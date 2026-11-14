import {
  BUILT_IN_COVER_SEARCH_SOURCES,
  COVER_SEARCH_METADATA_PREFIX,
  DEFAULT_CUSTOM_PATCH_PREFERENCES,
  type CoverSearchSource,
} from '@bookorbit/types'
import { computed, shallowRef, watch } from 'vue'
import { api } from '@/lib/api'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useCustomPatchSettings } from '@/features/custom-patches/composables/useCustomPatchSettings'

const retailerKeys = new Set<string>(DEFAULT_CUSTOM_PATCH_PREFERENCES.coverSearch.retailerSources)
const basicSources = BUILT_IN_COVER_SEARCH_SOURCES.filter(({ key }) => !retailerKeys.has(key))

export function useCoverSearchSources() {
  const { user } = useAuth()
  const { preferences, policy } = useCustomPatchSettings()
  const generation = createRequestGeneration()
  const listedSources = shallowRef<readonly CoverSearchSource[]>(basicSources)
  const sources = computed(() => {
    const settings = preferences.value.coverSearch
    const extended = settings.enabled && policy.value.extendedCoverSearchEnabled
    return listedSources.value.filter(({ key }) => {
      if (key.startsWith(COVER_SEARCH_METADATA_PREFIX)) return extended && settings.metadataSourcesEnabled
      return !retailerKeys.has(key) || (extended && settings.retailerSources.some((source) => source === key))
    })
  })
  let requested = false
  const fetchSources = createCoalescedFetch(async () => {
    const request = generation.current()
    try {
      const response = await api('/api/v1/books/cover/sources')
      if (response.ok) {
        const result = (await response.json()) as CoverSearchSource[]
        if (generation.isCurrent(request)) listedSources.value = result
      }
    } catch {
      // The core sources are available even when source discovery fails.
    }
  })

  function resetSources() {
    generation.invalidate()
    fetchSources.clear()
    listedSources.value = basicSources
  }

  watch(
    () => user.value?.id,
    () => {
      resetSources()
      if (requested && user.value) void fetchSources()
    },
    { flush: 'sync' },
  )
  watch(
    [
      () => preferences.value.coverSearch.enabled,
      () => preferences.value.coverSearch.metadataSourcesEnabled,
      () => preferences.value.coverSearch.retailerSources.join(','),
      () => policy.value.extendedCoverSearchEnabled,
    ],
    () => {
      if (requested && user.value) {
        generation.invalidate()
        fetchSources.clear()
        void fetchSources()
      }
    },
  )

  function load() {
    requested = true
    return user.value ? fetchSources() : Promise.resolve()
  }

  return { sources, load }
}
