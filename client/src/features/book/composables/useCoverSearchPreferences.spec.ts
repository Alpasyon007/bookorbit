import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { user: ref<{ id: number } | null>({ id: 7 }), api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }
})
vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('@/lib/api', () => ({ api: state.api }))

import { useCoverSearchPreferences } from './useCoverSearchPreferences'

const saved = (defaultProvider: string) => new Response(JSON.stringify({ settings: { defaultProvider } }))
function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useCoverSearchPreferences', () => {
  it('never publishes a stale account load or save over a new account preference', async () => {
    const model = useCoverSearchPreferences()
    const oldLoad = deferredResponse()
    state.api.mockReturnValueOnce(oldLoad.promise)
    const first = model.load()
    state.user.value = { id: 8 }
    state.api.mockResolvedValueOnce(saved('itunes'))
    await expect(model.load()).resolves.toBe(true)
    oldLoad.resolve(saved('metadata:foyles'))
    await expect(first).resolves.toBe(false)
    expect(model.defaultProvider.value).toBe('itunes')

    const oldSave = deferredResponse()
    state.api.mockReturnValueOnce(oldSave.promise)
    const save = model.update('metadata:waterstones')
    state.user.value = { id: 9 }
    expect(model.defaultProvider.value).toBe('duckduckgo')
    state.api.mockResolvedValueOnce(saved('metadata:hardcover'))
    await expect(model.load()).resolves.toBe(true)
    oldSave.resolve(new Response(null, { status: 400 }))
    await expect(save).resolves.toBe(false)
    await nextTick()
    expect(model.defaultProvider.value).toBe('metadata:hardcover')
    expect(model.isSaving.value).toBe(false)
  })

  it('falls back for a retired retailer preference and only saves valid sources', async () => {
    const model = useCoverSearchPreferences()
    state.user.value = { id: 10 }
    state.api.mockClear()
    state.api.mockResolvedValueOnce(saved('foyles'))
    await expect(model.load()).resolves.toBe(true)
    expect(model.defaultProvider.value).toBe('duckduckgo')
    await expect(model.update('foyles')).resolves.toBe(false)
    expect(state.api).toHaveBeenCalledOnce()
  })
})
