import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES } from '@bookorbit/types'
import { useLibrarySeriesGrid } from './useLibrarySeriesGrid'

const preference = ref('series-grid')
const preferences = ref(structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES))
const policy = ref({ ...DEFAULT_CUSTOM_PATCH_POLICY })
const loaded = ref(false)
const loading = ref(true)
const loadFailed = ref(false)
const load = vi.fn<() => Promise<boolean>>()

vi.mock('@/composables/useDisplaySettings', () => ({ useDisplaySettings: () => ({ viewMode: preference }) }))
vi.mock('./useCustomPatchSettings', () => ({ useCustomPatchSettings: () => ({ preferences, policy, loaded, loading, loadFailed, load }) }))

describe('useLibrarySeriesGrid', () => {
  beforeEach(() => {
    preference.value = 'series-grid'
    preferences.value = structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES)
    policy.value = { ...DEFAULT_CUSTOM_PATCH_POLICY }
    loaded.value = false
    loading.value = true
    loadFailed.value = false
  })

  it('keeps the saved mode, loads ordinary Grid after a failure and restores saved grouping after retry', () => {
    const grid = useLibrarySeriesGrid()
    expect(grid.seriesGrid.value).toBe(true)
    expect(grid.listingEnabled.value).toBe(false)
    expect(grid.libraryViewModes.value).not.toContain('series-grid')

    loading.value = false
    loadFailed.value = true
    expect(grid.effectiveViewMode.value).toBe('grid')
    expect(grid.listingEnabled.value).toBe(true)
    expect(preference.value).toBe('series-grid')

    loading.value = true
    expect(grid.effectiveViewMode.value).toBe('grid')
    preferences.value.seriesGrid.hierarchyOrder = 'reverse'
    preferences.value.seriesGrid.groupOrder = 'name-desc'
    loaded.value = true
    loadFailed.value = false
    loading.value = false
    expect(grid.effectiveViewMode.value).toBe('series-grid')
    expect(grid.listingEnabled.value).toBe(true)
    expect(grid.libraryViewModes.value).toContain('series-grid')
    expect(grid.seriesGridOptions.value).toEqual({
      hierarchyOrder: 'reverse',
      groupOrder: 'name-desc',
      maxDepth: 0,
      directBooksPosition: 'last',
      standalonePosition: 'last',
    })
  })

  it('keeps ordinary views available during initial loading and hides Series Grid when policy turns it off', () => {
    preference.value = 'list'
    const grid = useLibrarySeriesGrid()
    expect(grid.effectiveViewMode.value).toBe('list')
    expect(grid.listingEnabled.value).toBe(true)
    loaded.value = true
    policy.value.seriesGridEnabled = false
    preference.value = 'series-grid'
    expect(grid.effectiveViewMode.value).toBe('grid')
    expect(grid.libraryViewModes.value).not.toContain('series-grid')
    expect(preference.value).toBe('series-grid')
  })
})
