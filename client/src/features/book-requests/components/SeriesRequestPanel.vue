<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSeriesRequests } from '../composables/useSeriesRequests'

const props = defineProps<{ seed: { name: string; sequence: number }; onAcknowledged: () => void }>()
const { t } = useI18n()
const searchInput = ref<HTMLInputElement | null>(null)
function focusSearch() {
  searchInput.value?.scrollIntoView({ block: 'center' })
  searchInput.value?.focus()
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
} = useSeriesRequests(() => props.seed, props.onAcknowledged)
</script>

<template>
  <section class="mt-6 space-y-3 rounded-lg border border-border p-4">
    <h2 class="font-semibold">{{ t('bookRequests.series.title') }}</h2>
    <p class="text-sm text-muted-foreground">{{ t('bookRequests.series.help') }}</p>
    <form class="flex flex-wrap gap-2" @submit.prevent="handleSearch">
      <input
        ref="searchInput"
        v-model="query"
        class="min-w-40 flex-1 rounded border border-input bg-background px-3 py-2"
        :aria-label="t('bookRequests.series.search')"
        :placeholder="t('bookRequests.series.search')"
        minlength="2"
        maxlength="200"
        required
      />
      <button type="submit" class="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" :disabled="busy">
        {{ t('bookRequests.series.search') }}
      </button>
    </form>
    <ul v-if="results.length" class="space-y-1">
      <li v-for="series in results" :key="series.id">
        <button type="button" class="text-start text-primary underline" :disabled="busy" @click="selectSeries(series)">
          {{ series.name }}<span v-if="series.author"> - {{ series.author }}</span>
        </button>
      </li>
    </ul>
    <button v-if="searchPageOffset > 0" type="button" class="me-3 text-primary underline" :disabled="busy" @click="handlePreviousSearch">
      {{ t('bookRequests.series.previous') }}
    </button>
    <button v-if="searchOffset !== null" type="button" class="text-primary underline" :disabled="busy" @click="handleMoreSearch">
      {{ t('bookRequests.series.more') }}
    </button>
    <div v-if="selected" class="space-y-3">
      <h3 class="font-medium">{{ selected.name }}</h3>
      <ul class="space-y-1 text-sm">
        <li v-for="(book, index) in books" :key="book.id">
          {{ book.position ?? '?' }}. {{ book.title }}
          <span class="text-muted-foreground">({{ book.releaseDate ?? t('bookRequests.series.unknown') }})</span>
          <span class="text-muted-foreground">{{ availabilityLabel(index) }}</span>
        </li>
      </ul>
      <div class="flex gap-3 text-sm">
        <button type="button" class="text-primary underline disabled:opacity-50" :disabled="busy || !pageOffset" @click="previousPage">
          {{ t('bookRequests.series.previous') }}</button
        ><button type="button" class="text-primary underline disabled:opacity-50" :disabled="busy || nextOffset === null" @click="nextPage">
          {{ t('bookRequests.series.next') }}
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <label for="series-library">{{ t('bookRequests.search.libraryLabel') }}</label>
        <select
          id="series-library"
          :value="targetLibraryId ?? ''"
          class="rounded border border-input bg-background px-2 py-2"
          :disabled="busy || !optionsReady"
          @change="changeLibrary"
        >
          <option value="">{{ defaultLabel }}</option>
          <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
        </select>
        <template v-if="folders.length > 1"
          ><label for="series-folder">{{ t('bookRequests.search.folderLabel') }}</label
          ><select
            id="series-folder"
            :value="targetFolderId ?? ''"
            class="rounded border border-input bg-background px-2 py-2"
            :disabled="busy || !optionsReady"
            @change="changeFolder"
          >
            <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
          </select></template
        >
        <label for="series-language">{{ t('bookRequests.search.languageLabel') }}</label
        ><select
          id="series-language"
          :value="language ?? ''"
          class="rounded border border-input bg-background px-2 py-2"
          :disabled="busy || !optionsReady"
          @change="changeLanguage"
        >
          <option value="">{{ t('bookRequests.search.languageAny') }}</option>
          <option v-for="option in languageOptions" :key="option.code" :value="option.code">{{ option.name }}</option>
        </select>
      </div>
      <p v-if="destinationMissing" class="text-sm text-destructive">{{ t('bookRequests.series.chooseDestination') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <label for="series-media">{{ t('bookRequests.series.media') }}</label
        ><select id="series-media" v-model="mediaKind" class="rounded border border-input bg-background px-2 py-2" :disabled="busy || !optionsReady">
          <option value="ebook">{{ t('bookRequests.series.ebook') }}</option>
          <option value="audiobook">{{ t('bookRequests.series.audiobook') }}</option></select
        ><button
          type="button"
          class="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
          :disabled="busy || !optionsReady || destinationMissing"
          @click="requestAll"
        >
          {{ t('bookRequests.series.requestAll') }}
        </button>
      </div>
    </div>
    <button v-if="running" type="button" class="text-primary underline" @click="stop">{{ t('bookRequests.series.stop') }}</button>
    <p v-if="busy" role="status">{{ t(running ? 'bookRequests.series.working' : 'bookRequests.series.loading') }}</p>
    <p v-if="progress" role="status" class="text-sm">{{ progress }}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
  </section>
</template>
