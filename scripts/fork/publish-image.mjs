import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareCustomVersions, parseCustomVersion } from "./release-version.mjs";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const MANIFEST_ACCEPT =
  "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json";

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Registry response has no body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error("Registry response exceeds 64 KiB");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function registryToken(repository, username, token, fetchImpl) {
  const url = new URL("https://ghcr.io/token");
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${repository}:pull`);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GHCR token request failed with HTTP ${response.status}`);
  }
  const body = await readJson(response);
  if (typeof body.token !== "string" || !body.token) throw new Error("GHCR token response is invalid");
  return body.token;
}

async function registryDigest(repository, tag, token, fetchImpl) {
  const response = await fetchImpl(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (response.status === 404) {
    const body = await readJson(response);
    if (Array.isArray(body.errors) && body.errors.length === 1 && body.errors[0]?.code === "MANIFEST_UNKNOWN") return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`GHCR manifest lookup failed with HTTP ${response.status}`);
  }
  await response.body?.cancel();
  const digest = response.headers.get("docker-content-digest");
  if (!digest || !DIGEST_RE.test(digest)) throw new Error("GHCR manifest response has no valid digest");
  return digest;
}

function runDocker(args) {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }).trim();
}

function customImageTag(version) {
  return parseCustomVersion(version).version.slice(1);
}

export async function publishImage(
  { image, version, expectedId, username, token },
  { docker = runDocker, fetchImpl = fetch, imageTag = customImageTag, compareVersions = compareCustomVersions } = {},
) {
  const tag = imageTag(version);
  const match = /^ghcr\.io\/([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*):(.+)$/.exec(image);
  if (!match || match[2] !== tag || !DIGEST_RE.test(expectedId)) throw new Error("Invalid tested image identity");
  if (!username || !token) throw new Error("GHCR credentials are required");
  const repository = match[1];
  const base = `ghcr.io/${repository}`;
  const latestImage = `${base}:latest`;
  const inspect = (format, reference) => docker(["image", "inspect", "--format", format, reference]);
  const verifyId = (reference) => {
    if (inspect("{{.Id}}", reference) !== expectedId) throw new Error("Published image ID does not match the tested image");
  };

  const auth = await registryToken(repository, username, token, fetchImpl);
  let digest = await registryDigest(repository, match[2], auth, fetchImpl);
  if (!digest) {
    docker(["push", image]);
    digest = await registryDigest(repository, match[2], auth, fetchImpl);
    if (!digest) throw new Error("Published version tag has no registry digest");
  }
  const digestRef = `${base}@${digest}`;
  docker(["pull", digestRef]);
  verifyId(digestRef);

  const previousDigest = await registryDigest(repository, "latest", auth, fetchImpl);
  if (previousDigest) {
    const previousRef = `${base}@${previousDigest}`;
    docker(["pull", previousRef]);
    const previousVersion = inspect('{{index .Config.Labels "org.opencontainers.image.version"}}', previousRef);
    const comparison = compareVersions(version, previousVersion);
    if (comparison < 0)
      return { image, digestRef, latestImage, latestDigestRef: previousRef, latestVersion: previousVersion, latestStatus: "kept-newer" };
    if (comparison === 0) {
      if (previousDigest !== digest) throw new Error("Existing latest has the same version with a different digest");
      verifyId(previousRef);
      return { image, digestRef, latestImage, latestDigestRef: previousRef, latestVersion: previousVersion, latestStatus: "unchanged" };
    }
  }

  docker(["tag", expectedId, latestImage]);
  docker(["push", latestImage]);
  const promotedDigest = await registryDigest(repository, "latest", auth, fetchImpl);
  if (promotedDigest !== digest) throw new Error("Latest alias digest does not match the versioned image");
  docker(["pull", digestRef]);
  verifyId(digestRef);
  return { image, digestRef, latestImage, latestDigestRef: digestRef, latestVersion: version, latestStatus: "promoted" };
}

export function publicationOutputs(result) {
  return `image=${result.image}\ndigest-ref=${result.digestRef}\nlatest-image=${result.latestImage}\nlatest-digest-ref=${result.latestDigestRef}\nlatest-version=${result.latestVersion}\nlatest-status=${result.latestStatus}\n`;
}

export function publicationSummary(result) {
  return `## Verified custom image\n\nImage: \`${result.image}\`\n\nDigest: \`${result.digestRef}\`\n\nLatest: \`${result.latestImage}\` (${result.latestStatus}, \`${result.latestVersion}\`)\n\nLatest digest: \`${result.latestDigestRef}\`\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await publishImage({
      image: process.env.IMAGE,
      version: process.env.TAG,
      expectedId: process.env.EXPECTED_ID,
      username: process.env.GHCR_USER,
      token: process.env.GHCR_TOKEN,
    });
    appendFileSync(process.env.GITHUB_OUTPUT, publicationOutputs(result));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, publicationSummary(result));
  } catch {
    // Registry errors can include authorization data, so only emit a fixed failure message.
    console.error("Custom image publication or latest verification failed; no success summary was written");
    process.exitCode = 1;
  }
}
