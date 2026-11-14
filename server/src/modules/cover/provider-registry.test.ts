import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES } from '@bookorbit/types';

import { CoverProvider, DUCKDUCKGO_PROVIDER_KEY, ITUNES_PROVIDER_KEY } from './providers/cover-provider';
import { CoverProviderRegistry } from './provider-registry';

function makeProvider(key: CoverProvider['key']): CoverProvider {
  return {
    key,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe('CoverProviderRegistry', () => {
  const duckduckgo = makeProvider(DUCKDUCKGO_PROVIDER_KEY);
  const itunes = makeProvider(ITUNES_PROVIDER_KEY);
  const metadataSources = vi.fn();
  const search = vi.fn();
  const getPolicy = vi.fn().mockResolvedValue(DEFAULT_CUSTOM_PATCH_POLICY);
  const getPreferences = vi.fn().mockResolvedValue(DEFAULT_CUSTOM_PATCH_PREFERENCES);
  const registry = new CoverProviderRegistry(
    [duckduckgo, itunes],
    { sources: metadataSources, search } as never,
    { getPolicy, getPreferences } as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    getPolicy.mockResolvedValue(DEFAULT_CUSTOM_PATCH_POLICY);
    getPreferences.mockResolvedValue(DEFAULT_CUSTOM_PATCH_PREFERENCES);
    metadataSources.mockResolvedValue([
      { key: 'metadata:hardcover', provider: 'hardcover', label: 'Hardcover', media: ['ebook', 'audio'] },
      { key: 'metadata:openLibrary', provider: 'openLibrary', label: 'Open Library', media: ['ebook'] },
      { key: 'metadata:foyles', provider: 'foyles', label: 'Foyles', media: ['ebook'] },
    ]);
  });

  it('defaults to duckduckgo when provider is omitted', async () => {
    await expect(registry.select(7)).resolves.toEqual([duckduckgo]);
  });

  it('returns all compatible sources, including catalogue providers and ebook-only sites', async () => {
    expect((await registry.select(7, 'all')).map(({ key }) => key)).toEqual([
      'duckduckgo',
      'itunes',
      'metadata:hardcover',
      'metadata:openLibrary',
      'metadata:foyles',
    ]);
    expect((await registry.select(7, 'all', true)).map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'metadata:hardcover']);
  });

  it('returns the requested provider', async () => {
    await expect(registry.select(7, ITUNES_PROVIDER_KEY)).resolves.toEqual([itunes]);
  });

  it.each(['personal', 'instance'])('keeps native external covers when the %s built-in extension is disabled', async (scope) => {
    if (scope === 'personal') {
      getPreferences.mockResolvedValue({ ...DEFAULT_CUSTOM_PATCH_PREFERENCES, coverSearch: { enabled: false } });
    } else {
      getPolicy.mockResolvedValue({ ...DEFAULT_CUSTOM_PATCH_POLICY, extendedCoverSearchEnabled: false });
    }
    expect((await registry.list(7)).map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'audiobookcovers', 'metadata:foyles']);
    expect((await registry.select(7, 'all')).map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'metadata:foyles']);
    await expect(registry.select(7, 'metadata:hardcover')).rejects.toThrow(BadRequestException);
    await expect(registry.select(7, 'metadata:foyles')).resolves.toMatchObject([{ key: 'metadata:foyles' }]);
    await expect(registry.select(7, 'foyles')).rejects.toThrow(BadRequestException);
    await expect(registry.select(7, 'duckduckgo')).resolves.toEqual([duckduckgo]);
  });

  it('keeps native external providers available when custom settings cannot load', async () => {
    getPolicy.mockRejectedValue(new Error('settings unavailable'));
    expect((await registry.list(7)).map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'audiobookcovers', 'metadata:foyles']);
    expect((await registry.select(7, 'all')).map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'metadata:foyles']);
    getPolicy.mockClear();
    getPreferences.mockClear();
    await expect(registry.select(7, 'metadata:foyles')).resolves.toMatchObject([{ key: 'metadata:foyles' }]);
    expect(getPolicy).not.toHaveBeenCalled();
    expect(getPreferences).not.toHaveBeenCalled();
    await expect(registry.select(7, 'metadata:disabled')).rejects.toThrow(BadRequestException);
  });

  it('trims provider values before selecting', async () => {
    await expect(registry.select(7, ` ${ITUNES_PROVIDER_KEY} `)).resolves.toEqual([itunes]);
  });

  it('rejects unknown, disabled and incompatible metadata keys', async () => {
    await expect(registry.select(7, 'unknown')).rejects.toThrow(BadRequestException);
    await expect(registry.select(7, 'metadata:disabled')).rejects.toThrow(BadRequestException);
    await expect(registry.select(7, 'metadata:openLibrary', true)).rejects.toThrow(BadRequestException);
  });

  it('maps real Open Library cover URLs without inventing dimensions or rendering missing-image placeholders', async () => {
    search.mockResolvedValue({ candidates: [{ coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' }], failed: false });
    const [operation] = await registry.select(7, 'metadata:openLibrary');
    await expect(operation.search({ title: 'Dune' })).resolves.toMatchObject({
      results: [
        {
          url: 'https://covers.openlibrary.org/b/id/1-L.jpg?default=false',
          previewUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg?default=false',
          width: 0,
          height: 0,
          source: 'Open Library',
        },
      ],
    });
  });

  it('drops unsupported cover URLs, tiny thumbnails and wrong-medium candidates', async () => {
    search.mockResolvedValue({
      candidates: [
        { coverUrl: 'javascript:alert(1)' },
        { coverUrl: 'https://user:pass@covers.example.com/b.jpg' },
        { coverUrl: 'https://covers.example.com/b.jpg', mediaKind: 'ebook' },
        { coverUrl: 'https://covers.example.com/c.jpg', coverWidth: 100, coverHeight: 100 },
        { coverUrl: 'https://covers.example.com/d.jpg', coverWidth: 250, coverHeight: 500 },
        { coverUrl: 'https://covers.example.com/e.jpg', coverWidth: 400, coverHeight: 400 },
      ],
      failed: true,
    });
    const [operation] = await registry.select(7, 'metadata:hardcover', true);
    await expect(operation.search({ title: 'Dune', isAudiobook: true })).resolves.toEqual({
      results: [
        {
          url: 'https://covers.example.com/e.jpg',
          sourceUrl: 'https://covers.example.com/e.jpg',
          previewUrl: 'https://covers.example.com/e.jpg',
          width: 400,
          height: 400,
          source: 'Hardcover',
        },
      ],
      failed: true,
    });
  });
});
