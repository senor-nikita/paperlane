import { describe, expect, it } from 'vitest'
import {
  auswahlrechtecke,
  duenneAus,
  glaette,
  MAX_ZUG_PUNKTE,
  quadPointsAusRechtecken,
  vereinfache
} from '../../src/renderer/src/viewer/eingabe'
import { baueTransformation, type Punkt } from '../../src/renderer/src/viewer/koordinaten'

/**
 * Die Uebersetzung von Nutzereingaben in PDF-Geometrie (S2.2).
 *
 * jsdom rechnet kein Layout: `getClientRects` liefert dort immer eine leere
 * Liste. Die Rechtecke kommen deshalb aus Attrappen — geprueft wird die
 * Auswahllogik, nicht der Browser. Dass die echten Rechtecke stimmen, belegt
 * der E2E-Test.
 */
const A4 = [0, 0, 595, 842] as const
const MATRIX = baueTransformation(A4, 1, 0)

function rechteck(links: number, oben: number, breite: number, hoehe: number): DOMRect {
  return {
    left: links,
    top: oben,
    right: links + breite,
    bottom: oben + hoehe,
    width: breite,
    height: hoehe,
    x: links,
    y: oben,
    toJSON: () => ({})
  }
}

/** Ein Bereich und ein Behaelter, wie sie die Ebene vorfindet. */
function attrappen(
  zeilen: DOMRect[],
  seitenrahmen = rechteck(100, 50, 595, 842)
): { bereich: Range; behaelter: Element } {
  return {
    bereich: { getClientRects: () => zeilen } as unknown as Range,
    behaelter: { getBoundingClientRect: () => seitenrahmen } as unknown as Element
  }
}

describe('auswahlrechtecke', () => {
  // Ein Rechteck je Zeilenkasten - genau die Zerlegung, die /QuadPoints
  // braucht.
  it('rechnet die Zeilen auf die Seitenecke um', () => {
    const { bereich, behaelter } = attrappen([rechteck(150, 100, 200, 16)])
    expect(auswahlrechtecke(bereich, behaelter)).toEqual([
      { links: 50, oben: 50, breite: 200, hoehe: 16 }
    ])
  })

  it('behaelt jede Zeile einzeln', () => {
    const { bereich, behaelter } = attrappen([
      rechteck(150, 100, 200, 16),
      rechteck(150, 120, 90, 16)
    ])
    expect(auswahlrechtecke(bereich, behaelter)).toHaveLength(2)
  })

  // Browser liefern sie fuer Zeilenumbrueche; ein Viererblock ohne Flaeche
  // waere eine Markierung, die niemand sieht und die trotzdem in der Datei
  // steht.
  it('uebergeht leere Rechtecke', () => {
    const { bereich, behaelter } = attrappen([
      rechteck(150, 100, 0, 16),
      rechteck(150, 120, 200, 0),
      rechteck(150, 140, 200, 16)
    ])
    expect(auswahlrechtecke(bereich, behaelter)).toHaveLength(1)
  })

  // Eine Auswahl kann ueber den Seitenrand hinausgehen; die Nachbarseite
  // fuehrt ihre eigene Ebene und nimmt ihren Anteil selbst.
  it('nimmt nur Zeilen, die ueber dieser Seite liegen', () => {
    const seite = rechteck(0, 0, 595, 842)
    const { bereich, behaelter } = attrappen(
      [rechteck(10, -50, 100, 16), rechteck(10, 400, 100, 16), rechteck(10, 900, 100, 16)],
      seite
    )
    const gefunden = auswahlrechtecke(bereich, behaelter)
    expect(gefunden).toHaveLength(1)
    expect(gefunden[0]?.oben).toBe(400)
  })

  it('liefert fuer eine leere Auswahl nichts', () => {
    const { bereich, behaelter } = attrappen([])
    expect(auswahlrechtecke(bereich, behaelter)).toEqual([])
  })
})

describe('quadPointsAusRechtecken', () => {
  it('schreibt je Zeile acht Werte in der Reihenfolge der Spezifikation', () => {
    // Bildschirm oben 60 entspricht bei 842 Punkten Seitenhoehe y = 782.
    const quadPoints = quadPointsAusRechtecken(
      [{ links: 70, oben: 60, breite: 270, hoehe: 30 }],
      MATRIX
    )
    expect(quadPoints).toEqual([70, 782, 340, 782, 70, 752, 340, 752])
  })

  it('haengt mehrere Zeilen aneinander', () => {
    const quadPoints = quadPointsAusRechtecken(
      [
        { links: 70, oben: 60, breite: 270, hoehe: 30 },
        { links: 70, oben: 100, breite: 130, hoehe: 30 }
      ],
      MATRIX
    )
    expect(quadPoints).toHaveLength(16)
  })

  // Bei 180 Grad ist oben unten; sortiert wird deshalb in PDF-Koordinaten.
  it('haelt die Reihenfolge auch bei gedrehter Seite ein', () => {
    const gedreht = baueTransformation(A4, 1, 180)
    const quadPoints = quadPointsAusRechtecken(
      [{ links: 70, oben: 60, breite: 270, hoehe: 30 }],
      gedreht
    ) as number[]
    // Erster Punkt ist oben links: sein y liegt ueber dem des dritten.
    expect(quadPoints[1]).toBeGreaterThan(quadPoints[5] as number)
    expect(quadPoints[0]).toBeLessThan(quadPoints[2] as number)
  })

  it('liefert null, wenn sich die Abbildung nicht umkehren laesst', () => {
    const entartet = baueTransformation(A4, 0, 0)
    expect(
      quadPointsAusRechtecken([{ links: 0, oben: 0, breite: 1, hoehe: 1 }], entartet)
    ).toBeNull()
  })

  it('liefert null fuer eine leere Liste', () => {
    expect(quadPointsAusRechtecken([], MATRIX)).toBeNull()
  })
})

describe('vereinfache', () => {
  // Eine gerade Linie braucht genau zwei Punkte.
  it('wirft Punkte weg, die auf der Verbindungslinie liegen', () => {
    const gerade: Punkt[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 }
    ]
    expect(vereinfache(gerade, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 }
    ])
  })

  // Eine Ecke bleibt eine Ecke - genau das unterscheidet Vereinfachung von
  // Verschmieren.
  it('behaelt eine deutliche Ecke', () => {
    const ecke: Punkt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 }
    ]
    expect(vereinfache(ecke, 0.5)).toHaveLength(3)
  })

  it('laesst zu kurze Zuege unveraendert', () => {
    const zwei: Punkt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ]
    expect(vereinfache(zwei, 1)).toEqual(zwei)
  })

  // Iterativ statt rekursiv: ein langer Zug wuerde den Aufrufstapel sonst
  // sprengen. Geprueft mit einer Laenge, die unter der Ausduenngrenze bleibt.
  it('kommt ohne Rekursionstiefe aus', () => {
    const lang = Array.from({ length: 3000 }, (_wert, stelle) => ({ x: stelle, y: stelle % 3 }))
    expect(vereinfache(lang, 0.1).length).toBeGreaterThan(1)
  })
})

/**
 * Ramer-Douglas-Peucker ist im schlechtesten Fall quadratisch: bei einem
 * Zickzack teilt jeder Durchgang nur einen Punkt ab. Ein Zeiger mit hoher
 * Abtastrate erreicht diese Laengen, ein von Hand gezogener Strich nicht — die
 * Grenze schneidet also nichts weg, was jemand gezeichnet hat.
 */
describe('duenneAus', () => {
  it('laesst einen Zug unter der Grenze unveraendert', () => {
    const kurz = Array.from({ length: 10 }, (_wert, stelle) => ({ x: stelle, y: 0 }))
    expect(duenneAus(kurz)).toEqual(kurz)
  })

  it('kuerzt einen ueberlangen Zug auf die Grenze', () => {
    const lang = Array.from({ length: 20000 }, (_wert, stelle) => ({ x: stelle, y: stelle % 3 }))
    const gekuerzt = duenneAus(lang)
    expect(gekuerzt.length).toBeLessThanOrEqual(MAX_ZUG_PUNKTE + 1)
    expect(gekuerzt.length).toBeGreaterThan(1)
  })

  // Ein abgeschnittener Strich waere ein halber Strich.
  it('behaelt Anfang und Ende', () => {
    const lang = Array.from({ length: 9999 }, (_wert, stelle) => ({ x: stelle, y: 0 }))
    const gekuerzt = duenneAus(lang, 100)
    expect(gekuerzt[0]).toEqual({ x: 0, y: 0 })
    expect(gekuerzt[gekuerzt.length - 1]).toEqual({ x: 9998, y: 0 })
  })
})

describe('glaette', () => {
  it('behaelt Anfang und Ende unveraendert', () => {
    const zug: Punkt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
      { x: 40, y: 0 }
    ]
    const geglaettet = glaette(zug, 0.1)
    expect(geglaettet[0]).toEqual({ x: 0, y: 0 })
    expect(geglaettet[geglaettet.length - 1]).toEqual({ x: 40, y: 0 })
  })

  // Das Zittern der Hand: kleine Ausschlaege um eine Gerade herum.
  it('nimmt das Zittern aus einer im Kern geraden Linie', () => {
    const zittrig: Punkt[] = Array.from({ length: 40 }, (_wert, stelle) => ({
      x: stelle,
      y: stelle % 2 === 0 ? 0.3 : -0.3
    }))
    expect(glaette(zittrig).length).toBeLessThan(zittrig.length)
  })

  it('laesst einen Zug aus zwei Punkten in Ruhe', () => {
    const zwei: Punkt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    ]
    expect(glaette(zwei)).toEqual(zwei)
  })

  // Der eigentliche Grund fuer die Ausduenngrenze: ohne sie lief dieser Fall
  // in die Zeitgrenze des Testlaufs.
  it('bleibt auch bei einem Zug mit zwanzigtausend Punkten schnell', () => {
    const lang: Punkt[] = Array.from({ length: 20000 }, (_wert, stelle) => ({
      x: stelle,
      y: stelle % 3
    }))
    const begonnen = Date.now()
    expect(glaette(lang).length).toBeGreaterThan(1)
    expect(Date.now() - begonnen).toBeLessThan(2000)
  })
})
