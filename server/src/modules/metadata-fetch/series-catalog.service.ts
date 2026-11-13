import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { SeriesCatalogBook, SeriesCatalogPage, SeriesCatalogSeries } from '@bookorbit/types';

import { readBoundedText } from '../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { toBearerAuthorization } from '../../common/utils/bearer-token.utils';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from './fetch-with-throttle';

const PAGE_SIZE = 25;
const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const SEARCH = `query SeriesSearch($name: String!, $offset: Int!, $limit: Int!) {
  series(where: {name: {_ilike: $name}, canonical_id: {_is_null: true}}, order_by: [{id: asc}], offset: $offset, limit: $limit) {
    id name author { name }
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

interface SeriesRow {
  id: number;
  name: string;
  author: { name: string } | null;
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

function validSeries(row: SeriesRow): boolean {
  return (
    !!row &&
    Number.isSafeInteger(row.id) &&
    row.id > 0 &&
    typeof row.name === 'string' &&
    row.name.trim().length > 0 &&
    row.name.length <= 500 &&
    (row.author === null || (typeof row.author === 'object' && typeof row.author.name === 'string' && row.author.name.length <= 255))
  );
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
    const data = await this.query<{ series?: SeriesRow[] }>(
      SEARCH,
      { name: `%${name.replace(/[%_\\]/g, '\\$&')}%`, offset, limit: PAGE_SIZE + 1 },
      (data) => !!data && Array.isArray(data.series) && data.series.length <= PAGE_SIZE + 1 && data.series.every(validSeries),
    );
    if (!Array.isArray(data.series) || data.series.length > PAGE_SIZE + 1 || !data.series.every(validSeries))
      throw new ServiceUnavailableException('Hardcover returned an invalid series search');
    return this.page(data.series, offset, (row) => ({ id: row.id, name: row.name, author: row.author?.name ?? null }));
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
    if (!enabled || !apiKey) throw new ServiceUnavailableException('Enable and configure Hardcover to browse series');
    if (this.queued >= 3) throw new ServiceUnavailableException('Hardcover is busy, please retry');
    this.queued++;
    const start = Date.now();
    const signal = AbortSignal.timeout(10000);
    const scheduled = Math.max(start, this.nextRequestAt);
    this.nextRequestAt = scheduled + 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, scheduled - Date.now())));
    this.logger.log('[series.catalog] [start] provider=hardcover - catalog query started');
    try {
      const response = await fetchWithThrottle(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: toBearerAuthorization(apiKey) },
        body: JSON.stringify({ query, variables }),
        signal,
      });
      if (!response.ok) throw new ServiceUnavailableException(`HTTP ${response.status}`);
      const body = JSON.parse(await readBoundedText(response, 1024 * 1024)) as { data?: T; errors?: unknown } | null;
      if (!body || !body.data || body.errors || !validate(body.data)) throw new ServiceUnavailableException('Invalid GraphQL response');
      this.logger.log(`[series.catalog] [end] provider=hardcover durationMs=${Date.now() - start} - catalog query completed`);
      return body.data;
    } catch (error) {
      this.logger.warn(
        `[series.catalog] [fail] provider=hardcover durationMs=${Date.now() - start} errorClass=${error instanceof Error ? error.name : 'Unknown'} error="${sanitizeLogValue(error instanceof Error ? error.message : 'Unknown error')}" - catalog query failed`,
      );
      throw new ServiceUnavailableException('Hardcover catalog is unavailable');
    } finally {
      this.queued--;
    }
  }
}
