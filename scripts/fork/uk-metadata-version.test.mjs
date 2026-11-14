import assert from "node:assert/strict";
import { test } from "node:test";
import { publishImage } from "./publish-image.mjs";
import { compareUkMetadataVersions, ukMetadataImageTag, validateUkMetadataReleaseTag } from "./uk-metadata-version.mjs";

const image = "ghcr.io/owner/bookorbit-uk-metadata:0.1.0";
const expectedId = `sha256:${"a".repeat(64)}`;
const digest = `sha256:${"b".repeat(64)}`;
const newerDigest = `sha256:${"c".repeat(64)}`;
const latest = "ghcr.io/owner/bookorbit-uk-metadata:latest";
const versionRef = `ghcr.io/owner/bookorbit-uk-metadata@${digest}`;
const options = { image, version: "0.1.0", expectedId, username: "owner", token: "secret-token" };

function publication({ previousVersion, previousDigest = newerDigest, existingVersion = false, imageId = expectedId } = {}) {
  const dockerCalls = [];
  const missing = () => new Response(JSON.stringify({ errors: [{ code: "MANIFEST_UNKNOWN" }] }), { status: 404 });
  const manifest = (value) => new Response("{}", { headers: { "docker-content-digest": value } });
  const responses = [
    new Response(JSON.stringify({ token: "registry-token" })),
    ...(existingVersion ? [] : [missing()]),
    manifest(digest),
    previousVersion ? manifest(previousDigest) : missing(),
    manifest(digest),
  ];
  const runtime = {
    imageTag: ukMetadataImageTag,
    compareVersions: compareUkMetadataVersions,
    async fetchImpl(url) {
      assert.equal(new URL(url).hostname, "ghcr.io");
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    docker(args) {
      dockerCalls.push(args);
      if (args[3] === "{{.Id}}") return imageId;
      if (args[3] === '{{index .Config.Labels "org.opencontainers.image.version"}}') return previousVersion;
      return "";
    },
  };
  return { dockerCalls, runtime };
}

test("release tag must carry the exact stable package version", () => {
  assert.equal(validateUkMetadataReleaseTag("uk-metadata-v0.1.0", "0.1.0"), "0.1.0");
  for (const invalid of ["v0.1.0", "uk-metadata-v0.1.1", "uk-metadata-v0.1.0\n", "uk-metadata-v00.1.0", "uk-metadata-v0.1.0-custom.1"]) {
    assert.throws(() => validateUkMetadataReleaseTag(invalid, "0.1.0"));
  }
  assert.throws(() => validateUkMetadataReleaseTag("uk-metadata-v0.01.0", "0.01.0"));
  assert.throws(() => validateUkMetadataReleaseTag("uk-metadata-v9007199254740992.0.0", "9007199254740992.0.0"));
});

test("stable versions compare numerically across patch, minor and major changes", () => {
  assert.equal(compareUkMetadataVersions("0.1.10", "0.1.2"), 1);
  assert.equal(compareUkMetadataVersions("0.99.99", "1.0.0"), -1);
  assert.equal(compareUkMetadataVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareUkMetadataVersions("0.1.0", "v0.1.0"), 0);
  assert.throws(() => compareUkMetadataVersions("0.1.0", "v3.8.0-custom.11"));
});

test("publishes checked provider ID and verifies matching version and latest digests", async () => {
  const { dockerCalls, runtime } = publication();
  const result = await publishImage(options, runtime);
  assert.equal(result.latestStatus, "promoted");
  assert.equal(result.digestRef, versionRef);
  assert.equal(result.latestDigestRef, versionRef);
  assert.ok(dockerCalls.some(([command, reference]) => command === "push" && reference === image));
  assert.ok(dockerCalls.some(([command, id, reference]) => command === "tag" && id === expectedId && reference === latest));
  assert.ok(dockerCalls.some(([command, reference]) => command === "pull" && reference === versionRef));
});

test("keeps an existing newer latest on an older provider rerun", async () => {
  const { dockerCalls, runtime } = publication({ previousVersion: "0.2.0", existingVersion: true });
  const result = await publishImage(options, runtime);
  assert.equal(result.latestStatus, "kept-newer");
  assert.equal(result.latestVersion, "0.2.0");
  assert.ok(!dockerCalls.some(([command]) => command === "push" || command === "tag"));
});

test("fails closed when immutable provider publication or same-version latest differs", async () => {
  const immutable = publication({ existingVersion: true, imageId: `sha256:${"d".repeat(64)}` });
  await assert.rejects(publishImage(options, immutable.runtime), /Published image ID/);
  assert.ok(!immutable.dockerCalls.some(([command]) => command === "push"));
  const alias = publication({ existingVersion: true, previousVersion: "0.1.0" });
  await assert.rejects(publishImage(options, alias.runtime), /same version with a different digest/);
  assert.ok(!alias.dockerCalls.some(([command]) => command === "push" || command === "tag"));
});
