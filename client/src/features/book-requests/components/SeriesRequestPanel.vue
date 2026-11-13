<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, LibraryBig, Loader2, Search } from '@lucide/vue'
import { BOOK_REQUEST_MEDIA_KINDS, type SeriesCatalogSeries } from '@bookorbit/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useSeriesRequests } from '../composables/useSeriesRequests'
import { requestMediaIcon } from '../requestMedia'

const props = defineProps<{ seed: { name: string; sequence: number }; onAcknowledged: () => void }>()
const { t } = useI18n()
const searchInput = ref<InstanceType<typeof Input> | null>(null)
const previewHeading = ref<HTMLElement | null>(null)

function focusSearch() {
  const input = searchInput.value?.$el as HTMLInputElement | undefined
  input?.scrollIntoView({ block: 'center' })
  input?.focus({ preventScroll: true })
}
defineExpose({ focusSearch })

const {
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
  searching,
  hasSearched,
  results,
  searchOffset,
  searchPageOffset,
  selected,
  books,
  previewLoaded,
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
  clearSelection,
  previousPage,
  nextPage,
  requestAll,
  availabilityLabel,
} = useSeriesRequests(() => props.seed, props.onAcknowledged)

const canSearch = computed(() => query.value.trim().length >= 2)
const optionsDisabled = computed(() => busy.value || !optionsReady.value)

async function openPreview(series: SeriesCatalogSeries) {
  selectSeries(series)
  await nextTick()
  previewHeading.value?.focus()
}

async function backToResults() {
  clearSelection()
  await nextTick()
  focusSearch()
}
</script>

<template>
  <section class="mt-6 space-y-3" aria-labelledby="series-search-title">
    <div class="space-y-1">
      <h2 id="series-search-title" class="text-base font-semibold text-foreground">{{ t('bookRequests.series.title') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('bookRequests.series.help') }}</p>
    </div>

    <form class="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center" @submit.prevent="handleSearch">
      <div class="relative min-w-0 flex-1">
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <label for="series-query" class="sr-only">{{ t('bookRequests.series.search') }}</label>
        <Input
          id="series-query"
          ref="searchInput"
          v-model="query"
          type="search"
          class="bg-background ps-9 shadow-none focus-visible:ring-ring/40 dark:bg-background"
          :placeholder="t('bookRequests.series.searchPlaceholder')"
          minlength="2"
          maxlength="200"
          required
        />
      </div>
      <Button type="submit" class="w-full sm:w-auto" :disabled="busy || !canSearch">
        <Loader2 v-if="searching" class="motion-safe:animate-spin" aria-hidden="true" />
        {{ t('bookRequests.series.search') }}
      </Button>
    </form>

    <p v-if="searching" role="status" class="sr-only">{{ t('bookRequests.search.searching') }}</p>

    <template v-if="!selected">
      <ul v-if="results.length" class="space-y-2">
        <li v-for="series in results" :key="series.id">
          <Button
            type="button"
            variant="ghost"
            class="h-auto min-h-14 w-full justify-start gap-3 rounded-lg border border-border bg-card p-3 text-start whitespace-normal"
            :disabled="busy"
            @click="openPreview(series)"
          >
            <LibraryBig class="size-4 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block font-semibold wrap-break-word">{{ series.name }}</span>
              <span v-if="series.author" class="block text-sm font-normal wrap-break-word text-muted-foreground">{{ series.author }}</span>
            </span>
            <ChevronRight class="size-4 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
          </Button>
        </li>
      </ul>
      <div v-else-if="hasSearched && !searching && !error" role="status" class="space-y-0.5 rounded-xl border border-border bg-card p-4">
        <p class="text-sm font-medium text-foreground">{{ t('bookRequests.series.noResultsTitle') }}</p>
        <p class="text-sm text-muted-foreground">{{ t('bookRequests.series.noResultsHint') }}</p>
      </div>

      <div v-if="searchPageOffset > 0 || searchOffset !== null" class="flex flex-wrap justify-end gap-2">
        <Button v-if="searchPageOffset > 0" type="button" variant="outline" size="sm" :disabled="busy" @click="handlePreviousSearch">
          <ChevronLeft class="rtl:rotate-180" aria-hidden="true" />
          {{ t('bookRequests.series.previous') }}
        </Button>
        <Button v-if="searchOffset !== null" type="button" variant="outline" size="sm" :disabled="busy" @click="handleMoreSearch">
          {{ t('bookRequests.series.more') }}
          <ChevronRight class="rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </template>

    <div v-else class="overflow-hidden rounded-xl border border-border bg-card">
      <div class="space-y-2 p-3 sm:p-4">
        <Button type="button" variant="ghost" size="sm" class="-ms-1 text-muted-foreground" :disabled="busy" @click="backToResults">
          <ArrowLeft class="rtl:rotate-180" aria-hidden="true" />
          {{ t('bookRequests.series.backToResults') }}
        </Button>
        <div class="space-y-0.5">
          <h3 ref="previewHeading" class="text-base font-semibold wrap-break-word text-foreground" tabindex="-1">{{ selected.name }}</h3>
          <p v-if="selected.author" class="text-sm wrap-break-word text-muted-foreground">{{ selected.author }}</p>
        </div>
      </div>

      <ul v-if="books.length" class="divide-y divide-border border-t border-border">
        <li v-for="(book, index) in books" :key="book.id" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
          <div class="min-w-0">
            <p class="text-sm font-medium wrap-break-word text-foreground">
              <span v-if="book.position !== null" class="me-1.5 font-normal text-muted-foreground tabular-nums">{{ book.position }}.</span>
              {{ book.title }}
            </p>
            <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">{{ book.releaseDate ?? t('bookRequests.series.unknown') }}</p>
          </div>
          <Badge v-if="availabilityLabel(index)" variant="secondary" class="max-w-full whitespace-normal">{{ availabilityLabel(index) }}</Badge>
        </li>
      </ul>
      <p v-else-if="previewLoaded && !busy" role="status" class="border-t border-border px-3 py-3 text-sm text-muted-foreground sm:px-4">
        {{ t('bookRequests.series.noBooks') }}
      </p>

      <div v-if="pageOffset > 0 || nextOffset !== null" class="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2.5 sm:px-4">
        <Button type="button" variant="outline" size="sm" :disabled="busy || !pageOffset" @click="previousPage">
          <ChevronLeft class="rtl:rotate-180" aria-hidden="true" />
          {{ t('bookRequests.series.previous') }}
        </Button>
        <Button type="button" variant="outline" size="sm" :disabled="busy || nextOffset === null" @click="nextPage">
          {{ t('bookRequests.series.next') }}
          <ChevronRight class="rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>

      <div v-if="previewLoaded && books.length" class="space-y-3 border-t border-border bg-muted p-3 sm:p-4">
        <fieldset class="grid min-w-0 gap-3 sm:grid-cols-2" :disabled="optionsDisabled">
          <legend class="mb-2 text-sm font-medium text-foreground">{{ t('bookRequests.series.options') }}</legend>
          <div class="grid min-w-0 gap-1.5">
            <label for="series-media" class="text-xs font-medium text-foreground">{{ t('bookRequests.series.media') }}</label>
            <div class="relative">
              <component
                :is="requestMediaIcon(mediaKind)"
                class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Select id="series-media" v-model="mediaKind" class="bg-card ps-9" :disabled="optionsDisabled">
                <option v-for="kind in BOOK_REQUEST_MEDIA_KINDS" :key="kind" :value="kind">{{ t(`bookRequests.mediaKind.${kind}`) }}</option>
              </Select>
            </div>
          </div>
          <div class="grid min-w-0 gap-1.5">
            <label for="series-language" class="text-xs font-medium text-foreground">{{ t('bookRequests.search.languageLabel') }}</label>
            <Select
              id="series-language"
              :model-value="language ?? ''"
              class="bg-card"
              :disabled="optionsDisabled"
              @update:model-value="changeLanguage"
            >
              <option value="">{{ t('bookRequests.search.languageAny') }}</option>
              <option v-for="option in languageOptions" :key="option.code" :value="option.code">{{ option.name }}</option>
            </Select>
          </div>
          <div class="grid min-w-0 gap-1.5">
            <label for="series-library" class="text-xs font-medium text-foreground">{{ t('bookRequests.search.libraryLabel') }}</label>
            <Select
              id="series-library"
              :model-value="targetLibraryId ?? ''"
              class="bg-card"
              :aria-describedby="optionsReady && destinationMissing ? 'series-destination-hint' : undefined"
              :disabled="optionsDisabled"
              @update:model-value="changeLibrary"
            >
              <option value="">{{ defaultLabel }}</option>
              <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
            </Select>
          </div>
          <div v-if="folders.length > 1" class="grid min-w-0 gap-1.5">
            <label for="series-folder" class="text-xs font-medium text-foreground">{{ t('bookRequests.search.folderLabel') }}</label>
            <Select
              id="series-folder"
              :model-value="targetFolderId ?? ''"
              class="bg-card"
              :disabled="optionsDisabled"
              @update:model-value="changeFolder"
            >
              <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
            </Select>
          </div>
        </fieldset>
        <p v-if="optionsReady && destinationMissing" id="series-destination-hint" class="text-sm text-muted-foreground">
          {{ t('bookRequests.series.chooseDestination') }}
        </p>
        <p class="text-xs text-muted-foreground">{{ t('bookRequests.series.batchHint') }}</p>
        <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button type="button" class="h-auto min-h-9 whitespace-normal" :disabled="optionsDisabled || destinationMissing" @click="requestAll">
            <Loader2 v-if="running" class="motion-safe:animate-spin" aria-hidden="true" />
            {{ t('bookRequests.series.requestAll') }}
          </Button>
          <Button v-if="running" type="button" variant="outline" class="h-auto min-h-9 whitespace-normal" @click="stop">
            {{ t('bookRequests.series.stop') }}
          </Button>
        </div>
      </div>
    </div>

    <p v-if="busy && !searching" role="status" :class="running ? 'sr-only' : 'flex items-center gap-2 text-sm text-muted-foreground'">
      <Loader2 class="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      {{ t(running ? 'bookRequests.series.working' : 'bookRequests.series.loading') }}
    </p>
    <p v-if="progress" role="status" class="text-sm text-muted-foreground">{{ progress }}</p>
    <div v-if="error" role="alert" class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p class="min-w-0 wrap-break-word text-foreground">{{ error }}</p>
    </div>
  </section>
</template>
