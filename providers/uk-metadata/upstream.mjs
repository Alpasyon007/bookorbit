const ORIGINS = {
  "https://www.hachette.co.uk": { limit: 2, interval: 150 },
  "https://openlibrary.org": { limit: 1, interval: 1_050 },
  "https://cdn.waterstones.com": { limit: 2, interval: 150 },
  "https://cdn.foyles.co.uk": { limit: 2, interval: 150 },
};
const MAX_ACTIVE = 4;
const MAX_QUEUED = 16;
const FETCH_TIMEOUT_MS = 5_000;

export class SourceError extends Error {
  constructor(status = 502, retryAfter) {
    super(status === 429 ? "Source rate limit reached" : "Source unavailable");
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function createUpstream({ fetcher = fetch, contact = "", version } = {}) {
  const agent = `BookOrbit-UK-Metadata/${version ?? "dev"}${contact ? ` (${contact})` : ""}`;
  const hosts = new Map(Object.entries(ORIGINS).map(([origin, settings]) => [origin, { ...settings, active: 0, next: 0, cooldownUntil: 0 }]));
  const queued = [];
  let active = 0;
  let timer;

  function drain() {
    clearTimeout(timer);
    let wakeAfter = Infinity;
    for (let index = 0; index < queued.length && active < MAX_ACTIVE;) {
      const job = queued[index];
      const now = Date.now();
      if (job.host.active >= job.host.limit) {
        index++;
        continue;
      }
      if (job.host.cooldownUntil <= now && job.host.next > now) {
        wakeAfter = Math.min(wakeAfter, job.host.next - now);
        index++;
        continue;
      }
      queued.splice(index, 1);
      job.signal.removeEventListener("abort", job.cancel);
      job.run();
    }
    if (Number.isFinite(wakeAfter)) timer = setTimeout(drain, wakeAfter);
  }

  async function get(url, { signal, kind, maxBytes }) {
    const host = hosts.get(url.origin);
    if (!host || url.username || url.password) throw new SourceError();
    if (signal.aborted) throw signal.reason;
    if (queued.length >= MAX_QUEUED) throw new SourceError(503);

    return new Promise((resolve, reject) => {
      const cancel = () => {
        const index = queued.indexOf(job);
        if (index !== -1) queued.splice(index, 1);
        reject(signal.reason);
        drain();
      };
      const run = async () => {
        const now = Date.now();
        if (host.cooldownUntil > now) {
          reject(new SourceError(429, Math.ceil((host.cooldownUntil - now) / 1_000)));
          return;
        }
        active++;
        host.active++;
        host.next = now + host.interval;
        try {
          const response = await fetcher(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
            redirect: "manual",
            headers: { "User-Agent": agent, Accept: acceptHeader(kind) },
          });
          if (response.status === 429) {
            const delay = retrySeconds(response.headers.get("Retry-After"));
            host.cooldownUntil = Date.now() + delay * 1_000;
            await response.body?.cancel();
            throw new SourceError(429, delay);
          }
          const status = response.status;
          const contentType = response.headers.get("Content-Type") ?? "";
          if (status === 404 || status === 410 || [301, 302, 303, 307, 308].includes(status)) {
            await response.body?.cancel();
            resolve({ status, contentType, location: response.headers.get("Location") });
            return;
          }
          if (status !== 200 || !response.body) {
            await response.body?.cancel();
            throw new SourceError();
          }
          resolve({ status, contentType, bytes: await readBoundedBody(response, maxBytes) });
        } catch (error) {
          reject(error instanceof SourceError ? error : new SourceError());
        } finally {
          active--;
          host.active--;
          drain();
        }
      };
      const job = { host, signal, cancel, run };
      queued.push(job);
      signal.addEventListener("abort", cancel, { once: true });
      drain();
    });
  }

  return { get };
}

function acceptHeader(kind) {
  if (kind === "html") return "text/html";
  if (kind === "image") return "image/jpeg,image/png,image/webp";
  return "application/json";
}

function retrySeconds(value) {
  if (value && /^\d+$/.test(value)) return Math.min(3_600, Math.max(1, Number(value)));
  const at = Date.parse(value ?? "");
  return Number.isFinite(at) ? Math.min(3_600, Math.max(1, Math.ceil((at - Date.now()) / 1_000))) : 60;
}

async function readBoundedBody(response, maxBytes) {
  if (Number(response.headers.get("Content-Length")) > maxBytes) {
    await response.body.cancel();
    throw new SourceError();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, size);
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SourceError();
    }
    chunks.push(value);
  }
}

export async function collectMatches(inputs, limit, load) {
  const matches = [];
  let failure;
  for (let index = 0; index < inputs.length && matches.length < limit; index += 2) {
    const results = await Promise.allSettled(inputs.slice(index, index + 2).map(load));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) matches.push(result.value);
      if (result.status === "rejected") {
        if (result.reason instanceof SourceError && result.reason.status === 429) throw result.reason;
        failure = result.reason;
      }
    }
    if (failure && matches.length === 0) throw failure;
  }
  return { matches: matches.slice(0, limit), ...(failure ? { partial: true } : {}) };
}
