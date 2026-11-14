import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  autoApprove: false,
}))
const patch = await vi.hoisted(async () => {
  const { ref, shallowRef } = await import('vue')
  const { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES } = await import('@bookorbit/types')
  return {
    preferences: shallowRef(DEFAULT_CUSTOM_PATCH_PREFERENCES),
    policy: shallowRef(DEFAULT_CUSTOM_PATCH_POLICY),
    defaults: DEFAULT_CUSTOM_PATCH_PREFERENCES,
    defaultPolicy: DEFAULT_CUSTOM_PATCH_POLICY,
    loaded: ref(true),
    loadFailed: ref(false),
    load: vi.fn<() => Promise<boolean>>(),
  }
})
vi.mock('@/features/custom-patches/composables/useCustomPatchSettings', () => ({ useCustomPatchSettings: () => patch }))
vi.mock('@/lib/api', () => ({ api: state.api }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => state.autoApprove }) }))
vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref } = await import('vue')
  return {
    useLibraries: () => ({
      libraries: ref([
        {
          id: 1,
          name: 'Library',
          folders: [
            { id: 5, path: 'First' },
            { id: 6, path: 'Second' },
          ],
        },
        { id: 2, name: 'Other', folders: [] },
      ]),
      fetchLibraries: state.fetchLibraries,
    }),
  }
})
import SeriesRequestPanel from '../components/SeriesRequestPanel.vue'

function json(value: unknown, ok = true): Response {
  return { ok, json: async () => value } as Response
}
const rows = Array.from({ length: 60 }, (_, i) => ({
  id: `book-${i}`,
  title: `Book ${i}`,
  position: i === 2 ? 1.5 : i + 1,
  releaseDate: '2020-01-01',
  authors: ['Author'],
}))
const available = { ownedBookId: null, existingRequestId: null, existingRequestStatus: null, alreadySubscribed: false }
async function setup(onAcknowledged = vi.fn<() => void>()) {
  const wrapper = mount(SeriesRequestPanel, { props: { seed: { name: '', sequence: 0 }, onAcknowledged } })
  await wrapper.get('input').setValue('Series')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes('Example'))!
    .trigger('click')
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  state.api.mockReset()
  patch.preferences.value = patch.defaults
  patch.policy.value = patch.defaultPolicy
  patch.load.mockReset().mockResolvedValue(true)
  state.autoApprove = false
  state.fetchLibraries.mockReset().mockResolvedValue()
  state.api.mockImplementation(async (path, init) => {
    if (path.includes('?q=')) return json({ items: [{ id: 1, name: 'Example', author: 'Author' }], nextOffset: null })
    if (path.includes('/series-catalog/1')) {
      const offset = Number(new URL(path, 'http://localhost').searchParams.get('offset'))
      return json({ items: rows.slice(offset, offset + 25), nextOffset: offset + 25 < rows.length ? offset + 25 : null })
    }
    if (path.endsWith('/availability')) return json(JSON.parse(init!.body as string).items.map(() => available))
    return json({ subscribed: false })
  })
})
describe('series requests', () => {
  it('hides the feature panel under disabled instance policy', () => {
    patch.policy.value = { ...patch.defaultPolicy, seriesRequestsEnabled: false }
    const wrapper = mount(SeriesRequestPanel, { props: { seed: { name: '', sequence: 0 }, onAcknowledged: vi.fn() } })
    expect(wrapper.find('#series-search-title').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides only Request all when that action is disabled', async () => {
    patch.preferences.value = { ...patch.defaults, seriesRequests: { ...patch.defaults.seriesRequests, showRequestAll: false } }
    const wrapper = await setup()
    expect(wrapper.findAll('button').some((button) => button.text().startsWith('Request all'))).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Request selected books')).toBe(true)
    wrapper.unmount()
  })
  it('selects requestable books by default and explains why other books cannot be selected', async () => {
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) => {
      if (path.includes('/series-catalog/1')) {
        const items = [rows[0], rows[1], { ...rows[2], releaseDate: '2999-01-01' }, { ...rows[3], releaseDate: null }, rows[4]]
        return json({ items, nextOffset: null })
      }
      if (path.endsWith('/availability')) {
        return json([
          { ...available, ownedBookId: 1 },
          { ...available, alreadySubscribed: true },
          available,
          available,
          { ...available, existingRequestId: 8 },
        ])
      }
      return previous(path, init)
    })
    const wrapper = await setup()
    const inputs = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')

    expect(inputs.map(({ element }) => [element.checked, element.disabled])).toEqual([
      [false, true],
      [false, true],
      [false, true],
      [false, true],
      [true, false],
    ])
    expect(inputs.map((input) => wrapper.get(`#${input.attributes('aria-describedby')}`).text())).toEqual([
      'Owned',
      'Already requested by you',
      'Upcoming release',
      'Release date unknown',
      'Already requested, will join',
    ])
    expect(wrapper.get('#series-selection-summary').text()).toBe('All requestable books selected across all pages')
  })

  it('retains exclusions across pages and restores the entire series with Select all', async () => {
    const wrapper = await setup()
    const checkbox = () => wrapper.get<HTMLInputElement>('input[type="checkbox"]')
    const summary = () => wrapper.get('#series-selection-summary').text()

    await checkbox().setValue(false)
    expect(summary()).toContain('across all pages except 1 book')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Next page')!
      .trigger('click')
    await flushPromises()
    expect(checkbox().element.checked).toBe(true)
    await checkbox().setValue(false)
    expect(summary()).toContain('across all pages except 2 books')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Previous page')!
      .trigger('click')
    await flushPromises()
    expect(checkbox().element.checked).toBe(false)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Select all books in series')!
      .trigger('click')
    expect(checkbox().element.checked).toBe(true)
    expect(summary()).toBe('All requestable books selected across all pages')
  })

  it('clears the series selection and requests only books picked on different pages', async () => {
    const wrapper = await setup()
    const checkbox = () => wrapper.get<HTMLInputElement>('input[type="checkbox"]')
    const requestSelected = wrapper.findAll('button').find((button) => button.text() === 'Request selected books')!

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Clear selection')!
      .trigger('click')
    expect(checkbox().element.checked).toBe(false)
    expect(requestSelected.attributes('disabled')).toBeDefined()
    expect(wrapper.get('#series-selection-summary').text()).toBe('No books selected')
    await checkbox().setValue(true)
    expect(wrapper.get('#series-selection-summary').text()).toBe('1 book selected')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Next page')!
      .trigger('click')
    await flushPromises()
    expect(checkbox().element.checked).toBe(false)
    await checkbox().setValue(true)
    expect(wrapper.get('#series-selection-summary').text()).toBe('2 books selected')
    expect(wrapper.get('#series-request-all-hint').text()).toContain('ignores the current selection')

    await requestSelected.trigger('click')
    await flushPromises()

    const submitted = state.api.mock.calls
      .filter(([path]) => path === '/api/v1/book-requests')
      .map(([, init]) => JSON.parse(init!.body as string).providerId)
    expect(submitted).toEqual(['book-0', 'book-25'])
  })

  it('shows the empty state only after a successful series search', async () => {
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation((path, init) =>
      path.includes('?q=') ? Promise.resolve(json({ items: [], nextOffset: null })) : previous(path, init),
    )
    const wrapper = mount(SeriesRequestPanel, { props: { seed: { name: '', sequence: 0 }, onAcknowledged: vi.fn<() => void>() } })
    const search = wrapper.get('#series-query')

    expect(wrapper.text()).not.toContain('No series found')
    await search.setValue('Unknown series')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('No series found')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('keeps pagination tied to the submitted search while editing the input', async () => {
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation((path, init) =>
      path.includes('?q=') ? Promise.resolve(json({ items: [{ id: 1, name: 'Example' }], nextOffset: 25 })) : previous(path, init),
    )
    const wrapper = mount(SeriesRequestPanel, { props: { seed: { name: '', sequence: 0 }, onAcknowledged: vi.fn<() => void>() } })
    const search = wrapper.get('#series-query')
    await search.setValue('Original title')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    await search.setValue('Unsaved edit')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'More series')!
      .trigger('click')
    await flushPromises()

    expect(state.api).toHaveBeenCalledWith('/api/v1/book-requests/series-catalog?q=Original%20title&offset=25', undefined)
  })

  it('shows an empty catalog message without showing submission options', async () => {
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation((path, init) =>
      path.includes('/series-catalog/1') ? Promise.resolve(json({ items: [], nextOffset: null })) : previous(path, init),
    )
    const wrapper = await setup()

    expect(wrapper.get('[role="status"]').text()).toBe('No books are available in this catalog page.')
    expect(wrapper.find('#series-library').exists()).toBe(false)
  })

  it('waits for destination and language initialization before allowing submission', async () => {
    let resolveLibraries!: () => void
    state.fetchLibraries.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLibraries = resolve
        }),
    )
    const wrapper = await setup()
    const button = wrapper.findAll('button').find((item) => item.text().includes('Request all'))!
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('#series-library').attributes('disabled')).toBeDefined()
    resolveLibraries()
    await flushPromises()
    expect(button.attributes('disabled')).toBeUndefined()
    await wrapper.get('#series-library').setValue('1')
    expect((wrapper.get('#series-library').element as HTMLSelectElement).value).toBe('1')
  })
  it('refreshes availability after a completed run and clears old progress on retry', async () => {
    const wrapper = await setup()
    const previous = state.api.getMockImplementation()!
    let submitted = false
    state.api.mockImplementation(async (path, init) => {
      if (path.includes('/series-catalog/1')) return json({ items: rows.slice(0, 1), nextOffset: null })
      if (path.endsWith('/availability')) return json([{ ...available, alreadySubscribed: submitted }])
      if (path === '/api/v1/book-requests') {
        submitted = true
        return json({ subscribed: false })
      }
      return previous(path, init)
    })
    const button = wrapper.findAll('button').find((item) => item.text().includes('Request all'))!
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Already requested by you')
    let resolvePage!: (response: Response) => void
    state.api.mockImplementation((path, init) =>
      path.includes('/series-catalog/1')
        ? new Promise((resolve) => {
            resolvePage = resolve
          })
        : previous(path, init),
    )
    await button.trigger('click')
    expect(wrapper.text()).not.toContain('Created: 1')
    resolvePage(json({ items: [], nextOffset: null }))
    await flushPromises()
  })
  it('requests every released book over three pages and keeps fractional positions out of integer fields', async () => {
    const wrapper = await setup()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()
    const posts = state.api.mock.calls.filter(([path]) => path === '/api/v1/book-requests')
    expect(posts).toHaveLength(60)
    expect(JSON.parse(posts[2]![1]!.body as string)).not.toHaveProperty('seriesIndex')
    expect(wrapper.text()).toContain('All catalog pages processed')
  })
  it('stops and reports partial progress on a submission failure', async () => {
    const wrapper = await setup()
    let count = 0
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) => {
      if (path === '/api/v1/book-requests' && ++count === 3) return json({ message: 'limit reached' }, false)
      return previous(path, init)
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()
    expect(count).toBe(3)
    expect(wrapper.get('[role="alert"]').text()).toContain('limit reached')
    expect(wrapper.text()).not.toContain('All catalog pages processed')
  })
  it('skips owned and subscribed books and joins existing requests', async () => {
    const wrapper = await setup()
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) => {
      if (path.includes('/series-catalog/1')) return json({ items: rows.slice(0, 3), nextOffset: null })
      if (path.endsWith('/availability'))
        return json([
          { ...available, ownedBookId: 1 },
          { ...available, alreadySubscribed: true },
          { ...available, existingRequestId: 8 },
        ])
      if (path === '/api/v1/book-requests') return json({ subscribed: true })
      return previous(path, init)
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()
    expect(state.api.mock.calls.filter(([path]) => path === '/api/v1/book-requests')).toHaveLength(1)
    expect(wrapper.text()).toContain('joined: 1')
    expect(wrapper.text()).toContain('skipped: 2')
  })
  it('retries a partial run without resubmitting completed works', async () => {
    const wrapper = await setup()
    const completed = new Set<string>()
    let fail = true
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) => {
      if (path.includes('/series-catalog/1')) return json({ items: rows.slice(0, 3), nextOffset: null })
      if (path.endsWith('/availability'))
        return json(
          JSON.parse(init!.body as string).items.map((item: { providerId: string }) => ({
            ...available,
            alreadySubscribed: completed.has(item.providerId),
          })),
        )
      if (path === '/api/v1/book-requests') {
        const id = JSON.parse(init!.body as string).providerId as string
        if (id === 'book-1' && fail) {
          fail = false
          return json({ message: 'temporary failure' }, false)
        }
        completed.add(id)
        return json({ subscribed: false })
      }
      return previous(path, init)
    })
    const button = wrapper.findAll('button').find((b) => b.text().includes('Request all'))!
    await button.trigger('click')
    await flushPromises()
    await button.trigger('click')
    await flushPromises()
    const ids = state.api.mock.calls
      .filter(([path]) => path === '/api/v1/book-requests')
      .map(([, init]) => JSON.parse(init!.body as string).providerId)
    expect(ids).toEqual(['book-0', 'book-1', 'book-1', 'book-2'])
    expect(wrapper.text()).toContain('All catalog pages processed')
  })
  it('excludes future and unknown release dates without claiming full completion', async () => {
    const wrapper = await setup()
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation(async (path, init) => {
      if (path.includes('/series-catalog/1'))
        return json({ items: [rows[0], { ...rows[1], releaseDate: null }, { ...rows[2], releaseDate: '2999-01-01' }], nextOffset: null })
      return previous(path, init)
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()
    expect(state.api.mock.calls.filter(([path]) => path === '/api/v1/book-requests')).toHaveLength(1)
    expect(wrapper.text()).toContain('Books without release dates were not requested')
    expect(wrapper.text()).not.toContain('All catalog pages processed')
  })
  it('stops issuing requests after the panel is unmounted', async () => {
    const onAcknowledged = vi.fn<() => void>()
    const wrapper = await setup(onAcknowledged)
    let resolvePost!: (value: Response) => void
    const previous = state.api.getMockImplementation()!
    state.api.mockImplementation((path, init) =>
      path === '/api/v1/book-requests'
        ? new Promise((resolve) => {
            resolvePost = resolve
          })
        : previous(path, init),
    )
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()
    wrapper.unmount()
    resolvePost(json({ subscribed: false }))
    await flushPromises()
    expect(state.api.mock.calls.filter(([path]) => path === '/api/v1/book-requests')).toHaveLength(1)
    expect(onAcknowledged).toHaveBeenCalledOnce()
  })
  it('requires and sends the chosen destination and language for an auto-approved requester', async () => {
    state.autoApprove = true
    const wrapper = await setup()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Request all'))!
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.get('#series-library').setValue('1')
    await wrapper.get('#series-folder').setValue('6')
    await wrapper.get('#series-language').setValue('fr')
    await button.trigger('click')
    await flushPromises()
    const post = state.api.mock.calls.find(([path]) => path === '/api/v1/book-requests')!
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ targetLibraryId: 1, targetFolderId: 6, language: 'fr' })
  })

  it('sends the chosen format and clears an explicit destination and language', async () => {
    const wrapper = await setup()
    await wrapper.get('#series-library').setValue('1')
    await wrapper.get('#series-folder').setValue('6')
    await wrapper.get('#series-library').setValue('')
    expect(wrapper.find('#series-folder').exists()).toBe(false)
    await wrapper.get('#series-language').setValue('fr')
    await wrapper.get('#series-language').setValue('')
    await wrapper.get('#series-media').setValue('audiobook')
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()

    const post = state.api.mock.calls.find(([path]) => path === '/api/v1/book-requests')!
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      mediaKind: 'audiobook',
      targetLibraryId: null,
      targetFolderId: null,
      language: null,
    })
  })
  it('rejects a non-advancing next offset', async () => {
    const wrapper = await setup()
    state.api.mockResolvedValueOnce(json({ items: rows.slice(0, 25), nextOffset: 0 }))
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Request all'))!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(state.api.mock.calls.filter(([path]) => path === '/api/v1/book-requests')).toHaveLength(0)
  })
})
