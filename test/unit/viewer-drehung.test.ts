import { describe, expect, it } from 'vitest'
import { effektiveDrehung } from '../../src/renderer/src/viewer/drehung'

/**
 * Befund vor S4.2b: `getViewport({ rotation })` ersetzt `/Rotate`. Die Summe
 * aus Seiten- und Ansichtsdrehung ist deshalb das, was an pdf.js geht.
 */
describe('effektiveDrehung', () => {
  it('addiert Seiten- und Ansichtsdrehung', () => {
    expect(effektiveDrehung(0, 0)).toBe(0)
    expect(effektiveDrehung(90, 0)).toBe(90)
    expect(effektiveDrehung(0, 90)).toBe(90)
    expect(effektiveDrehung(90, 90)).toBe(180)
    expect(effektiveDrehung(270, 180)).toBe(90)
  })

  it('normiert auf 0..270', () => {
    expect(effektiveDrehung(270, 90)).toBe(0)
    expect(effektiveDrehung(0, -90)).toBe(270)
    expect(effektiveDrehung(-90, -90)).toBe(180)
    expect(effektiveDrehung(360, 0)).toBe(0)
  })

  it('rundet auf Vielfache von 90 und zaehlt eine fehlende Seitendrehung als 0', () => {
    expect(effektiveDrehung(89, 0)).toBe(90)
    expect(effektiveDrehung(Number.NaN, 90)).toBe(90)
    expect(effektiveDrehung(undefined as unknown as number, 0)).toBe(0)
  })
})
