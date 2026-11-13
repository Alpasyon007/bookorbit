import assert from "node:assert/strict";
import { test } from "node:test";
import { publishImage, publicationOutputs, publicationSummary } from "./publish-image.mjs";

const base = "ghcr.io/owner/bookorbit";
const version = "v3.8.0-custom.2";
const expectedId = `sha256:${"a".repeat(64)}`;
const digest = `sha256:${"b".repeat(64)}`;
const olderDigest = `sha256:${"c".repeat(64)}`;
const image = `${base}:${version.slice(1)}`;
const digestRef = `${base}@${digest}`;
const latestImage = `${base}:latest`;
const options = { image, version, expectedId, username: "owner", token: "secret-token" };
const missing = () => new Response(JSON.stringify({ errors: [{ code: "MANIFEST_UNKNOWN" }] }), { status: 404 });
const manifest = (value) => new Response("{}", { headers: { "docker-content-digest": value } });

function fixture({
  current = null,
  currentDigest = olderDigest,
  currentId = expectedId,
  failure,
  responses,
  promotedDigest = digest,
  existingVersion = false,
  versionedId = expectedId,
  promotedId = expectedId,
} = {}) {
  const calls = [];
  const requests = [];
  let inspectedCurrent = false;
  let latestPushed = false;
  const queue = responses ?? [
    new Response(JSON.stringify({ token: "registry-token" })),
    existingVersion ? manifest(digest) : missing(),
    ...(existingVersion ? [] : [manifest(digest)]),
    current ? manifest(currentDigest) : missing(),
    manifest(promotedDigest),
  ];
  const docker = (args) => {
    calls.push(args);
    if (failure?.(args, calls)) throw new Error("Mock Docker failure");
    if (args[0] === "push" && args[1] === latestImage) latestPushed = true;
    if (args[0] !== "image") return "";
    if (args[3] === "{{.Id}}")
      return latestPushed ? promotedId : inspectedCurrent && args[4] === `${base}@${currentDigest}` ? currentId : versionedId;
    if (args[3] === '{{index .Config.Labels "org.opencontainers.image.version"}}') {
      inspectedCurrent = true;
      return current;
    }
    throw new Error("Unexpected Docker inspection");
  };
  const fetchImpl = async (url, request) => {
    requests.push({ url: String(url), request });
    assert.equal(request.redirect, "error");
    assert.ok(request.signal instanceof AbortSignal);
    const response = queue.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, "Unexpected registry request");
    return response;
  };
  return { calls, requests, docker, fetchImpl };
}

test("bootstraps missing latest from the tested ID after verifying the versioned publication", async () => {
  const mocks = fixture();
  const result = await publishImage(options, mocks);
  assert.equal(result.latestStatus, "promoted");
  assert.equal(result.latestDigestRef, digestRef);
  assert.deepEqual(mocks.calls, [
    ["push", image],
    ["pull", digestRef],
    ["image", "inspect", "--format", "{{.Id}}", digestRef],
    ["tag", expectedId, latestImage],
    ["push", latestImage],
    ["pull", digestRef],
    ["image", "inspect", "--format", "{{.Id}}", digestRef],
  ]);
  assert.equal(mocks.requests[0].url, "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aowner%2Fbookorbit%3Apull");
  assert.equal(mocks.requests[0].request.headers.Authorization, `Basic ${Buffer.from("owner:secret-token").toString("base64")}`);
  assert.equal(mocks.requests[1].request.headers.Authorization, "Bearer registry-token");
  assert.equal(mocks.requests[1].url, `https://ghcr.io/v2/owner/bookorbit/manifests/${version.slice(1)}`);
  assert.match(publicationOutputs(result), /latest-status=promoted/);
  assert.match(publicationSummary(result), /Latest: `ghcr.io\/owner\/bookorbit:latest` \(promoted, `v3\.8\.0-custom\.2`\)/);
});

test("reuses an identical existing version by digest without pushing the version tag again", async () => {
  const mocks = fixture({ existingVersion: true });
  const result = await publishImage(options, mocks);
  assert.equal(result.digestRef, digestRef);
  assert.deepEqual(mocks.calls.slice(0, 2), [
    ["pull", digestRef],
    ["image", "inspect", "--format", "{{.Id}}", digestRef],
  ]);
  assert.ok(!mocks.calls.some(([command, reference]) => command === "push" && reference === image));
});

test("rejects an existing version with different image contents before any push", async () => {
  const mocks = fixture({ existingVersion: true, versionedId: `sha256:${"d".repeat(64)}` });
  await assert.rejects(publishImage(options, mocks), /Published image ID/);
  assert.deepEqual(mocks.calls, [
    ["pull", digestRef],
    ["image", "inspect", "--format", "{{.Id}}", digestRef],
  ]);
  assert.equal(mocks.requests.length, 2);
});

test("promotes a newer revision using the existing latest digest as a pinned comparison baseline", async () => {
  const mocks = fixture({ current: "v3.8.0-custom.1" });
  assert.equal((await publishImage(options, mocks)).latestStatus, "promoted");
  assert.ok(mocks.calls.some((args) => args[0] === "pull" && args[1] === `${base}@${olderDigest}`));
});

for (const current of ["v3.8.0-custom.3", "v3.8.1-custom.1", "v4.0.0-custom.1"]) {
  test(`keeps newer latest ${current} when an older tag is rerun`, async () => {
    const mocks = fixture({ current });
    const result = await publishImage(options, mocks);
    assert.equal(result.latestStatus, "kept-newer");
    assert.equal(result.latestVersion, current);
    assert.equal(result.latestDigestRef, `${base}@${olderDigest}`);
    assert.ok(!mocks.calls.some(([command, ref]) => command === "tag" || (command === "push" && ref === latestImage)));
    assert.match(publicationSummary(result), /kept-newer/);
  });
}

test("an identical release leaves latest unchanged after verifying its digest and image ID", async () => {
  const mocks = fixture({ current: version, currentDigest: digest });
  assert.equal((await publishImage(options, mocks)).latestStatus, "unchanged");
  assert.deepEqual(mocks.calls.at(-1), ["image", "inspect", "--format", "{{.Id}}", digestRef]);
  assert.ok(!mocks.calls.some(([command]) => command === "tag"));
});

for (const [name, changes] of [
  ["different digest", { currentDigest: olderDigest }],
  ["different image ID", { currentDigest: digest, currentId: `sha256:${"d".repeat(64)}` }],
]) {
  test(`rejects equal latest version with ${name} without overwriting it`, async () => {
    const mocks = fixture({ current: version, ...changes });
    await assert.rejects(publishImage(options, mocks));
    assert.ok(!mocks.calls.some(([command]) => command === "tag"));
  });
}

for (const current of ["dev", "v3.8.0", "v3.8.0-custom.01"]) {
  test(`refuses to replace latest with unrecognized version ${current}`, async () => {
    const mocks = fixture({ current });
    await assert.rejects(publishImage(options, mocks));
    assert.ok(!mocks.calls.some(([command]) => command === "tag"));
  });
}

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`token HTTP ${status} fails closed`, async () => {
    const mocks = fixture({ responses: [new Response("{}", { status })] });
    await assert.rejects(publishImage(options, mocks));
    assert.deepEqual(mocks.calls, []);
  });
}

for (const [name, response] of [
  ["authorization error", () => new Response("{}", { status: 401 })],
  ["access denied", () => new Response("{}", { status: 403 })],
  ["unknown repository", () => new Response(JSON.stringify({ errors: [{ code: "NAME_UNKNOWN" }] }), { status: 404 })],
  ["unclassified 404", () => new Response("{}", { status: 404 })],
  [
    "missing tag plus another error",
    () => new Response(JSON.stringify({ errors: [{ code: "MANIFEST_UNKNOWN" }, { code: "DENIED" }] }), { status: 404 }),
  ],
  ["registry outage", () => new Response("{}", { status: 503 })],
  ["malformed JSON", () => new Response("not-json", { status: 404 })],
  ["oversized body", () => new Response(" ".repeat(65_537), { status: 404 })],
  ["missing digest", () => new Response("{}")],
  ["invalid digest", () => manifest("untrusted-digest")],
  ["network failure", () => new Error("network error")],
]) {
  for (const tag of ["version", "latest"]) {
    test(`${tag} lookup ${name} fails closed`, async () => {
      const mocks = fixture({
        responses: [
          new Response(JSON.stringify({ token: "registry-token" })),
          ...(tag === "latest" ? [missing(), manifest(digest)] : []),
          response(),
        ],
      });
      await assert.rejects(publishImage(options, mocks));
      assert.ok(!mocks.calls.some(([command]) => command === "tag"));
      if (tag === "version") assert.deepEqual(mocks.calls, []);
    });
  }
}

for (const [name, failure] of [
  ["versioned push", ([command, ref]) => command === "push" && ref === image],
  ["versioned pull", ([command, ref]) => command === "pull" && ref === digestRef],
  ["latest push", ([command, ref]) => command === "push" && ref === latestImage],
  [
    "latest pull",
    ([command, ref], calls) =>
      command === "pull" && ref === digestRef && calls.some(([operation, reference]) => operation === "push" && reference === latestImage),
  ],
]) {
  test(`${name} failure rejects publication`, async () => {
    await assert.rejects(publishImage(options, fixture({ failure })));
  });
}

test("rejects a promoted latest digest different from the verified versioned digest", async () => {
  const mocks = fixture({ promotedDigest: olderDigest });
  await assert.rejects(publishImage(options, mocks), /Latest alias digest/);
  assert.equal(mocks.calls.filter(([command, ref]) => command === "pull" && ref === digestRef).length, 1);
});

test("rejects a pulled latest ID different from the tested ID", async () => {
  await assert.rejects(publishImage(options, fixture({ promotedId: `sha256:${"d".repeat(64)}` })), /Published image ID/);
});

test("rejects a newly published version with a different ID before promoting latest", async () => {
  const mocks = fixture({ versionedId: `sha256:${"d".repeat(64)}` });
  await assert.rejects(publishImage(options, mocks), /Published image ID/);
  assert.ok(!mocks.calls.some(([command]) => command === "tag"));
});

test("rejects a missing versioned manifest after a successful push", async () => {
  const mocks = fixture({ responses: [new Response(JSON.stringify({ token: "registry-token" })), missing(), missing()] });
  await assert.rejects(publishImage(options, mocks), /Published version tag has no registry digest/);
  assert.deepEqual(mocks.calls, [["push", image]]);
});
