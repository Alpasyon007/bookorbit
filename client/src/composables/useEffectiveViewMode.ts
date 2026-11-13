import { computed } from 'vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { useDisplaySettings, type BookViewMode } from '@/composables/useDisplaySettings'

export function useEffectiveViewMode(options: { allowSeriesGrid?: boolean } = {}) {
  const { viewMode: preference } = useDisplaySettings()
  const { md } = useBreakpoints(breakpointsTailwind)
  const viewMode = computed<BookViewMode>({
    get: () => (!options.allowSeriesGrid && preference.value === 'series-grid' ? 'grid' : preference.value),
    set: (mode) => {
      preference.value = mode
    },
  })

  const effectiveViewMode = computed<BookViewMode>(() => {
    if (!md.value && viewMode.value === 'table') return 'grid'
    return viewMode.value
  })

  return { viewMode, effectiveViewMode }
}
