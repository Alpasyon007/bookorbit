import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { SeriesCatalogService } from './series-catalog.service';

async function service(enabled = true) {
  const module = await Test.createTestingModule({
    providers: [
      SeriesCatalogService,
      { provide: ProviderConfigService, useValue: { getConfig: vi.fn().mockResolvedValue({ hardcover: { enabled, apiKey: 'test' } }) } },
    ],
  }).compile();
  return module.get(SeriesCatalogService);
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SeriesCatalogService', () => {
  it('paginates stable identifiers and preserves fractional position', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({
      position: i === 0 ? 1.5 : i,
      book: { slug: `book-${i}`, title: `Book ${i}`, release_date: '2020-01-01', cached_contributors: [{ author: { name: 'Author' } }] },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { series_by_pk: { book_series: rows } } }))));
    const result = await (await service()).members(4, 0);
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(request!.body as string).query).toContain('order_by: [{position: asc_nulls_last}, {id: asc}]');
    expect(result.items).toHaveLength(25);
    expect(result.nextOffset).toBe(25);
    expect(result.items[0]).toEqual({ id: 'book-0', title: 'Book 0', authors: ['Author'], position: 1.5, releaseDate: '2020-01-01' });
  });
  it('returns a final member page without discarding fractional positions or missing authors', async () => {
    const rows = [
      { position: 1.5, book: { slug: 'short-work', title: 'A novella', release_date: '2020-01-01', cached_contributors: null } },
      { position: null, book: { slug: 'unplaced-work', title: 'Unplaced', release_date: null, cached_contributors: [] } },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { series_by_pk: { book_series: rows } } })));
    vi.stubGlobal('fetch', fetchMock);
    const page = await (await service()).members(4, 25);
    expect(page.nextOffset).toBeNull();
    expect(page.items).toEqual([
      { id: 'short-work', title: 'A novella', position: 1.5, releaseDate: '2020-01-01', authors: [] },
      { id: 'unplaced-work', title: 'Unplaced', position: null, releaseDate: null, authors: [] },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).variables).toMatchObject({ id: 4, offset: 25, limit: 26 });
  });

  it('rejects invalid provider data instead of treating it as an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'bad query' }] }))));
    await expect((await service()).members(4, 0)).rejects.toThrow('Hardcover catalog is unavailable');
  });
  it('reports missing configuration', async () => {
    await expect((await service(false)).search('Dune', 0)).rejects.toThrow('Enable and configure Hardcover in Settings > Metadata > Providers');
  });
  it.each([
    { slug: '', title: 'Title', release_date: '2020-01-01', cached_contributors: [] },
    { slug: 'work', title: 'Title', release_date: 'unknown', cached_contributors: [] },
    { slug: 'work', title: 'Title', release_date: null, cached_contributors: [{ author: { name: 9 } }] },
  ])('rejects malformed member data', async (book) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { series_by_pk: { book_series: [{ position: 1, book }] } } }))),
    );
    await expect((await service()).members(1, 0)).rejects.toThrow('Hardcover catalog is unavailable');
  });
  it('rejects oversized provider responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1))));
    await expect((await service()).members(1, 0)).rejects.toThrow('Hardcover catalog is unavailable');
  });
  it('uses the supported indexed series search and preserves ranking and pagination', async () => {
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as { query: string; variables: { page: number } };
      if (request.query.includes('_ilike'))
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'ilike and related operations are not permitted on this server.' }), { status: 403 }),
        );
      const start = (request.variables.page - 1) * 25;
      const hits = Array.from({ length: Math.min(25, Math.max(0, 52 - start)) }, (_, i) => ({
        document: {
          id: i % 2 ? start + i + 1 : String(start + i + 1),
          name: `Series ${start + i + 1}`,
          ...(i === 0 ? { author_name: 'Author' } : { author: { name: 'Other' } }),
        },
      }));
      return Promise.resolve(new Response(JSON.stringify({ data: { search: { error: null, results: { found: 52, hits } } } })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await (await service()).search('A%_B', 0);
    const second = await (await service()).search('A%_B', 25);
    const last = await (await service()).search('A%_B', 50);
    const empty = await (await service()).search('A%_B', 75);
    expect(first.items[0]).toEqual({ id: 1, name: 'Series 1', author: 'Author' });
    expect(first.items[1]).toEqual({ id: 2, name: 'Series 2', author: 'Other' });
    expect(first.nextOffset).toBe(25);
    expect(second.nextOffset).toBe(50);
    expect(last.items.map((item) => item.id)).toEqual([51, 52]);
    expect(last.nextOffset).toBeNull();
    expect(empty).toEqual({ items: [], nextOffset: null });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { query: string; variables: unknown };
    expect(request.query).toContain('query_type: "Series"');
    expect(request.variables).toEqual({ name: 'A%_B', page: 1, limit: 25 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).variables.page).toBe(2);
  });
  it('rejects unaligned search offsets rather than returning the wrong page', async () => {
    await expect((await service()).search('Dune', 1)).rejects.toThrow('multiple of 25');
  });
  it.each([
    { found: 1, hits: [{ document: { id: 'bad', name: 'Dune' } }] },
    { found: 26, hits: [] },
    { found: 1, hits: [{ document: { id: '1', name: '' } }] },
  ])('rejects malformed or incomplete index pages', async (results) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { search: { error: null, results } } }))));
    await expect((await service()).search('Dune', 0)).rejects.toThrow('Hardcover catalog is unavailable');
  });
  it('rejects a search action error without disclosing its payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { search: { error: 'private token value', results: null } } }))),
    );
    await expect((await service()).search('Dune', 0)).rejects.toThrow('Hardcover catalog is unavailable');
  });
  it.each([401, 403])('reports token or scope errors for HTTP %s without disclosing the provider body', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private token value', { status })));
    await expect((await service()).search('Dune', 0)).rejects.toThrow('Hardcover rejected the configured token or its catalog permissions');
  });
  it('cancels rejected bodies and logs only safe diagnostics', async () => {
    const response = new Response('private token value', { status: 403 });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect((await service()).search('Dune', 0)).rejects.toThrow('Hardcover rejected the configured token or its catalog permissions');
    expect(cancel).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('operation=search'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failureKind=authentication httpStatus=403'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private token value');
  });

  it('reports rate limiting as a retryable provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect((await service()).search('Dune', 0)).rejects.toThrow('Hardcover rate limit reached');
  });
  it('bounds the queue and releases slots after a provider timeout', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener('abort', () => reject(new Error('timeout')));
          }),
      ),
    );
    const catalog = await service();
    const requests = [catalog.search('One', 0), catalog.search('Two', 0), catalog.search('Three', 0)];
    const settled = Promise.allSettled(requests);
    await vi.advanceTimersByTimeAsync(0);
    await expect(catalog.search('Four', 0)).rejects.toThrow('Hardcover is busy');
    await vi.advanceTimersByTimeAsync(10000);
    expect((await settled).every((r) => r.status === 'rejected')).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { search: { error: null, results: { found: 0, hits: [] } } } }))),
    );
    const retry = catalog.search('Retry', 0);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(retry).resolves.toEqual({ items: [], nextOffset: null });
    timeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
