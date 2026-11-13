import { BadRequestException } from '@nestjs/common';

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
  const searchIndexedSite = vi.fn();
  const metadataSources = vi.fn();
  const search = vi.fn();
  const registry = new CoverProviderRegistry([duckduckgo, itunes], { searchIndexedSite } as never, { sources: metadataSources, search } as never);

  beforeEach(() => {
    vi.resetAllMocks();
    metadataSources.mockResolvedValue([
      { key: 'metadata:hardcover', provider: 'hardcover', label: 'Hardcover', media: ['ebook', 'audio'] },
      { key: 'metadata:openLibrary', provider: 'openLibrary', label: 'Open Library', media: ['ebook'] },
    ]);
  });

  it('defaults to duckduckgo when provider is omitted', async () => {
    await expect(registry.select()).resolves.toEqual([duckduckgo]);
  });

  it('returns all compatible sources, including catalogue providers and ebook-only sites', async () => {
    expect((await registry.select('all')).map(({ key }) => key)).toEqual([
      'duckduckgo',
      'itunes',
      'hachette-uk',
      'waterstones',
      'foyles',
      'metadata:hardcover',
      'metadata:openLibrary',
    ]);
    expect((await registry.select('all', true)).map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'metadata:hardcover']);
  });

  it('returns the requested provider', async () => {
    await expect(registry.select(ITUNES_PROVIDER_KEY)).resolves.toEqual([itunes]);
  });

  it('trims provider values before selecting', async () => {
    await expect(registry.select(` ${ITUNES_PROVIDER_KEY} `)).resolves.toEqual([itunes]);
  });

  it('rejects unknown, disabled and incompatible metadata keys', async () => {
    await expect(registry.select('unknown')).rejects.toThrow(BadRequestException);
    await expect(registry.select('metadata:disabled')).rejects.toThrow(BadRequestException);
    await expect(registry.select('metadata:openLibrary', true)).rejects.toThrow(BadRequestException);
  });

  it('routes indexed lookups to the selected site', async () => {
    const [operation] = await registry.select('foyles');
    await operation.search({ title: 'Dune' });
    expect(searchIndexedSite).toHaveBeenCalledWith('foyles', { title: 'Dune' });
    await expect(registry.select('foyles', true)).resolves.toEqual([]);
  });

  it('maps real Open Library cover URLs without inventing dimensions or rendering missing-image placeholders', async () => {
    search.mockResolvedValue({ candidates: [{ coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' }], failed: false });
    const [operation] = await registry.select('metadata:openLibrary');
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
    const [operation] = await registry.select('metadata:hardcover', true);
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
