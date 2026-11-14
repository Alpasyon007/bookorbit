<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_CUSTOM_PATCH_POLICY, Permission, type CustomPatchPolicy } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import PatchToggle from './components/PatchToggle.vue'
import PatchDraftActions from './components/PatchDraftActions.vue'
import { useCustomPatchSettings } from './composables/useCustomPatchSettings'
import { usePatchSettingsDraft } from './composables/usePatchSettingsDraft'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const canManage = computed(() => hasPermission(Permission.ManageAppSettings))
const { policy, loaded, loadFailed, load, savePolicy } = useCustomPatchSettings()
const { draft, saving, saveFailed, savedStatus, isDirty, restoreDefaults, discard, save } = usePatchSettingsDraft<CustomPatchPolicy>({
  saved: policy,
  loaded,
  defaults: DEFAULT_CUSTOM_PATCH_POLICY,
  save: savePolicy,
})

const controls = ['seriesGridEnabled', 'sidebarCustomizationEnabled', 'seriesRequestsEnabled', 'extendedCoverSearchEnabled'] as const

function handleRetry() {
  return load()
}

function handleSave() {
  if (canManage.value) return save()
}
</script>

<template>
  <p v-if="!canManage" class="settings-error-state" role="alert">{{ t('settings.customPatches.policy.noPermission') }}</p>
  <div v-else-if="!loaded && loadFailed" class="settings-error-state flex flex-wrap items-center justify-between gap-3" role="alert">
    <span>{{ t('settings.customPatches.loadFailed') }}</span>
    <Button type="button" variant="outline" size="sm" @click="handleRetry">{{ t('common.retry') }}</Button>
  </div>
  <p v-else-if="!loaded" class="settings-loading-state" role="status">{{ t('common.loading') }}</p>
  <div v-else class="flex flex-col gap-6">
    <section aria-labelledby="custom-patches-policy-title">
      <h3 id="custom-patches-policy-title" class="settings-group-label">{{ t('settings.customPatches.policy.availability') }}</h3>
      <div class="settings-card">
        <PatchToggle
          v-for="control in controls"
          :key="control"
          v-model="draft[control]"
          :label="t(`settings.customPatches.policy.fields.${control}.label`)"
          :hint="t(`settings.customPatches.policy.fields.${control}.hint`)"
          :disabled="saving"
        />
      </div>
    </section>
    <PatchDraftActions
      :dirty="isDirty"
      :saving="saving"
      :save-failed="saveFailed"
      :saved="savedStatus"
      @save="handleSave"
      @discard="discard"
      @restore="restoreDefaults"
    />
  </div>
</template>
