import { describe, expect, it } from 'vitest'

import { isNewerCustomRelease } from './custom-release-version'
import { isNewer } from './whats-new.logic'

describe('custom release history ordering', () => {
  it.each([
    ['v3.8.0-custom.1', 'v3.8.0', true],
    ['v3.8.0-custom.2', 'v3.8.0-custom.1', true],
    ['v3.8.0-custom.10', 'v3.8.0-custom.2', true],
    ['v3.8.0-custom.2', 'v3.8.0-custom.2', false],
    ['v3.8.0-custom.1', 'v3.8.0-custom.2', false],
    ['v3.8.0', 'v3.8.0-custom.1', false],
    ['v3.8.1', 'v3.8.0-custom.99', true],
    ['v3.9.0-custom.1', 'v3.8.0-custom.99', true],
    ['v4.0.0-custom.1', 'v3.9.9-custom.99', true],
    ['v3.8.0-custom.99', 'v3.8.1', false],
    ['v3.8.0-custom.2', 'v3.8.0.1', true],
    ['v3.8.0-custom.1', 'v3.8.0.1', false],
    ['v3.8.0.2', 'v3.8.0-custom.1', true],
  ])('compares %s against %s', (candidate, baseline, expected) => {
    expect(isNewer(candidate, baseline)).toBe(expected)
  })

  it.each([
    'v3.9.0-custom.0',
    'v3.9.0-custom.01',
    'v03.9.0-custom.1',
    'v3.9.0-custom.9007199254740992',
    'v9007199254740992.9.0-custom.1',
    'v3.9.0-custom.1junk',
    'v3.9.0-custom.1.extra',
    'v3.9.0-custom.1+metadata',
    'v3.9.0-custom',
    'v3.9.0.01',
  ])('rejects malformed custom label %s in either position', (version) => {
    expect(isNewer(version, 'v3.8.0')).toBe(false)
    expect(isNewer('v4.0.0-custom.1', version)).toBe(false)
  })

  it('leaves upstream-only comparison behavior to the existing helper', () => {
    expect(isNewerCustomRelease('v3.9.0', 'v3.8.0')).toBeNull()
    expect(isNewer('v3.9.0-rc.1', 'v3.8.0')).toBe(true)
    expect(isNewer('v3.8.0-rc.1', 'v3.8.0')).toBe(false)
    expect(isNewer('Local build', 'v3.8.0')).toBe(false)
  })
})
