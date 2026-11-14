import { computed } from 'vue'
import { BOOK_VIEW_MODES } from '@bookorbit/types'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { useCustomPatchSettings } from './useCustomPatchSettings'

export function useLibrarySeriesGrid() {
  const { preferences, policy, loaded, loading, loadFailed, load } = useCustomPatchSettings()
  const gridPreferences = computed(() => preferences.value.seriesGrid)
  const allowSeriesGrid = computed(() => !loadFailed.value && policy.value.seriesGridEnabled && gridPreferences.value.enabled)
  const { viewMode, effectiveViewMode } = useEffectiveViewMode({ allowSeriesGrid })
  const seriesGrid = computed(() => effectiveViewMode.value === 'series-grid')
  const libraryViewModes = computed(() => BOOK_VIEW_MODES.filter((mode) => mode !== 'series-grid' || (loaded.value && allowSeriesGrid.value)))
  const seriesGridOptions = computed(() => {
    const { hierarchyOrder, groupOrder, maxDepth, directBooksPosition, standalonePosition } = gridPreferences.value
    return { hierarchyOrder, groupOrder, maxDepth, directBooksPosition, standalonePosition }
  })
  const listingEnabled = computed(() => !seriesGrid.value || loaded.value)

  return {
    viewMode,
    effectiveViewMode,
    seriesGrid,
    libraryViewModes,
    seriesGridOptions,
    gridPreferences,
    listingEnabled,
    loaded,
    loading,
    loadFailed,
    load,
  }
}
