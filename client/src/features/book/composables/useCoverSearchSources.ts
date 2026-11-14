import {
  BUILT_IN_COVER_SEARCH_SOURCES,
  COVER_SEARCH_METADATA_PREFIX,
  isBuiltInMetadataProviderKey,
  isCoverSearchSourceKey,
  type CoverSearchSource,
} from '@bookorbit/types'
import { computed, shallowRef, watch } from 'vue'
import { api } from '@/lib/api'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useCustomPatchSettings } from '@/features/custom-patches/composables/useCustomPatchSettings'

export function useCoverSearchSources() {
  const { user } = useAuth()
  const { preferences, policy, loaded } = useCustomPatchSettings()
  const generation = createRequestGeneration()
  const listedSources = shallowRef<readonly CoverSearchSource[]>(BUILT_IN_COVER_SEARCH_SOURCES)
  const sources = computed(() => {
    const includeBuiltInMetadata = loaded.value && preferences.value.coverSearch.enabled && policy.value.extendedCoverSearchEnabled
    return listedSources.value.filter(
      ({ key }) =>
        isCoverSearchSourceKey(key) &&
        (includeBuiltInMetadata ||
          !key.startsWith(COVER_SEARCH_METADATA_PREFIX) ||
          !isBuiltInMetadataProviderKey(key.slice(COVER_SEARCH_METADATA_PREFIX.length))),
    )
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
    listedSources.value = BUILT_IN_COVER_SEARCH_SOURCES
  }

  watch(
    () => user.value?.id,
    () => {
      resetSources()
      if (requested && user.value) void fetchSources()
    },
    { flush: 'sync' },
  )
  watch([loaded, () => preferences.value.coverSearch.enabled, () => policy.value.extendedCoverSearchEnabled], () => {
    if (requested && user.value) {
      generation.invalidate()
      fetchSources.clear()
      void fetchSources()
    }
  })

  function load() {
    requested = true
    return user.value ? fetchSources() : Promise.resolve()
  }

  return { sources, load }
}
