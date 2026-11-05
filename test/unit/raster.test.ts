import { describe, expect, it } from 'vitest'
import {
  BESCHRIFTUNG,
  berechneRaster,
  einfuegestelle,
  RASTER_ABSTAND,
  sichtbareKacheln,
  spaltenFuer,
  zielImRaster
} from '../../src/renderer/src/viewer/raster'

/** Raster der Seitenuebersicht (S6.2) als reine Funktionen. */
const A4 = { breite: 595, hoehe: 842 }
const QUER = { breite: 842, hoehe: 595 }
/** Genau so breit, dass drei Kacheln zu 180 px samt Abstaenden passen. */
const DREI_SPALTEN = RASTER_ABSTAND + 3 * (180 + RASTER_ABSTAND)

describe('spaltenFuer', () => {
  it('passt so viele Kacheln nebeneinander, wie mit Abstand Platz haben', () => {
    // Abstand links plus drei Kacheln mit je einem Abstand rechts
    expect(spaltenFuer(180, DREI_SPALTEN)).toBe(3)
    expect(spaltenFuer(180, DREI_SPALTEN - 1)).toBe(2)
  })

  it('hat immer mindestens eine Spalte', () => {
    expect(spaltenFuer(360, 50)).toBe(1)
  })
})

describe('berechneRaster', () => {
  it('legt Seiten zeilenweise von links nach rechts', () => {
    const raster = berechneRaster([A4, A4, A4, A4, A4], 0, 180, DREI_SPALTEN)
    expect(raster.spalten).toBe(3)
    expect(raster.zeilen).toHaveLength(2)
    expect(raster.plaetze.map((p) => [p.zeile, p.spalte])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1]
    ])
  })

  it('fuellt die Kachelbreite mit einer Hochformatseite', () => {
    const [platz] = berechneRaster([A4], 0, 180, DREI_SPALTEN).plaetze
    expect(platz?.breite).toBe(180)
    expect(platz?.links).toBe(RASTER_ABSTAND)
    expect(platz?.hoehe).toBe(Math.floor(842 * (180 / 595)) + BESCHRIFTUNG)
  })

  it('zentriert eine schmale Seite in ihrer Kachel', () => {
    const schmal = { breite: 300, hoehe: 842 }
    const [platz] = berechneRaster([schmal], 0, 180, DREI_SPALTEN).plaetze
    expect(platz).toBeDefined()
    if (platz === undefined) return
    expect(platz.breite).toBeLessThan(180)
    expect(platz.links).toBe(RASTER_ABSTAND + Math.floor((180 - platz.breite) / 2))
  })

  it('macht eine Querformatseite nicht breiter als die Kachel', () => {
    const [platz] = berechneRaster([QUER], 0, 180, DREI_SPALTEN).plaetze
    expect(platz?.breite).toBe(180)
  })

  it('beruecksichtigt die Ansichtsdrehung', () => {
    const [hoch] = berechneRaster([QUER], 90, 180, DREI_SPALTEN).plaetze
    const [quer] = berechneRaster([QUER], 0, 180, DREI_SPALTEN).plaetze
    expect(hoch?.hoehe ?? 0).toBeGreaterThan(quer?.hoehe ?? 0)
  })

  it('richtet die Zeilenhoehe nach der hoechsten Kachel', () => {
    const raster = berechneRaster([QUER, A4], 0, 180, DREI_SPALTEN)
    const [a, b] = raster.plaetze
    expect(raster.zeilen[0]?.hoehe).toBe(Math.max(a?.hoehe ?? 0, b?.hoehe ?? 0))
    expect(raster.gesamthoehe).toBe(
      RASTER_ABSTAND + (raster.zeilen[0]?.hoehe ?? 0) + RASTER_ABSTAND
    )
  })

  it('liefert fuer ein leeres Dokument ein leeres Raster', () => {
    const raster = berechneRaster([], 0, 180, DREI_SPALTEN)
    expect(raster.plaetze).toEqual([])
    expect(sichtbareKacheln(raster, 0, 600, 1)).toEqual({ von: -1, bis: -1 })
  })
})

describe('sichtbareKacheln', () => {
  const raster = berechneRaster(
    Array.from({ length: 30 }, () => A4),
    0,
    180,
    DREI_SPALTEN
  )
  const zeilenHoehe = (raster.zeilen[0]?.hoehe ?? 0) + RASTER_ABSTAND

  it('liefert am Anfang die ersten Zeilen samt Puffer', () => {
    const sicht = sichtbareKacheln(raster, 0, zeilenHoehe, 1)
    expect(sicht.von).toBe(0)
    expect(sicht.bis).toBeLessThanOrEqual(3 * 3 - 1)
    expect(sicht.bis).toBeGreaterThanOrEqual(2 * 3 - 1)
  })

  it('schneidet am Ende auf die letzte Seite ab', () => {
    const sicht = sichtbareKacheln(raster, raster.gesamthoehe, 600, 1)
    expect(sicht.bis).toBe(29)
  })

  it('beginnt weiter unten mit Puffer vor der ersten sichtbaren Zeile', () => {
    const sicht = sichtbareKacheln(raster, zeilenHoehe * 5 + 1, 600, 1)
    expect(sicht.von).toBe(4 * 3)
  })
})

describe('zielImRaster', () => {
  it.each([
    ['ArrowLeft', 5, 4],
    ['ArrowLeft', 1, 1],
    ['ArrowRight', 5, 6],
    ['ArrowRight', 10, 10],
    ['ArrowUp', 5, 2],
    ['ArrowUp', 2, 2],
    ['ArrowDown', 5, 8],
    ['ArrowDown', 9, 9],
    ['Home', 5, 1],
    ['End', 5, 10]
  ])('%s von Seite %i fuehrt zu %i', (taste, von, nach) => {
    expect(zielImRaster(taste, von, 10, 3)).toBe(nach)
  })

  it('ignoriert andere Tasten', () => {
    expect(zielImRaster('a', 5, 10, 3)).toBeNull()
  })
})

describe('einfuegestelle', () => {
  it('rueckt eine Auswahl um eine Stelle zurueck', () => {
    expect(einfuegestelle('zurueck', [3, 4], 10)).toBe(2)
  })

  it('rueckt eine Auswahl um eine Stelle vor', () => {
    expect(einfuegestelle('vor', [3, 4], 10)).toBe(6)
  })

  it('bleibt am Anfang und am Ende stehen', () => {
    expect(einfuegestelle('zurueck', [1, 2], 10)).toBeNull()
    expect(einfuegestelle('vor', [9, 10], 10)).toBeNull()
  })

  it('tut ohne Auswahl nichts', () => {
    expect(einfuegestelle('vor', [], 10)).toBeNull()
  })
})
