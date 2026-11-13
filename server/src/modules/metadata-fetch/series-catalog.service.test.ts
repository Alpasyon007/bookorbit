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
  it('rejects invalid provider data instead of treating it as an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'bad query' }] }))));
    await expect((await service()).members(4, 0)).rejects.toThrow('Hardcover catalog is unavailable');
  });
  it('reports missing configuration', async () => {
    await expect((await service(false)).search('Dune', 0)).rejects.toThrow('Enable and configure Hardcover');
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
  it('escapes wildcard characters in series search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { series: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    await (await service()).search('A%_B', 0);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { variables: { name: string } };
    expect(body.variables.name).toBe('%A\\%\\_B%');
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { series: [] } }))));
    const retry = catalog.search('Retry', 0);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(retry).resolves.toEqual({ items: [], nextOffset: null });
    timeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
