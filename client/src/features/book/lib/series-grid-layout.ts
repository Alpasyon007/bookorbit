import { BOOK_WINDOW_BLOCK_SIZE, type SeriesGridBlock, type SeriesGridPath } from '../composables/useBookWindow'

type SeriesGridHeading = SeriesGridPath[number] & { depth: number; continued: boolean }

export type SeriesGridRow = {
  id: string
  start: number
  end: number
  size: number
  heading?: SeriesGridHeading
}

const HEADING_HEIGHT = 40
const EMPTY_PATH: SeriesGridPath = []

function commonPathLength(left: SeriesGridPath, right: SeriesGridPath): number {
  const max = Math.min(left.length, right.length)
  let length = 0
  while (length < max && left[length]!.key === right[length]!.key) length++
  return length
}

function samePath(left: SeriesGridPath, right: SeriesGridPath): boolean {
  return left.length === right.length && commonPathLength(left, right) === left.length
}

function layoutBlock(
  offset: number,
  count: number,
  block: SeriesGridBlock | undefined,
  previousPath: SeriesGridPath,
  previousRowStart: number | undefined,
  columns: number,
  size: number,
) {
  const rows: SeriesGridRow[] = []
  let start = 0
  while (start < count) {
    const path = block?.[start] ?? EMPTY_PATH
    const before = start === 0 ? previousPath : (block?.[start - 1] ?? EMPTY_PATH)
    const sharedDepth = commonPathLength(before, path)
    const returnsToAncestor = path.length < before.length && sharedDepth === path.length
    const firstHeading = returnsToAncestor ? Math.max(0, sharedDepth - 1) : sharedDepth

    for (let depth = firstHeading; depth < path.length; depth++) {
      const group = path[depth]!
      rows.push({
        id: `heading:${offset + start}:${depth}`,
        start: offset + start,
        end: offset + start + 1,
        size: HEADING_HEIGHT,
        heading: { ...group, depth, continued: depth < sharedDepth },
      })
    }
    const rowStart = start === 0 ? (previousRowStart ?? offset) : offset + start
    const rowLimit = Math.min(rowStart + columns - offset, count)
    let end = start + 1
    while (end < rowLimit) {
      const next = block?.[end] ?? EMPTY_PATH
      if (!samePath(path, next)) break
      end++
    }
    rows.push({ id: `row:${rowStart}`, start: rowStart, end: offset + end, size })
    start = end
  }
  return rows
}

export function createSeriesGridLayout() {
  const cache: {
    count: number
    block: SeriesGridBlock | undefined
    previousPath: SeriesGridPath
    previousRowStart: number | undefined
    rows: SeriesGridRow[]
  }[] = []
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
      const previousPath = (block ? blocks[index - 1]?.at(-1) : undefined) ?? EMPTY_PATH
      const firstPath = block?.[0]
      const lastRow = rows.at(-1)
      const previousRowStart =
        firstPath && lastRow?.end === offset && offset - lastRow.start < columns && samePath(previousPath, firstPath) ? lastRow.start : undefined
      let cached = cache[index]
      if (
        !cached ||
        cached.count !== count ||
        cached.block !== block ||
        cached.previousPath !== previousPath ||
        cached.previousRowStart !== previousRowStart
      ) {
        cached = {
          count,
          block,
          previousPath,
          previousRowStart,
          rows: layoutBlock(offset, count, block, previousPath, previousRowStart, columns, size),
        }
        cache[index] = cached
      }
      if (previousRowStart !== undefined) rows.pop()
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
