import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { ReleaseNotesService } from './release-notes.service';

describe('ReleaseNotesService bundled custom releases', () => {
  const modules: TestingModule[] = [];
  const fetchMock = vi.fn<typeof fetch>();

  const upstream = (version: string) => ({
    tag_name: version,
    body: '## Highlights\n- **Upstream change** - A useful upstream feature.\n\n### Changes\n- An upstream change.',
  });

  async function createService(version = 'v3.8.0-custom.2', enabled = true) {
    const module = await Test.createTestingModule({
      providers: [
        ReleaseNotesService,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'app.version' ? version : undefined) } },
        { provide: AppSettingsService, useValue: { isUpdateCheckEnabled: vi.fn().mockResolvedValue(enabled) } },
      ],
    }).compile();
    modules.push(module);
    return module.get(ReleaseNotesService);
  }

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify([upstream('v3.8.1'), upstream('v3.8.0'), upstream('v3.7.0')])));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const module of modules.splice(0)) await module.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('includes custom history and preserves upstream archive entries, including newer upstream releases', async () => {
    const service = await createService();
    const response = await service.getAll(1);
    expect(response.releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2', 'v3.8.0-custom.1', 'v3.8.1', 'v3.8.0', 'v3.7.0']);
    expect(response.hasMore).toBe(false);
  });

  it('returns only unseen custom changes without repeating upstream highlights', async () => {
    const service = await createService();
    expect((await service.getSince('v3.8.0-custom.1')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2']);
    expect((await service.getSince('v3.8.0.1')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2']);
    expect((await service.getSince('v3.8.0-custom.2')).releases).toEqual([]);
  });

  it('shows both custom revisions when moving from the upstream base', async () => {
    const service = await createService();
    expect((await service.getSince('v3.8.0')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2', 'v3.8.0-custom.1']);
  });

  it('keeps installed custom notes available with update checks disabled and makes no network request', async () => {
    const service = await createService('v3.8.0-custom.2', false);
    expect((await service.getAll(1)).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2', 'v3.8.0-custom.1']);
    expect((await service.getSince('v3.8.0-custom.1')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps custom notes available when the upstream API fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
    const service = await createService();
    const response = await service.getAll(1);
    expect(response.releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2', 'v3.8.0-custom.1']);
    expect(response.hasMore).toBe(false);
  });

  it('does not expose a future custom revision in an older installed image', async () => {
    const service = await createService('v3.8.0-custom.1', false);
    expect((await service.getAll(1)).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.1']);
  });

  it('keeps upstream paging intact and never repeats custom notes on the next page', async () => {
    fetchMock.mockImplementation((url) => {
      const page = new URL(url instanceof Request ? url.url : url).searchParams.get('page');
      const releases = page === '1' ? Array.from({ length: 30 }, (_, index) => upstream(`v3.7.${29 - index}`)) : [upstream('v3.6.0')];
      return Promise.resolve(new Response(JSON.stringify(releases)));
    });
    const service = await createService();
    const first = await service.getAll(1);
    const second = await service.getAll(2);
    expect(first.releases).toHaveLength(32);
    expect(first.hasMore).toBe(true);
    expect(second.releases.map((release) => release.version)).toEqual(['v3.6.0']);
    expect(second.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the existing cumulative cap for combined custom and upstream highlights', async () => {
    const service = await createService();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(['v3.8.0', 'v3.7.0', 'v3.6.0'].map(upstream))));
    const response = await service.getSince('v3.5.0');
    expect(response.releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2', 'v3.8.0-custom.1', 'v3.8.0', 'v3.7.0']);
    expect(response.hasMore).toBe(true);
  });

  it('prefers bundled notes if the configured GitHub feed also contains the custom tag', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([upstream('v3.8.0-custom.2'), upstream('v3.8.0')])));
    const service = await createService();
    const releases = (await service.getAll(1)).releases;
    expect(releases.filter((release) => release.version === 'v3.8.0-custom.2')).toHaveLength(1);
    expect(releases[0].highlights[0].title).toBe("Our changes in What's New");
  });

  it('never imports future custom notes from a configured remote release feed', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([upstream('v3.8.0-custom.2'), upstream('v3.8.0.2'), upstream('v3.8.0')]))),
    );
    const service = await createService('v3.8.0-custom.1');
    const expected = ['v3.8.0-custom.1', 'v3.8.0'];
    expect((await service.getAll(1)).releases.map((release) => release.version)).toEqual(expected);
    expect((await service.getSince('v3.7.0')).releases.map((release) => release.version)).toEqual(expected);
  });
});
