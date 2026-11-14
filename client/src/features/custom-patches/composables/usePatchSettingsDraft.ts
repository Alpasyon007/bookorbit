import { computed, ref, toRaw, watch, type DeepReadonly, type Ref } from 'vue'

export function usePatchSettingsDraft<T extends object>(options: {
  saved: Readonly<Ref<DeepReadonly<T>>>
  loaded: Readonly<Ref<boolean>>
  defaults: T
  save: (settings: T) => Promise<boolean>
  normalize?: (settings: T) => T
}) {
  function copy(value: T | DeepReadonly<T>): T {
    return structuredClone(toRaw(value)) as T
  }

  const draft = ref<T>(copy(options.saved.value)) as Ref<T>
  const saving = ref(false)
  const saveFailed = ref(false)
  const savedStatus = ref(false)
  const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(options.saved.value))
  let revision = 0

  watch([options.saved, options.loaded], ([saved, loaded], [previous, wasLoaded]) => {
    if (loaded && wasLoaded && (JSON.stringify(saved) === JSON.stringify(previous) || JSON.stringify(draft.value) !== JSON.stringify(previous)))
      return
    draft.value = copy(saved)
    saveFailed.value = false
  })

  watch(
    options.loaded,
    (loaded) => {
      if (loaded) return
      revision++
      saving.value = false
      savedStatus.value = false
    },
    { flush: 'sync' },
  )

  function restoreDefaults() {
    draft.value = copy(options.defaults)
    saveFailed.value = false
    savedStatus.value = false
  }

  function discard() {
    draft.value = copy(options.saved.value)
    saveFailed.value = false
    savedStatus.value = false
  }

  async function save() {
    if (saving.value || !isDirty.value || !options.loaded.value) return
    const currentRevision = revision
    const snapshot = copy(draft.value)
    saving.value = true
    saveFailed.value = false
    savedStatus.value = false
    const ok = await options.save(options.normalize?.(snapshot) ?? snapshot)
    if (currentRevision !== revision) return
    if (ok) draft.value = copy(options.saved.value)
    saving.value = false
    saveFailed.value = !ok
    savedStatus.value = ok
  }

  return { draft, saving, saveFailed, savedStatus, isDirty, restoreDefaults, discard, save }
}
