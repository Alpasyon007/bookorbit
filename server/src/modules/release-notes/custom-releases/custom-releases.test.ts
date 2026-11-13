import { describe, expect, it } from 'vitest';

import { CUSTOM_RELEASE_NOTES } from './catalog';
import { compareCustomReleaseVersions, getCustomReleaseNotes } from './custom-releases';

describe('custom release notes', () => {
  it.each([
    ['v3.8.0-custom.2', 'v3.8.0-custom.1', 1],
    ['v3.8.0-custom.10', 'v3.8.0-custom.2', 1],
    ['v3.8.0-custom.1', 'v3.8.0', 1],
    ['v3.8.0-custom.1', 'v3.8.0.1', 0],
    ['v3.8.0-custom.2', 'v3.8.0-custom.2', 0],
    ['v3.8.1', 'v3.8.0-custom.99', 1],
    ['v3.8.0-custom.2', 'v3.9.0', -1],
    ['v3.8.0-custom.0', 'v3.8.0', null],
    ['v3.8.0-custom.01', 'v3.8.0', null],
    ['v3.8.0-custom.1junk', 'v3.8.0', null],
    ['v3.8.0-custom.9007199254740992', 'v3.8.0', null],
    ['v3.8.0-custom.2', 'sha-build', null],
  ])('orders %s against %s as %s', (candidate, baseline, expected) => {
    expect(compareCustomReleaseVersions(candidate, baseline)).toBe(expected);
  });

  it('caps notes at the installed custom version and orders revisions numerically', () => {
    expect(getCustomReleaseNotes('v3.8.0-custom.1').map((release) => release.version)).toEqual(['v3.8.0-custom.1']);
    const fixture = CUSTOM_RELEASE_NOTES[0];
    const catalog = ['v3.8.0-custom.2', 'v3.8.0-custom.11', 'v3.8.0-custom.1', 'v3.8.0-custom.10'].map((version) => ({ ...fixture, version }));
    expect(getCustomReleaseNotes('v3.8.0-custom.10', 'v3.8.0-custom.1', catalog).map((release) => release.version)).toEqual([
      'v3.8.0-custom.10',
      'v3.8.0-custom.2',
    ]);
  });

  it.each(['v3.8.0', 'sha-build', 'Local build', 'v3.8.0-custom.0', 'v3.8.0-custom.01'])('does not attach custom notes to %s', (version) => {
    expect(getCustomReleaseNotes(version)).toEqual([]);
  });

  it('bundles unique, useful notes with source links and no empty highlights', () => {
    expect(new Set(CUSTOM_RELEASE_NOTES.map((release) => release.version)).size).toBe(CUSTOM_RELEASE_NOTES.length);
    for (const release of CUSTOM_RELEASE_NOTES) {
      expect(compareCustomReleaseVersions(release.version, release.version)).toBe(0);
      expect(release.changelogUrl).toBe(`https://github.com/Alpasyon007/bookorbit/tree/${release.version}`);
      expect(release.changelogBody?.trim().length).toBeGreaterThan(40);
      expect(Number.isNaN(Date.parse(release.date ?? ''))).toBe(false);
      expect(release.highlights.length).toBeGreaterThan(0);
      expect(release.highlights.length).toBeLessThanOrEqual(12);
      for (const highlight of release.highlights) {
        expect(highlight.title.trim().length).toBeGreaterThan(0);
        expect(highlight.title.length).toBeLessThanOrEqual(120);
        expect(highlight.body.trim().length).toBeGreaterThan(20);
        expect(highlight.body.length).toBeLessThanOrEqual(400);
      }
    }
  });
});
