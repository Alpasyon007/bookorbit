import { Injectable } from '@nestjs/common';
import {
  BUILT_IN_METADATA_PROVIDER_LABELS,
  COVER_SEARCH_METADATA_PREFIX,
  isBuiltInMetadataProviderKey,
  METADATA_PROVIDER_SUPPORTED_FIELDS,
  type CoverMedium,
  type CoverSearchSource,
  type MetadataCandidate,
  type MetadataProviderKey,
} from '@bookorbit/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataHttpProviderCatalog } from '../metadata-http-provider/metadata-http-provider.catalog';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';

const COVER_CANDIDATE_LIMIT = 12;

export interface MetadataCoverSource extends CoverSearchSource {
  provider: MetadataProviderKey;
}

@Injectable()
export class MetadataCoverSearchService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly providerConfig: ProviderConfigService,
    private readonly httpProviders: MetadataHttpProviderCatalog,
    private readonly metadata: MetadataFetchService,
    private readonly throttleTracker: ProviderThrottleTracker,
  ) {}

  async sources(): Promise<MetadataCoverSource[]> {
    const config = await this.providerConfig.getConfig();
    return this.registry.all().flatMap((provider) => {
      const { key } = provider;
      if (key === 'itunes') return [];

      const builtIn = isBuiltInMetadataProviderKey(key);
      if (builtIn && !config[key].enabled) return [];
      const registered = builtIn ? undefined : this.httpProviders.findRegistered(key);
      if (!builtIn && !registered?.enabled) return [];
      const fields = builtIn ? METADATA_PROVIDER_SUPPORTED_FIELDS[key] : registered?.info?.supportedFields;
      const media: CoverMedium[] = [];
      // The HTTP adapter sends a book query for the text cover slot.
      const searchesText = builtIn
        ? !provider.mediaKinds || provider.mediaKinds.some((kind) => kind !== 'audiobook')
        : provider.mediaKinds?.includes('ebook');
      if ((!fields || fields.includes('cover')) && searchesText) {
        media.push('ebook');
      }
      if (
        (!fields || fields.includes('audioCover') || (!builtIn && fields.includes('cover'))) &&
        (!provider.mediaKinds || provider.mediaKinds.includes('audiobook')) &&
        provider.coverShape !== 'portrait'
      ) {
        media.push('audio');
      }
      if (!media.length) return [];
      return [
        {
          key: `${COVER_SEARCH_METADATA_PREFIX}${key}`,
          label: builtIn ? BUILT_IN_METADATA_PROVIDER_LABELS[key] : provider.label,
          media,
          provider: key,
        },
      ];
    });
  }

  async search(
    key: MetadataProviderKey,
    { title, author, isAudiobook, signal }: { title: string; author?: string; isAudiobook?: boolean; signal?: AbortSignal },
  ): Promise<{ candidates: MetadataCandidate[]; failed: boolean }> {
    const cooldown = this.throttleTracker.isThrottled(key);
    const events = await firstValueFrom(
      this.metadata
        .search(
          {
            title,
            author,
            isAudiobook,
            resultsPerProvider: COVER_CANDIDATE_LIMIT,
            maxCandidatesPerProvider: COVER_CANDIDATE_LIMIT,
            validateCoverPlaceholders: true,
          },
          [key],
          { signal, ...(cooldown ? { directive: { policy: 'only-if-cached', allowFallback: true } } : {}) },
        )
        .pipe(toArray()),
    );
    const candidates = events.flatMap((event) => (event.kind === 'candidate' ? [event.candidate] : []));
    return { candidates, failed: events.some((event) => event.kind === 'status') || (cooldown && candidates.length === 0) };
  }
}
