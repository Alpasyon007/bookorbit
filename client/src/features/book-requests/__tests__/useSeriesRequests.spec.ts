import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: state.api }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }))
import { useSeriesRequests } from '../composables/useSeriesRequests'

const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response

describe('useSeriesRequests', () => {
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
      if (path.endsWith('/availability'))
        return json(JSON.parse(init!.body as string).items.map(() => ({ ownedBookId: null, alreadySubscribed: false })))
      return json({ subscribed: false })
    })
    let model!: ReturnType<typeof useSeriesRequests>
    const wrapper = mount(
      defineComponent({
        setup() {
          model = useSeriesRequests(() => ({ name: '', sequence: 0 }), vi.fn())
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
})
