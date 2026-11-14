import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES, type CustomPatchPreferences } from '@bookorbit/types'
import { useCustomPatchSettings } from './useCustomPatchSettings'

const user = ref<{ id: number } | null>(null)
const fetchSettings = vi.fn<(endpoint: string, init?: RequestInit) => Promise<Response>>()

vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/lib/api', () => ({ api: (endpoint: string, init?: RequestInit) => fetchSettings(endpoint, init) }))

const personalEndpoint = '/api/v1/custom-patches/preferences'

function settingsResponse(settings: object) {
  return Response.json({ settings })
}

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

function preferencesWithOrder(hierarchyOrder: 'forward' | 'reverse'): CustomPatchPreferences {
  return { ...DEFAULT_CUSTOM_PATCH_PREFERENCES, seriesGrid: { ...DEFAULT_CUSTOM_PATCH_PREFERENCES.seriesGrid, hierarchyOrder } }
}

function mockSettings(preferences = DEFAULT_CUSTOM_PATCH_PREFERENCES) {
  fetchSettings.mockImplementation(async (endpoint, init) => {
    if (init?.method === 'PUT') return new Response(null, { status: 204 })
    return settingsResponse(endpoint === personalEndpoint ? preferences : DEFAULT_CUSTOM_PATCH_POLICY)
  })
}

describe('useCustomPatchSettings', () => {
  beforeEach(() => {
    user.value = null
    fetchSettings.mockReset()
    mockSettings()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a session load and retries after an initial failure', async () => {
    fetchSettings.mockResolvedValueOnce(new Response(null, { status: 503 }))
    user.value = { id: 12 }
    const settings = useCustomPatchSettings()
    const first = settings.load()
    expect(settings.load()).toBe(first)
    expect(await first).toBe(false)
    expect(settings.loaded.value).toBe(false)
    expect(settings.loadFailed.value).toBe(true)
    expect(await settings.load()).toBe(true)
    expect(fetchSettings).toHaveBeenCalledTimes(4)
  })

  it('clears previous-account values and ignores a delayed response after switching', async () => {
    const settings = useCustomPatchSettings()
    const deferred = deferredResponse()
    fetchSettings.mockReturnValueOnce(deferred.promise)
    user.value = { id: 12 }
    const previousRequest = settings.load()
    const previousSignal = fetchSettings.mock.calls[0]?.[1]?.signal

    user.value = { id: 13 }
    expect(previousSignal?.aborted).toBe(true)
    expect(await settings.load()).toBe(true)
    deferred.resolve(settingsResponse(preferencesWithOrder('reverse')))
    expect(await previousRequest).toBe(false)
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('forward')

    user.value = null
    expect(settings.loaded.value).toBe(false)
    expect(settings.preferences.value.seriesGrid).toEqual(DEFAULT_CUSTOM_PATCH_PREFERENCES.seriesGrid)
    expect(settings.policy.value).toEqual(DEFAULT_CUSTOM_PATCH_POLICY)
  })

  it('isolates a submitted snapshot and preserves it after a failed refresh or save', async () => {
    user.value = { id: 12 }
    const settings = useCustomPatchSettings()
    await settings.load()
    const submitted = preferencesWithOrder('reverse')
    const response = deferredResponse()
    fetchSettings.mockReturnValueOnce(response.promise)
    const saving = settings.savePreferences(submitted)
    submitted.seriesGrid.hierarchyOrder = 'forward'
    expect(await settings.savePreferences(submitted)).toBe(false)
    response.resolve(new Response(null, { status: 204 }))
    expect(await saving).toBe(true)
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('reverse')

    fetchSettings.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await settings.load({ refresh: true })).toBe(false)
    expect(settings.loaded.value).toBe(true)
    fetchSettings.mockResolvedValueOnce(new Response(null, { status: 400 }))
    expect(await settings.savePreferences(submitted)).toBe(false)
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('reverse')

    user.value = null
    await flushPromises()
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('forward')
  })

  it('times out unresponsive reads and writes, then retries without applying partial settings', async () => {
    vi.useFakeTimers()
    const delayed = deferredResponse()
    fetchSettings.mockReturnValueOnce(delayed.promise)
    fetchSettings.mockResolvedValueOnce(settingsResponse({ ...DEFAULT_CUSTOM_PATCH_POLICY, seriesGridEnabled: false }))
    user.value = { id: 12 }
    const settings = useCustomPatchSettings()
    const first = settings.load()
    const firstSignal = fetchSettings.mock.calls[0]?.[1]?.signal
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await first).toBe(false)
    expect(firstSignal?.aborted).toBe(true)
    expect(settings.policy.value.seriesGridEnabled).toBe(true)
    expect(settings.loaded.value).toBe(false)
    expect(settings.loadFailed.value).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(await settings.load()).toBe(true)
    delayed.resolve(settingsResponse(preferencesWithOrder('reverse')))
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('forward')

    const pendingWrite = deferredResponse()
    const submitted = preferencesWithOrder('reverse')
    fetchSettings.mockReturnValueOnce(pendingWrite.promise)
    const saving = settings.savePreferences(submitted)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await saving).toBe(false)
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('forward')
    pendingWrite.resolve(new Response(null, { status: 204 }))
    expect(await settings.savePreferences(submitted)).toBe(true)
    expect(settings.preferences.value.seriesGrid.hierarchyOrder).toBe('reverse')
    expect(vi.getTimerCount()).toBe(0)
  })
})
