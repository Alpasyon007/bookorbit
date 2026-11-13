import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ViewHeaderMobileMenu from './ViewHeaderMobileMenu.vue'

const passthrough = { template: '<div><slot /></div>' }

describe('ViewHeaderMobileMenu', () => {
  it('offers Series Grid when supported and emits the selected mode', () => {
    const wrapper = mount(ViewHeaderMobileMenu, {
      props: { viewMode: 'grid', allowedViewModes: ['grid', 'list', 'table', 'series-grid'] },
      global: {
        stubs: {
          DropdownMenu: passthrough,
          DropdownMenuContent: passthrough,
          DropdownMenuTrigger: passthrough,
          DropdownMenuRadioGroup: { name: 'DropdownMenuRadioGroup', ...passthrough, emits: ['update:modelValue'] },
          DropdownMenuRadioItem: { props: ['value'], template: '<button :value="value"><slot /></button>' },
          DropdownMenuItem: true,
          DropdownMenuSeparator: true,
        },
      },
    })

    expect(wrapper.get('button[value="series-grid"]').text()).toBe('Series Grid')
    expect(wrapper.find('button[value="table"]').exists()).toBe(false)

    wrapper.getComponent({ name: 'DropdownMenuRadioGroup' }).vm.$emit('update:modelValue', 'series-grid')
    expect(wrapper.emitted('update:viewMode')).toEqual([['series-grid']])
  })
})
