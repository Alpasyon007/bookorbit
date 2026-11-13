import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { ref } from 'vue'
import SidebarFooterBar from '../SidebarFooterBar.vue'

const version = ref('v3.8.0-custom.2')
const updateAvailable = ref(false)
const latestVersion = ref('v3.8.1')
const hasUnseen = ref(false)

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
})
