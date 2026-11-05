import { describe, expect, it } from 'vitest'
import {
  SEITENABSTAND,
  bestimmeAnker,
  berechneLayout,
  gedrehteGroesse,
  scrollFuerAnker,
  sichtbareSeiten,
  type SeitenGroesse
} from '../../src/renderer/src/viewer/layout'

const A4: SeitenGroesse = { breite: 595, hoehe: 842 }
const seiten = (anzahl: number): SeitenGroesse[] => Array.from({ length: anzahl }, () => A4)

describe('gedrehteGroesse', () => {
  it.each([
    [0, 595, 842],
    [90, 842, 595],
    [180, 595, 842],
    [270, 842, 595],
    [360, 595, 842],
    [-90, 842, 595]
  ])('bei %i Grad: %i x %i', (rotation, breite, hoehe) => {
    expect(gedrehteGroesse(A4, rotation)).toEqual({ breite, hoehe })
  })
})

describe('berechneLayout', () => {
  it('stapelt Seiten mit Abstand', () => {
    const layout = berechneLayout(seiten(3), 1, 0)
    expect(layout.plaetze.map((p) => p.oben)).toEqual([
      0,
      842 + SEITENABSTAND,
      2 * (842 + SEITENABSTAND)
    ])
  })

  it('zaehlt den letzten Abstand nicht zur Gesamthoehe', () => {
    expect(berechneLayout(seiten(3), 1, 0).gesamthoehe).toBe(3 * 842 + 2 * SEITENABSTAND)
  })

  it('skaliert mit dem Zoom', () => {
    const layout = berechneLayout(seiten(2), 2, 0)
    expect(layout.plaetze[0]?.hoehe).toBe(1684)
    expect(layout.maxBreite).toBe(1190)
  })

  it('beruecksichtigt die Drehung', () => {
    const layout = berechneLayout(seiten(1), 1, 90)
    expect(layout.plaetze[0]).toMatchObject({ breite: 842, hoehe: 595 })
  })

  it('kommt mit einem leeren Dokument zurecht', () => {
    expect(berechneLayout([], 1, 0)).toEqual({ plaetze: [], gesamthoehe: 0, maxBreite: 0 })
  })
})

describe('sichtbareSeiten', () => {
  const layout = berechneLayout(seiten(100), 1, 0)

  it('findet die Seiten im Sichtfenster', () => {
    // Sichtfenster 0..900 deckt Seite 0 (0..842) und Seite 1 (858..1700) an.
    expect(sichtbareSeiten(layout, 0, 900, 0)).toEqual({ von: 0, bis: 1 })
  })

  it('erweitert um den Puffer', () => {
    expect(sichtbareSeiten(layout, 0, 900, 2)).toEqual({ von: 0, bis: 3 })
  })

  it('bleibt innerhalb des Dokuments', () => {
    const ergebnis = sichtbareSeiten(layout, 0, 100, 5)
    expect(ergebnis.von).toBe(0)
    expect(ergebnis.bis).toBeLessThan(100)
  })

  // Das ist der Punkt der Virtualisierung: bei 100 Seiten duerfen nur wenige
  // gleichzeitig sichtbar sein, sonst waechst der Speicher mit der Seitenzahl.
  it('liefert bei einem grossen Dokument nur eine Handvoll Seiten', () => {
    const { von, bis } = sichtbareSeiten(layout, 5000, 800, 2)
    expect(bis - von).toBeLessThanOrEqual(6)
  })

  it('liefert nichts bei leerem Dokument', () => {
    expect(sichtbareSeiten(berechneLayout([], 1, 0), 0, 800, 2)).toEqual({ von: -1, bis: -1 })
  })

  it('faellt auf die naechstgelegene Seite zurueck, wenn nur Abstand sichtbar ist', () => {
    const schmal = berechneLayout(seiten(2), 1, 0)
    // Genau im Abstand zwischen Seite 0 und 1.
    const ergebnis = sichtbareSeiten(schmal, 845, 5, 0)
    expect(ergebnis.von).toBeGreaterThanOrEqual(0)
  })
})

describe('Anker', () => {
  // Ohne Anker springt die Leseposition bei jedem Zoomwechsel.
  it('haelt die Position ueber einen Zoomwechsel', () => {
    const vorher = berechneLayout(seiten(50), 1, 0)
    const anker = bestimmeAnker(vorher, 4000)
    expect(anker).not.toBeNull()

    const nachher = berechneLayout(seiten(50), 2, 0)
    const neuerScroll = scrollFuerAnker(nachher, anker!)
    const ankerNachher = bestimmeAnker(nachher, neuerScroll)
    expect(ankerNachher?.index).toBe(anker?.index)
    expect(ankerNachher?.anteil).toBeCloseTo(anker?.anteil ?? 0, 5)
  })

  it('liefert null bei leerem Dokument', () => {
    expect(bestimmeAnker(berechneLayout([], 1, 0), 0)).toBeNull()
  })

  it('liefert 0 fuer einen unbekannten Index', () => {
    expect(scrollFuerAnker(berechneLayout(seiten(2), 1, 0), { index: 99, anteil: 0 })).toBe(0)
  })
})
