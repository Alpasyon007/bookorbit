const UPSTREAM_VERSION_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:(?:-custom\.([1-9]\d*))|(?:\.(0|[1-9]\d*)))?$/;

// Fork revisions identify our build; upstream updates and highlights follow the base release.
export function parseUpstreamBaseVersion(version: string): [number, number, number] | null {
  const match = UPSTREAM_VERSION_RE.exec(version);
  if (!match || match[0] !== version) return null;
  const values = match
    .slice(1)
    .filter((part): part is string => part !== undefined)
    .map(Number);
  if (values.some((part) => !Number.isSafeInteger(part))) return null;
  return [values[0], values[1], values[2]];
}
