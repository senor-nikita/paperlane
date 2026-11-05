import { describe, expect, it } from 'vitest'
import { anteilVonOben, beschriftung, istDarstellbar } from '../../src/shared/annotations'
import type { Annotation } from '../../src/shared/annotations'
import {
  findeAnnotationUnter,
  huelleFuer,
  rechteckeFuer,
  wandleAnnotation,
  wandleAnnotationen,
  zeichne
} from '../../src/renderer/src/viewer/annotationen'
import { baueTransformation } from '../../src/renderer/src/viewer/koordinaten'

const A4 = [0, 0, 595, 842] as const
const MATRIX = baueTransformation(A4, 1, 0)

/** Ein Datensatz, wie ihn `getAnnotations` fuer die Fixture `annotated.pdf` liefert. */
const MARKIERUNG = {
  id: '10R',
  subtype: 'Highlight',
  rect: [70, 752, 340, 782],
  quadPoints: Float32Array.from([70, 782, 340, 782, 70, 752, 340, 752]),
  color: Uint8ClampedArray.from([255, 255, 0]),
  opacity: 0.6,
  titleObj: { str: 'Testautor' },
  contentsObj: { str: 'Vorhandene Markierung' },
  creationDate: 'D:20260907120000Z',
  modificationDate: null,
  annotationFlags: 4
}

describe('wandleAnnotation', () => {
  it('uebernimmt die Felder einer Markierung', () => {
    const annotation = wandleAnnotation(MARKIERUNG, 1)
    expect(annotation).toMatchObject({
      id: '10R',
      seite: 1,
      typ: 'Highlight',
      subtyp: 'Highlight',
      rect: [70, 752, 340, 782],
      farbe: { r: 255, g: 255, b: 0 },
      opazitaet: 0.6,
      autor: 'Testautor',
      inhalt: 'Vorhandene Markierung',
      erstellt: 'D:20260907120000Z',
      geaendert: null,
      versteckt: false,
      ziel: null
    })
    expect(annotation?.quadPoints).toEqual([70, 782, 340, 782, 70, 752, 340, 752])
  })

  // Folge von D7: was diese Fassung nicht versteht, darf nicht schon beim
  // Einlesen verloren gehen.
  it('reicht den Ausgangsdatensatz unveraendert durch', () => {
    expect(wandleAnnotation(MARKIERUNG, 1)?.roh).toBe(MARKIERUNG)
  })

  it('sortiert ein verdreht angegebenes Rechteck', () => {
    const annotation = wandleAnnotation({ subtype: 'Square', rect: [340, 782, 70, 752] }, 2)
    expect(annotation?.rect).toEqual([70, 752, 340, 782])
  })

  // Ein unbekannter Subtyp bleibt im Modell, wird aber nicht gezeichnet.
  it('behaelt unbekannte Subtypen als Unbekannt', () => {
    const annotation = wandleAnnotation({ subtype: 'Popup', rect: [0, 0, 10, 10] }, 1)
    expect(annotation?.typ).toBe('Unbekannt')
    expect(annotation?.subtyp).toBe('Popup')
    expect(istDarstellbar(annotation?.typ ?? 'Unbekannt')).toBe(false)
  })

  it.each([
    ['ohne Rechteck', { subtype: 'Highlight' }],
    ['mit zu kurzem Rechteck', { subtype: 'Highlight', rect: [1, 2, 3] }],
    ['mit unbrauchbaren Zahlen', { subtype: 'Highlight', rect: [1, 2, 3, Number.NaN] }],
    ['kein Objekt', 'Highlight'],
    ['null', null]
  ])('verwirft einen Datensatz %s', (_beschreibung, eingabe) => {
    expect(wandleAnnotation(eingabe, 1)).toBeNull()
  })

  it('erkennt die Flags Hidden und NoView', () => {
    expect(wandleAnnotation({ ...MARKIERUNG, annotationFlags: 2 }, 1)?.versteckt).toBe(true)
    expect(wandleAnnotation({ ...MARKIERUNG, annotationFlags: 32 }, 1)?.versteckt).toBe(true)
    expect(wandleAnnotation({ ...MARKIERUNG, annotationFlags: 4 }, 1)?.versteckt).toBe(false)
  })

  it('begrenzt eine unsinnige Opazitaet auf 0..1', () => {
    expect(wandleAnnotation({ ...MARKIERUNG, opacity: 5 }, 1)?.opazitaet).toBe(1)
    expect(wandleAnnotation({ ...MARKIERUNG, opacity: -1 }, 1)?.opazitaet).toBe(0)
    expect(wandleAnnotation({ ...MARKIERUNG, opacity: undefined }, 1)?.opazitaet).toBe(1)
  })

  it('liest Freihandzuege', () => {
    const annotation = wandleAnnotation(
      {
        subtype: 'Ink',
        rect: [10, 10, 100, 100],
        inkLists: [Float32Array.from([10, 10, 50, 60]), [60, 60, 90, 90]]
      },
      3
    )
    expect(annotation?.striche).toEqual([
      [10, 10, 50, 60],
      [60, 60, 90, 90]
    ])
  })
})

describe('wandleAnnotation — Verweise', () => {
  it('erkennt ein internes Ziel', () => {
    const annotation = wandleAnnotation(
      {
        subtype: 'Link',
        rect: [70, 694, 250, 716],
        dest: [{ num: 5, gen: 0 }, 'XYZ', 0, 842, null]
      },
      1
    )
    expect(annotation?.ziel).toEqual({
      art: 'intern',
      ziel: [{ num: 5, gen: 0 }, 'XYZ', 0, 842, null]
    })
  })

  it('erkennt ein benanntes internes Ziel', () => {
    expect(
      wandleAnnotation({ subtype: 'Link', rect: [0, 0, 1, 1], dest: 'kapitel3' }, 1)?.ziel
    ).toEqual({ art: 'intern', ziel: 'kapitel3' })
  })

  it('zieht das interne Ziel einer URL vor', () => {
    const annotation = wandleAnnotation(
      { subtype: 'Link', rect: [0, 0, 1, 1], dest: 'kapitel3', unsafeUrl: 'https://example.org/' },
      1
    )
    expect(annotation?.ziel).toEqual({ art: 'intern', ziel: 'kapitel3' })
  })

  /**
   * `unsafeUrl` ist die Angabe aus dem Dokument, `url` die von pdf.js bereits
   * gefilterte. Gebraucht wird die erste: sonst verschwaende ein `file:`-Ziel
   * lautlos, statt sichtbar abgelehnt zu werden (Exit-Kriterium des Schritts).
   */
  it('nimmt das Ziel aus dem Dokument, nicht die gefilterte Fassung', () => {
    const annotation = wandleAnnotation(
      {
        subtype: 'Link',
        rect: [0, 0, 1, 1],
        unsafeUrl: 'file:///C:/Windows/win.ini',
        url: undefined
      },
      1
    )
    expect(annotation?.ziel).toEqual({ art: 'extern', url: 'file:///C:/Windows/win.ini' })
  })

  it('laesst einen Verweis ohne jedes Ziel leer', () => {
    expect(wandleAnnotation({ subtype: 'Link', rect: [0, 0, 1, 1] }, 1)?.ziel).toBeNull()
  })

  it('gibt Nicht-Verweisen kein Ziel', () => {
    expect(
      wandleAnnotation({ subtype: 'Highlight', rect: [0, 0, 1, 1], dest: 'kapitel3' }, 1)?.ziel
    ).toBeNull()
  })
})

describe('wandleAnnotationen', () => {
  it('uebergeht unbrauchbare Eintraege und behaelt die uebrigen', () => {
    const gewandelt = wandleAnnotationen([MARKIERUNG, null, { subtype: 'Text' }], 1)
    expect(gewandelt).toHaveLength(1)
    expect(gewandelt[0]?.id).toBe('10R')
  })

  // Doppelte React-Schluessel sind der Fehler, der sich am schlechtesten
  // finden laesst.
  it('vergibt eine Kennung, wenn das Dokument keine nennt', () => {
    const gewandelt = wandleAnnotationen(
      [
        { subtype: 'Square', rect: [0, 0, 1, 1] },
        { subtype: 'Square', rect: [2, 2, 3, 3] }
      ],
      4
    )
    expect(gewandelt.map((eintrag) => eintrag.id)).toEqual(['seite4-0', 'seite4-1'])
  })

  it('liefert fuer alles Untaugliche eine leere Liste', () => {
    expect(wandleAnnotationen(null, 1)).toEqual([])
    expect(wandleAnnotationen('Anmerkungen', 1)).toEqual([])
  })
})

describe('rechteckeFuer', () => {
  it('nimmt bei Text-Markup ein Rechteck je Zeile', () => {
    const annotation = wandleAnnotation(
      {
        ...MARKIERUNG,
        quadPoints: Float32Array.from([
          70, 782, 340, 782, 70, 752, 340, 752, 70, 742, 200, 742, 70, 712, 200, 712
        ])
      },
      1
    )
    expect(rechteckeFuer(annotation as Annotation, MATRIX)).toHaveLength(2)
  })

  it('nimmt sonst das Rechteck der Annotation', () => {
    const annotation = wandleAnnotation({ subtype: 'Square', rect: [70, 742, 200, 782] }, 1)
    const rechtecke = rechteckeFuer(annotation as Annotation, MATRIX)
    expect(rechtecke).toHaveLength(1)
    expect(rechtecke[0]?.links).toBeCloseTo(70, 6)
    expect(rechtecke[0]?.oben).toBeCloseTo(60, 6)
  })
})

describe('findeAnnotationUnter', () => {
  const unten = wandleAnnotation({ id: 'u', subtype: 'Link', rect: [10, 700, 200, 750] }, 1)
  const oben = wandleAnnotation({ id: 'o', subtype: 'Link', rect: [100, 710, 300, 740] }, 1)
  const gezeichnet = zeichne([unten as Annotation, oben as Annotation], MATRIX)

  it('waehlt bei Ueberlappung die zuletzt gezeichnete', () => {
    // y = 842 - 720 liegt in beiden Rechtecken.
    expect(findeAnnotationUnter({ x: 150, y: 122 }, gezeichnet)?.id).toBe('o')
  })

  it('findet die untere, wo nur sie liegt', () => {
    expect(findeAnnotationUnter({ x: 50, y: 122 }, gezeichnet)?.id).toBe('u')
  })

  it('liefert null ausserhalb', () => {
    expect(findeAnnotationUnter({ x: 500, y: 500 }, gezeichnet)).toBeNull()
    expect(findeAnnotationUnter({ x: 0, y: 0 }, [])).toBeNull()
  })
})

describe('huelleFuer', () => {
  it('umfasst beide Zeilen einer mehrzeiligen Markierung', () => {
    const annotation = wandleAnnotation(
      {
        ...MARKIERUNG,
        quadPoints: Float32Array.from([
          70, 782, 340, 782, 70, 752, 340, 752, 70, 742, 200, 742, 70, 712, 200, 712
        ])
      },
      1
    )
    expect(huelleFuer(annotation as Annotation, MATRIX)?.hoehe).toBeCloseTo(70, 6)
  })
})

describe('anteilVonOben', () => {
  it('rechnet die Oberkante von unten nach oben um', () => {
    expect(anteilVonOben([70, 752, 340, 782], 842)).toBeCloseTo((842 - 782) / 842, 6)
  })

  it('liefert null ohne brauchbare Seitenhoehe', () => {
    expect(anteilVonOben([0, 0, 1, 1], 0)).toBeNull()
  })

  it('begrenzt auf 0..1, auch wenn das Rechteck ueber die Seite hinausragt', () => {
    expect(anteilVonOben([0, 0, 1, 2000], 842)).toBe(0)
    expect(anteilVonOben([0, -100, 1, -50], 842)).toBe(1)
  })
})

describe('beschriftung', () => {
  const grund = wandleAnnotation(MARKIERUNG, 1) as Annotation

  it('nimmt den Inhalt', () => {
    expect(beschriftung(grund)).toBe('Vorhandene Markierung')
  })

  it('nimmt ersatzweise das Verweisziel', () => {
    expect(
      beschriftung({ ...grund, inhalt: '', ziel: { art: 'extern', url: 'https://example.org/' } })
    ).toBe('https://example.org/')
  })

  it('nimmt sonst den Autor', () => {
    expect(beschriftung({ ...grund, inhalt: '  ' })).toBe('Testautor')
  })

  it('sagt es, wenn gar nichts da ist', () => {
    expect(beschriftung({ ...grund, inhalt: '', autor: '' })).toBe('ohne Inhalt')
  })
})
