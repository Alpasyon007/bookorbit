import { pathToFileURL } from "node:url";

export function parseCustomVersion(version) {
  const match = typeof version === "string" && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-custom\.([1-9]\d*)$/.exec(version);
  if (!match || match[0] !== version || version.length > 128 || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("Custom releases must use vMAJOR.MINOR.PATCH-custom.REVISION with a positive revision and no leading zeroes");
  }
  return { version, upstreamVersion: `v${match[1]}.${match[2]}.${match[3]}`, revision: Number(match[4]) };
}

export function compareCustomVersions(candidate, current) {
  const parts = (version) => {
    const parsed = parseCustomVersion(version);
    return [...parsed.upstreamVersion.slice(1).split(".").map(Number), parsed.revision];
  };
  const left = parts(candidate);
  const right = parts(current);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Pass exactly one custom release tag");
    console.log(parseCustomVersion(process.argv[2]).version);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
