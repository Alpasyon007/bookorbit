import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES } from '@bookorbit/types';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UserPreferencesService } from '../user-preferences/user-preferences.service';
import { CustomPatchSettingsService } from './custom-patch-settings.service';

describe('CustomPatchSettingsService', () => {
  const app = { getValue: vi.fn(), setValue: vi.fn(), deleteValue: vi.fn() };
  const users = { getCustomPatchSettings: vi.fn(), setCustomPatchSettings: vi.fn(), deleteCustomPatchSettings: vi.fn() };
  let service: CustomPatchSettingsService;
  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [CustomPatchSettingsService, { provide: AppSettingsService, useValue: app }, { provide: UserPreferencesService, useValue: users }],
    }).compile();
    service = module.get(CustomPatchSettingsService);
    app.getValue.mockResolvedValue(null);
    users.getCustomPatchSettings.mockResolvedValue(null);
  });
  it('returns independent defaults for missing policy and per-user settings', async () => {
    expect(await service.getPolicy()).toEqual(DEFAULT_CUSTOM_PATCH_POLICY);
    const one = await service.getPreferences(12);
    expect(one).toEqual(DEFAULT_CUSTOM_PATCH_PREFERENCES);
    one.sidebar.enabled = false;
    expect((await service.getPreferences(12)).sidebar.enabled).toBe(true);
    expect(users.getCustomPatchSettings).toHaveBeenCalledWith(12);
  });
  it('validates and persists settings in the requesting user scope', async () => {
    const preferences = structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES);
    preferences.seriesGrid.standaloneLabel = '  Other  ';
    await service.setPreferences(17, preferences);
    expect(users.setCustomPatchSettings).toHaveBeenCalledWith(
      17,
      expect.objectContaining({ seriesGrid: expect.objectContaining({ standaloneLabel: 'Other' }) }),
    );
    await expect(service.setPreferences(17, { ...preferences, extra: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setPreferences(17, { ...preferences, seriesGrid: { ...preferences.seriesGrid, maxDepth: 9 } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('normalizes the legacy cover preference without changing other settings', async (enabled, metadataSourcesEnabled, expected) => {
    const legacy = {
      ...structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES),
      seriesGrid: { ...DEFAULT_CUSTOM_PATCH_PREFERENCES.seriesGrid, hierarchyOrder: 'reverse' },
      coverSearch: { enabled, metadataSourcesEnabled, retailerSources: ['foyles'] },
    };
    users.getCustomPatchSettings.mockResolvedValue(legacy);
    const result = await service.getPreferences(5);
    expect(result.coverSearch).toEqual({ enabled: expected });
    expect(result.seriesGrid.hierarchyOrder).toBe('reverse');
    expect(users.setCustomPatchSettings).not.toHaveBeenCalled();
    await service.setPreferences(5, legacy);
    expect(users.setCustomPatchSettings).toHaveBeenCalledWith(5, expect.objectContaining({ coverSearch: { enabled: expected } }));
  });
  it('rejects partial or unknown legacy cover settings', async () => {
    const preferences = structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES);
    await expect(service.setPreferences(5, { ...preferences, coverSearch: { enabled: true, retailerSources: ['foyles'] } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.setPreferences(5, {
        ...preferences,
        coverSearch: { enabled: true, metadataSourcesEnabled: true, retailerSources: ['foyles'], unknown: true },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates policy and refuses malformed or newer stored versions', async () => {
    await service.setPolicy(7, { ...DEFAULT_CUSTOM_PATCH_POLICY, seriesGridEnabled: false });
    expect(app.setValue).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('"seriesGridEnabled":false'));
    await expect(service.setPolicy(7, { ...DEFAULT_CUSTOM_PATCH_POLICY, version: 2 })).rejects.toBeInstanceOf(BadRequestException);
    app.getValue.mockResolvedValue('{');
    await expect(service.getPolicy()).rejects.toBeInstanceOf(InternalServerErrorException);
    users.getCustomPatchSettings.mockResolvedValue({ ...DEFAULT_CUSTOM_PATCH_PREFERENCES, version: 2 });
    await expect(service.getPreferences(1)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
