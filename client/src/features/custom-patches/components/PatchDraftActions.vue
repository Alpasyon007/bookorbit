<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'

defineProps<{ dirty: boolean; saving: boolean; saveFailed: boolean; saved: boolean }>()
const emit = defineEmits<{ save: []; discard: []; restore: [] }>()
const { t } = useI18n()

function handleSave() {
  emit('save')
}
function handleDiscard() {
  emit('discard')
}
function handleRestore() {
  emit('restore')
}
</script>

<template>
  <div>
    <p v-if="saveFailed" class="settings-error-state mb-3" role="alert">{{ t('settings.customPatches.saveFailed') }}</p>
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <p class="text-sm text-muted-foreground" role="status">
        {{
          saving ? t('settings.customPatches.saving') : dirty ? t('settings.customPatches.unsaved') : saved ? t('settings.customPatches.saved') : ''
        }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="handleRestore">{{ t('settings.customPatches.restore') }}</Button>
        <Button type="button" variant="ghost" size="sm" :disabled="saving || !dirty" @click="handleDiscard">{{
          t('settings.customPatches.discard')
        }}</Button>
        <Button type="button" size="sm" :disabled="saving || !dirty" @click="handleSave">{{ t('common.save') }}</Button>
      </div>
    </div>
  </div>
</template>
