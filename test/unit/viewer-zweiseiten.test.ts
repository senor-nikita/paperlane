import { describe, expect, it } from 'vitest'
import {
  SEITENABSTAND,
  berechneLayout,
  type SeitenGroesse
} from '../../src/renderer/src/viewer/layout'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  parseZoomEingabe,
  passendZuBreite,
  passendZuSeite
} from '../../src/renderer/src/viewer/zoom'

const A4: SeitenGroesse = { breite: 600, hoehe: 800 }
const seiten = (anzahl: number): SeitenGroesse[] => Array.from({ length: anzahl }, () => A4)

describe('parseZoomEingabe', () => {
  it.each([
    ['150', 1.5],
    ['150 %', 1.5],
    ['  150%  ', 1.5],
    ['87,5', 0.875],
    ['87.5 %', 0.875],
    ['100', 1]
  ])('liest "%s" als Faktor %f', (text, faktor) => {
    expect(parseZoomEingabe(text)).toBeCloseTo(faktor, 6)
  })

  it('begrenzt auf den erlaubten Bereich', () => {
    expect(parseZoomEingabe('1')).toBe(MIN_ZOOM)
    expect(parseZoomEingabe('99999')).toBe(MAX_ZOOM)
  })

  it.each([[''], ['abc'], ['-50'], ['0'], ['0 %'], ['1,2,3'], ['50 % mehr'], ['%']])(
    'lehnt "%s" ab',
    (text) => {
      expect(parseZoomEingabe(text)).toBeNull()
    }
  )
})

describe('berechneLayout mit zwei Spalten', () => {
  it('stellt je zwei Seiten nebeneinander', () => {
    const layout = berechneLayout(seiten(4), 1, 0, SEITENABSTAND, 2)
    expect(layout.plaetze.map((p) => p.index)).toEqual([0, 1, 2, 3])
    // Zeile 1: Seiten 1 und 2 auf gleicher Hoehe; Zeile 2 darunter.
    expect(layout.plaetze[0]?.oben).toBe(0)
    expect(layout.plaetze[1]?.oben).toBe(0)
    expect(layout.plaetze[2]?.oben).toBe(800 + SEITENABSTAND)
    expect(layout.plaetze[3]?.oben).toBe(800 + SEITENABSTAND)
  })

  it('setzt die linke Seite links und die rechte rechts der Mitte', () => {
    const layout = berechneLayout(seiten(2), 1, 0, SEITENABSTAND, 2)
    const links = layout.plaetze[0]?.mitte ?? 0
    const rechts = layout.plaetze[1]?.mitte ?? 0
    expect(links).toBeLessThan(0)
    expect(rechts).toBeGreaterThan(0)
    // Symmetrisch um die Mitte, Luecke = Seitenabstand.
    expect(links + rechts).toBeCloseTo(0, 6)
    expect(rechts - links - 600).toBeCloseTo(SEITENABSTAND, 6)
  })

  it('misst die Breite als Zeilenbreite', () => {
    expect(berechneLayout(seiten(2), 1, 0, SEITENABSTAND, 2).maxBreite).toBe(
      2 * 600 + SEITENABSTAND
    )
  })

  it('setzt eine allein stehende letzte Seite in die Mitte', () => {
    const layout = berechneLayout(seiten(3), 1, 0, SEITENABSTAND, 2)
    expect(layout.plaetze[2]?.mitte).toBeCloseTo(0, 6)
  })

  it('nimmt die hoehere Seite einer Zeile fuer die Zeilenhoehe', () => {
    const gemischt: SeitenGroesse[] = [
      { breite: 600, hoehe: 800 },
      { breite: 600, hoehe: 1000 },
      A4
    ]
    const layout = berechneLayout(gemischt, 1, 0, SEITENABSTAND, 2)
    expect(layout.plaetze[2]?.oben).toBe(1000 + SEITENABSTAND)
    expect(layout.gesamthoehe).toBe(1000 + SEITENABSTAND + 800)
  })

  it('laesst eine Spalte unveraendert: gleiche Hoehen, Mitte 0', () => {
    const layout = berechneLayout(seiten(3), 1, 0)
    expect(layout.plaetze.map((p) => p.oben)).toEqual([
      0,
      800 + SEITENABSTAND,
      2 * (800 + SEITENABSTAND)
    ])
    expect(layout.plaetze.every((p) => p.mitte === 0)).toBe(true)
  })

  it('kommt mit einem leeren Dokument zurecht', () => {
    expect(berechneLayout([], 1, 0, SEITENABSTAND, 2)).toEqual({
      plaetze: [],
      gesamthoehe: 0,
      maxBreite: 0
    })
  })
})

describe('Passung bei zwei Spalten', () => {
  it('Breite: zwei Seiten samt Abstand passen in die Breite', () => {
    const zoom = passendZuBreite(A4, 0, 1216, 2)
    expect(2 * 600 * zoom + SEITENABSTAND).toBeCloseTo(1216, 6)
  })

  it('Seite: die Hoehe begrenzt, wenn sie knapper ist', () => {
    expect(passendZuSeite(A4, 0, 5000, 400, 2)).toBeCloseTo(0.5, 6)
  })

  it('eine Spalte bleibt wie bisher', () => {
    expect(passendZuBreite(A4, 0, 1200)).toBeCloseTo(2, 6)
    expect(passendZuBreite(A4, 0, 1200, 1)).toBeCloseTo(2, 6)
  })
})
