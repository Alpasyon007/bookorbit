import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES, Permission, type CustomPatchPreferences } from '@bookorbit/types'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomPatchPreferencesPage from './CustomPatchPreferences.vue'

const preferences = ref(structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES))
const policy = ref({ ...DEFAULT_CUSTOM_PATCH_POLICY })
const loaded = ref(true)
const loadFailed = ref(false)
const load = vi.fn<() => Promise<boolean>>()
const savePreferences = vi.fn<(settings: CustomPatchPreferences) => Promise<boolean>>()
const permissions = new Set<string>()

vi.mock('./composables/useCustomPatchSettings', () => ({
  useCustomPatchSettings: () => ({ preferences, policy, loaded, loadFailed, load, savePreferences }),
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => permissions.has(key) }) }))
vi.mock('@/features/book-requests/composables/useBookRequestVisibility', () => ({
  useBookRequestVisibility: () => ({ showBookRequests: ref(true) }),
}))

function mountPage() {
  return mount(CustomPatchPreferencesPage, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

function button(wrapper: ReturnType<typeof mountPage>, label: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === label)
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}

describe('Custom Patch Preferences', () => {
  beforeEach(() => {
    preferences.value = structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES)
    policy.value = { ...DEFAULT_CUSTOM_PATCH_POLICY }
    loaded.value = true
    loadFailed.value = false
    permissions.clear()
    load.mockReset()
    savePreferences.mockReset()
    savePreferences.mockImplementation(async (value) => {
      preferences.value = value
      return true
    })
  })

  it('loads existing values; only saved trimmed changes become active and restore is a draft', async () => {
    preferences.value.seriesGrid.hierarchyOrder = 'reverse'
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Trilogy → Saga → Universe')
    expect(wrapper.text()).not.toContain('Default series request format')
    expect(wrapper.text()).not.toContain('Change default cover search source')
    await wrapper.get('#custom-patches-standalone').setValue('  Single titles  ')
    expect(preferences.value.seriesGrid.standaloneLabel).toBe('')

    await button(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(savePreferences.mock.calls[0]?.[0]?.seriesGrid.standaloneLabel).toBe('Single titles')
    expect(wrapper.get<HTMLInputElement>('#custom-patches-standalone').element.value).toBe('Single titles')
    expect(wrapper.text()).toContain('Changes saved')

    await button(wrapper, 'Restore defaults').trigger('click')
    expect(wrapper.text()).toContain('Universe → Saga → Trilogy')
    expect(preferences.value.seriesGrid.hierarchyOrder).toBe('reverse')
    expect(savePreferences).toHaveBeenCalledTimes(1)
    await button(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(preferences.value).toEqual(DEFAULT_CUSTOM_PATCH_PREFERENCES)
  })

  it('keeps edits after a failed save and keeps disallowed settings disabled', async () => {
    permissions.add(Permission.BookRequestAccess)
    policy.value.seriesRequestsEnabled = false
    savePreferences.mockResolvedValue(false)
    const wrapper = mountPage()
    const requestSettings = wrapper.get('section[aria-labelledby="custom-patches-requests-title"]')
    expect(requestSettings.text()).toContain('This feature is unavailable on this server')
    expect(requestSettings.findAll('button[role="switch"], select').every((control) => control.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.get('#custom-patches-standalone').setValue('Single titles')
    await button(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Your edits are still here')
    expect(wrapper.get<HTMLInputElement>('#custom-patches-standalone').element.value).toBe('Single titles')
  })

  it('shows loading and retries when the account settings cannot be loaded', async () => {
    loaded.value = false
    load.mockResolvedValue(true)
    const wrapper = mountPage()
    expect(wrapper.get('[role="status"]').text()).toContain('Loading')
    loadFailed.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    await button(wrapper, 'Retry').trigger('click')
    expect(load).toHaveBeenCalledOnce()
  })
})
