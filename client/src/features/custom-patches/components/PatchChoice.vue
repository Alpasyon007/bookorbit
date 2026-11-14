<script setup lang="ts" generic="Value extends string | number">
import { useId } from 'vue'

defineProps<{ label: string; hint?: string; options: { value: Value; label: string }[]; disabled?: boolean }>()
const value = defineModel<Value>({ required: true })
const id = useId()
</script>

<template>
  <div class="settings-row flex-wrap">
    <div class="min-w-0">
      <label :for="id" class="settings-label">{{ label }}</label>
      <p v-if="hint" :id="`${id}-hint`" class="settings-hint">{{ hint }}</p>
    </div>
    <select
      :id="id"
      v-model="value"
      class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:w-auto sm:max-w-full"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      :disabled="disabled"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </div>
</template>
