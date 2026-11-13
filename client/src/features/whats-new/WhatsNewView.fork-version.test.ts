import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReleaseNote } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { resetWhatsNew } from './composables/useWhatsNew'
import WhatsNewView from './WhatsNewView.vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

describe("custom releases in the What's New archive", () => {
  beforeEach(() => {
    resetWhatsNew()
    vi.mocked(api).mockReset()
    const appInfo = useAppInfo()
    appInfo.version.value = ''
    appInfo.isLoading.value = false
  })

  afterEach(resetWhatsNew)

  it('renders custom and upstream cards, identifies the installed revision, and expands its custom changes', async () => {
    const custom: ReleaseNote = {
      version: 'v3.8.0-custom.2',
      name: 'Custom revision 2',
      date: '2026-11-13',
      highlights: [{ icon: null, title: 'Our custom changes', body: 'Custom revisions now include their own release notes.', media: [] }],
      changelogUrl: 'https://github.com/Alpasyon007/bookorbit/tree/v3.8.0-custom.2',
      changelogBody: '### Custom changes\n\n- Explain the changes in each custom revision.',
    }
    const upstream: ReleaseNote = {
      version: 'v3.8.0',
      name: 'Upstream release',
      date: '2026-11-11',
      highlights: [{ icon: null, title: 'Upstream improvements', body: 'The features from the upstream release remain visible.', media: [] }],
      changelogUrl: 'https://github.com/bookorbit/bookorbit/releases/tag/v3.8.0',
      changelogBody: null,
    }
    vi.mocked(api).mockImplementation(async (input, init) => {
      if (input === '/api/v1/release-notes?page=1') return Response.json({ releases: [custom, upstream], hasMore: false })
      if (input === '/api/v1/app-info') return Response.json({ version: custom.version, updateAvailable: false, latestVersion: upstream.version })
      if (input === '/api/v1/user-preferences/whats-new') {
        if (init?.method === 'PUT') return Response.json({})
        return Response.json({ settings: { lastSeenVersion: 'v3.8.0-custom.1', popupEnabled: true } })
      }
      throw new Error(`Unexpected API request: ${String(input)}`)
    })

    const wrapper = mount(WhatsNewView, { global: { stubs: { PageTitleRow: true } } })
    try {
      await flushPromises()
      const cards = wrapper.findAll('article')
      expect(cards.map((card) => card.get('h2').text())).toEqual([custom.version, upstream.version])
      const customCard = cards[0]!
      const upstreamCard = cards[1]!
      expect(customCard.text()).toContain("You're here")
      expect(upstreamCard.text()).not.toContain("You're here")
      expect(customCard.text()).toContain('Custom revisions now include their own release notes.')
      expect(upstreamCard.text()).toContain('The features from the upstream release remain visible.')
      expect(customCard.get('a').attributes('href')).toBe(custom.changelogUrl)
      expect(upstreamCard.get('a').attributes('href')).toBe(upstream.changelogUrl)

      expect(customCard.find('.whats-new-changelog').exists()).toBe(false)
      await customCard.get('button').trigger('click')
      expect(customCard.get('.whats-new-changelog h3').text()).toBe('Custom changes')
      expect(customCard.get('.whats-new-changelog li').text()).toBe('Explain the changes in each custom revision.')
    } finally {
      wrapper.unmount()
    }
  })
})
