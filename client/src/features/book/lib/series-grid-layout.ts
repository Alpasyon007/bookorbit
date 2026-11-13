import type { BookCard } from '@bookorbit/types'
import { BOOK_WINDOW_BLOCK_SIZE, type SeriesGridBlock } from '../composables/useBookWindow'

type SeriesGridHeading = NonNullable<BookCard['seriesGroup']> & { continued: boolean }

export type SeriesGridRow = {
  id: string
  start: number
  end: number
  size: number
  heading?: SeriesGridHeading
}

const HEADING_HEIGHT = 40

function layoutBlock(
  offset: number,
  count: number,
  block: SeriesGridBlock | undefined,
  previousKey: string | undefined,
  columns: number,
  size: number,
) {
  const rows: SeriesGridRow[] = []
  let start = 0
  while (start < count) {
    const group = block?.[start]
    const beginsGroup = start === 0 || block?.[start - 1]?.key !== group?.key
    if (group && beginsGroup) {
      rows.push({
        id: `heading:${offset + start}`,
        start: offset + start,
        end: offset + start + 1,
        size: HEADING_HEIGHT,
        heading: { ...group, continued: start === 0 && previousKey === group.key },
      })
    }
    const rowLimit = Math.min(start + columns, count)
    let end = start + 1
    while (end < rowLimit && block?.[end]?.key === group?.key) end++
    rows.push({ id: `row:${offset + start}`, start: offset + start, end: offset + end, size })
    start = end
  }
  return rows
}

export function createSeriesGridLayout() {
  const cache: { count: number; block: SeriesGridBlock | undefined; previousKey: string | undefined; rows: SeriesGridRow[] }[] = []
  let previousColumns = 0
  let previousSize = 0

  return (total: number, blocks: readonly (SeriesGridBlock | undefined)[], columns: number, size: number): SeriesGridRow[] => {
    if (columns !== previousColumns || size !== previousSize) {
      cache.length = 0
      previousColumns = columns
      previousSize = size
    }

    const blockCount = Math.ceil(total / BOOK_WINDOW_BLOCK_SIZE)
    cache.length = blockCount
    const rows: SeriesGridRow[] = []
    for (let index = 0; index < blockCount; index++) {
      const offset = index * BOOK_WINDOW_BLOCK_SIZE
      const count = Math.min(total - offset, BOOK_WINDOW_BLOCK_SIZE)
      const block = blocks[index]
      const previousKey = block ? blocks[index - 1]?.at(-1)?.key : undefined
      let cached = cache[index]
      if (!cached || cached.count !== count || cached.block !== block || cached.previousKey !== previousKey) {
        cached = { count, block, previousKey, rows: layoutBlock(offset, count, block, previousKey, columns, size) }
        cache[index] = cached
      }
      rows.push(...cached.rows)
    }
    return rows
  }
}

export function seriesGridRowIndex(rows: readonly SeriesGridRow[], bookIndex: number): number {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (rows[middle]!.start <= bookIndex) low = middle + 1
    else high = middle
  }
  return low - 1
}
