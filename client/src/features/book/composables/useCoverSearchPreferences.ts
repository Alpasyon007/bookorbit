import { DEFAULT_COVER_SEARCH_PROVIDER, isCoverSearchSourceKey, type CoverSearchDefaultProvider, type CoverSearchPreferences } from '@bookorbit/types'
import { effectScope, ref, watch } from 'vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'

const ENDPOINT = '/api/v1/user-preferences/cover-search'

const defaultProvider = ref<CoverSearchDefaultProvider>(DEFAULT_COVER_SEARCH_PROVIDER)
const isLoading = ref(false)
const isSaving = ref(false)

let hasLoaded = false
let accountId: number | undefined
let observing = false
const generation = createRequestGeneration()

function normalizeProvider(value: unknown): CoverSearchDefaultProvider {
  return isCoverSearchSourceKey(value) ? value : DEFAULT_COVER_SEARCH_PROVIDER
}

const fetchPreferences = createCoalescedFetch(async (): Promise<boolean> => {
  const request = generation.current()
  isLoading.value = true
  try {
    const response = await api(ENDPOINT)
    if (!response.ok) return false

    const body = (await response.json()) as { settings?: Partial<CoverSearchPreferences> }
    if (!generation.isCurrent(request)) return false
    defaultProvider.value = normalizeProvider(body.settings?.defaultProvider)
    hasLoaded = true
    return true
  } catch {
    return false
  } finally {
    if (generation.isCurrent(request)) isLoading.value = false
  }
})

export function useCoverSearchPreferences() {
  if (!observing) {
    observing = true
    const { user } = useAuth()
    effectScope(true).run(() => {
      watch(
        () => user.value?.id,
        (id) => {
          generation.invalidate()
          fetchPreferences.clear()
          accountId = id
          defaultProvider.value = DEFAULT_COVER_SEARCH_PROVIDER
          isLoading.value = false
          isSaving.value = false
          hasLoaded = false
        },
        { immediate: true, flush: 'sync' },
      )
    })
  }

  async function load(): Promise<boolean> {
    if (accountId === undefined || isSaving.value) return false
    if (hasLoaded) return true
    return fetchPreferences()
  }

  async function update(provider: CoverSearchDefaultProvider): Promise<boolean> {
    if (accountId === undefined || isLoading.value || isSaving.value || !isCoverSearchSourceKey(provider)) return false
    const request = generation.current()
    const previous = defaultProvider.value
    defaultProvider.value = provider
    isSaving.value = true

    try {
      const response = await api(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { defaultProvider: provider } } satisfies { settings: CoverSearchPreferences }),
      })
      if (!generation.isCurrent(request)) return false
      if (!response.ok) {
        defaultProvider.value = previous
        return false
      }
      hasLoaded = true
      return true
    } catch {
      if (generation.isCurrent(request)) defaultProvider.value = previous
      return false
    } finally {
      if (generation.isCurrent(request)) isSaving.value = false
    }
  }

  return { defaultProvider, isLoading, isSaving, load, update }
}
