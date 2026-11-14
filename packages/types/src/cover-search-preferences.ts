import { isMetadataProviderKeySyntax } from "./metadata-fetch";

export type CoverSearchDefaultProvider = string;

export const DEFAULT_COVER_SEARCH_PROVIDER: CoverSearchDefaultProvider = "duckduckgo";

export interface CoverSearchPreferences {
  defaultProvider: CoverSearchDefaultProvider;
}

export const COVER_SEARCH_FAILED_SOURCES_HEADER = "X-Cover-Search-Failed-Sources";
export const COVER_SEARCH_METADATA_PREFIX = "metadata:";

export interface CoverSearchSource {
  key: string;
  label: string;
  media: ("ebook" | "audio")[];
}

export const BUILT_IN_COVER_SEARCH_SOURCES: readonly CoverSearchSource[] = [
  { key: "duckduckgo", label: "DuckDuckGo", media: ["ebook", "audio"] },
  { key: "itunes", label: "iTunes", media: ["ebook", "audio"] },
  { key: "audiobookcovers", label: "AudiobookCovers", media: ["audio"] },
];

export function isCoverSearchSourceKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "all" || BUILT_IN_COVER_SEARCH_SOURCES.some(({ key }) => key === value)) return true;
  return value.startsWith(COVER_SEARCH_METADATA_PREFIX) && isMetadataProviderKeySyntax(value.slice(COVER_SEARCH_METADATA_PREFIX.length));
}
