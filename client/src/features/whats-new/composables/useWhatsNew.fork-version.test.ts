import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseNote, WhatsNewPreferences } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { resetWhatsNew, useWhatsNew } from './useWhatsNew'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

const customNote: ReleaseNote = {
  version: 'v3.8.0-custom.2',
  name: 'Custom release notes',
  date: '2026-11-13T00:00:00.000Z',
  highlights: [{ icon: null, title: 'Custom changes', body: 'See the changes included in this custom build.', media: [] }],
  changelogUrl: 'https://github.com/Alpasyon007/bookorbit/tree/v3.8.0-custom.2',
  changelogBody: null,
}

function setupApi(current = customNote.version, lastSeenVersion: string | null = 'v3.8.0-custom.1', popupEnabled = true) {
  const preferences: WhatsNewPreferences = { lastSeenVersion, popupEnabled }
  vi.mocked(api).mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/v1/app-info') return Response.json({ version: current, updateAvailable: false, latestVersion: 'v3.8.0' })
    if (url === '/api/v1/user-preferences/whats-new') {
      if (init?.method === 'PUT') Object.assign(preferences, JSON.parse(String(init.body)).settings)
      return Response.json({ settings: preferences })
    }
    if (url.startsWith('/api/v1/release-notes?since=')) return Response.json({ releases: [customNote], hasMore: false })
    throw new Error(`Unexpected API request: ${url}`)
  })
  return preferences
}

function releaseRequests() {
  return vi.mocked(api).mock.calls.filter(([input]) => String(input).startsWith('/api/v1/release-notes'))
}

describe('useWhatsNew custom release history', () => {
  beforeEach(() => {
    resetWhatsNew()
    vi.mocked(api).mockReset()
    const appInfo = useAppInfo()
    appInfo.version.value = ''
    appInfo.isLoading.value = false
  })

  afterEach(resetWhatsNew)

  it('loads an unseen same-base custom revision and opens its popup', async () => {
    setupApi()
    const state = useWhatsNew()
    await state.evaluate()
    expect(releaseRequests()).toEqual([['/api/v1/release-notes?since=v3.8.0-custom.1']])
    expect(state.releases.value).toEqual([customNote])
    expect(state.hasUnseen.value).toBe(true)
    state.syncPopup('dashboard')
    expect(state.popupOpen.value).toBe(true)
  })

  it('acknowledges the full custom revision and does not show it again after reload', async () => {
    const preferences = setupApi()
    const state = useWhatsNew()
    await state.evaluate()
    state.syncPopup('dashboard')
    await state.acknowledge()
    expect(preferences.lastSeenVersion).toBe(customNote.version)
    expect(state.hasUnseen.value).toBe(false)
    expect(state.popupOpen.value).toBe(false)
    expect(api).toHaveBeenCalledWith('/api/v1/user-preferences/whats-new', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { lastSeenVersion: customNote.version } }),
    })
    resetWhatsNew()
    await state.evaluate()
    expect(releaseRequests()).toHaveLength(1)
  })

  it('marks a newly visited custom archive revision seen', async () => {
    const preferences = setupApi()
    const state = useWhatsNew()
    await state.evaluate()
    await state.markArchiveSeen()
    expect(preferences.lastSeenVersion).toBe(customNote.version)
    expect(state.hasUnseen.value).toBe(false)
  })

  it.each(['v3.8.0-custom.2', 'v3.8.0-custom.3', 'v3.8.1'])('does not fetch notes or rewind saved baseline %s', async (baseline) => {
    const preferences = setupApi(customNote.version, baseline)
    const state = useWhatsNew()
    await state.evaluate()
    await state.markArchiveSeen()
    expect(releaseRequests()).toHaveLength(0)
    expect(preferences.lastSeenVersion).toBe(baseline)
    expect(state.hasUnseen.value).toBe(false)
  })

  it('retains first-login suppression for a user without a saved baseline', async () => {
    const preferences = setupApi(customNote.version, null)
    const state = useWhatsNew()
    await state.evaluate()
    expect(preferences.lastSeenVersion).toBe(customNote.version)
    expect(releaseRequests()).toHaveLength(0)
    expect(state.hasUnseen.value).toBe(false)
  })

  it("reloads preferences after a user switch and respects that user's popup setting", async () => {
    setupApi(customNote.version, customNote.version)
    const state = useWhatsNew()
    await state.evaluate()
    expect(state.hasUnseen.value).toBe(false)

    resetWhatsNew()
    const secondUser = setupApi(customNote.version, 'v3.8.0-custom.1', false)
    await state.evaluate()
    expect(state.hasUnseen.value).toBe(true)
    state.syncPopup('dashboard')
    expect(state.popupOpen.value).toBe(false)
    expect(secondUser.lastSeenVersion).toBe('v3.8.0-custom.1')
  })
})
