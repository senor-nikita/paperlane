import { describe, expect, it } from 'vitest'
import {
  SEITENABSTAND,
  berechneLayout,
  bestimmeZoomAnker,
  scrollNachZoom,
  type SeitenGroesse
} from '../../src/renderer/src/viewer/layout'
import { RAD_EMPFINDLICHKEIT, radFaktor } from '../../src/renderer/src/viewer/zoom'

/**
 * Strg + Mausrad zoomt stufenlos, und die Stelle unter dem Zeiger bleibt dort.
 * Die Rechnung steht in zwei reinen Funktionen; das Verdrahten im Fenster
 * prueft der E2E-Test.
 */
const A4: SeitenGroesse = { breite: 595, hoehe: 842 }
const seiten = (anzahl: number): SeitenGroesse[] => Array.from({ length: anzahl }, () => A4)
const RAND = 24

describe('radFaktor', () => {
  it('laesst den Zoom bei null unveraendert', () => {
    expect(radFaktor(0, 0)).toBe(1)
  })

  it('vergroessert beim Drehen nach oben, verkleinert nach unten', () => {
    expect(radFaktor(-100, 0)).toBeGreaterThan(1)
    expect(radFaktor(100, 0)).toBeLessThan(1)
  })

  it('ist multiplikativ: hin und zurueck ergibt wieder den Ausgangszoom', () => {
    expect(radFaktor(-100, 0) * radFaktor(100, 0)).toBeCloseTo(1, 10)
    // Zwei Raster auf einmal wirken wie zwei einzelne.
    expect(radFaktor(-200, 0)).toBeCloseTo(radFaktor(-100, 0) ** 2, 10)
  })

  it('macht aus einem Mausradraster rund 16 Prozent', () => {
    expect(radFaktor(-100, 0)).toBeCloseTo(Math.exp(100 * RAD_EMPFINDLICHKEIT), 10)
    expect(radFaktor(-100, 0)).toBeGreaterThan(1.1)
    expect(radFaktor(-100, 0)).toBeLessThan(1.25)
  })

  it('rechnet Zeilen- und Seitenschritte in Pixel um', () => {
    expect(radFaktor(-3, 1)).toBeCloseTo(radFaktor(-48, 0), 10)
    expect(radFaktor(-1, 2)).toBeCloseTo(radFaktor(-400, 0), 10)
  })

  it('zoomt feiner als eine Stufenleiter: kleine Schritte ergeben kleine Faktoren', () => {
    const faktor = radFaktor(-10, 0)
    expect(faktor).toBeGreaterThan(1)
    expect(faktor).toBeLessThan(1.02)
  })
})

describe('Zoomanker: die Stelle unter dem Zeiger bleibt', () => {
  /** Wo im Inhalt (Bildschirm y der Flaeche) steht die Seitenstelle des Ankers? */
  function zeigerInhaltY(
    layout: ReturnType<typeof berechneLayout>,
    index: number,
    anteilY: number
  ): number {
    const platz = layout.plaetze[index]
    if (platz === undefined) throw new Error('Platz fehlt')
    return RAND + platz.oben + anteilY * platz.hoehe
  }

  it.each([
    [0, 300, 1, 2],
    [4000, 200, 1, 1.4],
    [4000, 200, 2, 0.5],
    [40000, 600, 0.7, 3.1]
  ])(
    'haelt bei Scroll %i und Zeiger y %i (Zoom %f -> Faktor %f) die Seitenstelle fest',
    (scroll, zeigerY, zoomAlt, faktor) => {
      const alt = berechneLayout(seiten(100), zoomAlt, 0)
      const breite = 1000
      const anker = bestimmeZoomAnker(alt, scroll, 0, 400, zeigerY, breite, RAND)
      if (anker === null) throw new Error('Anker fehlt')

      const neu = berechneLayout(seiten(100), zoomAlt * faktor, 0)
      const ziel = scrollNachZoom(neu, anker, faktor, 400, zeigerY, breite, RAND)

      // Dieselbe Stelle der Seite liegt wieder auf Hoehe des Zeigers.
      const inhalt = zeigerInhaltY(neu, anker.index, anker.anteilY)
      expect(inhalt - ziel.oben).toBeCloseTo(zeigerY, 6)
    }
  )

  it('findet die Seite unter dem Zeiger, auch mitten im Seitenabstand', () => {
    const layout = berechneLayout(seiten(10), 1, 0)
    // Mitten im Abstand zwischen Seite 1 und 2.
    const imAbstand = (layout.plaetze[0]?.hoehe ?? 0) + SEITENABSTAND / 2
    const anker = bestimmeZoomAnker(layout, 0, 0, 0, RAND + imAbstand, 800, RAND)
    expect(anker?.index).toBe(1)
    expect(anker?.anteilY).toBeLessThan(0)
  })

  it('haelt waagerecht den Abstand von der Mitte, skaliert mit dem Faktor', () => {
    const layout = berechneLayout(seiten(3), 1, 0)
    // Flaeche 2000 breit, gescrollt um 300, Zeiger bei x 500: 300 + 500 - 1000 = -200 von der Mitte.
    const anker = bestimmeZoomAnker(layout, 0, 300, 500, 100, 2000, RAND)
    expect(anker?.abstandX).toBe(-200)
    if (anker === null) return
    const neu = berechneLayout(seiten(3), 2, 0)
    const ziel = scrollNachZoom(neu, anker, 2, 500, 100, 4000, RAND)
    // Neue Flaeche 4000: Mitte 2000, Stelle bei -400 von der Mitte, Zeiger bei 500.
    expect(ziel.links).toBe(2000 - 400 - 500)
  })

  it('scrollt nie ins Negative', () => {
    const layout = berechneLayout(seiten(3), 1, 0)
    const anker = bestimmeZoomAnker(layout, 0, 0, 10, 10, 600, RAND)
    if (anker === null) throw new Error('Anker fehlt')
    const ziel = scrollNachZoom(berechneLayout(seiten(3), 0.5, 0), anker, 0.5, 10, 10, 600, RAND)
    expect(ziel.oben).toBeGreaterThanOrEqual(0)
    expect(ziel.links).toBeGreaterThanOrEqual(0)
  })

  it('liefert ohne Seiten keinen Anker und eine Null-Position bei unbekannter Seite', () => {
    expect(bestimmeZoomAnker(berechneLayout([], 1, 0), 0, 0, 0, 0, 800, RAND)).toBeNull()
    const layout = berechneLayout(seiten(2), 1, 0)
    const ziel = scrollNachZoom(
      layout,
      { index: 99, anteilY: 0.5, abstandX: 0 },
      1,
      0,
      0,
      800,
      RAND
    )
    expect(ziel.oben).toBe(0)
  })
})
