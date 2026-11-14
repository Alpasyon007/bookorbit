import { effectScope, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILT_IN_COVER_SEARCH_SOURCES,
  DEFAULT_CUSTOM_PATCH_POLICY,
  DEFAULT_CUSTOM_PATCH_PREFERENCES,
  type CoverSearchSource,
} from '@bookorbit/types'
import { useCoverSearchSources } from './useCoverSearchSources'

const user = ref({ id: 7 })
const preferences = ref(structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES))
const policy = ref({ ...DEFAULT_CUSTOM_PATCH_POLICY })
const loaded = ref(true)
const loadFailed = ref(false)
const apiMock = vi.fn<(url: string) => Promise<Response>>()

vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/features/custom-patches/composables/useCustomPatchSettings', () => ({
  useCustomPatchSettings: () => ({ preferences, policy, loaded, loadFailed }),
}))
vi.mock('@/lib/api', () => ({ api: (url: string) => apiMock(url) }))

function discoveryResult(): Response {
  const discovered: CoverSearchSource[] = [
    ...BUILT_IN_COVER_SEARCH_SOURCES,
    { key: 'foyles', label: 'Old Foyles source', media: ['ebook'] },
    { key: 'metadata:foyles', label: 'Foyles', media: ['ebook'] },
    { key: 'metadata:openLibrary', label: 'Open Library', media: ['ebook'] },
  ]
  return Response.json(discovered)
}

describe('useCoverSearchSources', () => {
  beforeEach(() => {
    preferences.value = structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES)
    policy.value = { ...DEFAULT_CUSTOM_PATCH_POLICY }
    loaded.value = true
    loadFailed.value = false
    apiMock.mockReset()
    apiMock.mockImplementation(async () => discoveryResult())
  })

  it('loads external providers while custom settings are pending and keeps them after those settings fail', async () => {
    loaded.value = false
    const scope = effectScope()
    const model = scope.run(() => useCoverSearchSources())!
    try {
      await model.load()
      expect(model.sources.value.map(({ key }) => key)).toEqual(['duckduckgo', 'itunes', 'audiobookcovers', 'metadata:foyles'])
      loadFailed.value = true
      await nextTick()
      expect(model.sources.value.map(({ key }) => key)).toContain('metadata:foyles')
      expect(model.sources.value.map(({ key }) => key)).not.toContain('metadata:openLibrary')
      expect(apiMock).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
  })

  it('offers external sources from discovery independently of the built-in metadata preferences', async () => {
    const scope = effectScope()
    const model = scope.run(() => useCoverSearchSources())!
    const keys = () => model.sources.value.map(({ key }) => key)
    try {
      expect(keys()).toEqual(['duckduckgo', 'itunes', 'audiobookcovers'])
      await model.load()
      expect(keys()).toEqual(['duckduckgo', 'itunes', 'audiobookcovers', 'metadata:foyles', 'metadata:openLibrary'])

      preferences.value.coverSearch.enabled = false
      expect(keys()).toEqual(['duckduckgo', 'itunes', 'audiobookcovers', 'metadata:foyles'])
      await nextTick()
      await model.load()
      expect(keys()).toContain('metadata:foyles')

      preferences.value.coverSearch.enabled = true
      policy.value.extendedCoverSearchEnabled = false
      expect(keys()).toEqual(['duckduckgo', 'itunes', 'audiobookcovers', 'metadata:foyles'])
    } finally {
      scope.stop()
    }
  })
})
