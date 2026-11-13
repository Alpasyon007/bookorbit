<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckSquare, MoreHorizontal, Search, SlidersHorizontal, Square } from '@lucide/vue'

const { t } = useI18n()
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BookViewMode } from '@/composables/useDisplaySettings'

const props = withDefaults(
  defineProps<{
    viewMode: BookViewMode
    selectionMode?: boolean
    showSelection?: boolean
    showViewModeToggle?: boolean
    searchable?: boolean
    mobileSearchInMenu?: boolean
    showDisplayAction?: boolean
    allowedViewModes?: BookViewMode[]
  }>(),
  {
    selectionMode: false,
    showSelection: true,
    showViewModeToggle: true,
    searchable: false,
    mobileSearchInMenu: true,
    showDisplayAction: true,
    allowedViewModes: () => ['grid', 'list', 'table'] as BookViewMode[],
  },
)

const emit = defineEmits<{
  'update:viewMode': [value: BookViewMode]
  'open-display': []
  'open-mobile-search': []
  'toggle-selection': []
}>()

function handleViewModeUpdate(value: unknown) {
  const mode = mobileViewModes.value.find((mode) => mode === value)
  if (mode) emit('update:viewMode', mode)
}

const slots = useSlots()

const mobileViewModes = computed(() => props.allowedViewModes.filter((mode) => mode !== 'table'))
const hasViewModeActions = computed(() => props.showViewModeToggle && mobileViewModes.value.length > 0)
const hasSearchAction = computed(() => props.searchable && props.mobileSearchInMenu)
const hasSelectionAction = computed(() => props.showSelection)
const hasCustomMobileMenu = computed(() => Boolean(slots['mobile-menu']))
const hasActions = computed(
  () => props.showDisplayAction || hasViewModeActions.value || hasSearchAction.value || hasSelectionAction.value || hasCustomMobileMenu.value,
)
</script>

<template>
  <DropdownMenu v-if="hasActions">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
        <MoreHorizontal :size="15" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" class="w-44">
      <template v-if="hasViewModeActions">
        <DropdownMenuRadioGroup :model-value="viewMode" @update:model-value="handleViewModeUpdate">
          <DropdownMenuRadioItem v-for="mode in mobileViewModes" :key="mode" :value="mode">{{
            t(mode === 'series-grid' ? 'components.viewHeader.viewModes.series-grid' : `components.viewHeader.mobileMenu.${mode}`)
          }}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
      </template>

      <template v-if="showDisplayAction">
        <DropdownMenuItem @click="emit('open-display')">
          <SlidersHorizontal :size="14" class="mr-2" />
          {{ t('components.viewHeader.displayControls.display') }}
        </DropdownMenuItem>
      </template>

      <template v-if="$slots['mobile-menu']">
        <DropdownMenuSeparator />
        <slot name="mobile-menu" />
      </template>

      <template v-if="searchable && mobileSearchInMenu">
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="emit('open-mobile-search')">
          <Search :size="14" class="mr-2" />
          {{ t('common.search') }}
        </DropdownMenuItem>
      </template>

      <template v-if="showSelection">
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="emit('toggle-selection')">
          <CheckSquare v-if="selectionMode" :size="14" class="mr-2" />
          <Square v-else :size="14" class="mr-2" />
          {{ selectionMode ? t('components.viewHeader.mobileMenu.exitSelect') : t('components.viewHeader.mobileMenu.select') }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
