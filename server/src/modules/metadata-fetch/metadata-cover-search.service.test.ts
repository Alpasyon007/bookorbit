import { Test } from '@nestjs/testing';
import { of } from 'rxjs';

import { MetadataHttpProviderCatalog } from '../metadata-http-provider/metadata-http-provider.catalog';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataCoverSearchService } from './metadata-cover-search.service';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';

describe('MetadataCoverSearchService', () => {
  const config = { getConfig: vi.fn() };
  const registry = { all: vi.fn() };
  const http = { findRegistered: vi.fn() };
  const metadata = { search: vi.fn() };
  const tracker = { isThrottled: vi.fn() };
  let service: MetadataCoverSearchService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        MetadataCoverSearchService,
        { provide: ProviderConfigService, useValue: config },
        { provide: ProviderRegistry, useValue: registry },
        { provide: MetadataHttpProviderCatalog, useValue: http },
        { provide: MetadataFetchService, useValue: metadata },
        { provide: ProviderThrottleTracker, useValue: tracker },
      ],
    }).compile();
    service = module.get(MetadataCoverSearchService);
  });

  it('lists enabled cover sources by medium, using the live HTTP catalogue and builtin configuration', async () => {
    config.getConfig.mockResolvedValue({ openLibrary: { enabled: true }, hardcover: { enabled: false }, audible: { enabled: true } });
    registry.all.mockReturnValue([
      { key: 'itunes' },
      { key: 'openLibrary' },
      { key: 'hardcover' },
      { key: 'audible', mediaKinds: ['audiobook'], coverShape: 'square' },
      { key: 'audio-demo', label: 'Audio Demo', mediaKinds: ['audiobook'] },
      { key: 'without-covers', mediaKinds: ['ebook'] },
      { key: 'disabled-demo', mediaKinds: ['ebook'] },
      { key: 'comic-only', label: 'Comic Demo', mediaKinds: ['comic'] },
      { key: 'legacy-demo', label: 'Legacy Demo', mediaKinds: ['ebook', 'comic'] },
    ]);
    http.findRegistered.mockImplementation((key: string) => ({
      enabled: key !== 'disabled-demo',
      info: { supportedFields: key === 'without-covers' ? ['title'] : key === 'legacy-demo' ? null : ['cover'] },
    }));

    await expect(service.sources()).resolves.toEqual([
      { key: 'metadata:openLibrary', provider: 'openLibrary', label: 'Open Library', media: ['ebook'] },
      { key: 'metadata:audible', provider: 'audible', label: 'Audible', media: ['audio'] },
      { key: 'metadata:audio-demo', provider: 'audio-demo', label: 'Audio Demo', media: ['audio'] },
      { key: 'metadata:legacy-demo', provider: 'legacy-demo', label: 'Legacy Demo', media: ['ebook'] },
    ]);
  });

  it('passes a bounded query through metadata search and preserves partial provider failures', async () => {
    const candidate = { title: 'Dune', coverUrl: 'https://images.example/cover.jpg' };
    metadata.search.mockReturnValue(of({ kind: 'candidate', candidate }, { kind: 'status', status: { outcome: 'throttled' } }));
    const signal = new AbortController().signal;

    await expect(service.search('hardcover', { title: 'Dune', author: 'Frank Herbert', isAudiobook: true, signal })).resolves.toEqual({
      candidates: [candidate],
      failed: true,
    });
    expect(metadata.search).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: 'Frank Herbert',
        isAudiobook: true,
        resultsPerProvider: 12,
        maxCandidatesPerProvider: 12,
        validateCoverPlaceholders: true,
      },
      ['hardcover'],
      { signal },
    );
  });

  it('does not retry a provider in cooldown live', async () => {
    tracker.isThrottled.mockReturnValue(true);
    metadata.search.mockReturnValue(of({ kind: 'run' }));
    await expect(service.search('hardcover', { title: 'Dune' })).resolves.toEqual({ candidates: [], failed: true });
    expect(metadata.search).toHaveBeenCalledWith(expect.anything(), ['hardcover'], {
      signal: undefined,
      directive: { policy: 'only-if-cached', allowFallback: true },
    });
  });
});
