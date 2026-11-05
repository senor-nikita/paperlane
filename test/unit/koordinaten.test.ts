import { describe, expect, it } from 'vitest'
import {
  baueTransformation,
  bildschirmZuPdf,
  huelle,
  pdfZuBildschirm,
  punktInRechteck,
  punktlisteZuBildschirm,
  quadPointsZuRechtecken,
  rechteckZuBildschirm
} from '../../src/renderer/src/viewer/koordinaten'

/** A4 in PDF-Punkten, wie es die Fixtures verwenden. */
const A4 = [0, 0, 595, 842] as const
const DREHUNGEN = [0, 90, 180, 270] as const

/**
 * Ein Zufallsgenerator mit festem Startwert.
 *
 * `Math.random` waere hier ein Fehler: ein Rundlauf, der einmal in tausend
 * Laeufen bricht, ist ohne reproduzierbare Eingabe nicht zu finden.
 */
function wuerfel(startwert: number): () => number {
  let zustand = startwert
  return () => {
    zustand = (zustand * 1664525 + 1013904223) % 4294967296
    return zustand / 4294967296
  }
}

describe('baueTransformation', () => {
  // Bei 0 Grad steht die linke obere Seitenecke auf (0,0) und die linke untere
  // auf (0, Hoehe): das PDF misst y von unten, der Bildschirm von oben.
  it('dreht die y-Achse um', () => {
    const matrix = baueTransformation(A4, 1, 0)
    expect(pdfZuBildschirm({ x: 0, y: 842 }, matrix)).toEqual({ x: 0, y: 0 })
    expect(pdfZuBildschirm({ x: 0, y: 0 }, matrix)).toEqual({ x: 0, y: 842 })
  })

  it('skaliert mit dem Zoom', () => {
    const matrix = baueTransformation(A4, 2, 0)
    expect(pdfZuBildschirm({ x: 100, y: 842 }, matrix)).toEqual({ x: 200, y: 0 })
  })

  /**
   * Die rechte obere Ecke der Seite, einmal je Drehung.
   *
   * Bei 0 Grad liegt sie oben rechts (595, 0). Jede Vierteldrehung im
   * Uhrzeigersinn schiebt sie eine Ecke weiter: 90 Grad nach unten rechts der
   * nun querliegenden Seite, 180 Grad nach unten links, 270 Grad nach oben
   * links.
   */
  it.each([
    [90, { x: 842, y: 595 }],
    [180, { x: 0, y: 842 }],
    [270, { x: 0, y: 0 }]
  ])('legt die Seitenecken bei %i Grad richtig', (drehung, erwartet) => {
    const matrix = baueTransformation(A4, 1, drehung)
    const ecke = pdfZuBildschirm({ x: 595, y: 842 }, matrix)
    expect(ecke.x).toBeCloseTo(erwartet.x, 6)
    expect(ecke.y).toBeCloseTo(erwartet.y, 6)
  })

  // Die ganze Seite muss in den Bereich passen, den das Layout vorhaelt -
  // sonst raegte eine Annotation am Rand ueber das Blatt hinaus.
  it.each(DREHUNGEN)('bildet die Seite bei %i Grad auf den ersten Quadranten ab', (drehung) => {
    const matrix = baueTransformation(A4, 1.5, drehung)
    const flaeche = rechteckZuBildschirm(A4, matrix)
    expect(flaeche.links).toBeCloseTo(0, 6)
    expect(flaeche.oben).toBeCloseTo(0, 6)
    const quer = drehung === 90 || drehung === 270
    expect(flaeche.breite).toBeCloseTo((quer ? 842 : 595) * 1.5, 6)
    expect(flaeche.hoehe).toBeCloseTo((quer ? 595 : 842) * 1.5, 6)
  })

  // Eine MediaBox muss nicht bei (0,0) beginnen.
  it('kommt mit einem verschobenen Ursprung zurecht', () => {
    const matrix = baueTransformation([20, 30, 615, 872], 1, 0)
    expect(pdfZuBildschirm({ x: 20, y: 872 }, matrix)).toEqual({ x: 0, y: 0 })
  })

  it('rundet krumme Drehwinkel auf das naechste Vielfache von 90', () => {
    expect(baueTransformation(A4, 1, 91)).toEqual(baueTransformation(A4, 1, 90))
    expect(baueTransformation(A4, 1, -90)).toEqual(baueTransformation(A4, 1, 270))
  })
})

/**
 * Der Rundlauf aus Aufgabe 5 des Schritts. Er ist die eigentliche Absicherung
 * gegen Risiko R6: eine Transformation, die sich nicht sauber umkehren laesst,
 * faellt in der Anzeige erst auf, wenn schon Annotationen darauf sitzen.
 */
describe('Rundlauf PDF → Bildschirm → PDF', () => {
  it.each(DREHUNGEN)('trifft bei %i Grad ueber zufaellige Punkte wieder ein', (drehung) => {
    const zufall = wuerfel(20260907 + drehung)
    for (const zoom of [0.25, 1, 2.5, 4]) {
      const matrix = baueTransformation(A4, zoom, drehung)
      for (let i = 0; i < 250; i++) {
        const punkt = { x: zufall() * 595, y: zufall() * 842 }
        const zurueck = bildschirmZuPdf(pdfZuBildschirm(punkt, matrix), matrix)
        expect(zurueck).not.toBeNull()
        expect(zurueck?.x).toBeCloseTo(punkt.x, 6)
        expect(zurueck?.y).toBeCloseTo(punkt.y, 6)
      }
    }
  })

  it('liefert null statt einer erfundenen Antwort, wenn die Matrix entartet ist', () => {
    expect(bildschirmZuPdf({ x: 1, y: 1 }, baueTransformation(A4, 0, 0))).toBeNull()
    expect(bildschirmZuPdf({ x: 1, y: 1 }, [0, 0, 0, 0, 0, 0])).toBeNull()
  })
})

describe('rechteckZuBildschirm', () => {
  it('liefert nie eine negative Breite oder Hoehe', () => {
    for (const drehung of DREHUNGEN) {
      const matrix = baueTransformation(A4, 1, drehung)
      const flaeche = rechteckZuBildschirm([70, 752, 340, 782], matrix)
      expect(flaeche.breite).toBeGreaterThan(0)
      expect(flaeche.hoehe).toBeGreaterThan(0)
    }
  })

  it('behaelt die Kantenlaengen bei 90 Grad, vertauscht aber die Achsen', () => {
    const ohne = rechteckZuBildschirm([70, 752, 340, 782], baueTransformation(A4, 1, 0))
    const quer = rechteckZuBildschirm([70, 752, 340, 782], baueTransformation(A4, 1, 90))
    expect(quer.breite).toBeCloseTo(ohne.hoehe, 6)
    expect(quer.hoehe).toBeCloseTo(ohne.breite, 6)
  })
})

describe('quadPointsZuRechtecken', () => {
  const matrix = baueTransformation(A4, 1, 0)

  // Ein Block je Textzeile - ein einziges Rechteck ueber beide waere bei einer
  // mehrzeiligen Markierung falsch.
  it('macht aus zwei Bloecken zwei Rechtecke', () => {
    const rechtecke = quadPointsZuRechtecken(
      [70, 782, 340, 782, 70, 752, 340, 752, 70, 742, 200, 742, 70, 712, 200, 712],
      matrix
    )
    expect(rechtecke).toHaveLength(2)
    expect(rechtecke[0]?.links).toBeCloseTo(70, 6)
    expect(rechtecke[0]?.hoehe).toBeCloseTo(30, 6)
    expect(rechtecke[1]?.breite).toBeCloseTo(130, 6)
  })

  it('uebergeht einen angefangenen Block statt die Markierung fallen zu lassen', () => {
    const rechtecke = quadPointsZuRechtecken(
      [70, 782, 340, 782, 70, 752, 340, 752, 70, 742, 200],
      matrix
    )
    expect(rechtecke).toHaveLength(1)
  })

  it('uebergeht Bloecke mit unbrauchbaren Zahlen', () => {
    expect(quadPointsZuRechtecken([0, 0, 0, 0, 0, 0, 0, Number.NaN], matrix)).toEqual([])
    expect(quadPointsZuRechtecken([], matrix)).toEqual([])
  })
})

describe('punktlisteZuBildschirm', () => {
  it('bildet Paare ab und laesst einen einzelnen Rest liegen', () => {
    const punkte = punktlisteZuBildschirm([0, 842, 100, 742, 50], baueTransformation(A4, 1, 0))
    expect(punkte).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 }
    ])
  })
})

describe('punktInRechteck', () => {
  const flaeche = { links: 10, oben: 20, breite: 100, hoehe: 4 }

  it('trifft innerhalb', () => {
    expect(punktInRechteck({ x: 50, y: 22 }, flaeche)).toBe(true)
  })

  it('trifft ohne Toleranz nicht knapp daneben', () => {
    expect(punktInRechteck({ x: 50, y: 26 }, flaeche)).toBe(false)
  })

  // Eine Unterstreichung ist nur wenige Pixel hoch; ohne Rand waere sie mit
  // der Maus praktisch nicht zu treffen.
  it('trifft mit Toleranz knapp daneben', () => {
    expect(punktInRechteck({ x: 50, y: 26 }, flaeche, 3)).toBe(true)
  })
})

describe('huelle', () => {
  it('umfasst alle Rechtecke', () => {
    expect(
      huelle([
        { links: 10, oben: 10, breite: 20, hoehe: 5 },
        { links: 40, oben: 30, breite: 10, hoehe: 5 }
      ])
    ).toEqual({ links: 10, oben: 10, breite: 40, hoehe: 25 })
  })

  it('liefert null fuer nichts', () => {
    expect(huelle([])).toBeNull()
  })
})
