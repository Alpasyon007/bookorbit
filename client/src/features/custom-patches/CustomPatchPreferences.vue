<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_CUSTOM_PATCH_PREFERENCES, Permission, type CustomPatchPreferences, type SeriesGridOptions } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookRequestVisibility } from '@/features/book-requests/composables/useBookRequestVisibility'
import PatchChoice from './components/PatchChoice.vue'
import PatchToggle from './components/PatchToggle.vue'
import PatchDraftActions from './components/PatchDraftActions.vue'
import { useCustomPatchSettings } from './composables/useCustomPatchSettings'
import { usePatchSettingsDraft } from './composables/usePatchSettingsDraft'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { showBookRequests } = useBookRequestVisibility()
const { preferences, policy, loaded, loadFailed, load, savePreferences } = useCustomPatchSettings()
const { draft, saving, saveFailed, savedStatus, isDirty, restoreDefaults, discard, save } = usePatchSettingsDraft<CustomPatchPreferences>({
  saved: preferences,
  loaded,
  defaults: DEFAULT_CUSTOM_PATCH_PREFERENCES,
  save: savePreferences,
  normalize: (settings) => ({ ...settings, seriesGrid: { ...settings.seriesGrid, standaloneLabel: settings.seriesGrid.standaloneLabel.trim() } }),
})

const canUseRequests = computed(() => showBookRequests.value && hasPermission(Permission.BookRequestAccess))
const canEditCovers = computed(() => hasPermission(Permission.LibraryEditMetadata))
const canManageProviders = computed(() => hasPermission(Permission.ManageMetadataConfig))
const canManageRequests = computed(() => hasPermission(Permission.ManageAppSettings))
const gridControlsDisabled = computed(() => saving.value || !policy.value.seriesGridEnabled || !draft.value.seriesGrid.enabled)
const sidebarControlsDisabled = computed(() => saving.value || !policy.value.sidebarCustomizationEnabled || !draft.value.sidebar.enabled)
const requestControlsDisabled = computed(
  () => saving.value || !policy.value.seriesRequestsEnabled || !canUseRequests.value || !draft.value.seriesRequests.enabled,
)

function choices<Value extends string>(values: readonly Value[], prefix: string) {
  return values.map((value) => ({ value, label: t(`${prefix}.${value}`) }))
}

const hierarchyOptions = computed(() =>
  choices<SeriesGridOptions['hierarchyOrder']>(['forward', 'reverse'], 'settings.customPatches.grid.hierarchyOptions'),
)
const groupOptions = computed(() =>
  choices<SeriesGridOptions['groupOrder']>(['library', 'library-reversed', 'name-asc', 'name-desc'], 'settings.customPatches.grid.groupOptions'),
)
const positionOptions = computed(() =>
  choices<SeriesGridOptions['standalonePosition']>(['first', 'last'], 'settings.customPatches.grid.positionOptions'),
)
const depthOptions = computed(() => [
  { value: 0, label: t('settings.customPatches.grid.allLevels') },
  ...Array.from({ length: 8 }, (_, index) => ({ value: index + 1, label: String(index + 1) })),
])
const formatOptions = computed(() =>
  choices<CustomPatchPreferences['seriesRequests']['defaultFormat']>(['ebook', 'audiobook'], 'settings.customPatches.requests.formatOptions'),
)
const selectionOptions = computed(() =>
  choices<CustomPatchPreferences['seriesRequests']['initialSelection']>(['eligible', 'none'], 'settings.customPatches.requests.selectionOptions'),
)
const hierarchyExample = computed(() => t(`settings.customPatches.grid.hierarchyExamples.${draft.value.seriesGrid.hierarchyOrder}`))

function handleRetry() {
  return load()
}
</script>

<template>
  <div v-if="!loaded && loadFailed" class="settings-error-state flex flex-wrap items-center justify-between gap-3" role="alert">
    <span>{{ t('settings.customPatches.loadFailed') }}</span>
    <Button type="button" variant="outline" size="sm" @click="handleRetry">{{ t('common.retry') }}</Button>
  </div>
  <p v-else-if="!loaded" class="settings-loading-state" role="status">{{ t('common.loading') }}</p>
  <div v-else class="flex flex-col gap-6">
    <section aria-labelledby="custom-patches-grid-title">
      <h3 id="custom-patches-grid-title" class="settings-group-label">{{ t('settings.customPatches.grid.title') }}</h3>
      <p v-if="!policy.seriesGridEnabled" class="settings-hint mb-2">{{ t('settings.customPatches.policyDisabled') }}</p>
      <div class="settings-card">
        <PatchToggle
          v-model="draft.seriesGrid.enabled"
          :label="t('settings.customPatches.grid.enabled')"
          :hint="t('settings.customPatches.grid.enabledHint')"
          :disabled="saving || !policy.seriesGridEnabled"
        />
        <PatchChoice
          v-model="draft.seriesGrid.hierarchyOrder"
          :label="t('settings.customPatches.grid.hierarchy')"
          :hint="hierarchyExample"
          :options="hierarchyOptions"
          :disabled="gridControlsDisabled"
        />
        <PatchChoice
          v-model="draft.seriesGrid.groupOrder"
          :label="t('settings.customPatches.grid.groupOrder')"
          :hint="t('settings.customPatches.grid.groupHint')"
          :options="groupOptions"
          :disabled="gridControlsDisabled"
        />
        <PatchChoice
          v-model="draft.seriesGrid.maxDepth"
          :label="t('settings.customPatches.grid.depth')"
          :hint="t('settings.customPatches.grid.depthHint')"
          :options="depthOptions"
          :disabled="gridControlsDisabled"
        />
        <PatchChoice
          v-model="draft.seriesGrid.directBooksPosition"
          :label="t('settings.customPatches.grid.directBooks')"
          :hint="t('settings.customPatches.grid.directBooksHint')"
          :options="positionOptions"
          :disabled="gridControlsDisabled"
        />
        <PatchChoice
          v-model="draft.seriesGrid.standalonePosition"
          :label="t('settings.customPatches.grid.standalonePosition')"
          :options="positionOptions"
          :disabled="gridControlsDisabled"
        />
        <div class="settings-row flex-wrap">
          <div>
            <label for="custom-patches-standalone" class="settings-label">{{ t('settings.customPatches.grid.standaloneLabel') }}</label>
            <p id="custom-patches-standalone-hint" class="settings-hint">{{ t('settings.customPatches.grid.standaloneLabelHint') }}</p>
          </div>
          <Input
            id="custom-patches-standalone"
            v-model="draft.seriesGrid.standaloneLabel"
            class="w-full sm:w-44"
            maxlength="40"
            :placeholder="t('views.bookView.seriesGrid.standalone')"
            aria-describedby="custom-patches-standalone-hint"
            :disabled="gridControlsDisabled"
          />
        </div>
        <div class="settings-row flex-wrap">
          <div>
            <label for="custom-patches-indent" class="settings-label">{{ t('settings.customPatches.grid.headingIndent') }}</label>
            <p id="custom-patches-indent-hint" class="settings-hint">{{ t('settings.customPatches.grid.headingIndentHint') }}</p>
          </div>
          <div class="flex w-full items-center gap-2 sm:w-44">
            <input
              id="custom-patches-indent"
              v-model.number="draft.seriesGrid.headingIndent"
              class="min-w-0 flex-1 accent-primary"
              type="range"
              min="0"
              max="32"
              aria-describedby="custom-patches-indent-hint"
              :disabled="gridControlsDisabled"
            />
            <output for="custom-patches-indent" class="w-10 text-end text-xs tabular-nums text-muted-foreground">{{
              t('settings.customPatches.grid.pixels', { count: draft.seriesGrid.headingIndent })
            }}</output>
          </div>
        </div>
        <PatchToggle v-model="draft.seriesGrid.showDividers" :label="t('settings.customPatches.grid.dividers')" :disabled="gridControlsDisabled" />
      </div>
    </section>

    <section aria-labelledby="custom-patches-sidebar-title">
      <h3 id="custom-patches-sidebar-title" class="settings-group-label">{{ t('settings.customPatches.sidebar.title') }}</h3>
      <p v-if="!policy.sidebarCustomizationEnabled" class="settings-hint mb-2">{{ t('settings.customPatches.policyDisabled') }}</p>
      <div class="settings-card">
        <PatchToggle
          v-model="draft.sidebar.enabled"
          :label="t('settings.customPatches.sidebar.enabled')"
          :hint="t('settings.customPatches.sidebar.enabledHint')"
          :disabled="saving || !policy.sidebarCustomizationEnabled"
        />
        <PatchToggle v-model="draft.sidebar.showGithub" :label="t('components.appHeader.starOnGithub')" :disabled="sidebarControlsDisabled" />
        <PatchToggle v-model="draft.sidebar.showSupport" :label="t('components.sidebar.supportAria')" :disabled="sidebarControlsDisabled" />
        <PatchToggle v-model="draft.sidebar.showIos" :label="t('components.sidebar.appLinks.ios')" :disabled="sidebarControlsDisabled" />
        <PatchToggle v-model="draft.sidebar.showAndroid" :label="t('components.sidebar.appLinks.android')" :disabled="sidebarControlsDisabled" />
      </div>
    </section>

    <section v-if="canUseRequests" aria-labelledby="custom-patches-requests-title">
      <h3 id="custom-patches-requests-title" class="settings-group-label">{{ t('settings.customPatches.requests.title') }}</h3>
      <p v-if="!policy.seriesRequestsEnabled" class="settings-hint mb-2">{{ t('settings.customPatches.policyDisabled') }}</p>
      <div class="settings-card">
        <PatchToggle
          v-model="draft.seriesRequests.enabled"
          :label="t('settings.customPatches.requests.enabled')"
          :hint="t('settings.customPatches.requests.enabledHint')"
          :disabled="saving || !policy.seriesRequestsEnabled"
        />
        <PatchChoice
          v-model="draft.seriesRequests.defaultFormat"
          :label="t('settings.customPatches.requests.format')"
          :options="formatOptions"
          :disabled="requestControlsDisabled"
        />
        <PatchChoice
          v-model="draft.seriesRequests.initialSelection"
          :label="t('settings.customPatches.requests.selection')"
          :options="selectionOptions"
          :disabled="requestControlsDisabled"
        />
        <PatchToggle
          v-model="draft.seriesRequests.showRequestAll"
          :label="t('settings.customPatches.requests.requestAll')"
          :hint="t('settings.customPatches.requests.requestAllHint')"
          :disabled="requestControlsDisabled"
        />
        <div class="settings-row flex-wrap">
          <RouterLink :to="{ name: 'book-requests', query: { tab: 'search' } }" class="text-sm text-primary underline underline-offset-2">{{
            t('settings.customPatches.requests.languageLink')
          }}</RouterLink>
          <RouterLink
            v-if="canManageRequests"
            :to="{ name: 'settings-admin-requests', query: { tab: 'automation' } }"
            class="text-sm text-primary underline underline-offset-2"
            >{{ t('settings.customPatches.requests.destinationsLink') }}</RouterLink
          >
          <RouterLink
            v-if="canManageProviders"
            :to="{ name: 'settings-metadata-providers' }"
            class="text-sm text-primary underline underline-offset-2"
            >{{ t('settings.customPatches.requests.providerLink') }}</RouterLink
          >
        </div>
      </div>
    </section>

    <section v-if="canEditCovers" aria-labelledby="custom-patches-covers-title">
      <h3 id="custom-patches-covers-title" class="settings-group-label">{{ t('settings.customPatches.covers.title') }}</h3>
      <p v-if="!policy.extendedCoverSearchEnabled" class="settings-hint mb-2">{{ t('settings.customPatches.covers.policyDisabled') }}</p>
      <div class="settings-card">
        <PatchToggle
          v-model="draft.coverSearch.enabled"
          :label="t('settings.customPatches.covers.enabled')"
          :hint="t('settings.customPatches.covers.enabledHint')"
          :disabled="saving || !policy.extendedCoverSearchEnabled"
        />
        <div class="settings-row flex-wrap">
          <p class="settings-hint w-full">{{ t('settings.customPatches.covers.externalHint') }}</p>
          <RouterLink :to="{ name: 'settings-appearance-book-covers' }" class="text-sm text-primary underline underline-offset-2">{{
            t('settings.customPatches.covers.defaultSourceLink')
          }}</RouterLink>
          <RouterLink
            v-if="canManageProviders"
            :to="{ name: 'settings-metadata-providers', query: { tab: 'external' } }"
            class="text-sm text-primary underline underline-offset-2"
            >{{ t('settings.customPatches.covers.providersLink') }}</RouterLink
          >
        </div>
      </div>
    </section>
    <PatchDraftActions
      :dirty="isDirty"
      :saving="saving"
      :save-failed="saveFailed"
      :saved="savedStatus"
      @save="save"
      @discard="discard"
      @restore="restoreDefaults"
    />
  </div>
</template>
