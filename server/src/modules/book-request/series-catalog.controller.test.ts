import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES } from '@bookorbit/types';

import { CustomPatchSettingsService } from '../custom-patches/custom-patch-settings.service';
import { SeriesCatalogService } from '../metadata-fetch/series-catalog.service';
import { SeriesCatalogController } from './series-catalog.controller';

describe('SeriesCatalogController', () => {
  const catalog = { search: vi.fn(), members: vi.fn() };
  const settings = { getPolicy: vi.fn(), getPreferences: vi.fn() };
  let module: TestingModule;
  let controller: SeriesCatalogController;

  beforeEach(async () => {
    vi.resetAllMocks();
    settings.getPolicy.mockResolvedValue(DEFAULT_CUSTOM_PATCH_POLICY);
    settings.getPreferences.mockResolvedValue(DEFAULT_CUSTOM_PATCH_PREFERENCES);
    module = await Test.createTestingModule({
      controllers: [SeriesCatalogController],
      providers: [
        { provide: SeriesCatalogService, useValue: catalog },
        { provide: CustomPatchSettingsService, useValue: settings },
      ],
    }).compile();
    controller = module.get(SeriesCatalogController);
  });

  afterEach(async () => module.close());

  it('gates both catalog routes per current user before fetching the catalog', async () => {
    settings.getPreferences.mockImplementation((id: number) =>
      Promise.resolve(
        id === 7
          ? { ...DEFAULT_CUSTOM_PATCH_PREFERENCES, seriesRequests: { ...DEFAULT_CUSTOM_PATCH_PREFERENCES.seriesRequests, enabled: false } }
          : DEFAULT_CUSTOM_PATCH_PREFERENCES,
      ),
    );
    await expect(controller.search({ q: 'Discworld', offset: 0 }, { id: 7 } as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.members({ id: 3 }, { offset: 25 }, { id: 7 } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(catalog.search).not.toHaveBeenCalled();
    expect(catalog.members).not.toHaveBeenCalled();
    await controller.search({ q: 'Discworld', offset: 25 }, { id: 9 } as never);
    await controller.members({ id: 3 }, { offset: 0 }, { id: 9 } as never);
    expect(catalog.search).toHaveBeenCalledWith('Discworld', 25);
    expect(catalog.members).toHaveBeenCalledWith(3, 0);
  });

  it('stops catalog calls when instance policy is disabled', async () => {
    settings.getPolicy.mockResolvedValue({ ...DEFAULT_CUSTOM_PATCH_POLICY, seriesRequestsEnabled: false });
    await expect(controller.search({ q: 'Discworld', offset: 0 }, { id: 7 } as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.members({ id: 3 }, { offset: 0 }, { id: 9 } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(catalog.search).not.toHaveBeenCalled();
    expect(catalog.members).not.toHaveBeenCalled();
  });
});
