import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from '../../src/main/navigation'

describe('isAllowedNavigation', () => {
  it('erlaubt dieselbe Origin (Full Reload des Dev-Servers)', () => {
    expect(isAllowedNavigation('http://localhost:5173/', 'http://localhost:5173/index.html')).toBe(
      true
    )
  })

  it('erlaubt dieselbe Origin unter app://', () => {
    expect(isAllowedNavigation('app://bundle/index.html', 'app://bundle/')).toBe(true)
  })

  it.each([
    ['https://example.com/', 'app://bundle/index.html'],
    ['file:///C:/Windows/System32/config', 'app://bundle/index.html'],
    ['app://bundle/x', 'file:///C:/y'],
    ['app://andere/index.html', 'app://bundle/index.html'],
    ['http://localhost:9999/', 'http://localhost:5173/']
  ])('blockiert %s', (target, current) => {
    expect(isAllowedNavigation(target, current)).toBe(false)
  })

  it('blockiert unparsbare Ziele, statt zu werfen', () => {
    expect(isAllowedNavigation('nicht-einmal-eine-url', 'app://bundle/')).toBe(false)
  })
})
