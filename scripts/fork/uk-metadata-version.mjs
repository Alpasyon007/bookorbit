import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_PREFIX = "uk-metadata-v";
const PACKAGE = new URL("../../providers/uk-metadata/package.json", import.meta.url);

export function parseUkMetadataVersion(version) {
  const match = typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || match[0] !== version || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("UK metadata image versions must use MAJOR.MINOR.PATCH with no leading zeroes");
  }
  return match.slice(1).map(Number);
}

export function compareUkMetadataVersions(candidate, current) {
  const left = parseUkMetadataVersion(candidate);
  const right = parseUkMetadataVersion(typeof current === "string" && current.startsWith("v") ? current.slice(1) : current);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

export function ukMetadataImageTag(version) {
  parseUkMetadataVersion(version);
  return version;
}

export function validateUkMetadataReleaseTag(tag, packageVersion) {
  const version = ukMetadataImageTag(packageVersion);
  if (tag !== `${RELEASE_PREFIX}${version}`) throw new Error("UK metadata release tag must match uk-metadata-vMAJOR.MINOR.PATCH and package.json");
  return version;
}

export function ukMetadataPackageVersion() {
  return ukMetadataImageTag(JSON.parse(readFileSync(PACKAGE, "utf8")).version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error("Pass at most one UK metadata release tag");
    const version = ukMetadataPackageVersion();
    console.log(args.length === 1 ? validateUkMetadataReleaseTag(args[0], version) : version);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
