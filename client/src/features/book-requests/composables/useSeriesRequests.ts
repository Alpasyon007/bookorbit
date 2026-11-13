import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { Permission } from '@bookorbit/types'
import { requestLanguageOptions, useRequestDestinationDefault, useRequestLanguageDefault } from './useRequestDestinationDefault'
import { useI18n } from 'vue-i18n'
import type {
  BookRequestAvailability,
  BookRequestMediaKind,
  BookRequestSubmitResult,
  SeriesCatalogBook,
  SeriesCatalogPage,
  SeriesCatalogSeries,
} from '@bookorbit/types'

export function useSeriesRequests(seed: () => { name: string; sequence: number }, onSubmitted: () => void) {
  const { t, locale } = useI18n()
  const { libraries, fetchLibraries } = useLibraries()
  const { hasPermission } = usePermissions()
  const { load: loadDestinations, defaultFor, resolveDestination } = useRequestDestinationDefault()
  const { load: loadLanguage, resolveLanguage } = useRequestLanguageDefault()
  const query = ref('')
  const results = ref<SeriesCatalogSeries[]>([])
  const searchOffset = ref<number | null>(null)
  const searchPageOffset = ref(0)
  const selected = ref<SeriesCatalogSeries | null>(null)
  const books = ref<SeriesCatalogBook[]>([])
  const annotations = ref<BookRequestAvailability[]>([])
  const pageOffset = ref(0)
  const nextOffset = ref<number | null>(null)
  const mediaKind = ref<BookRequestMediaKind>('ebook')
  const optionsReady = ref(false)
  const targetLibraryId = ref<number | null>(null)
  const targetFolderId = ref<number | null>(null)
  const language = ref<string | null>(null)
  const folders = computed(() => libraries.value.find((library) => library.id === targetLibraryId.value)?.folders ?? [])
  const languageOptions = computed(() => requestLanguageOptions(locale.value))
  const destinationMissing = computed(
    () => hasPermission(Permission.BookRequestAutoApprove) && targetLibraryId.value === null && defaultFor(mediaKind.value).libraryId === null,
  )
  const defaultLabel = computed(() => {
    const name = defaultFor(mediaKind.value).libraryName
    return name
      ? t('bookRequests.search.libraryDefault', { library: name })
      : t(hasPermission(Permission.BookRequestAutoApprove) ? 'bookRequests.search.libraryChoose' : 'bookRequests.search.libraryAny')
  })
  onMounted(async () => {
    await Promise.all([fetchLibraries(), loadDestinations(), loadLanguage()])
    if (disposed) return
    targetLibraryId.value = resolveDestination(libraries.value, undefined, hasPermission(Permission.BookRequestAutoApprove)).libraryId
    language.value = resolveLanguage(locale.value)
    optionsReady.value = true
  })
  watch(targetLibraryId, () => {
    targetFolderId.value = folders.value[0]?.id ?? null
  })
  function changeLibrary(event: Event) {
    const value = (event.target as HTMLSelectElement).value
    targetLibraryId.value = value ? Number(value) : null
  }
  function changeFolder(event: Event) {
    const value = (event.target as HTMLSelectElement).value
    targetFolderId.value = value ? Number(value) : null
  }
  function changeLanguage(event: Event) {
    language.value = (event.target as HTMLSelectElement).value || null
  }
  const busy = ref(false)
  const running = ref(false)
  let cancelled = false
  const error = ref('')
  const progress = ref('')
  let disposed = false
  onUnmounted(() => {
    disposed = true
  })

  async function read<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await api(url, init)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(typeof body?.message === 'string' ? body.message : t('bookRequests.series.failed'))
    }
    return (await response.json()) as T
  }
  async function readPage<T>(url: string, offset: number): Promise<SeriesCatalogPage<T>> {
    const page = await read<SeriesCatalogPage<T>>(url)
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 25 ||
      (page.nextOffset !== null && (page.nextOffset !== offset + 25 || page.nextOffset > 100000))
    ) {
      throw new Error(t('bookRequests.series.failed'))
    }
    return page
  }
  async function searchAt(offset: number) {
    busy.value = true
    error.value = ''
    try {
      const page = await readPage<SeriesCatalogSeries>(
        `/api/v1/book-requests/series-catalog?q=${encodeURIComponent(query.value.trim())}&offset=${offset}`,
        offset,
      )
      if (disposed) return
      results.value = page.items
      searchPageOffset.value = offset
      searchOffset.value = page.nextOffset
    } catch (e) {
      if (!disposed) error.value = e instanceof Error ? e.message : t('bookRequests.series.failed')
    } finally {
      if (!disposed) busy.value = false
    }
  }
  let appliedSeed = 0
  watch([seed, busy], ([seed, isBusy]) => {
    if (seed.name && seed.sequence !== appliedSeed && !isBusy) {
      appliedSeed = seed.sequence
      query.value = seed.name
      handleSearch()
    }
  })
  function handleSearch() {
    if (busy.value || query.value.trim().length < 2) return
    selected.value = null
    results.value = []
    searchOffset.value = null
    searchPageOffset.value = 0
    progress.value = ''
    void searchAt(0)
  }
  function handlePreviousSearch() {
    void searchAt(Math.max(0, searchPageOffset.value - 25))
  }
  function handleMoreSearch() {
    if (searchOffset.value !== null) void searchAt(searchOffset.value)
  }
  async function loadPage(offset: number, preserveError = false) {
    if (!selected.value) return
    busy.value = true
    if (!preserveError) error.value = ''
    try {
      const page = await readPage<SeriesCatalogBook>(`/api/v1/book-requests/series-catalog/${selected.value.id}?offset=${offset}`, offset)
      if (disposed) return
      const availability = page.items.length ? await availabilityFor(page.items, mediaKind.value) : []
      if (disposed) return
      books.value = page.items
      annotations.value = availability
      pageOffset.value = offset
      nextOffset.value = page.nextOffset
    } catch (e) {
      if (!disposed && (!preserveError || !error.value)) error.value = e instanceof Error ? e.message : t('bookRequests.series.failed')
    } finally {
      if (!disposed) busy.value = false
    }
  }
  function selectSeries(series: SeriesCatalogSeries) {
    selected.value = series
    books.value = []
    annotations.value = []
    pageOffset.value = 0
    nextOffset.value = null
    progress.value = ''
    void loadPage(0)
  }
  function previousPage() {
    void loadPage(Math.max(0, pageOffset.value - 25))
  }
  function nextPage() {
    if (nextOffset.value !== null) void loadPage(nextOffset.value)
  }

  async function availabilityFor(items: SeriesCatalogBook[], kind: BookRequestMediaKind): Promise<BookRequestAvailability[]> {
    const result = await read<BookRequestAvailability[]>('/api/v1/book-requests/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((book) => ({
          title: book.title,
          author: book.authors[0],
          mediaKind: kind,
          providerKey: 'hardcover',
          providerId: book.id,
        })),
      }),
    })
    if (!Array.isArray(result) || result.length !== items.length) throw new Error(t('bookRequests.series.failed'))
    return result
  }
  function availabilityLabel(index: number): string {
    const item = annotations.value[index]
    if (!item) return ''
    if (item.ownedBookId) return t('bookRequests.series.owned')
    if (item.alreadySubscribed) return t('bookRequests.series.subscribed')
    if (item.existingRequestId) return t('bookRequests.series.requested')
    return t('bookRequests.series.missing')
  }
  watch(mediaKind, () => {
    if (selected.value) void loadPage(pageOffset.value)
  })

  async function requestAll() {
    if (!selected.value || busy.value || !optionsReady.value || destinationMissing.value) return
    busy.value = true
    running.value = true
    cancelled = false
    error.value = ''
    progress.value = ''
    let offset: number | null = 0
    let created = 0
    let joined = 0
    let skipped = 0
    let unknown = 0
    const today = new Date().toISOString().slice(0, 10)
    const series = selected.value
    const kind = mediaKind.value
    const destination = { targetLibraryId: targetLibraryId.value, targetFolderId: targetFolderId.value, language: language.value }
    try {
      do {
        const page: SeriesCatalogPage<SeriesCatalogBook> = await readPage(
          `/api/v1/book-requests/series-catalog/${series.id}?offset=${offset}`,
          offset,
        )
        if (disposed) return
        if (cancelled) throw new Error(t('bookRequests.series.stopped'))
        const eligible = page.items.filter((book) => {
          if (!book.releaseDate) {
            unknown++
            return false
          }
          if (book.releaseDate > today) {
            skipped++
            return false
          }
          return true
        })
        if (eligible.length) {
          const availability = await availabilityFor(eligible, kind)
          for (let i = 0; i < eligible.length; i++) {
            if (disposed) return
            if (cancelled) throw new Error(t('bookRequests.series.stopped'))
            const book = eligible[i]!
            const status = availability[i]!
            if (status.ownedBookId || status.alreadySubscribed) {
              skipped++
              continue
            }
            const result = await read<BookRequestSubmitResult>('/api/v1/book-requests', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: book.title,
                authors: book.authors,
                seriesName: series.name,
                ...(book.position !== null && Number.isSafeInteger(book.position) && book.position >= 0 ? { seriesIndex: book.position } : {}),
                mediaKind: kind,
                ...destination,
                providerKey: 'hardcover',
                providerId: book.id,
              }),
            })
            if (disposed) return
            if (result.subscribed) joined++
            else created++
            progress.value = t('bookRequests.series.progress', { created, joined, skipped, unknown })
          }
        }
        if (cancelled) throw new Error(t('bookRequests.series.stopped'))
        offset = page.nextOffset
        progress.value = t('bookRequests.series.progress', { created, joined, skipped, unknown })
      } while (offset !== null)
      progress.value += ' ' + t(unknown ? 'bookRequests.series.unknownDates' : 'bookRequests.series.complete')
    } catch (e) {
      if (!disposed) error.value = t('bookRequests.series.partial', { reason: e instanceof Error ? e.message : t('bookRequests.series.failed') })
    } finally {
      if (!disposed) {
        busy.value = false
        running.value = false
      }
      onSubmitted()
      if (!disposed && selected.value?.id === series.id) void loadPage(pageOffset.value, true)
    }
  }

  function stop() {
    cancelled = true
  }

  return {
    running,
    stop,
    optionsReady,
    libraries,
    folders,
    targetLibraryId,
    targetFolderId,
    language,
    languageOptions,
    destinationMissing,
    defaultLabel,
    changeLibrary,
    changeFolder,
    changeLanguage,
    query,
    results,
    searchOffset,
    searchPageOffset,
    selected,
    books,
    pageOffset,
    nextOffset,
    mediaKind,
    busy,
    error,
    progress,
    handleSearch,
    handleMoreSearch,
    handlePreviousSearch,
    selectSeries,
    previousPage,
    nextPage,
    requestAll,
    availabilityLabel,
  }
}
