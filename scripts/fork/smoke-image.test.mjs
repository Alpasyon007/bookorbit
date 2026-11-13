import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { smokeImage } from "./smoke-image.mjs";

function customNote(version = "v3.8.0-custom.2") {
  return {
    version,
    name: `Custom release ${version}`,
    date: "2026-11-13T00:00:00.000Z",
    highlights: [{ icon: null, title: "Visible custom changes", body: "Custom builds now show their changes in What's New.", media: [] }],
    changelogBody: "### Changes\n- Include bundled custom release notes in the archive and update popup.",
    changelogUrl: `https://github.com/Alpasyon007/bookorbit/tree/${version}`,
  };
}

async function fixture(t, overrides = {}, expectedVersion = "v3.8.0-custom.2") {
  let initialized = false;
  let updateChecksDisabled = false;
  let credentials;
  const calls = [];
  const user = { id: 42, username: "fork-smoke-admin", active: true, isSuperuser: true };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: req.url, method: req.method, body, headers: req.headers });
    const override = overrides[req.url];
    if (override) {
      const result = await override({ req, body, calls });
      if (result === null) return;
      res.writeHead(result.status ?? 200, { "content-type": result.contentType ?? "application/json" });
      res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
      return;
    }

    let status = 200;
    let response;
    let contentType = "application/json";
    switch (req.url) {
      case "/api/v1/health":
        response = { status: "ok", details: { database: { status: "up" } } };
        break;
      case "/api/v1/auth/setup-status":
        response = { needsSetup: !initialized, allowRegistration: false };
        break;
      case "/api/v1/auth/setup":
        assert.equal(req.headers["x-setup-token"], "test-bootstrap-token");
        assert.equal(req.method, "POST");
        initialized = true;
        credentials = body;
        status = 201;
        response = { user, accessToken: "setup-token" };
        break;
      case "/api/v1/auth/login":
        assert.equal(body.username, credentials.username);
        assert.equal(body.password, credentials.password);
        response = { user, accessToken: "login-token" };
        break;
      case "/api/v1/auth/me":
        assert.equal(req.headers.authorization, "Bearer login-token");
        response = user;
        break;
      case "/api/v1/books/query":
        assert.equal(req.headers.authorization, "Bearer login-token");
        assert.deepEqual(body, { pagination: { page: 0, size: 1 } });
        status = 201;
        response = { items: [], total: 0, page: 0, size: 1 };
        break;
      case "/api/v1/books/search?q=fork-smoke&limit=1":
        assert.equal(req.headers.authorization, "Bearer login-token");
        response = [];
        break;
      case "/api/v1/app-info":
        assert.equal(req.headers.authorization, "Bearer login-token");
        response = { version: expectedVersion };
        break;
      case "/api/v1/app-settings/update_check_enabled":
        assert.equal(req.headers.authorization, "Bearer login-token");
        assert.equal(req.method, "PATCH");
        assert.deepEqual(body, { value: "false" });
        updateChecksDisabled = true;
        response = { key: "update_check_enabled", value: "false" };
        break;
      case "/api/v1/release-notes?page=1":
        assert.equal(req.headers.authorization, "Bearer login-token");
        assert.equal(updateChecksDisabled, true);
        response = { releases: expectedVersion.includes("-custom.") ? [customNote(expectedVersion)] : [], hasMore: false };
        break;
      case "/api/v1/release-notes?page=2":
        assert.equal(req.headers.authorization, "Bearer login-token");
        response = { releases: [], hasMore: false };
        break;
      case "/api/v1/release-notes?since=v3.8.0-custom.1":
        assert.equal(req.headers.authorization, "Bearer login-token");
        response = { releases: [customNote(expectedVersion)], hasMore: false };
        break;
      case "/":
        contentType = "text/html";
        response = '<html><div id="app"></div><script type="module" src="/assets/app.js"></script></html>';
        break;
      case "/assets/app.js":
        contentType = "text/javascript";
        response = 'console.log("built client");';
        break;
      default:
        status = 404;
        response = {};
    }
    res.writeHead(status, { "content-type": contentType });
    res.end(typeof response === "string" ? response : JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    calls,
    options: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      expectedVersion,
      setupToken: "test-bootstrap-token",
      readyTimeoutMs: 2_000,
      pollIntervalMs: 10,
      requestTimeoutMs: 1_000,
    },
  };
}

test("checks a fresh production instance using the returned login token and bounded queries", async (t) => {
  const { options, calls } = await fixture(t);
  const result = await smokeImage(options);
  assert.equal(result.version, options.expectedVersion);
  assert.equal(result.checks.length, 9);
  assert.ok(result.checks.includes("release-notes"));
  assert.equal(calls.filter((call) => call.path === "/api/v1/auth/setup").length, 1);
  assert.equal(calls.at(-1).path, "/assets/app.js");
  assert.deepEqual(
    calls.filter((call) => call.path.startsWith("/api/v1/release-notes")).map((call) => call.path),
    ["/api/v1/release-notes?page=1", "/api/v1/release-notes?page=2", "/api/v1/release-notes?since=v3.8.0-custom.1"],
  );
});

test("requires bundled notes for the first custom revision without inventing revision zero", async (t) => {
  const { options, calls } = await fixture(t, {}, "v3.8.0-custom.1");
  await smokeImage(options);
  assert.equal(
    calls.some((call) => call.path.includes("since=")),
    false,
  );
  assert.equal(calls.filter((call) => call.path.startsWith("/api/v1/release-notes")).length, 2);
});

test("checks archive shape for branch builds without requiring a bundled SHA release", async (t) => {
  const { options, calls } = await fixture(t, {}, "sha-abcdef123456");
  await smokeImage(options);
  assert.equal(calls.filter((call) => call.path.startsWith("/api/v1/release-notes")).length, 1);
});

test("waits through temporary migration readiness failures", async (t) => {
  let attempts = 0;
  const { options } = await fixture(t, {
    "/api/v1/health": () =>
      ++attempts < 3 ? { status: 503, body: { status: "error" } } : { body: { status: "ok", details: { database: { status: "up" } } } },
  });
  await smokeImage(options);
  assert.equal(attempts, 3);
});

test("fails closed when database health never becomes ready", async (t) => {
  const { options, calls } = await fixture(t, { "/api/v1/health": () => ({ body: { status: "ok", details: { database: { status: "down" } } } }) });
  await assert.rejects(smokeImage({ ...options, readyTimeoutMs: 40 }), /readiness deadline/);
  assert.ok(calls.every((call) => call.path === "/api/v1/health"));
});

test("refuses an initialized database before creating any account", async (t) => {
  const { options, calls } = await fixture(t, { "/api/v1/auth/setup-status": () => ({ body: { needsSetup: false } }) });
  await assert.rejects(smokeImage(options), /already initialized/);
  assert.equal(
    calls.some((call) => call.method === "POST"),
    false,
  );
});

for (const [label, path, result, message] of [
  ["failed login", "/api/v1/auth/login", { status: 401, body: {} }, /HTTP status/],
  ["missing token", "/api/v1/auth/login", { body: { user: { id: 42 } } }, /access token/],
  ["wrong session user", "/api/v1/auth/me", { body: { id: 7 } }, /created user/],
  ["broken browse response", "/api/v1/books/query", { status: 201, body: { data: [] } }, /empty library/],
  ["failed search", "/api/v1/books/search?q=fork-smoke&limit=1", { status: 500, body: {} }, /HTTP status/],
  ["wrong image version", "/api/v1/app-info", { body: { version: "v3.6.0.1" } }, /tested image version/],
  ["unauthorized disposable setting update", "/api/v1/app-settings/update_check_enabled", { status: 403, body: {} }, /HTTP status/],
  [
    "unchanged upstream-fetch setting",
    "/api/v1/app-settings/update_check_enabled",
    { body: { key: "update_check_enabled", value: "true" } },
    /must be disabled/,
  ],
  ["unauthorized release archive", "/api/v1/release-notes?page=1", { status: 401, body: {} }, /HTTP status/],
  ["missing release array", "/api/v1/release-notes?page=1", { body: { hasMore: false } }, /releases array/],
  ["invalid release pagination", "/api/v1/release-notes?page=1", { body: { releases: [], hasMore: "false" } }, /pagination flag/],
  ["unidentified release entry", "/api/v1/release-notes?page=1", { body: { releases: [{}], hasMore: false } }, /identify its version/],
  ["missing bundled notes", "/api/v1/release-notes?page=1", { body: { releases: [], hasMore: false } }, /exactly once/],
  ["wrong bundled version", "/api/v1/release-notes?page=1", { body: { releases: [customNote("v3.8.0-custom.1")], hasMore: false } }, /exactly once/],
  ["duplicate current notes", "/api/v1/release-notes?page=1", { body: { releases: [customNote(), customNote()], hasMore: false } }, /exactly once/],
  [
    "empty release title",
    "/api/v1/release-notes?page=1",
    { body: { releases: [{ ...customNote(), name: "  " }], hasMore: false } },
    /must have a title/,
  ],
  [
    "missing highlights",
    "/api/v1/release-notes?page=1",
    { body: { releases: [{ ...customNote(), highlights: [] }], hasMore: false } },
    /must have highlights/,
  ],
  [
    "empty highlight body",
    "/api/v1/release-notes?page=1",
    { body: { releases: [{ ...customNote(), highlights: [{ title: "Changes", body: " " }] }], hasMore: false } },
    /nonempty titles and bodies/,
  ],
  [
    "empty highlight title",
    "/api/v1/release-notes?page=1",
    { body: { releases: [{ ...customNote(), highlights: [{ title: " ", body: "Changes" }] }], hasMore: false } },
    /nonempty titles and bodies/,
  ],
  [
    "empty changelog",
    "/api/v1/release-notes?page=1",
    { body: { releases: [{ ...customNote(), changelogBody: "\n" }], hasMore: false } },
    /changelog body/,
  ],
  [
    "upstream changelog link",
    "/api/v1/release-notes?page=1",
    { body: { releases: [{ ...customNote(), changelogUrl: "https://github.com/bookorbit/bookorbit/releases/tag/v3.8.0" }], hasMore: false } },
    /fork source/,
  ],
  ["repeated current archive page", "/api/v1/release-notes?page=2", { body: { releases: [customNote()], hasMore: false } }, /must not repeat/],
  ["missing current revision update", "/api/v1/release-notes?since=v3.8.0-custom.1", { body: { releases: [], hasMore: false } }, /exactly once/],
  [
    "repeated baseline notes",
    "/api/v1/release-notes?since=v3.8.0-custom.1",
    { body: { releases: [customNote(), customNote("v3.8.0-custom.1")], hasMore: false } },
    /must not repeat baseline/,
  ],
  [
    "repeated upstream notes",
    "/api/v1/release-notes?since=v3.8.0-custom.1",
    { body: { releases: [customNote(), customNote("v3.8.0")], hasMore: false } },
    /must not repeat baseline/,
  ],
  [
    "spurious revision pagination",
    "/api/v1/release-notes?since=v3.8.0-custom.1",
    { body: { releases: [customNote()], hasMore: true } },
    /must not claim additional/,
  ],
  ["missing client", "/", { contentType: "text/html", body: "<html></html>" }, /app root/],
  ["missing built asset", "/assets/app.js", { status: 404, body: {} }, /HTTP status/],
  ["redirected API", "/api/v1/auth/setup-status", { status: 302, body: {} }, /request bounds/],
  ["malformed JSON", "/api/v1/auth/setup-status", { body: "not JSON" }, /invalid JSON/],
]) {
  test(`rejects ${label}`, async (t) => {
    const { options } = await fixture(t, { [path]: () => result });
    await assert.rejects(smokeImage(options), message);
  });
}

test("aborts a stalled API request", async (t) => {
  const { options, calls } = await fixture(t, { "/api/v1/auth/login": () => null });
  await assert.rejects(smokeImage({ ...options, requestTimeoutMs: 100 }), /request bounds/);
  assert.equal(calls.at(-1).path, "/api/v1/auth/login");
});

test("rejects nonlocal targets and missing version before making requests", async () => {
  const options = { baseUrl: "http://example.com", expectedVersion: "v3.8.0-custom.1", setupToken: "test" };
  await assert.rejects(smokeImage(options), /loopback/);
  await assert.rejects(smokeImage({ ...options, baseUrl: "http://127.0.0.1", expectedVersion: "" }), /version is required/);
  await assert.rejects(smokeImage({ ...options, baseUrl: "http://user:secret@127.0.0.1" }), /without credentials/);
});
