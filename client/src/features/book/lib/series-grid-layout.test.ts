import { describe, expect, it } from 'vitest'
import { createSeriesGridLayout, seriesGridRowIndex } from './series-grid-layout'

const alpha = { key: 'series:1', label: 'Shared Title' }
const beta = { key: 'series:2', label: 'Shared Title' }
const none = { key: 'none', label: null }

describe('Series Grid layout', () => {
  it('uses full-width headings and splits rows by series identity', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const rows = layoutSeriesGrid(5, [[alpha, alpha, beta, beta, none]], 3, 220)

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

  it('marks a later page as continued once its predecessor has loaded', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const previousPage = Array.from({ length: 100 }, () => alpha)
    const currentPage = [alpha, beta]
    const before = layoutSeriesGrid(102, [undefined, currentPage], 3, 220)
    const after = layoutSeriesGrid(102, [previousPage, currentPage], 3, 220)

    expect(before.find((row) => row.id === 'heading:100')?.heading).toEqual({ ...alpha, continued: false })
    expect(after.find((row) => row.id === 'heading:100')?.heading).toEqual({ ...alpha, continued: true })
    expect(after.find((row) => row.id === 'heading:101')?.heading).toEqual({ ...beta, continued: false })
  })

  it('keeps placeholders for distant unloaded pages without generating group headings', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const rows = layoutSeriesGrid(50_002, [[alpha]], 5, 200)
    const last = seriesGridRowIndex(rows, 50_001)

    expect(rows[last]).toMatchObject({ start: 50_000, end: 50_002 })
    expect(rows.filter((row) => row.heading)).toHaveLength(1)
  })

  it('reuses distant row descriptors when one page arrives', () => {
    const layoutSeriesGrid = createSeriesGridLayout()
    const before = layoutSeriesGrid(50_002, [], 5, 200)
    const after = layoutSeriesGrid(50_002, [[alpha]], 5, 200)

    expect(after.at(-1)).toBe(before.at(-1))
  })
})
