import { BUILT_IN_COVER_SEARCH_SOURCES, type CoverSearchResult } from '@bookorbit/types';

import { parseCoverSearchUrl } from './remote-cover-url';

const BOOK_PAGE = /^\/book\/[^/]+\/[^/]+\/(\d{13})\/?$/;
const TITLE_PAGE = /^\/titles\/[^/]+\/[^/]+\/\d{13}\/?$/;
const RETAIL_JACKET = /^\/(?:bookjackets|override\/v1)\/[a-z]+\/\d{4}\/\d{4}\/(\d{13})\.(?:jpe?g|png|webp)$/i;

const INDEXED_SOURCES = {
  'hachette-uk': { domain: 'hachette.co.uk', productPage: TITLE_PAGE, imagePath: /^\/wp-content\/uploads\/.+\.(?:jpe?g|png|webp)$/i },
  waterstones: { domain: 'waterstones.com', productPage: BOOK_PAGE },
  foyles: { domain: 'foyles.co.uk', productPage: BOOK_PAGE },
};

export type IndexedCoverSource = keyof typeof INDEXED_SOURCES;

export function isIndexedCoverSource(key: string): key is IndexedCoverSource {
  return Object.hasOwn(INDEXED_SOURCES, key);
}

export function indexedCoverDomain(source: IndexedCoverSource): string {
  return INDEXED_SOURCES[source].domain;
}

export function indexedCoverResult(
  key: IndexedCoverSource,
  { page, image, thumbnail, width, height }: { page: unknown; image: unknown; thumbnail: unknown; width: unknown; height: unknown },
): CoverSearchResult | undefined {
  const source = INDEXED_SOURCES[key];
  const pageUrl = parseCoverSearchUrl(page);
  const imageUrl = parseCoverSearchUrl(image);
  if (!pageUrl || !imageUrl || !isSiteHost(pageUrl.hostname, source.domain)) return;
  const product = source.productPage.exec(pageUrl.pathname);
  if (!product || !isSourceCover(source, product, imageUrl)) return;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return;
  if (width < 200 || height < 200 || width / height > 0.85 || height > 20_000) return;

  const preview = parseCoverSearchUrl(thumbnail);
  const previewUrl =
    preview?.hostname === 'external-content.duckduckgo.com' || /^tse\d+\.mm\.bing\.net$/.test(preview?.hostname ?? '') ? preview : imageUrl;
  return {
    url: imageUrl.href,
    sourceUrl: imageUrl.href,
    previewUrl: (previewUrl ?? imageUrl).href,
    width,
    height,
    source: BUILT_IN_COVER_SEARCH_SOURCES.find((entry) => entry.key === key)!.label,
  };
}

function isSourceCover(source: (typeof INDEXED_SOURCES)[IndexedCoverSource], product: RegExpExecArray, image: URL): boolean {
  if ('imagePath' in source) return isSiteHost(image.hostname, source.domain) && source.imagePath.test(image.pathname);
  return image.hostname === `cdn.${source.domain}` && RETAIL_JACKET.exec(image.pathname)?.[1] === product[1];
}

function isSiteHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname === `www.${domain}`;
}
