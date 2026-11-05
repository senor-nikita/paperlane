import { describe, expect, it } from 'vitest'
import {
  ausMm,
  begrenzeRaender,
  berechneZuschnitte,
  flaecheAusRaendern,
  GRIFFE,
  MIN_KANTE,
  rahmenAusRaendern,
  raenderAusRahmen,
  raenderAusZug,
  seitenmass,
  zieheGriff,
  zuMm,
  type Raender
} from '../../src/renderer/src/viewer/zuschnitt'

/**
 * Die Rechnung hinter dem Zuschneiden (S6.3): Raender in Bildschirmrichtung
 * ↔ `/CropBox` in PDF-Koordinaten, bei allen vier Drehungen und mit einer
 * sichtbaren Box, deren Ursprung nicht bei 0,0 liegt.
 *
 * Die erwarteten Kaesten sind von Hand hergeleitet, nicht aus der Funktion
 * abgeschrieben: bei 90 Grad im Uhrzeigersinn liegt die PDF-Unterkante
 * links, die linke PDF-Kante oben - und so weiter.
 */
const RAENDER: Raender = { links: 10, oben: 20, rechts: 30, unten: 40 }
const HOCHKANT = [0, 0, 600, 800]
const VERSETZT = [100, 50, 700, 850]

describe('rahmenAusRaendern', () => {
  it.each<[number, number[]]>([
    [0, [10, 40, 570, 780]],
    [90, [20, 10, 560, 770]],
    [180, [30, 20, 590, 760]],
    [270, [40, 30, 580, 790]]
  ])('bildet die Raender bei %i Grad auf die richtigen PDF-Kanten ab', (drehung, erwartet) => {
    expect(rahmenAusRaendern(HOCHKANT, drehung, RAENDER)).toEqual(erwartet)
  })

  it.each([0, 90, 180, 270])(
    'verschiebt bei %i Grad mit dem Ursprung der sichtbaren Box',
    (drehung) => {
      const ohne = rahmenAusRaendern(HOCHKANT, drehung, RAENDER)
      const mit = rahmenAusRaendern(VERSETZT, drehung, RAENDER)
      expect(ohne).not.toBeNull()
      expect(mit).toEqual(ohne?.map((wert, i) => wert + (i % 2 === 0 ? 100 : 50)))
    }
  )

  it('nimmt eine verkehrt herum notierte Box wie die sortierte', () => {
    expect(rahmenAusRaendern([600, 800, 0, 0], 0, RAENDER)).toEqual([10, 40, 570, 780])
  })

  it('lehnt Raender ab, die weniger als die Mindestkante uebrig lassen', () => {
    expect(rahmenAusRaendern(HOCHKANT, 0, { ...RAENDER, links: 590 - MIN_KANTE })).toBeNull()
    expect(rahmenAusRaendern(HOCHKANT, 90, { ...RAENDER, oben: 590 })).toBeNull()
    expect(rahmenAusRaendern(HOCHKANT, 0, { ...RAENDER, links: -1 })).toBeNull()
  })

  it('rundet auf Tausendstel Punkt', () => {
    const rahmen = rahmenAusRaendern(HOCHKANT, 0, { links: 1 / 3, oben: 0, rechts: 0, unten: 0 })
    expect(rahmen?.[0]).toBe(0.333)
  })
})

describe('Rundlauf Raender → Rahmen → Raender', () => {
  it.each([0, 90, 180, 270])('ergibt bei %i Grad dieselben Raender', (drehung) => {
    for (const view of [HOCHKANT, VERSETZT, [-20.5, 13.25, 400.75, 333]]) {
      const rahmen = rahmenAusRaendern(view, drehung, RAENDER)
      expect(rahmen).not.toBeNull()
      if (rahmen === null) continue
      const zurueck = raenderAusRahmen(view, drehung, rahmen)
      expect(zurueck.links).toBeCloseTo(RAENDER.links, 2)
      expect(zurueck.oben).toBeCloseTo(RAENDER.oben, 2)
      expect(zurueck.rechts).toBeCloseTo(RAENDER.rechts, 2)
      expect(zurueck.unten).toBeCloseTo(RAENDER.unten, 2)
    }
  })

  it('ein Rahmen gleich der Box laesst keine Raender', () => {
    expect(raenderAusRahmen(VERSETZT, 90, [100, 50, 700, 850])).toEqual({
      links: 0,
      oben: 0,
      rechts: 0,
      unten: 0
    })
  })
})

describe('seitenmass', () => {
  it('tauscht Breite und Hoehe bei 90 und 270 Grad', () => {
    expect(seitenmass(HOCHKANT, 0)).toEqual({ breite: 600, hoehe: 800 })
    expect(seitenmass(HOCHKANT, 90)).toEqual({ breite: 800, hoehe: 600 })
    expect(seitenmass(VERSETZT, 270)).toEqual({ breite: 800, hoehe: 600 })
    expect(seitenmass(VERSETZT, 180)).toEqual({ breite: 600, hoehe: 800 })
  })
})

describe('Millimeter', () => {
  it('rechnet Punkte in mm auf eine Stelle und zurueck', () => {
    expect(zuMm(72)).toBe(25.4)
    expect(zuMm(595.28)).toBe(210)
    expect(ausMm(25.4)).toBeCloseTo(72, 10)
    expect(zuMm(ausMm(12.3))).toBe(12.3)
  })
})

const MASS = { breite: 600, hoehe: 800 }

describe('begrenzeRaender', () => {
  it('laesst gueltige Raender unveraendert', () => {
    expect(begrenzeRaender(RAENDER, MASS)).toEqual(RAENDER)
  })

  it('schneidet negative Raender auf null', () => {
    expect(begrenzeRaender({ links: -5, oben: -1, rechts: 0, unten: 3 }, MASS)).toEqual({
      links: 0,
      oben: 0,
      rechts: 0,
      unten: 3
    })
  })

  it('haelt die Mindestkante - links und oben haben Vorrang', () => {
    const raender = begrenzeRaender({ links: 700, oben: 500, rechts: 100, unten: 500 }, MASS)
    expect(raender.links).toBe(600 - MIN_KANTE)
    expect(raender.rechts).toBe(0)
    expect(raender.oben).toBe(500)
    expect(raender.unten).toBe(800 - MIN_KANTE - 500)
  })
})

describe('raenderAusZug', () => {
  it('nimmt beide Zugrichtungen und begrenzt auf die Seite', () => {
    expect(raenderAusZug({ x: 50, y: 60 }, { x: 550, y: 700 }, MASS)).toEqual({
      links: 50,
      oben: 60,
      rechts: 50,
      unten: 100
    })
    expect(raenderAusZug({ x: 550, y: 700 }, { x: 50, y: 60 }, MASS)).toEqual({
      links: 50,
      oben: 60,
      rechts: 50,
      unten: 100
    })
    expect(raenderAusZug({ x: -30, y: -30 }, { x: 900, y: 900 }, MASS)).toEqual({
      links: 0,
      oben: 0,
      rechts: 0,
      unten: 0
    })
  })
})

describe('zieheGriff', () => {
  it('bewegt je Griff genau seine Kanten', () => {
    const erwartet: Record<string, Partial<Raender>> = {
      linksOben: { links: 15, oben: 27 },
      oben: { oben: 27 },
      rechtsOben: { rechts: 25, oben: 27 },
      rechts: { rechts: 25 },
      rechtsUnten: { rechts: 25, unten: 33 },
      unten: { unten: 33 },
      linksUnten: { links: 15, unten: 33 },
      links: { links: 15 }
    }
    for (const griff of GRIFFE) {
      expect(zieheGriff(RAENDER, griff, 5, 7, MASS)).toEqual({ ...RAENDER, ...erwartet[griff] })
    }
  })

  it('verschiebt im Inneren mit gleicher Groesse und stoesst an die Seitenkanten', () => {
    expect(zieheGriff(RAENDER, 'innen', 5, 7, MASS)).toEqual({
      links: 15,
      oben: 27,
      rechts: 25,
      unten: 33
    })
    expect(zieheGriff(RAENDER, 'innen', -100, 100, MASS)).toEqual({
      links: 0,
      oben: 60,
      rechts: 40,
      unten: 0
    })
  })

  it('laesst eine Kante nicht ueber die gegenueberliegende', () => {
    const raender = zieheGriff(RAENDER, 'links', 1000, 0, MASS)
    expect(raender.links).toBe(600 - RAENDER.rechts - MIN_KANTE)
    expect(zieheGriff(RAENDER, 'unten', 0, -1000, MASS).unten).toBe(800 - 20 - MIN_KANTE)
    expect(zieheGriff(RAENDER, 'rechts', -1000, 0, MASS).rechts).toBe(600 - 10 - MIN_KANTE)
    expect(zieheGriff(RAENDER, 'oben', 0, 1000, MASS).oben).toBe(800 - 40 - MIN_KANTE)
  })
})

describe('flaecheAusRaendern', () => {
  it('liefert das Rechteck in Pixeln beim Zoom', () => {
    expect(flaecheAusRaendern(RAENDER, MASS, 2)).toEqual({
      links: 20,
      oben: 40,
      breite: 1120,
      hoehe: 1480
    })
    expect(flaecheAusRaendern({ links: 700, oben: 0, rechts: 0, unten: 0 }, MASS, 1).breite).toBe(0)
  })
})

describe('berechneZuschnitte', () => {
  const quelle = {
    getPage: (nummer: number) =>
      Promise.resolve(
        nummer === 1
          ? { view: HOCHKANT, rotate: 0 }
          : nummer === 2
            ? { view: VERSETZT, rotate: 90 }
            : { view: [0, 0, 40, 40], rotate: 0 }
      )
  }

  it('rechnet dieselben Raender je Seite mit deren Drehung um', async () => {
    expect(await berechneZuschnitte(quelle, [1, 2], RAENDER, 0)).toEqual({
      zuschnitte: [
        { seite: 1, rahmen: [10, 40, 570, 780] },
        { seite: 2, rahmen: [120, 60, 660, 820] }
      ]
    })
  })

  it('zaehlt die Ansichtsdrehung zur Seitendrehung', async () => {
    // Seite 1 ohne /Rotate, Ansicht um 270 gedreht, Seite 2: 90 + 270 = 0.
    expect(await berechneZuschnitte(quelle, [1, 2], RAENDER, 270)).toEqual({
      zuschnitte: [
        { seite: 1, rahmen: [40, 30, 580, 790] },
        { seite: 2, rahmen: [110, 90, 670, 830] }
      ]
    })
  })

  it('meldet eine Seite, die fuer die Raender zu klein ist', async () => {
    expect(await berechneZuschnitte(quelle, [1, 3], RAENDER, 0)).toEqual({
      fehler: 'Seite 3 ist für diese Ränder zu klein.'
    })
  })
})
