import { describe, expect, it } from 'vitest'
import type { SeitenGroesse } from '../../src/renderer/src/viewer/layout'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  begrenzeFuerCanvas,
  begrenzeZoom,
  naechsteStufe,
  passendZuBreite,
  passendZuSeite
} from '../../src/renderer/src/viewer/zoom'

const A4: SeitenGroesse = { breite: 595, hoehe: 842 }

describe('begrenzeZoom', () => {
  it.each([
    [0.01, MIN_ZOOM],
    [1, 1],
    [99, MAX_ZOOM]
  ])('%f wird zu %f', (eingabe, erwartet) => {
    expect(begrenzeZoom(eingabe)).toBe(erwartet)
  })
})

describe('naechsteStufe', () => {
  it('geht aufwaerts zur naechstgroesseren Stufe', () => {
    expect(naechsteStufe(1, 1)).toBe(1.25)
  })

  it('geht abwaerts zur naechstkleineren Stufe', () => {
    expect(naechsteStufe(1, -1)).toBe(0.75)
  })

  it('findet auch von einem Zwischenwert aus die Stufe', () => {
    expect(naechsteStufe(1.1, 1)).toBe(1.25)
    expect(naechsteStufe(1.1, -1)).toBe(1)
  })

  it('bleibt an den Enden stehen', () => {
    expect(naechsteStufe(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(naechsteStufe(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})

describe('Passung', () => {
  it('passt zur Breite', () => {
    expect(passendZuBreite(A4, 0, 1190)).toBeCloseTo(2, 5)
  })

  it('beruecksichtigt die Drehung', () => {
    // Gedreht ist die Seite 842 breit.
    expect(passendZuBreite(A4, 90, 842)).toBeCloseTo(1, 5)
  })

  it('passt zur Seite und nimmt die kleinere Richtung', () => {
    expect(passendZuSeite(A4, 0, 1190, 842)).toBeCloseTo(1, 5)
  })

  it.each([[{ breite: 0, hoehe: 842 }], [{ breite: 595, hoehe: 0 }]])(
    'faellt bei entarteter Groesse auf 1 zurueck',
    (groesse) => {
      expect(passendZuSeite(groesse, 0, 100, 100)).toBe(1)
    }
  )
})

describe('begrenzeFuerCanvas', () => {
  // Ueber der Kantenbegrenzung liefert der Browser ein leeres Canvas, ohne
  // Fehlermeldung. Deshalb wird vorher begrenzt.
  it('senkt den Zoom, wenn das Canvas zu gross wuerde', () => {
    const begrenzt = begrenzeFuerCanvas(20, A4, 0, 2, 16384)
    expect(begrenzt * 842 * 2).toBeLessThanOrEqual(16384)
  })

  it('laesst zulaessige Werte unveraendert', () => {
    expect(begrenzeFuerCanvas(2, A4, 0, 2, 16384)).toBe(2)
  })

  it('rechnet den Geraetepixelfaktor mit', () => {
    const beiEins = begrenzeFuerCanvas(20, A4, 0, 1, 16384)
    const beiZwei = begrenzeFuerCanvas(20, A4, 0, 2, 16384)
    expect(beiZwei).toBeLessThan(beiEins)
  })

  it('gibt bei entarteten Eingaben den Zoom unveraendert zurueck', () => {
    expect(begrenzeFuerCanvas(3, { breite: 0, hoehe: 0 }, 0, 2)).toBe(3)
  })
})
