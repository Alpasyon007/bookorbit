import { describe, expect, it } from 'vitest';

import { parseUpstreamBaseVersion } from './upstream-version.utils';

describe('parseUpstreamBaseVersion', () => {
  it.each(['v3.8.0', '3.8.0', 'v3.8.0-custom.1', '3.8.0-custom.12', 'v3.8.0.1', '3.8.0.0'])('extracts the upstream base from %s', (version) => {
    expect(parseUpstreamBaseVersion(version)).toEqual([3, 8, 0]);
  });

  it('keeps numeric components distinct for comparison', () => {
    expect(parseUpstreamBaseVersion('v12.34.56-custom.789')).toEqual([12, 34, 56]);
  });

  it.each([
    '',
    'dev',
    'Local build',
    'sha-abc1234',
    'v3.8',
    'v3.8.0-custom',
    'v3.8.0-custom.0',
    'v3.8.0-custom.01',
    'v3.8.0-custom.one',
    'v3.8.0-custom.1.extra',
    'v3.8.0-custom.1+metadata',
    'v3.8.0-beta.1',
    'v3.8.0.1.2',
    'v3.8.0junk',
    'v03.8.0',
    ' v3.8.0',
    'v3.8.0 ',
    'v3.8.0\n',
    'v3.8.0-custom.1\n',
    'v9007199254740992.8.0',
    'v3.8.0-custom.9007199254740992',
  ])('rejects unsupported or malformed version %j', (version) => {
    expect(parseUpstreamBaseVersion(version)).toBeNull();
  });
});
