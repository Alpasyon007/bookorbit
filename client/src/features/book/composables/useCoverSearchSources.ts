import { BUILT_IN_COVER_SEARCH_SOURCES, type CoverSearchSource } from '@bookorbit/types'
import { shallowRef } from 'vue'
import { api } from '@/lib/api'

export function useCoverSearchSources() {
  const sources = shallowRef<readonly CoverSearchSource[]>(BUILT_IN_COVER_SEARCH_SOURCES)
  let request: Promise<void> | undefined

  function load() {
    request ??= api('/api/v1/books/cover/sources')
      .then(async (response) => {
        if (response.ok) sources.value = (await response.json()) as CoverSearchSource[]
      })
      .catch(() => undefined)
      .finally(() => {
        request = undefined
      })
    return request
  }

  return { sources, load }
}
