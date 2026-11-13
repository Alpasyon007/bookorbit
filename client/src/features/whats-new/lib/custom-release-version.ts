type ReleaseVersion = [number, number, number, number]

function parseReleaseVersion(value: string): ReleaseVersion | null {
  const normalized = value.trim()
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-custom\.([1-9]\d*)|\.(0|[1-9]\d*))?$/.exec(normalized)
  if (!match || match[0] !== normalized) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? match[5] ?? 0)] as ReleaseVersion
  return parts.every(Number.isSafeInteger) ? parts : null
}

function hasCustomRevision(value: string): boolean {
  return value.includes('-custom') || /^v?\d+\.\d+\.\d+\./.test(value.trim())
}

// Custom revisions follow their upstream base in our release history, unlike SemVer prerelease precedence.
export function isNewerCustomRelease(candidate: string, baseline: string): boolean | null {
  if (!hasCustomRevision(candidate) && !hasCustomRevision(baseline)) return null
  const next = parseReleaseVersion(candidate)
  const previous = parseReleaseVersion(baseline)
  if (!next || !previous) return false
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== previous[index]) return next[index]! > previous[index]!
  }
  return false
}
