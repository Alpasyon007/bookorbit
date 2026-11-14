import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import packageInfo from "./package.json" with { type: "json" };
import { isbn13 } from "./book.mjs";
import { createHachette } from "./hachette.mjs";
import { createRetailers } from "./retailers.mjs";
import { createUpstream, SourceError } from "./upstream.mjs";

const VERSION = packageInfo.version;
const MAX_ACTIVE_REQUESTS = 6;
const REQUEST_TIMEOUT_MS = 8_500;
const ROUTE = /^\/(hachette-uk|waterstones|foyles)\/(provider\/info|search|book\/([^/]+))\/?$/;
const METADATA_FIELDS = ["title", "authors", "publisher", "isbn", "publishedYear", "pageCount", "cover"];
const NAMES = {
  "hachette-uk": "Hachette UK",
  waterstones: "Waterstones Jackets (Open Library metadata)",
  foyles: "Foyles Jackets (Open Library metadata)",
};

export function createMetadataServer({ authToken, contact, fetcher, logger = console } = {}) {
  const upstream = createUpstream({ fetcher, contact, version: VERSION });
  const providers = { "hachette-uk": createHachette(upstream), ...createRetailers(upstream) };
  const tokenHash = authToken && digest(`Bearer ${authToken}`);
  const caches = new Map();
  let active = 0;

  return createServer({ maxHeaderSize: 8_192, requestTimeout: 10_000, headersTimeout: 5_000 }, async (req, res) => {
    if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
    if (!req.url || req.url.length > 2_048 || !req.url.startsWith("/") || req.url.startsWith("//")) return send(res, 400, { error: "Invalid URL" });
    let url;
    try {
      url = new URL(req.url, "http://local");
    } catch {
      return send(res, 400, { error: "Invalid URL" });
    }
    if (url.origin !== "http://local") return send(res, 400, { error: "Invalid URL" });
    if (url.pathname === "/health") return send(res, 200, { status: "ok" });
    const route = ROUTE.exec(url.pathname);
    if (!route) return send(res, 404, { error: "Not found" });
    if (tokenHash && !timingSafeEqual(tokenHash, digest(req.headers.authorization ?? ""))) {
      return send(res, 401, { error: "Authorization required" }, { "WWW-Authenticate": "Bearer" });
    }

    const [, key, endpoint, id] = route;
    if (endpoint === "provider/info") return send(res, 200, providerInfo(key, Boolean(tokenHash)));
    const isLookup = Boolean(id);
    const params = isLookup ? parseId(id) : parseSearch(url.searchParams);
    if (!params) return send(res, 400, { error: "Invalid title, ISBN, media or result limit" });
    if (params.incompatible) return send(res, 200, { matches: [] });

    const cacheKey = JSON.stringify([key, endpoint === "search", params]);
    const cached = caches.get(cacheKey);
    if (cached && cached.expires > Date.now()) return reply(res, isLookup, cached.result);
    if (active >= MAX_ACTIVE_REQUESTS) return send(res, 429, { error: "Provider is busy" }, { "Retry-After": "2" });

    active++;
    const cancellation = new AbortController();
    const stop = () => cancellation.abort();
    res.once("close", stop);
    const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    const startedAt = Date.now();
    const operation = isLookup ? "lookup" : "search";
    logger.info(`[uk_metadata.request] [start] provider=${key} operation=${operation} - provider request started`);
    try {
      const provider = providers[key];
      const result = isLookup ? await provider.lookup(params.isbn, signal) : await provider.search({ ...params, signal });
      if (cancellation.signal.aborted) return;
      if (!result?.partial) {
        caches.set(cacheKey, { result, expires: Date.now() + (result && (isLookup || result.matches.length) ? 300_000 : 60_000) });
        if (caches.size > 128) caches.delete(caches.keys().next().value);
      }
      const results = isLookup ? Number(Boolean(result)) : result.matches.length;
      logger.info(
        `[uk_metadata.request] [end] provider=${key} operation=${operation} durationMs=${Date.now() - startedAt} resultCount=${results} partial=${Boolean(result?.partial)} - provider request completed`,
      );
      reply(res, isLookup, result);
    } catch (error) {
      if (cancellation.signal.aborted) return;
      const failure = error instanceof SourceError ? error : new SourceError();
      logger.warn(
        `[uk_metadata.request] [fail] provider=${key} operation=${operation} durationMs=${Date.now() - startedAt} errorClass=SourceError error="${sanitizeLogValue(failure.message)}" - provider request failed`,
      );
      send(res, failure.status, { error: failure.message }, failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {});
    } finally {
      active--;
      res.off("close", stop);
    }
  });
}

function providerInfo(key, authenticationRequired) {
  const isHachette = key === "hachette-uk";
  return {
    name: NAMES[key],
    key,
    version: VERSION,
    mediaTypes: ["book"],
    lookup: true,
    searchParams: ["query", "author", "mediaType", "isbn", "limit"],
    supportedFields: [...METADATA_FIELDS, ...(isHachette ? ["description", "genres"] : ["language"])],
    idMaxLength: 13,
    coverShape: "portrait",
    authenticationRequired,
    rateLimit: { maxConcurrency: 1, minIntervalMs: 1_050 },
  };
}

function parseId(id) {
  const isbn = isbn13(id);
  return isbn === id ? { isbn } : undefined;
}

function parseSearch(params) {
  const query = (params.get("query") ?? "").trim();
  const author = (params.get("author") ?? "").trim();
  const rawIsbn = (params.get("isbn") ?? "").trim();
  const media = params.get("mediaType");
  const rawLimit = params.get("limit") ?? "6";
  if (query.length > 250 || author.length > 180 || rawIsbn.length > 32 || !/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) === 0) return;
  const isbn = isbn13(rawIsbn || query);
  if (rawIsbn && !isbn) return;
  if (!query && !isbn) return;
  return { query, author, isbn, limit: Math.min(8, Number(rawLimit)), incompatible: Boolean(media && media !== "book") };
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function sanitizeLogValue(value) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 200)
    .replace(/["\\]/g, "\\$&");
}

function reply(res, isLookup, result) {
  if (isLookup && !result) return send(res, 404, { error: "Book not found" });
  send(res, 200, result);
}

function send(res, status, result, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { AUTH_TOKEN: authToken, OPEN_LIBRARY_CONTACT: contact, PORT: rawPort = "8080" } = process.env;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be between 1 and 65535");
  const server = createMetadataServer({ authToken, contact });
  server.listen(port, "0.0.0.0", () => console.info(`BookOrbit UK metadata v${VERSION} listening on ${port}`));
  process.once("SIGTERM", () => server.close());
  process.once("SIGINT", () => server.close());
}
