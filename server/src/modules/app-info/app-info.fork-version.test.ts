import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { ServerIdentityService } from '../server-identity/server-identity.service';
import { AppInfoService } from './app-info.service';

describe('AppInfoService fork versions', () => {
  const modules: TestingModule[] = [];
  const fetchMock = vi.fn<typeof fetch>();

  async function createService(version: string, latest = 'v3.8.0', enabled = true) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tag_name: latest }), { status: 200 }));
    const module = await Test.createTestingModule({
      providers: [
        AppInfoService,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'app.version' ? version : undefined) } },
        {
          provide: AppSettingsService,
          useValue: { isUpdateCheckEnabled: vi.fn().mockResolvedValue(enabled), getMaxUploadSizeMb: vi.fn().mockResolvedValue(500) },
        },
        {
          provide: ServerIdentityService,
          useValue: { getIdentity: vi.fn().mockResolvedValue({ instanceId: '538a27ca-87ef-47bc-a195-13c8597c3529' }) },
        },
      ],
    }).compile();
    modules.push(module);
    return module.get(AppInfoService);
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const module of modules.splice(0)) await module.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['v3.8.0-custom.1', 'v3.8.0', false],
    ['v3.8.0-custom.99', 'v3.8.0', false],
    ['v3.8.0-custom.1', 'v3.8.1', true],
    ['v3.8.0-custom.1', 'v3.9.0', true],
    ['v3.8.0-custom.1', 'v4.0.0', true],
    ['v3.8.0-custom.1', 'v3.7.9', false],
    ['v3.8.0.1', 'v3.8.1', true],
    ['3.8.0', 'v3.8.0', false],
  ])('compares running %s with upstream %s while preserving the displayed label', async (version, latest, expected) => {
    const service = await createService(version, latest);
    await service.onApplicationBootstrap();

    const info = await service.getAppInfo();
    expect(info.version).toBe(version);
    expect(info.latestVersion).toBe(latest);
    expect(info.updateAvailable).toBe(expected);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('checks a custom version on an app-info request without bootstrap', async () => {
    const service = await createService('v3.8.0-custom.1', 'v3.8.1');
    expect((await service.getAppInfo()).updateAvailable).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('honors disabled update checks for a custom version', async () => {
    const service = await createService('v3.8.0-custom.1', 'v3.8.1', false);
    await service.onApplicationBootstrap();
    expect((await service.getAppInfo()).updateAvailable).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['Local build', 'sha-abc1234', 'v3.8.0-custom.0', 'v3.8.0-custom.01', 'v3.8.0-custom.1junk'])(
    'does not fetch updates for unsupported running label %s',
    async (version) => {
      const service = await createService(version);
      await service.onApplicationBootstrap();
      expect((await service.getAppInfo()).updateAvailable).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed upstream tags rather than treating them as releases', async () => {
    const service = await createService('v3.8.0-custom.1', 'v3.9.0junk');
    await service.onApplicationBootstrap();
    const info = await service.getAppInfo();
    expect(info.latestVersion).toBeNull();
    expect(info.updateAvailable).toBeNull();
  });
});
