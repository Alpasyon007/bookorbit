import type { ReleaseNote } from '@bookorbit/types';

import { parseUpstreamBaseVersion } from '../../../common/utils/upstream-version.utils';
import { CUSTOM_RELEASE_NOTES } from './catalog';

export function isCustomReleaseLabel(version: string): boolean {
  return version.includes('-custom') || /^v?\d+\.\d+\.\d+\./.test(version);
}

function parseReleaseVersion(version: string): number[] | null {
  const base = parseUpstreamBaseVersion(version);
  if (!base) return null;
  const revision = /(?:-custom\.|^v?\d+\.\d+\.\d+\.)(\d+)$/.exec(version);
  return [...base, revision ? Number(revision[1]) : 0];
}

export function compareCustomReleaseVersions(candidate: string, baseline: string): number | null {
  const a = parseReleaseVersion(candidate);
  const b = parseReleaseVersion(baseline);
  if (!a || !b) return null;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function getCustomReleaseNotes(
  current: string,
  since: string | null = null,
  catalog: readonly ReleaseNote[] = CUSTOM_RELEASE_NOTES,
): ReleaseNote[] {
  const installed = parseReleaseVersion(current);
  if (!installed || installed[3] === 0) return [];

  return catalog
    .filter((release) => {
      if (!isCustomReleaseLabel(release.version)) return false;
      const installedComparison = compareCustomReleaseVersions(release.version, current);
      if (installedComparison === null || installedComparison > 0) return false;
      return since === null || compareCustomReleaseVersions(release.version, since) === 1;
    })
    .sort((a, b) => compareCustomReleaseVersions(b.version, a.version) ?? 0);
}
