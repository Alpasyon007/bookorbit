import { describe, expect, it } from 'vitest'

import { buildSidebarVersionUi } from '../versionUi'

describe('buildSidebarVersionUi fork versions', () => {
  it('shows the upstream update while preserving the custom label', () => {
    expect(buildSidebarVersionUi('v3.8.0-custom.1', true, 'v3.8.1')).toEqual({
      currentLabel: 'v3.8.0-custom.1',
      currentHref: null,
      showUpdate: true,
      updateVersionLabel: 'v3.8.1',
      updateHref: 'https://github.com/bookorbit/bookorbit/releases/tag/v3.8.1',
    })
  })

  it.each([false, null])('does not invent an update when the backend reports %s', (updateAvailable) => {
    const ui = buildSidebarVersionUi('v3.8.0-custom.2', updateAvailable, 'v3.8.0')
    expect(ui.showUpdate).toBe(false)
    expect(ui.currentLabel).toBe('v3.8.0-custom.2')
    expect(ui.currentHref).toBeNull()
  })

  it.each([null, '', '   '])('requires a nonempty upstream release label: %j', (latestVersion) => {
    expect(buildSidebarVersionUi('v3.8.0-custom.1', true, latestVersion).showUpdate).toBe(false)
  })

  it.each(['v3.8.0-custom.0', 'v3.8.0-custom.01', 'v03.8.0-custom.1', 'v3.8.0-custom.1junk', 'v3.8.0-beta.1'])(
    'does not treat unsupported label %s as a custom release',
    (version) => {
      const ui = buildSidebarVersionUi(version, true, 'v3.8.1')
      expect(ui.showUpdate).toBe(false)
      expect(ui.currentHref).toBeNull()
    },
  )
})
