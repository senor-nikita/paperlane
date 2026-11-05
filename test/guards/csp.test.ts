import { describe, expect, it } from 'vitest'
import { HEADER_ONLY_DIRECTIVES, buildCsp, cspDirectives } from '../../src/main/csp'

/**
 * Invariante 7, CSP-Teil. Geprueft wird ausschliesslich das Production-Profil.
 * Das Development-Profil darf gelockert sein — aber nur dort, und nur in den
 * beiden hier festgeschriebenen Direktiven.
 */
const REQUIRED = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'worker-src',
  'object-src',
  'frame-src',
  'base-uri',
  'form-action',
  'frame-ancestors'
] as const

describe('CSP, Profil production', () => {
  const directives = cspDirectives('production')
  const policy = buildCsp('production')

  it.each(REQUIRED)('enthaelt %s', (name) => {
    expect(directives[name]).toBeDefined()
  })

  it('hat genau die zwoelf vorgesehenen Direktiven', () => {
    expect(Object.keys(directives).sort()).toEqual([...REQUIRED].sort())
  })

  it('verbietet jede Netzwerkverbindung', () => {
    expect(directives['connect-src']).toBe("'none'")
  })

  it('erlaubt kein unsafe-eval', () => {
    expect(policy).not.toContain('unsafe-eval')
  })

  it('erlaubt keine Inline-Skripte', () => {
    expect(directives['script-src']).toBe("'self'")
  })

  it('erlaubt Worker aus eigener Herkunft und blob (pdf.js ab S1.1)', () => {
    expect(directives['worker-src']).toBe("'self' blob:")
  })

  it('erlaubt Schriften als data-URI (pdf.js-Fallbackpfad)', () => {
    expect(directives['font-src']).toBe("'self' data:")
  })

  it('serialisiert mit Semikolon getrennt', () => {
    expect(policy.split('; ')).toHaveLength(REQUIRED.length)
  })
})

describe('CSP, Profil development', () => {
  const production = cspDirectives('production')
  const development = cspDirectives('development')

  it('lockert genau connect-src und script-src, sonst nichts', () => {
    const abweichend = Object.keys(production).filter((key) => production[key] !== development[key])
    expect(abweichend.sort()).toEqual(['connect-src', 'script-src'])
  })

  it('erlaubt den HMR-WebSocket', () => {
    expect(development['connect-src']).toContain('ws:')
  })
})

describe('CSP-Auslieferung per <meta>', () => {
  it('laesst header-only Direktiven weg', () => {
    // frame-ancestors wird in einem <meta> ignoriert und erzeugt dort nur eine
    // Konsolenmeldung. Der Header traegt sie weiterhin.
    expect(cspDirectives('production', 'meta')['frame-ancestors']).toBeUndefined()
  })

  it('unterscheidet sich vom Header ausschliesslich in den header-only Direktiven', () => {
    const header = Object.keys(cspDirectives('production', 'header'))
    const meta = Object.keys(cspDirectives('production', 'meta'))
    expect(header.filter((name) => !meta.includes(name))).toEqual([...HEADER_ONLY_DIRECTIVES])
  })

  it('behaelt frame-ancestors im Header', () => {
    expect(cspDirectives('production', 'header')['frame-ancestors']).toBe("'none'")
  })
})
