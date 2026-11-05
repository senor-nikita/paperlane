import { beforeEach, describe, expect, it } from 'vitest'
import type { Annotation } from '../../src/shared/annotations'
import {
  aendere,
  erzeugeFreihand,
  erzeugeMarkup,
  erzeugeNotiz,
  erzeugeSignatur,
  erzeugeStempel,
  passeEin,
  signaturRechteck,
  SIGNATUR_BREITE,
  farbeAusHex,
  hexAusFarbe,
  neueKennung,
  NOTIZ_GROESSE,
  pdfDatum,
  rechteckAusQuadPoints,
  setzeKennungszaehlerZurueck,
  skaliere,
  STEMPEL_BREITE,
  STEMPEL_HOEHE,
  verschiebe
} from '../../src/renderer/src/viewer/erzeugen'

/**
 * Die reinen Bausteine von S2.2. Sie kennen weder Speicher noch Dokument —
 * deshalb laesst sich hier ohne laufende Anwendung pruefen, was spaeter in
 * einer Datei landet.
 */
const VORGABEN = { autor: 'Testautor', farbe: '#ffd400', strichstaerke: 2 }
const ZEITPUNKT = new Date(Date.UTC(2026, 8, 8, 14, 30, 0))

beforeEach(() => {
  setzeKennungszaehlerZurueck()
})

describe('pdfDatum', () => {
  it('schreibt das PDF-Format in UTC', () => {
    expect(pdfDatum(ZEITPUNKT)).toBe('D:20260908143000Z')
  })

  it('fuellt einstellige Werte auf', () => {
    expect(pdfDatum(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('D:20260102030405Z')
  })
})

describe('Farben', () => {
  it('rechnet Hex in Kanaele um', () => {
    expect(farbeAusHex('#ffd400')).toEqual({ r: 255, g: 212, b: 0 })
  })

  it('nimmt Grossschreibung an', () => {
    expect(farbeAusHex('#FFD400')).toEqual({ r: 255, g: 212, b: 0 })
  })

  // Der Wert kommt aus einem Eingabefeld; eine Ausnahme waere hier die
  // schlechtere Antwort als Schwarz.
  it('faellt bei Unsinn auf Schwarz zurueck', () => {
    expect(farbeAusHex('blau')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('laeuft rund: Hex und zurueck', () => {
    expect(hexAusFarbe(farbeAusHex('#3a7bd5'))).toBe('#3a7bd5')
  })

  it('liefert fuer eine fehlende Farbe Schwarz', () => {
    expect(hexAusFarbe(null)).toBe('#000000')
  })

  it('begrenzt Kanaele ausserhalb 0..255', () => {
    expect(hexAusFarbe({ r: 300, g: -5, b: 13 })).toBe('#ff000d')
  })
})

describe('neueKennung', () => {
  // Sie darf nicht mit den Kennungen kollidieren, die pdf.js aus dem Dokument
  // vergibt (etwa "10R").
  it('zaehlt hoch und traegt ein eigenes Praefix', () => {
    expect(neueKennung()).toMatch(/^neu-[a-z0-9]+-1$/)
    expect(neueKennung()).toMatch(/^neu-[a-z0-9]+-2$/)
  })

  // Der Schreibpfad legt die Kennung als /NM in die Datei. Eine Kennung, die in
  // jeder Sitzung bei "neu-1" begaenne, traefe dort auf eine fremde Annotation.
  it('traegt ein Sitzungskennzeichen, das nicht nur aus dem Zaehler besteht', () => {
    const kennung = neueKennung()
    expect(kennung).not.toMatch(/^neu-\d+$/)
    expect(kennung.split('-')[1]?.length).toBeGreaterThanOrEqual(4)
  })
})

describe('rechteckAusQuadPoints', () => {
  it('umfasst alle Punkte', () => {
    expect(rechteckAusQuadPoints([70, 782, 340, 782, 70, 752, 340, 752])).toEqual([
      70, 752, 340, 782
    ])
  })

  it('liefert fuer nichts ein Nullrechteck', () => {
    expect(rechteckAusQuadPoints([])).toEqual([0, 0, 0, 0])
  })
})

describe('erzeugeMarkup', () => {
  const quadPoints = [70, 782, 340, 782, 70, 752, 340, 752, 70, 742, 200, 742, 70, 712, 200, 712]

  it('uebernimmt QuadPoints und leitet das Rechteck daraus ab', () => {
    const annotation = erzeugeMarkup('Highlight', 3, quadPoints, VORGABEN, ZEITPUNKT)
    expect(annotation).toMatchObject({
      seite: 3,
      typ: 'Highlight',
      subtyp: 'Highlight',
      autor: 'Testautor',
      farbe: { r: 255, g: 212, b: 0 },
      erstellt: 'D:20260908143000Z',
      geaendert: 'D:20260908143000Z'
    })
    expect(annotation?.rect).toEqual([70, 712, 340, 782])
    expect(annotation?.quadPoints).toEqual(quadPoints)
  })

  // Der Text darunter soll lesbar bleiben; Striche zeichnen daneben und
  // brauchen volle Deckung.
  it('macht Markierungen durchscheinend, Striche nicht', () => {
    expect(erzeugeMarkup('Highlight', 1, quadPoints, VORGABEN)?.opazitaet).toBeLessThan(1)
    expect(erzeugeMarkup('Underline', 1, quadPoints, VORGABEN)?.opazitaet).toBe(1)
    expect(erzeugeMarkup('StrikeOut', 1, quadPoints, VORGABEN)?.opazitaet).toBe(1)
  })

  it('verwirft eine Auswahl ohne vollstaendigen Viererblock', () => {
    expect(erzeugeMarkup('Highlight', 1, [1, 2, 3, 4], VORGABEN)).toBeNull()
    expect(erzeugeMarkup('Highlight', 1, [], VORGABEN)).toBeNull()
  })

  // Folge von D7: neue Annotationen tragen kein fremdes Objekt mit.
  it('legt kein Rohobjekt an', () => {
    expect(erzeugeMarkup('Highlight', 1, quadPoints, VORGABEN)?.roh).toBeNull()
  })
})

describe('erzeugeNotiz', () => {
  it('setzt den Marker mit der Klickstelle als linker oberer Ecke', () => {
    const notiz = erzeugeNotiz(2, { x: 100, y: 700 }, VORGABEN, ZEITPUNKT)
    expect(notiz.typ).toBe('Text')
    expect(notiz.rect).toEqual([100, 700 - NOTIZ_GROESSE, 100 + NOTIZ_GROESSE, 700])
    expect(notiz.inhalt).toBe('')
  })
})

describe('erzeugeStempel', () => {
  it('traegt den Text und die feste Groesse', () => {
    const stempel = erzeugeStempel(1, { x: 50, y: 400 }, 'Geprueft', VORGABEN, ZEITPUNKT)
    expect(stempel.typ).toBe('Stamp')
    expect(stempel.inhalt).toBe('Geprueft')
    expect(stempel.rect).toEqual([50, 400 - STEMPEL_HOEHE, 50 + STEMPEL_BREITE, 400])
  })
})

/**
 * Die grafische Signatur (S3.2, Aufgabe 4): ein Stempel mit Bild. Das
 * Seitenverhaeltnis des Bildes bestimmt das Rechteck — verzerrt darf es
 * nirgends sein, weil der Appearance-Stream genau in /Rect zeichnet.
 */
describe('Signatur', () => {
  const BILD = 'data:image/png;base64,iVBORw0KGgo='

  it('setzt frei mit fester Breite und der Hoehe aus dem Seitenverhaeltnis', () => {
    // Bild 300x100 -> Verhaeltnis 3 -> Hoehe 50 bei Breite 150.
    expect(signaturRechteck({ x: 50, y: 400 }, 3)).toEqual([50, 350, 50 + SIGNATUR_BREITE, 400])
  })

  it('faellt bei einem unbrauchbaren Verhaeltnis auf 3:1 zurueck', () => {
    for (const kaputt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(signaturRechteck({ x: 0, y: 100 }, kaputt)).toEqual(
        signaturRechteck({ x: 0, y: 100 }, 3)
      )
    }
  })

  it('passt ein breites Bild an der Breite des Feldes an und zentriert senkrecht', () => {
    // Feld 200x100, Bild 4:1 -> 200x50, senkrecht mittig: unten 525.
    expect(passeEin([100, 500, 300, 600], 4)).toEqual([100, 525, 300, 575])
  })

  it('passt ein hohes Bild an der Hoehe des Feldes an und zentriert waagerecht', () => {
    // Feld 200x100, Bild 1:1 -> 100x100, waagerecht mittig: links 150.
    expect(passeEin([100, 500, 300, 600], 1)).toEqual([150, 500, 250, 600])
  })

  it('nimmt das Feld auch mit vertauschten Ecken', () => {
    expect(passeEin([300, 600, 100, 500], 4)).toEqual([100, 525, 300, 575])
  })

  it('ist ein Stempel mit Bild und einem Inhalt, der sagt, was es ist', () => {
    const signatur = erzeugeSignatur(2, [10, 20, 160, 70], BILD, VORGABEN, ZEITPUNKT)
    expect(signatur.typ).toBe('Stamp')
    expect(signatur.bild).toBe(BILD)
    expect(signatur.seite).toBe(2)
    expect(signatur.rect).toEqual([10, 20, 160, 70])
    expect(signatur.inhalt).toMatch(/Signatur/)
    expect(signatur.inhalt).toMatch(/Bild/)
    expect(signatur.roh).toBeNull()
  })
})

describe('erzeugeFreihand', () => {
  it('legt die Punkte flach ab und merkt sich die Strichstaerke', () => {
    const zug = [
      { x: 10, y: 10 },
      { x: 50, y: 60 }
    ]
    const freihand = erzeugeFreihand(4, zug, VORGABEN, ZEITPUNKT)
    expect(freihand?.typ).toBe('Ink')
    expect(freihand?.striche).toEqual([[10, 10, 50, 60]])
    expect(freihand?.strichstaerke).toBe(2)
  })

  // Ein Pfad genau auf der Kante waere sonst zur Haelfte ausserhalb seines
  // eigenen /Rect.
  it('legt die halbe Strichstaerke als Rand um das Rechteck', () => {
    const freihand = erzeugeFreihand(
      1,
      [
        { x: 10, y: 10 },
        { x: 50, y: 60 }
      ],
      VORGABEN
    )
    expect(freihand?.rect).toEqual([9, 9, 51, 61])
  })

  it('verwirft einen Zug aus einem einzigen Punkt', () => {
    expect(erzeugeFreihand(1, [{ x: 1, y: 1 }], VORGABEN)).toBeNull()
    expect(erzeugeFreihand(1, [], VORGABEN)).toBeNull()
  })
})

describe('verschiebe', () => {
  const markierung = erzeugeMarkup(
    'Highlight',
    1,
    [70, 782, 340, 782, 70, 752, 340, 752],
    VORGABEN
  ) as Annotation

  // Bliebe eines davon liegen, risse die Markierung von ihrem Rechteck ab.
  it('bewegt Rechteck und QuadPoints gemeinsam', () => {
    const bewegt = verschiebe(markierung, 10, -20)
    expect(bewegt.rect).toEqual([80, 732, 350, 762])
    expect(bewegt.quadPoints).toEqual([80, 762, 350, 762, 80, 732, 350, 732])
  })

  it('bewegt auch Freihandzuege', () => {
    const freihand = erzeugeFreihand(
      1,
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ],
      VORGABEN
    ) as Annotation
    expect(verschiebe(freihand, 5, 5).striche).toEqual([[5, 5, 15, 15]])
  })
})

describe('skaliere', () => {
  const markierung = erzeugeMarkup(
    'Highlight',
    1,
    [0, 100, 100, 100, 0, 0, 100, 0],
    VORGABEN
  ) as Annotation

  it('rechnet QuadPoints in das neue Rechteck um', () => {
    const gross = skaliere(markierung, [0, 0, 200, 200])
    expect(gross?.rect).toEqual([0, 0, 200, 200])
    expect(gross?.quadPoints).toEqual([0, 200, 200, 200, 0, 0, 200, 0])
  })

  it('verschiebt und skaliert zugleich', () => {
    const versetzt = skaliere(markierung, [50, 50, 150, 150])
    expect(versetzt?.quadPoints).toEqual([50, 150, 150, 150, 50, 50, 150, 50])
  })

  // Eine auf Breite 0 gezogene Markierung waere unwiederbringlich verloren.
  it('weist entartete Masse ab, statt durch null zu teilen', () => {
    expect(skaliere(markierung, [10, 10, 10, 20])).toBeNull()
    expect(skaliere({ ...markierung, rect: [5, 5, 5, 5] }, [0, 0, 10, 10])).toBeNull()
  })
})

describe('aendere', () => {
  it('uebernimmt das Feld und fuehrt das Aenderungsdatum nach', () => {
    const notiz = erzeugeNotiz(1, { x: 0, y: 100 }, VORGABEN, new Date(Date.UTC(2020, 0, 1)))
    const geaendert = aendere(notiz, { inhalt: 'Rueckfrage' }, ZEITPUNKT)
    expect(geaendert.inhalt).toBe('Rueckfrage')
    expect(geaendert.erstellt).toBe('D:20200101000000Z')
    expect(geaendert.geaendert).toBe('D:20260908143000Z')
  })
})
