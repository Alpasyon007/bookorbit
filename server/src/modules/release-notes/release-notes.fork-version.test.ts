import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { ReleaseNotesService } from './release-notes.service';

describe('ReleaseNotesService fork versions', () => {
  const modules: TestingModule[] = [];

  async function createService(currentVersion: string, versions: string[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            versions.map((version) => ({
              tag_name: version,
              name: version,
              draft: false,
              body: `## Highlights\n- **Release** - Changes for ${version}.\n\n### Features\n- A feature`,
            })),
          ),
          { status: 200 },
        ),
      ),
    );
    const module = await Test.createTestingModule({
      providers: [
        ReleaseNotesService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'app.version' ? currentVersion : key === 'app.githubReleasesRepo' ? 'o/r' : undefined) },
        },
        { provide: AppSettingsService, useValue: { isUpdateCheckEnabled: vi.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    modules.push(module);
    return module.get(ReleaseNotesService);
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const module of modules.splice(0)) await module.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['v3.8.0-custom.1', 'v3.8.0.1'])('caps upstream highlights at the base of running %s', async (currentVersion) => {
    const service = await createService(currentVersion, ['v3.9.0', 'v3.8.1', 'v3.8.0', 'v3.7.0']);
    expect((await service.getSince(null)).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.1', 'v3.8.0', 'v3.7.0']);
  });

  it('does not repeat upstream highlights when only the custom revision changes', async () => {
    const service = await createService('v3.8.0-custom.2', ['v3.8.1', 'v3.8.0', 'v3.7.0']);
    expect((await service.getSince('v3.8.0-custom.1')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.2']);
  });

  it('shows the new custom revision without repeating its base or future upstream releases', async () => {
    const service = await createService('v3.8.0-custom.3', ['v3.9.0', 'v3.8.1', 'v3.8.0', 'v3.7.0']);
    expect((await service.getSince('v3.8.0-custom.2')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.3']);
    expect((await service.getSince('v3.8.0-custom.3')).releases).toEqual([]);
  });

  it('includes custom.4 only when installed and newer than the saved revision', async () => {
    const service = await createService('v3.8.0-custom.4', ['v3.8.1', 'v3.8.0']);
    expect((await service.getSince('v3.8.0-custom.3')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.4']);
    expect((await service.getSince('v3.8.0-custom.4')).releases).toEqual([]);
  });

  it('shows only custom.5 when updating from custom.4', async () => {
    const service = await createService('v3.8.0-custom.5', ['v3.8.1', 'v3.8.0']);
    expect((await service.getSince('v3.8.0-custom.4')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.5']);
    expect((await service.getSince('v3.8.0-custom.5')).releases).toEqual([]);
  });

  it('shows only custom.6 when updating from custom.5', async () => {
    const service = await createService('v3.8.0-custom.6', ['v3.8.1', 'v3.8.0']);
    expect((await service.getSince('v3.8.0-custom.5')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.6']);
    expect((await service.getSince('v3.8.0-custom.6')).releases).toEqual([]);
  });

  it('shows only custom.7 when updating from custom.6', async () => {
    const service = await createService('v3.8.0-custom.7', ['v3.8.1', 'v3.8.0']);
    expect((await service.getSince('v3.8.0-custom.6')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.7']);
    expect((await service.getSince('v3.8.0-custom.7')).releases).toEqual([]);
  });

  it('shows only custom.8 when updating from custom.7', async () => {
    const service = await createService('v3.8.0-custom.8', ['v3.8.1', 'v3.8.0']);
    expect((await service.getSince('v3.8.0-custom.7')).releases.map((release) => release.version)).toEqual(['v3.8.0-custom.8']);
    expect((await service.getSince('v3.8.0-custom.8')).releases).toEqual([]);
  });

  it.each(['v3.8.0-custom.1', 'v3.8.0.1'])('advances from saved baseline %s while excluding future releases', async (since) => {
    const service = await createService('v3.9.0-custom.1', ['v3.10.0', 'v3.9.0', 'v3.8.1', 'v3.8.0']);
    expect((await service.getSince(since)).releases.map((release) => release.version)).toEqual([
      'v3.8.0-custom.8',
      'v3.8.0-custom.7',
      'v3.8.0-custom.6',
      'v3.8.0-custom.5',
    ]);
    expect((await service.getSince('v3.8.0-custom.5')).releases.map((release) => release.version)).toEqual([
      'v3.8.0-custom.8',
      'v3.8.0-custom.7',
      'v3.8.0-custom.6',
      'v3.9.0',
    ]);
  });

  it.each([null, 'v3.8.0-custom.5'])('rejects malformed release candidates and legacy four-part upstream tags with baseline %s', async (since) => {
    const service = await createService('v3.9.0-custom.1', ['v3.9.0-custom.0', 'v3.9.0junk', 'v3.8.0.2', 'v3.8.1']);
    expect((await service.getSince(since)).releases.map((release) => release.version)).toEqual(
      since
        ? ['v3.8.0-custom.8', 'v3.8.0-custom.7', 'v3.8.0-custom.6', 'v3.8.1']
        : ['v3.8.0-custom.8', 'v3.8.0-custom.7', 'v3.8.0-custom.6', 'v3.8.0-custom.5'],
    );
  });
});
