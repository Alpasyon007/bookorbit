import { describe, expect, it } from 'vitest'
import { DIRECT_SERIES_BOOKS_KEY } from '../composables/useBookWindow'
import { createSeriesGridLayout, seriesGridRowIndex } from './series-grid-layout'

const alpha = { key: 'series:1', label: 'Shared Title' }
const beta = { key: 'series:2', label: 'Shared Title' }
const none = { key: 'none', label: null }
const inner = { key: 'series:3', label: 'Inner' }
const story = { key: 'series:4', label: 'Story' }
const direct = { key: DIRECT_SERIES_BOOKS_KEY, label: null }

describe('Series Grid layout', () => {
  it('uses full-width headings and splits rows by series identity', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const rows = layoutSeriesGrid(5, [[[alpha], [alpha], [beta], [beta], [none]]], 3, 220)

    expect(rows.map(({ start, end, heading }) => [start, end, heading?.key])).toEqual([
      [0, 1, alpha.key],
      [0, 2, undefined],
      [2, 3, beta.key],
      [2, 4, undefined],
      [4, 5, none.key],
      [4, 5, undefined],
    ])
    expect(rows[4]?.heading?.label).toBeNull()
    expect(seriesGridRowIndex(rows, 3)).toBe(3)
  })

  it('draws each distinct path and restores an ancestor heading for its direct books', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const rows = layoutSeriesGrid(6, [[[alpha, inner, story], [alpha, inner], [alpha], [beta, inner, story], [beta, inner, story], [none]]], 4, 220)

    expect(rows.filter((row) => row.heading).map(({ start, heading }) => [start, heading!.key, heading!.depth, heading!.continued])).toEqual([
      [0, alpha.key, 0, false],
      [0, inner.key, 1, false],
      [0, story.key, 2, false],
      [1, inner.key, 1, true],
      [2, alpha.key, 0, true],
      [3, beta.key, 0, false],
      [3, inner.key, 1, false],
      [3, story.key, 2, false],
      [5, none.key, 0, false],
    ])
    expect(rows.filter((row) => !row.heading).map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 5],
      [5, 6],
    ])
    expect(rows[seriesGridRowIndex(rows, 4)]).toMatchObject({ start: 3, end: 5 })
  })

  it('shows subordinate Standalone buckets after child groups at every parent depth', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const rows = layoutSeriesGrid(5, [[[alpha, inner, story], [alpha, inner, direct], [alpha, direct], [beta], [none]]], 4, 220)

    expect(rows.filter((row) => row.heading).map(({ start, heading }) => [start, heading!.key, heading!.depth, heading!.continued])).toEqual([
      [0, alpha.key, 0, false],
      [0, inner.key, 1, false],
      [0, story.key, 2, false],
      [1, direct.key, 2, false],
      [2, direct.key, 1, false],
      [3, beta.key, 0, false],
      [4, none.key, 0, false],
    ])
  })

  it('retains standalone headings and continuation when the previous page arrives', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const children = Array.from({ length: 100 }, () => [alpha, inner, story])
    const directBooks = Array.from({ length: 100 }, () => [alpha, inner, direct])
    const finalBooks = [[alpha, inner, direct]]
    const headings = (rows: ReturnType<typeof layoutSeriesGrid>, at: number) =>
      rows.filter((row) => row.start === at && row.heading).map((row) => row.heading)

    const before = layoutSeriesGrid(201, [undefined, directBooks, finalBooks], 3, 220)
    expect(headings(before, 100)).toEqual([
      { ...alpha, depth: 0, continued: false },
      { ...inner, depth: 1, continued: false },
      { ...direct, depth: 2, continued: false },
    ])
    expect(headings(before, 200)).toEqual([{ ...direct, depth: 2, continued: true }])

    const after = layoutSeriesGrid(201, [children, directBooks, finalBooks], 3, 220)
    expect(headings(after, 100)).toEqual([{ ...direct, depth: 2, continued: false }])
    expect(headings(after, 200)).toEqual([{ ...direct, depth: 2, continued: true }])
  })

  it('marks a later page as continued once its predecessor has loaded', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const previousPage = Array.from({ length: 100 }, () => [alpha, inner])
    const currentPage = [
      [alpha, inner, story],
      [beta, inner],
    ]
    const before = layoutSeriesGrid(102, [undefined, currentPage], 3, 220)
    const after = layoutSeriesGrid(102, [previousPage, currentPage], 3, 220)

    expect(before.find((row) => row.id === 'heading:100:0')?.heading).toEqual({ ...alpha, depth: 0, continued: false })
    expect(after.find((row) => row.id === 'heading:100:0')?.heading).toEqual({ ...alpha, depth: 0, continued: true })
    expect(after.find((row) => row.id === 'heading:100:1')?.heading).toEqual({ ...inner, depth: 1, continued: true })
    expect(after.find((row) => row.id === 'heading:100:2')?.heading).toEqual({ ...story, depth: 2, continued: false })
    expect(after.find((row) => row.id === 'heading:101:1')?.heading).toEqual({ ...inner, depth: 1, continued: false })
  })

  it('keeps placeholders for distant unloaded pages without generating group headings', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const rows = layoutSeriesGrid(50_002, [[[alpha]]], 5, 200)
    const last = seriesGridRowIndex(rows, 50_001)

    expect(rows[last]).toMatchObject({ start: 50_000, end: 50_002 })
    expect(rows.filter((row) => row.heading)).toHaveLength(1)
  })

  it('reuses distant row descriptors when one page arrives', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const before = layoutSeriesGrid(50_002, [], 5, 200)
    const after = layoutSeriesGrid(50_002, [[[alpha]]], 5, 200)

    expect(after.at(-1)).toBe(before.at(-1))
  })
})
