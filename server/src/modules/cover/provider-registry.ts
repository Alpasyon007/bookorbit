import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  BUILT_IN_COVER_SEARCH_SOURCES,
  COVER_SEARCH_METADATA_PREFIX,
  MIN_COVER_SHORT_SIDE_PX,
  coverShapeFromSize,
  isBuiltInMetadataProviderKey,
  type CoverSearchSource,
  type MetadataCandidate,
} from '@bookorbit/types';

import { MetadataCoverSearchService, type MetadataCoverSource } from '../metadata-fetch/metadata-cover-search.service';
import { COVER_PROVIDERS } from './constants';
import { COVER_PROVIDER_ALL_KEY, CoverProvider, type CoverSearchOperation, DEFAULT_COVER_PROVIDER_KEY } from './providers/cover-provider';
import { parseCoverSearchUrl } from './providers/remote-cover-url';
import { CustomPatchSettingsService } from '../custom-patches/custom-patch-settings.service';

@Injectable()
export class CoverProviderRegistry {
  private readonly logger = new Logger(CoverProviderRegistry.name);
  constructor(
    @Inject(COVER_PROVIDERS)
    private readonly providers: CoverProvider[],
    private readonly metadataCoverSearch: MetadataCoverSearchService,
    private readonly patchSettings: CustomPatchSettingsService,
  ) {}

  async list(userId: number): Promise<CoverSearchSource[]> {
    const metadata = await this.availableMetadata(userId);
    return [...BUILT_IN_COVER_SEARCH_SOURCES, ...metadata.map(({ key, label, media }) => ({ key, label, media }))];
  }

  async select(userId: number, provider?: string, isAudiobook?: boolean): Promise<CoverSearchOperation[]> {
    const selected = provider?.trim() || DEFAULT_COVER_PROVIDER_KEY;
    const builtin = this.providers.find(({ key }) => key === selected);
    if (builtin) return [builtin];
    const all = selected === COVER_PROVIDER_ALL_KEY;
    if (!all && !selected.startsWith(COVER_SEARCH_METADATA_PREFIX)) throw new BadRequestException('Unknown cover provider');
    const medium = isAudiobook ? 'audio' : 'ebook';
    const key = selected.slice(COVER_SEARCH_METADATA_PREFIX.length);
    const candidates = !all && !isBuiltInMetadataProviderKey(key) ? await this.metadataCoverSearch.sources() : await this.availableMetadata(userId);
    const metadata = candidates.filter((source) => source.media.includes(medium));
    if (!all) {
      const source = metadata.find(({ key }) => key === selected);
      if (!source) throw new BadRequestException('Cover provider is unavailable for this medium');
      return [this.metadataOperation(source)];
    }
    const operations = BUILT_IN_COVER_SEARCH_SOURCES.filter((source) => source.media.includes(medium)).flatMap<CoverSearchOperation>(({ key }) => {
      const source = this.providers.find((entry) => entry.key === key);
      return source ? [source] : [];
    });
    return [...operations, ...metadata.map((source) => this.metadataOperation(source))];
  }

  private async availableMetadata(userId: number): Promise<MetadataCoverSource[]> {
    const metadata = await this.metadataCoverSearch.sources();
    const external = metadata.filter((source) => !isBuiltInMetadataProviderKey(source.provider));
    const startedAt = Date.now();
    try {
      const [policy, { coverSearch }] = await Promise.all([this.patchSettings.getPolicy(), this.patchSettings.getPreferences(userId)]);
      return policy.extendedCoverSearchEnabled && coverSearch.enabled ? metadata : external;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[cover.source_settings] [fail] userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="custom cover settings unavailable" - using native cover sources`,
      );
      return external;
    }
  }

  private metadataOperation(source: MetadataCoverSource): CoverSearchOperation {
    return {
      key: source.key,
      search: async (params) => {
        const { candidates, failed } = await this.metadataCoverSearch.search(source.provider, params);
        const results = candidates.flatMap((candidate) => metadataCoverResult(candidate, source.label, params.isAudiobook) ?? []);
        return { results, failed };
      },
    };
  }
}

function metadataCoverResult(candidate: MetadataCandidate, source: string, isAudiobook?: boolean) {
  const image = parseCoverSearchUrl(candidate.coverUrl);
  if (!image) return;
  if (candidate.mediaKind && (candidate.mediaKind === 'audiobook') !== Boolean(isAudiobook)) return;
  const { coverWidth: width = 0, coverHeight: height = 0 } = candidate;
  if (width && height && Math.min(width, height) < MIN_COVER_SHORT_SIDE_PX) return;
  const shape = width && height ? coverShapeFromSize(width, height) : candidate.coverShape;
  if (isAudiobook ? shape === 'portrait' : shape === 'square') return;

  let preview = image;
  if (image.hostname === 'covers.openlibrary.org') {
    image.searchParams.set('default', 'false');
    preview = new URL(image);
    preview.pathname = preview.pathname.replace(/-L\.jpg$/, '-M.jpg');
  }
  return { url: image.href, sourceUrl: image.href, previewUrl: preview.href, width, height, source };
}
