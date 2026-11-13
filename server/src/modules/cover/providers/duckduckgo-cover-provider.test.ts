import { Logger } from '@nestjs/common';

import { DuckDuckGoCoverProvider } from './duckduckgo-cover-provider';

function result(sourceUrl: string, width: number, height: number) {
  return {
    sourceUrl,
    url: sourceUrl,
    previewUrl: `${sourceUrl}/thumb`,
    width,
    height,
    source: 'Web',
  };
}

describe('DuckDuckGoCoverProvider', () => {
  const originalFetch = global.fetch;
  const loggerWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: DuckDuckGoCoverProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DuckDuckGoCoverProvider();
    fetchMock = vi.fn();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('combines site/general/fallback results with deduplication', async () => {
    const performSearch = vi.spyOn(provider as any, 'performSearch');
    performSearch
      .mockResolvedValueOnce([result('https://img/a', 500, 800), result('https://img/ignored-small', 200, 300)])
      .mockResolvedValueOnce([result('https://img/a', 500, 800), result('https://img/b', 520, 900)])
      .mockResolvedValueOnce([result('https://img/c', 530, 930)]);

    const results = await provider.search({ title: 'Dune', author: 'Frank Herbert' });

    expect(performSearch).toHaveBeenNthCalledWith(
      1,
      'Dune Frank Herbert book (site:amazon.com OR site:goodreads.com)',
      expect.stringContaining('Tall'),
    );
    expect(performSearch).toHaveBeenNthCalledWith(2, 'Dune Frank Herbert book', expect.stringContaining('Tall'));
    expect(performSearch).toHaveBeenNthCalledWith(3, 'Dune book', expect.stringContaining('Tall'));
    expect(results.map((entry) => entry.sourceUrl)).toEqual(['https://img/a', 'https://img/b', 'https://img/c']);
  });

  it('filters audiobook results to near-square dimensions', async () => {
    const performSearch = vi.spyOn(provider as any, 'performSearch');
    performSearch.mockResolvedValueOnce([result('https://img/square', 500, 500), result('https://img/tall', 500, 800)]).mockResolvedValueOnce([]);

    const results = await provider.search({ title: 'Dune', isAudiobook: true });

    expect(results.map((entry) => entry.sourceUrl)).toEqual(['https://img/square']);
  });

  it('returns an empty list when internal search errors with a non-Error value', async () => {
    vi.spyOn(provider as any, 'performSearch').mockRejectedValueOnce(null);

    await expect(provider.search({ title: 'Dune' })).resolves.toEqual([]);
    expect(loggerError).toHaveBeenCalledWith('Error searching DuckDuckGo: null', undefined);
  });

  it('returns no results when the initial search page request fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

    await expect((provider as any).performSearch('query', '&iar=images')).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith('Search page fetch failed: 500');
  });

  it('returns no results when vqd token is missing from html', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>no token</html>', { status: 200 }));

    await expect((provider as any).performSearch('query', '&iar=images')).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith('Could not find vqd token');
  });

  it('returns no results when the JSON API request fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('<html>vqd="123-456"</html>', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));

    await expect((provider as any).performSearch('query', '&iar=images')).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith('API fetch failed: 403');
  });

  it('maps JSON API results and infers source labels', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>vqd="123-456"</html>', { status: 200 })).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { image: 'https://cdn.amazon.com/a.jpg', thumbnail: 'https://cdn.amazon.com/a_t.jpg', width: 700, height: 1000 },
            { image: 'https://www.goodreads.com/b.jpg', thumbnail: 'https://www.goodreads.com/b_t.jpg', width: 650, height: 920 },
            { image: 'https://images.google.com/c.jpg', thumbnail: 'https://images.google.com/c_t.jpg', width: 600, height: 900 },
            { image: 'not-a-valid-url', thumbnail: 'https://x.test/t.jpg', width: 500, height: 800 },
          ],
        }),
        { status: 200 },
      ),
    );

    const results = await (provider as any).performSearch('query', '&iar=images');

    expect(results).toEqual([
      expect.objectContaining({ sourceUrl: 'https://cdn.amazon.com/a.jpg', source: 'Amazon' }),
      expect.objectContaining({ sourceUrl: 'https://www.goodreads.com/b.jpg', source: 'Goodreads' }),
      expect.objectContaining({ sourceUrl: 'https://images.google.com/c.jpg', source: 'Google' }),
      expect.objectContaining({ sourceUrl: 'not-a-valid-url', source: 'Web' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'hachette-uk',
      'hachette.co.uk',
      'https://www.hachette.co.uk/titles/n-k-jemisin/the-fifth-season/9780356508191/',
      'https://www.hachette.co.uk/wp-content/uploads/2019/02/hbg-title-the-fifth-season-297.jpg',
    ],
    [
      'waterstones',
      'waterstones.com',
      'https://www.waterstones.com/book/chapter-house-dune/frank-herbert/9781473233812',
      'https://cdn.waterstones.com/bookjackets/large/9781/4732/9781473233812.jpg',
    ],
    [
      'foyles',
      'foyles.co.uk',
      'https://www.foyles.co.uk/book/dune/frank-herbert/9781399601788',
      'https://cdn.foyles.co.uk/override/v1/large/9781/3996/9781399601788.jpg',
    ],
  ] as const)('returns verified book covers from the %s image index only', async (source, domain, page, image) => {
    const result = { url: page, image, thumbnail: 'https://tse2.mm.bing.net/th?id=example', width: 265, height: 400 };
    const response = Response.json({
      results: [
        { ...result, url: page.replace(domain, `${domain}.example.com`) },
        { ...result, url: `https://www.${domain}/booklist/frank-herbert` },
        { ...result, image: 'https://offsite.example.com/jacket.jpg' },
        { ...result, image: `https://www.${domain}@offsite.example.com/jacket.jpg` },
        { ...result, width: 400, height: 400 },
        result,
        result,
      ],
    });
    fetchMock.mockResolvedValueOnce(new Response('<html>vqd="4-123-456"</html>')).mockResolvedValueOnce(response);

    const output = await provider.searchIndexedSite(source, { title: 'Dune', author: 'Frank Herbert' });

    expect(output).toEqual({
      failed: false,
      results: [
        expect.objectContaining({
          url: image,
          previewUrl: result.thumbnail,
          source: expect.stringContaining('(via DuckDuckGo)'),
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls as [string][]) {
      const parsed = new URL(url);
      expect(parsed.hostname).toBe('duckduckgo.com');
      expect(parsed.searchParams.get('q')).toBe(`Dune Frank Herbert book cover site:${domain}`);
      expect(parsed.searchParams.get('kl')).toBe('uk-en');
    }
  });

  it('reports an unavailable index separately from an empty result', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(provider.searchIndexedSite('foyles', { title: 'Dune' })).resolves.toEqual({ results: [], failed: true });
    fetchMock.mockResolvedValueOnce(new Response('<html>vqd="4-123-456"</html>')).mockResolvedValueOnce(Response.json({ results: [] }));
    await expect(provider.searchIndexedSite('foyles', { title: 'Dune' })).resolves.toEqual({ results: [], failed: false });
  });

  describe('determineSource', () => {
    it.each([
      ['https://www.amazon.com/dp/B001', 'Amazon'],
      ['https://cdn.amazon.com/images/cover.jpg', 'Amazon'],
      ['https://m.amazon.com/product/123', 'Amazon'],
      ['https://www.goodreads.com/book/show/1', 'Goodreads'],
      ['https://images.goodreads.com/cover.jpg', 'Goodreads'],
      ['https://images.google.com/c.jpg', 'Google'],
      ['https://www.google.com/search', 'Google'],
    ])('%s -> %s', (url, expected) => {
      expect((provider as any).determineSource(url)).toBe(expected);
    });

    it('returns hostname for unknown sources', () => {
      expect((provider as any).determineSource('https://openlibrary.org/cover.jpg')).toBe('openlibrary.org');
    });

    it('strips www. prefix for unknown sources', () => {
      expect((provider as any).determineSource('https://www.openlibrary.org/cover.jpg')).toBe('openlibrary.org');
    });

    it('does not match evil-amazon.com as Amazon', () => {
      expect((provider as any).determineSource('https://evil-amazon.com/img.jpg')).toBe('evil-amazon.com');
    });

    it('does not match amazon.com.evil.com as Amazon', () => {
      expect((provider as any).determineSource('https://amazon.com.evil.com/img.jpg')).toBe('amazon.com.evil.com');
    });

    it('returns Web for an invalid URL', () => {
      expect((provider as any).determineSource('not-a-url')).toBe('Web');
    });

    it('returns Web for an empty string', () => {
      expect((provider as any).determineSource('')).toBe('Web');
    });
  });
});
