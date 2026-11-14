import { effectScope, readonly, shallowRef, watch } from 'vue'
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES, type CustomPatchPolicy, type CustomPatchPreferences } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

const PREFERENCES_ENDPOINT = '/api/v1/custom-patches/preferences'
const POLICY_ENDPOINT = '/api/v1/custom-patches/policy'
const SETTINGS_TIMEOUT_MS = 15_000

const preferences = shallowRef(DEFAULT_CUSTOM_PATCH_PREFERENCES)
const policy = shallowRef(DEFAULT_CUSTOM_PATCH_POLICY)
const loaded = shallowRef(false)
const loading = shallowRef(false)
const loadFailed = shallowRef(false)

let generation = 0
let accountId: number | undefined
let request: Promise<boolean> | undefined
let watching = false
let controller = new AbortController()
const writes = new Set<string>()

async function withSettingsDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const account = controller.signal
  const deadline = new AbortController()
  const signal = AbortSignal.any([account, deadline.signal])
  let rejectOnAbort!: () => void
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(new Error('Custom patch settings request interrupted', { cause: signal.reason }))
    signal.addEventListener('abort', rejectOnAbort, { once: true })
  })
  const timeout = setTimeout(() => deadline.abort(), SETTINGS_TIMEOUT_MS)
  try {
    return await Promise.race([operation(signal), interrupted])
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', rejectOnAbort)
    deadline.abort()
  }
}

async function readSettings<T>(endpoint: string, signal: AbortSignal): Promise<T> {
  const response = await api(endpoint, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return ((await response.json()) as { settings: T }).settings
}

function load({ refresh = false } = {}): Promise<boolean> {
  if (accountId === undefined) return Promise.resolve(false)
  if (request) return request
  if (loaded.value && !refresh) return Promise.resolve(true)

  const scope = generation
  const currentPreferences = preferences.value
  const currentPolicy = policy.value
  loading.value = true
  request = withSettingsDeadline((signal) =>
    Promise.all([readSettings<CustomPatchPreferences>(PREFERENCES_ENDPOINT, signal), readSettings<CustomPatchPolicy>(POLICY_ENDPOINT, signal)]),
  )
    .then(([nextPreferences, nextPolicy]) => {
      if (scope !== generation) return false
      if (preferences.value === currentPreferences) preferences.value = nextPreferences
      if (policy.value === currentPolicy) policy.value = nextPolicy
      loaded.value = true
      loadFailed.value = false
      return true
    })
    .catch(() => {
      if (scope === generation && !loaded.value) loadFailed.value = true
      return false
    })
    .finally(() => {
      if (scope === generation) {
        loading.value = false
        request = undefined
      }
    })
  return request
}

function observeAccount() {
  if (watching) return
  watching = true
  const { user } = useAuth()
  effectScope(true).run(() => {
    watch(
      () => user.value?.id,
      (id) => {
        generation++
        accountId = id
        controller.abort()
        controller = new AbortController()
        writes.clear()
        request = undefined
        preferences.value = DEFAULT_CUSTOM_PATCH_PREFERENCES
        policy.value = DEFAULT_CUSTOM_PATCH_POLICY
        loaded.value = false
        loading.value = false
        loadFailed.value = false
        void load()
      },
      { immediate: true, flush: 'sync' },
    )
  })
}

async function saveSettings<T>(endpoint: string, settings: T, apply: (settings: T) => void): Promise<boolean> {
  if (!loaded.value || accountId === undefined || writes.has(endpoint)) return false
  const scope = generation
  const body = JSON.stringify({ settings })
  writes.add(endpoint)
  try {
    const response = await withSettingsDeadline((signal) =>
      api(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
      }),
    )
    if (!response.ok || scope !== generation) return false
    apply((JSON.parse(body) as { settings: T }).settings)
    return true
  } catch {
    return false
  } finally {
    if (scope === generation) writes.delete(endpoint)
  }
}

function savePreferences(settings: CustomPatchPreferences): Promise<boolean> {
  return saveSettings(PREFERENCES_ENDPOINT, settings, (value) => {
    preferences.value = value
  })
}

function savePolicy(settings: CustomPatchPolicy): Promise<boolean> {
  return saveSettings(POLICY_ENDPOINT, settings, (value) => {
    policy.value = value
  })
}

export function useCustomPatchSettings() {
  observeAccount()
  return {
    preferences: readonly(preferences),
    policy: readonly(policy),
    loaded: readonly(loaded),
    loading: readonly(loading),
    loadFailed: readonly(loadFailed),
    load,
    savePreferences,
    savePolicy,
  }
}
