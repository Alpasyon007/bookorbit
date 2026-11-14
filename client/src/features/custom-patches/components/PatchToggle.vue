<script setup lang="ts">
import { useId } from 'vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

defineProps<{ label: string; hint?: string; disabled?: boolean }>()
const value = defineModel<boolean>({ required: true })
const id = useId()
</script>

<template>
  <div class="settings-row flex-row items-center justify-between">
    <div class="min-w-0">
      <label :for="id" class="settings-label">{{ label }}</label>
      <p v-if="hint" :id="`${id}-hint`" class="settings-hint">{{ hint }}</p>
    </div>
    <ToggleSwitch :id="id" v-model="value" :disabled="disabled" :aria-describedby="hint ? `${id}-hint` : undefined" />
  </div>
</template>
