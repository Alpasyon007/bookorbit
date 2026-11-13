<script setup lang="ts">
import type { BookCard, ConcreteBookMediaKind, CoverAspectRatio } from '@bookorbit/types'
import BookCoverCard from './BookCoverCard.vue'
import BookCoverSkeleton from './BookCoverSkeleton.vue'
import CollapsedSeriesCard from './CollapsedSeriesCard.vue'
import { isBookPlaceholder, type BookSlot } from '../composables/useBookWindow'

type BookActionType = 'quick-view' | 'add-to-collection' | 'move-to-library' | 'delete'

const props = defineProps<{
  item: BookSlot
  coverAspectRatio: CoverAspectRatio
  showLabel: boolean
  selectionMode: boolean
  selected: boolean
  allowMoveToLibrary?: boolean
  mediaKind?: ConcreteBookMediaKind | null
}>()

const emit = defineEmits<{
  action: [book: BookCard, action: BookActionType]
  select: [bookId: number, event: MouseEvent]
  'update:book': [updated: BookCard]
}>()

function handleAction(action: BookActionType) {
  if (!isBookPlaceholder(props.item)) emit('action', props.item, action)
}

function handleSelect(event: MouseEvent) {
  emit('select', props.item.id, event)
}

function handleUpdateBook(updated: BookCard) {
  emit('update:book', updated)
}
</script>

<template>
  <BookCoverSkeleton v-if="isBookPlaceholder(item)" />
  <CollapsedSeriesCard
    v-else-if="item.collapsedSeries"
    :book="item"
    :cover-aspect-ratio="coverAspectRatio"
    :show-label="showLabel"
    :selection-mode="selectionMode"
  />
  <BookCoverCard
    v-else
    :book="item"
    :cover-aspect-ratio="coverAspectRatio"
    :show-label="showLabel"
    :selection-mode="selectionMode"
    :selected="selected"
    :allow-move-to-library="allowMoveToLibrary"
    :media-kind="mediaKind"
    @action="handleAction"
    @select="handleSelect"
    @update:book="handleUpdateBook"
  />
</template>
