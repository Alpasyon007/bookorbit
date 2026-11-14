import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { ref } from 'vue'
import { DEFAULT_CUSTOM_PATCH_POLICY, DEFAULT_CUSTOM_PATCH_PREFERENCES } from '@bookorbit/types'
import SidebarFooterBar from '../SidebarFooterBar.vue'

const version = ref('v3.8.0-custom.2')
const updateAvailable = ref(false)
const latestVersion = ref('v3.8.1')
const hasUnseen = ref(false)
const preferences = ref(structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES))
const policy = ref({ ...DEFAULT_CUSTOM_PATCH_POLICY })
const loaded = ref(true)

vi.mock('@/features/custom-patches/composables/useCustomPatchSettings', () => ({
  useCustomPatchSettings: () => ({ preferences, policy, loaded }),
}))

vi.mock('@/features/settings/composables/useAppInfo', () => ({
  useAppInfo: () => ({ version, updateAvailable, latestVersion }),
}))

vi.mock('@/features/whats-new/composables/useWhatsNew', () => ({
  useWhatsNew: () => ({ hasUnseen }),
}))

function mountFooter() {
  return mount(SidebarFooterBar, {
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: true,
      },
    },
  })
}

describe('SidebarFooterBar', () => {
  beforeEach(() => {
    version.value = 'v3.8.0-custom.2'
    updateAvailable.value = false
    hasUnseen.value = false
    preferences.value = structuredClone(DEFAULT_CUSTOM_PATCH_PREFERENCES)
    policy.value = { ...DEFAULT_CUSTOM_PATCH_POLICY }
    loaded.value = true
  })

  it('links the installed version to release notes and renders no promotional controls', async () => {
    const wrapper = mountFooter()
    const link = wrapper.getComponent(RouterLinkStub)

    expect(link.props('to')).toBe('/whats-new')
    expect(link.text()).toBe('v3.8.0-custom.2')
    expect(wrapper.findAll('a, button')).toHaveLength(1)

    await link.trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([[]])
  })

  it('keeps the unread release marker and the upstream update link', () => {
    hasUnseen.value = true
    updateAvailable.value = true
    const wrapper = mountFooter()

    expect(wrapper.getComponent(RouterLinkStub).find('[aria-label]').exists()).toBe(true)
    expect(wrapper.get('a[target="_blank"]').attributes('href')).toBe('https://github.com/bookorbit/bookorbit/releases/tag/v3.8.1')
    expect(wrapper.findAll('a, button')).toHaveLength(2)
  })

  it('has no footer before the installed version is known', () => {
    version.value = ''
    const wrapper = mountFooter()

    expect(wrapper.find('[data-sidebar="footer"]').exists()).toBe(false)
  })

  it('shows selected links independently while preserving the version', () => {
    preferences.value.sidebar.showSupport = true
    preferences.value.sidebar.showIos = true
    const wrapper = mountFooter()
    expect(wrapper.find('a[href="https://ko-fi.com/neonbookorbit"]').exists()).toBe(true)
    expect(wrapper.find('a[href^="https://apps.apple.com/"]').exists()).toBe(true)
    expect(wrapper.find('[aria-disabled="true"]').exists()).toBe(false)
    expect(wrapper.getComponent(RouterLinkStub).text()).toBe('v3.8.0-custom.2')
  })

  it('restores original links when either customization switch is off, without flashing them during loading', async () => {
    preferences.value.sidebar.enabled = false
    loaded.value = false
    const wrapper = mountFooter()
    expect(wrapper.findAll('a, button')).toHaveLength(1)

    loaded.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-tour="github-star-cta"]').exists()).toBe(true)
    expect(wrapper.find('a[href="https://ko-fi.com/neonbookorbit"]').exists()).toBe(true)
    expect(wrapper.find('a[href^="https://apps.apple.com/"]').exists()).toBe(true)
    expect(wrapper.find('[aria-disabled="true"]').exists()).toBe(true)

    preferences.value.sidebar.enabled = true
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('a, button')).toHaveLength(1)
    policy.value.sidebarCustomizationEnabled = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-tour="github-star-cta"]').exists()).toBe(true)
    expect(wrapper.find('a[href="https://ko-fi.com/neonbookorbit"]').exists()).toBe(true)
    expect(wrapper.find('a[href^="https://apps.apple.com/"]').exists()).toBe(true)
    expect(wrapper.find('[aria-disabled="true"]').exists()).toBe(true)
    expect(wrapper.getComponent(RouterLinkStub).text()).toBe('v3.8.0-custom.2')
  })
})
