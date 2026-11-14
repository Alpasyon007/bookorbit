import { eq, sql, type SQL } from 'drizzle-orm';
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

export function buildSeriesGridPageSql(
  link: { prefixCte: SQL; where: SQL; addFolded: SQL },
  orderBy: SQL[],
  limit: number,
  offset: number,
  sortByAuthor = false,
): SQL {
  return sql`
      WITH ${link.prefixCte}
      ranked AS MATERIALIZED (
        SELECT books.id, series_grid.keys, series_grid.labels,
          row_number() OVER (ORDER BY ${sql.join(orderBy, sql`, `)}) AS rank
        FROM books
        LEFT JOIN book_metadata ON book_metadata.book_id = books.id
        LEFT JOIN book_series ON ${seriesGridSeriesJoin}
        ${
          sortByAuthor
            ? sql`
          LEFT JOIN LATERAL (
            SELECT ba.author_id FROM book_authors ba
            WHERE ba.book_id = books.id
            ORDER BY ba.display_order ASC, ba.author_id ASC LIMIT 1
          ) grid_primary_author ON true
          LEFT JOIN authors grid_author ON grid_author.id = grid_primary_author.author_id
        `
            : sql``
        }
        LEFT JOIN LATERAL (
          SELECT coalesce(members.keys, ARRAY[${seriesGridGroupKey}]) AS keys,
            coalesce(members.labels, ARRAY[${seriesGridGroupLabel}]) AS labels,
            coalesce(members.names, ARRAY[lower(${seriesGridGroupLabel})]) AS names,
            CASE WHEN members.keys IS NULL THEN ${bookMetadata.seriesIndex} ELSE members.leaf_index END AS leaf_index
          FROM (
            SELECT array_agg('series:' || bs.id::text ORDER BY bsm.display_order) AS keys,
              array_agg(bs.name ORDER BY bsm.display_order) AS labels,
              array_agg(lower(bs.name) ORDER BY bsm.display_order) AS names,
              (array_agg(bsm.series_index ORDER BY bsm.display_order DESC))[1] AS leaf_index
            FROM book_series_memberships bsm
            JOIN book_series bs ON bs.id = bsm.series_id
            WHERE bsm.book_id = books.id
          ) members
        ) series_grid ON true
        WHERE ${link.where}
      ),
      expanded AS MATERIALIZED (
        SELECT ranked.id, ranked.rank, ranked.keys[1:member.depth::integer] AS prefix, member.depth,
          member.depth = cardinality(ranked.keys) AS is_terminal
        FROM ranked CROSS JOIN LATERAL unnest(ranked.keys) WITH ORDINALITY AS member(key, depth)
      ),
      prefixes AS MATERIALIZED (
        SELECT prefix, min(rank) AS first_rank, bool_or(NOT is_terminal) AS has_children FROM expanded GROUP BY prefix
      ),
      rank_paths AS (
        SELECT expanded.id, array_agg(prefixes.first_rank ORDER BY expanded.depth) AS ranks,
          bool_or(prefixes.has_children) FILTER (WHERE expanded.is_terminal) AS has_children
        FROM expanded JOIN prefixes ON prefixes.prefix = expanded.prefix
        GROUP BY expanded.id
      ),
      ordered AS (
        SELECT ranked.*, rank_paths.ranks || 9223372036854775807::bigint AS rank_path, rank_paths.has_children
        FROM ranked JOIN rank_paths ON rank_paths.id = ranked.id
      ),
      totals AS (
        SELECT count(*) AS total, count(*) ${link.addFolded} AS book_total FROM ranked
      ),
      paged AS (
        SELECT * FROM ordered
        ORDER BY (keys[1] = 'none'), rank_path, rank
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT paged.id, paged.has_children, totals.total, totals.book_total,
        (SELECT jsonb_agg(jsonb_build_object('key', paged.keys[i], 'label', paged.labels[i]) ORDER BY i)
         FROM generate_subscripts(paged.keys, 1) i) AS path
      FROM totals LEFT JOIN paged ON true
      ORDER BY (paged.keys[1] = 'none'), paged.rank_path, paged.rank
    `;
}
