import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { SeriesCatalogBook, SeriesCatalogPage, SeriesCatalogSeries } from '@bookorbit/types';

import { readBoundedText } from '../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { toBearerAuthorization } from '../../common/utils/bearer-token.utils';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from './fetch-with-throttle';
import { ProviderThrottleError } from './provider-throttle.error';

const PAGE_SIZE = 25;
const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const SEARCH = `query SeriesSearch($name: String!, $page: Int!, $limit: Int!) {
  search(query: $name, query_type: "Series", page: $page, per_page: $limit) {
    error
    results
  }
}`;
const MEMBERS = `query SeriesMembers($id: Int!, $offset: Int!, $limit: Int!) {
  series_by_pk(id: $id) {
    id
    book_series(where: {compilation: {_eq: false}, book: {canonical_id: {_is_null: true}}}, order_by: [{position: asc_nulls_last}, {id: asc}], offset: $offset, limit: $limit) {
      position book { slug title release_date cached_contributors }
    }
  }
}`;

interface SeriesSearchResponse {
  search?: {
    error?: string | null;
    results?: {
      found?: number;
      hits?: Array<{ document?: { id?: string | number; name?: string; author_name?: string | null; author?: { name?: string | null } | null } }>;
    } | null;
  } | null;
}

interface MemberRow {
  position: number | null;
  book: {
    slug: string;
    title: string;
    release_date: string | null;
    cached_contributors: Array<{ author?: { name?: string }; contribution?: string | null }> | null;
  } | null;
}

function seriesFromHit(
  hit: NonNullable<NonNullable<NonNullable<SeriesSearchResponse['search']>['results']>['hits']>[number],
): SeriesCatalogSeries | null {
  const doc = hit?.document;
  if (!doc || (typeof doc.id !== 'number' && (typeof doc.id !== 'string' || !/^[0-9]+$/.test(doc.id)))) return null;
  const id = Number(doc.id);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 500)
    return null;
  if (doc.author_name != null && (typeof doc.author_name !== 'string' || doc.author_name.length > 255)) return null;
  const author = doc.author_name ?? doc.author?.name;
  if (author != null && (typeof author !== 'string' || author.length > 255)) return null;
  return { id, name: doc.name, author: author?.trim() || null };
}

function validDate(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validMember(row: MemberRow): boolean {
  if (
    !row ||
    !row.book ||
    typeof row.book.slug !== 'string' ||
    !/^[a-zA-Z0-9-]{1,255}$/.test(row.book.slug) ||
    typeof row.book.title !== 'string' ||
    !row.book.title.trim() ||
    row.book.title.length > 500 ||
    !(row.position === null || (typeof row.position === 'number' && Number.isFinite(row.position))) ||
    !validDate(row.book.release_date)
  )
    return false;
  const authors = row.book.cached_contributors;
  return (
    authors === null ||
    (Array.isArray(authors) &&
      authors.length <= 50 &&
      authors.every(
        (c) =>
          c &&
          typeof c === 'object' &&
          (c.contribution == null || typeof c.contribution === 'string') &&
          (c.author == null || (typeof c.author === 'object' && typeof c.author.name === 'string' && c.author.name.length <= 255)),
      ))
  );
}

@Injectable()
export class SeriesCatalogService {
  private readonly logger = new Logger(SeriesCatalogService.name);
  private nextRequestAt = 0;
  private queued = 0;
  constructor(private readonly config: ProviderConfigService) {}

  async search(name: string, offset: number): Promise<SeriesCatalogPage<SeriesCatalogSeries>> {
    if (offset % PAGE_SIZE !== 0) throw new BadRequestException('Series search offset must be a multiple of 25');
    const data = await this.query<SeriesSearchResponse>(SEARCH, { name, page: offset / PAGE_SIZE + 1, limit: PAGE_SIZE }, (data) => {
      const result = data?.search;
      const found = result?.results?.found;
      const hits = result?.results?.hits;
      return (
        result?.error == null &&
        Number.isSafeInteger(found) &&
        found! >= 0 &&
        Array.isArray(hits) &&
        hits.length === Math.min(PAGE_SIZE, Math.max(0, found! - offset)) &&
        hits.every((hit) => seriesFromHit(hit) !== null)
      );
    });
    const result = data.search!.results!;
    return {
      items: result.hits!.map((hit) => seriesFromHit(hit)!),
      nextOffset: result.found! > offset + PAGE_SIZE ? offset + PAGE_SIZE : null,
    };
  }

  async members(id: number, offset: number): Promise<SeriesCatalogPage<SeriesCatalogBook>> {
    const data = await this.query<{ series_by_pk?: { book_series?: MemberRow[] } | null }>(
      MEMBERS,
      { id, offset, limit: PAGE_SIZE + 1 },
      (data) =>
        !!data &&
        !!data.series_by_pk &&
        Array.isArray(data.series_by_pk.book_series) &&
        data.series_by_pk.book_series.length <= PAGE_SIZE + 1 &&
        data.series_by_pk.book_series.every(validMember),
    );
    if (!data.series_by_pk || !Array.isArray(data.series_by_pk.book_series)) throw new ServiceUnavailableException('Hardcover series is unavailable');
    const rows = data.series_by_pk.book_series;
    if (rows.length > PAGE_SIZE + 1 || !rows.every(validMember))
      throw new ServiceUnavailableException('Hardcover returned an incomplete series page');
    return this.page(rows, offset, (row) => ({
      id: row.book!.slug,
      title: row.book!.title,
      position: row.position,
      releaseDate: row.book!.release_date,
      authors: (row.book!.cached_contributors ?? [])
        .filter((c) => !c.contribution || c.contribution.toLowerCase() === 'author')
        .map((c) => c.author?.name)
        .filter((name): name is string => Boolean(name)),
    }));
  }

  private page<T, U>(rows: T[], offset: number, map: (row: T) => U): SeriesCatalogPage<U> {
    return { items: rows.slice(0, PAGE_SIZE).map(map), nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
  }

  private async query<T>(query: string, variables: Record<string, unknown>, validate: (data: T) => boolean): Promise<T> {
    const { enabled, apiKey } = (await this.config.getConfig()).hardcover;
    if (!enabled || !apiKey)
      throw new ServiceUnavailableException('Enable and configure Hardcover in Settings > Metadata > Providers to browse series');
    if (this.queued >= 3) throw new ServiceUnavailableException('Hardcover is busy, please retry');
    this.queued++;
    const start = Date.now();
    const signal = AbortSignal.timeout(10000);
    const scheduled = Math.max(start, this.nextRequestAt);
    this.nextRequestAt = scheduled + 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, scheduled - Date.now())));
    const operation = query === SEARCH ? 'search' : 'members';
    this.logger.log(`[series.catalog] [start] provider=hardcover operation=${operation} - catalog query started`);
    let failureKind = 'network';
    let httpStatus: number | undefined;
    try {
      const response = await fetchWithThrottle(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: toBearerAuthorization(apiKey) },
        body: JSON.stringify({ query, variables }),
        signal,
      });
      httpStatus = response.status;
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        failureKind = response.status === 401 || response.status === 403 ? 'authentication' : 'http';
        if (failureKind === 'authentication')
          throw new ServiceUnavailableException('Hardcover rejected the configured token or its catalog permissions');
        throw new ServiceUnavailableException('Hardcover catalog is unavailable');
      }
      failureKind = 'invalid_response';
      const body = JSON.parse(await readBoundedText(response, 1024 * 1024)) as { data?: T; errors?: unknown } | null;
      if (!body || !body.data || body.errors || !validate(body.data)) throw new ServiceUnavailableException('Invalid GraphQL response');
      this.logger.log(`[series.catalog] [end] provider=hardcover operation=${operation} durationMs=${Date.now() - start} - catalog query completed`);
      return body.data;
    } catch (error) {
      const message =
        error instanceof ProviderThrottleError
          ? 'Hardcover rate limit reached. Please retry later'
          : error instanceof ServiceUnavailableException && error.message === 'Hardcover rejected the configured token or its catalog permissions'
            ? error.message
            : 'Hardcover catalog is unavailable';
      if (error instanceof ProviderThrottleError) {
        failureKind = 'rate_limit';
        httpStatus = 429;
      } else if (signal.aborted) failureKind = 'timeout';
      const errorClass = error instanceof ProviderThrottleError ? 'ProviderThrottleError' : signal.aborted ? 'TimeoutError' : 'CatalogError';
      this.logger.warn(
        `[series.catalog] [fail] provider=hardcover operation=${operation} durationMs=${Date.now() - start} failureKind=${failureKind} httpStatus=${httpStatus ?? 'none'} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - catalog query failed`,
      );
      throw new ServiceUnavailableException(message);
    } finally {
      this.queued--;
    }
  }
}
