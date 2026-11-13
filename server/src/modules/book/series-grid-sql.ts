import { asc, eq, sql } from 'drizzle-orm';
import { normalizeMetadataTextKeySql } from '../../common/utils/metadata-text-normalize.utils';
import { bookMetadata, bookSeries } from '../../db/schema';

const legacySeriesName = sql<string | null>`NULLIF(${normalizeMetadataTextKeySql(bookMetadata.seriesName)}, '')`;

export const seriesGridSeriesJoin = eq(bookSeries.id, bookMetadata.seriesId);
export const seriesGridGroupLabel = sql<string | null>`coalesce(${bookSeries.name}, ${legacySeriesName})`;
export const seriesGridGroupKey = sql<string>`case
  when ${bookSeries.id} is not null then 'series:' || ${bookSeries.id}::text
  when ${legacySeriesName} is not null then 'legacy:' || ${legacySeriesName}
  else 'none'
end`;

export const seriesGridGroupOrder = [
  sql`coalesce(${bookSeries.normalizedName}, ${legacySeriesName}) asc nulls last`,
  sql`${bookSeries.id} asc nulls last`,
  asc(seriesGridGroupKey),
];
