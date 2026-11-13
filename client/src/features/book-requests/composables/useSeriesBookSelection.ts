import { computed, ref, shallowRef } from 'vue'
import type { SeriesCatalogBook } from '@bookorbit/types'

export function useSeriesBookSelection() {
  const mode = ref<'all' | 'explicit'>('all')
  const excluded = shallowRef(new Set<string>())
  const selected = shallowRef(new Map<string, SeriesCatalogBook>())

  const selectionSummary = computed(() => ({
    mode: mode.value === 'explicit' ? ('explicit' as const) : excluded.value.size ? ('all-except' as const) : ('all' as const),
    count: mode.value === 'explicit' ? selected.value.size : excluded.value.size,
  }))
  const hasSelectedBooks = computed(() => mode.value === 'all' || selected.value.size > 0)

  function reset() {
    mode.value = 'all'
    excluded.value = new Set()
    selected.value = new Map()
  }
  function clear() {
    mode.value = 'explicit'
    excluded.value = new Set()
    selected.value = new Map()
  }
  function isSelected(id: string) {
    return mode.value === 'all' ? !excluded.value.has(id) : selected.value.has(id)
  }
  function toggle(book: SeriesCatalogBook) {
    if (mode.value === 'all') {
      const next = new Set(excluded.value)
      if (next.has(book.id)) next.delete(book.id)
      else next.add(book.id)
      excluded.value = next
    } else {
      const next = new Map(selected.value)
      if (next.has(book.id)) next.delete(book.id)
      else next.set(book.id, book)
      selected.value = next
    }
  }
  function removeSelected(id: string) {
    if (mode.value !== 'explicit' || !selected.value.has(id)) return
    const next = new Map(selected.value)
    next.delete(id)
    selected.value = next
  }
  function snapshot() {
    return { mode: mode.value, excluded: new Set(excluded.value), selected: [...selected.value.values()] }
  }

  return { selectionSummary, hasSelectedBooks, reset, clear, isSelected, toggle, removeSelected, snapshot }
}
