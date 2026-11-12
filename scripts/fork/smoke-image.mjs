import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function validateOptions({ baseUrl, expectedVersion, setupToken, readyTimeoutMs, pollIntervalMs, requestTimeoutMs }) {
  const url = new URL(baseUrl);
  assert.ok(
    url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "Smoke tests require an HTTP loopback URL for a disposable container",
  );
  assert.ok(!url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "Smoke URL must be an origin without credentials");
  assert.ok(typeof expectedVersion === "string" && expectedVersion.trim(), "Expected image version is required");
  assert.ok(typeof setupToken === "string" && setupToken.trim(), "Disposable setup token is required");
  for (const value of [readyTimeoutMs, pollIntervalMs, requestTimeoutMs]) {
    assert.ok(Number.isSafeInteger(value) && value > 0, "Smoke timeouts must be positive integers");
  }
  return url.origin;
}

async function readBody(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= MAX_RESPONSE_BYTES, "Smoke response exceeded the size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function request(origin, path, { method = "GET", body, token, setupToken, status = 200, timeoutMs, text = false } = {}) {
  const headers = { accept: text ? "text/html,application/javascript" : "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (setupToken) headers["x-setup-token"] = setupToken;

  let response;
  let content;
  try {
    response = await fetch(new URL(path, origin), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    content = await readBody(response);
  } catch {
    throw new Error(`${method} ${path} did not complete within the request bounds`);
  }
  assert.equal(response.status, status, `${method} ${path} returned an unexpected HTTP status`);
  if (text) return { content, contentType: response.headers.get("content-type") ?? "" };
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i, `${method} ${path} must return JSON`);
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${method} ${path} returned invalid JSON`);
  }
}

async function waitUntilHealthy(origin, { readyTimeoutMs, pollIntervalMs, requestTimeoutMs }) {
  const deadline = Date.now() + readyTimeoutMs;
  do {
    try {
      const health = await request(origin, "/api/v1/health", { timeoutMs: Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())) });
      assert.equal(health.status, "ok");
      assert.equal(health.details?.database?.status, "up");
      return;
    } catch {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  } while (Date.now() < deadline);
  throw new Error("Container did not become healthy before the readiness deadline");
}

export async function smokeImage({
  baseUrl,
  expectedVersion,
  setupToken,
  readyTimeoutMs = 120_000,
  pollIntervalMs = 2_000,
  requestTimeoutMs = 15_000,
}) {
  const options = { baseUrl, expectedVersion, setupToken, readyTimeoutMs, pollIntervalMs, requestTimeoutMs };
  const origin = validateOptions(options);
  const call = (path, settings = {}) => request(origin, path, { timeoutMs: requestTimeoutMs, ...settings });
  await waitUntilHealthy(origin, options);

  const setupStatus = await call("/api/v1/auth/setup-status");
  assert.equal(setupStatus.needsSetup, true, "Refusing to modify an already initialized instance");
  const username = "fork-smoke-admin";
  const password = `SmokeA1!${randomUUID()}`;
  const setup = await call("/api/v1/auth/setup", {
    method: "POST",
    status: 201,
    setupToken,
    body: { username, name: "Fork smoke test", email: "fork-smoke@example.invalid", password },
  });
  assert.ok(Number.isSafeInteger(setup.user?.id) && setup.user.id > 0, "Setup must return the created user");
  assert.equal((await call("/api/v1/auth/setup-status")).needsSetup, false, "Setup must persist its completed state");

  const login = await call("/api/v1/auth/login", { method: "POST", body: { username, password } });
  assert.ok(typeof login.accessToken === "string" && login.accessToken.length > 0, "Login must return an access token");
  assert.equal(login.user?.id, setup.user.id, "Login must identify the newly created user");
  const token = login.accessToken;
  const user = await call("/api/v1/auth/me", { token });
  assert.equal(user.id, setup.user.id, "Authenticated session must identify the created user");
  assert.equal(user.username, username);
  assert.equal(user.active, true);
  assert.equal(user.isSuperuser, true);

  const browse = await call("/api/v1/books/query", { method: "POST", status: 201, token, body: { pagination: { page: 0, size: 1 } } });
  assert.deepEqual(browse.items, [], "Disposable instance must have an empty library");
  assert.equal(browse.total, 0);
  assert.equal(browse.page, 0);
  assert.equal(browse.size, 1);
  assert.deepEqual(await call("/api/v1/books/search?q=fork-smoke&limit=1", { token }), [], "Empty-library search must succeed");
  const info = await call("/api/v1/app-info", { token });
  assert.equal(info.version, expectedVersion, "Running container version must match the tested image version");

  const html = await call("/", { text: true });
  assert.match(html.contentType, /text\/html/i, "Production image must serve the client HTML");
  assert.match(html.content, /<div\b[^>]*\bid=["']app["']/i, "Client HTML must include its app root");
  const modulePath = html.content.match(/<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  assert.ok(modulePath?.startsWith("/assets/"), "Client HTML must reference a built module asset");
  const asset = await call(modulePath, { text: true });
  assert.match(asset.contentType, /(?:java|ecma)script/i, "Built client module must be served as JavaScript");
  assert.ok(asset.content.length > 0, "Built client module must not be empty");

  return { version: info.version, checks: ["health", "fresh-setup", "login", "session", "browse", "search", "version", "client-assets"] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  smokeImage({
    baseUrl: process.env.FORK_SMOKE_BASE_URL ?? "http://127.0.0.1:3000",
    expectedVersion: process.env.FORK_SMOKE_VERSION,
    setupToken: process.env.SETUP_BOOTSTRAP_TOKEN,
  }).then(
    ({ checks }) => console.log(`Container smoke checks passed: ${checks.join(", ")}`),
    (error) => {
      console.error(`Container smoke checks failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
