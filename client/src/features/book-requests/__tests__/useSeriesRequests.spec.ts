import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: state.api }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }))
import { useSeriesRequests } from '../composables/useSeriesRequests'

const available = () => ({ ownedBookId: null, existingRequestId: null, existingRequestStatus: null, alreadySubscribed: false })

const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response

describe('useSeriesRequests', () => {
  beforeEach(() => {
    state.api.mockReset()
  })
  it('walks every page in bounded batches using a captured medium', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `work-${i}`,
      title: `Book ${i}`,
      authors: ['Author'],
      position: i,
      releaseDate: '2020-01-01',
    }))
    state.api.mockImplementation(async (path, init) => {
      if (path.includes('series-catalog/')) {
        const offset = Number(new URL(path, 'http://localhost').searchParams.get('offset'))
        return json({ items: rows.slice(offset, offset + 25), nextOffset: offset + 25 < rows.length ? offset + 25 : null })
      }
      if (path.endsWith('/availability')) return json(JSON.parse(init!.body as string).items.map(() => available()))
      return json({ subscribed: false })
    })
    let model!: ReturnType<typeof useSeriesRequests>
    const wrapper = mount(
      defineComponent({
        setup() {
          model = useSeriesRequests(() => ({ name: '', sequence: 0 }), vi.fn<() => void>())
          return () => null
        },
      }),
    )
    model.selectSeries({ id: 1, name: 'Series', author: null })
    await flushPromises()
    await model.requestAll()
    const posts = state.api.mock.calls.filter(([path]) => path === '/api/v1/book-requests')
    expect(posts).toHaveLength(60)
    expect(posts.every(([, init]) => JSON.parse(init!.body as string).mediaKind === 'ebook')).toBe(true)
    expect(model.progress.value).toContain('All catalog pages processed')
    wrapper.unmount()
  })

  it('retains exclusions across pages and submits all other released books', async () => {
    const { model, wrapper, posts } = await setupSeries(60)
    model.toggleBook(model.books.value[0]!, 0)
    model.nextPage()
    await flushPromises()
    model.previousPage()
    await flushPromises()
    expect(model.selectionSummary.value).toEqual({ mode: 'all-except', count: 1 })
    expect(model.isBookSelected(model.books.value[0]!, 0)).toBe(false)
    await model.requestSelected()
    expect(posts()).toHaveLength(59)
    expect(posts().some((book) => book.providerId === 'work-0')).toBe(false)
    wrapper.unmount()
  })

  it('submits an explicit selection across pages without traversing the catalog', async () => {
    const { model, wrapper, posts } = await setupSeries(60)
    model.clearSelectedBooks()
    await model.requestSelected()
    expect(posts()).toHaveLength(0)
    model.toggleBook(model.books.value[0]!, 0)
    model.nextPage()
    await flushPromises()
    model.toggleBook(model.books.value[1]!, 1)
    expect(model.selectionSummary.value).toEqual({ mode: 'explicit', count: 2 })
    const callsBefore = state.api.mock.calls.length
    await model.requestSelected()
    expect(posts().map((book) => book.providerId)).toEqual(['work-0', 'work-26'])
    const catalogCalls = state.api.mock.calls.slice(callsBefore).filter(([path]) => path.includes('series-catalog/'))
    expect(catalogCalls).toHaveLength(1) // The current preview is refreshed afterwards.
    expect(catalogCalls[0]![0]).toContain('offset=25')
    wrapper.unmount()
  })

  it('preserves manual choices across formats and rechecks availability', async () => {
    const { model, wrapper, posts, owned } = await setupSeries(30)
    model.clearSelectedBooks()
    model.toggleBook(model.books.value[0]!, 0)
    owned.add('work-0')
    model.mediaKind.value = 'audiobook'
    await flushPromises()
    expect(model.selectionSummary.value).toEqual({ mode: 'explicit', count: 1 })
    expect(model.bookEligibilityReason(model.books.value[0]!, 0)).toBe('owned')
    await model.requestSelected()
    expect(posts()).toHaveLength(0)
    expect(model.selectionSummary.value.count).toBe(1)
    owned.clear()
    await flushPromises()
    await model.requestSelected()
    expect(posts()).toHaveLength(1)
    expect(posts()[0]!.mediaKind).toBe('audiobook')
    wrapper.unmount()
  })

  it('fails closed on malformed availability and retains the selection for retry', async () => {
    const { model, wrapper, posts } = await setupSeries(2)
    model.clearSelectedBooks()
    model.toggleBook(model.books.value[0]!, 0)
    const original = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) =>
      path.endsWith('/availability') ? json([{ ownedBookId: null, alreadySubscribed: false }]) : original(path, init),
    )
    await model.requestSelected()
    expect(posts()).toHaveLength(0)
    expect(model.error.value).toBeTruthy()
    expect(model.selectionSummary.value.count).toBe(1)
    wrapper.unmount()
  })

  it('resets choices on a new search or series', async () => {
    const { model, wrapper } = await setupSeries(3)
    model.clearSelectedBooks()
    model.toggleBook(model.books.value[0]!, 0)
    model.selectSeries({ id: 2, name: 'Other', author: null })
    await flushPromises()
    expect(model.selectionSummary.value).toEqual({ mode: 'all', count: 0 })
    model.toggleBook(model.books.value[0]!, 0)
    model.query.value = 'another series'
    model.handleSearch()
    expect(model.selectionSummary.value).toEqual({ mode: 'all', count: 0 })
    wrapper.unmount()
  })

  it('does not submit further books after unmount', async () => {
    const { model, wrapper, posts } = await setupSeries(3)
    let release!: () => void
    const deferred = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) => {
      if (path === '/api/v1/book-requests') await deferred
      return original(path, init)
    })
    const run = model.requestAll()
    await flushPromises()
    wrapper.unmount()
    release()
    await run
    expect(posts()).toHaveLength(1)
  })

  it('stops after an in-flight submission and retries safely', async () => {
    const { model, wrapper, posts } = await setupSeries(3)
    model.clearSelectedBooks()
    model.toggleBook(model.books.value[0]!, 0)
    model.toggleBook(model.books.value[1]!, 1)
    let release!: () => void
    const deferred = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = state.api.getMockImplementation()!
    let first = true
    state.api.mockImplementation(async (path, init) => {
      if (path === '/api/v1/book-requests' && first) {
        first = false
        await deferred
      }
      return original(path, init)
    })
    const run = model.requestSelected()
    await flushPromises()
    model.stop()
    release()
    await run
    expect(posts()).toHaveLength(1)
    await flushPromises()
    await model.requestSelected()
    expect(posts()).toHaveLength(2)
    wrapper.unmount()
  })
})

async function setupSeries(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `work-${i}`,
    title: `Book ${i}`,
    authors: ['Author'],
    position: i,
    releaseDate: '2020-01-01',
  }))
  const owned = new Set<string>()
  const subscribed = new Set<string>()
  const submitted: Array<{ providerId: string; mediaKind: string }> = []
  state.api.mockImplementation(async (path, init) => {
    if (path.includes('series-catalog/')) {
      const offset = Number(new URL(path, 'http://localhost').searchParams.get('offset'))
      return json({ items: rows.slice(offset, offset + 25), nextOffset: offset + 25 < rows.length ? offset + 25 : null })
    }
    if (path.endsWith('/availability')) {
      const items = JSON.parse(init!.body as string).items as Array<{ providerId: string }>
      return json(
        items.map((item) => ({
          ...available(),
          ownedBookId: owned.has(item.providerId) ? 1 : null,
          alreadySubscribed: subscribed.has(item.providerId),
        })),
      )
    }
    if (path === '/api/v1/book-requests') {
      const body = JSON.parse(init!.body as string) as { providerId: string; mediaKind: string }
      submitted.push(body)
      subscribed.add(body.providerId)
      return json({ subscribed: false })
    }
    return json([])
  })
  let model!: ReturnType<typeof useSeriesRequests>
  const wrapper = mount(
    defineComponent({
      setup() {
        model = useSeriesRequests(() => ({ name: '', sequence: 0 }), vi.fn<() => void>())
        return () => null
      },
    }),
  )
  await flushPromises()
  model.selectSeries({ id: 1, name: 'Series', author: null })
  await flushPromises()
  return { model, wrapper, posts: () => submitted, owned }
}
