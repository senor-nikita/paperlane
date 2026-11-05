import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  A4_PT,
  LETTER_PT,
  MAX_BILD_KANTE_PX,
  MAX_BILD_MEGAPIXEL,
  MAX_BILDER_GESAMT_BYTES,
  baueBilderPdf,
  berechneSeitenlayout,
  bildformat,
  jpegPixelmasse,
  mmZuPt,
  pngPixelmasse,
  pruefeBildPdfAuftrag,
  pruefePfadListe,
  pxZuPt
} from '../../src/main/bilderpdf'

/**
 * Bilder zu PDF (S6.4), electron-freier Kern.
 *
 * Deckt die Kombinatorik aus Aufgabe 3 ab (Seitengroesse × Ausrichtung × Rand,
 * Einpassen), die Formaterkennung aus Aufgabe 2 und die Ablehnungen aus
 * Aufgabe 6 - alles ohne pdf-lib, bis auf den PDF-Bau selbst.
 */

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82
])

/**
 * Ein plausibler BMP-Kopf (Security M1): vollstaendiger 14-Byte
 * BITMAPFILEHEADER, gefolgt von einer BITMAPINFOHEADER-Groesse (40 = die
 * gebraeuchlichste). Blosse zwei Bytes "BM" reichen seit dem Haertungsfix
 * nicht mehr - eine umbenannte Fremddatei begann zufaellig oft genauso.
 */
const BMP_KOPF = new Uint8Array([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 40, 0, 0, 0])

describe('bildformat', () => {
  it('erkennt PNG, JPEG, GIF, BMP, WebP am Kopf', () => {
    expect(bildformat(PNG_1X1)).toBe('png')
    expect(bildformat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(bildformat(new TextEncoder().encode('GIF89a'))).toBe('gif')
    expect(bildformat(new TextEncoder().encode('GIF87a'))).toBe('gif')
    expect(bildformat(BMP_KOPF)).toBe('bmp')
    // Security M1: nur "BM" ohne plausiblen Infoheader ist kein BMP mehr.
    expect(bildformat(new Uint8Array([0x42, 0x4d, 0, 0, 0, 0]))).toBeNull()
    const webp = new Uint8Array(16)
    webp.set(new TextEncoder().encode('RIFF'), 0)
    webp.set(new TextEncoder().encode('WEBP'), 8)
    expect(bildformat(webp)).toBe('webp')
  })

  it('lehnt Unbekanntes und eine umbenannte Datei ab', () => {
    expect(bildformat(new TextEncoder().encode('nicht ein bild'))).toBeNull()
    expect(bildformat(new Uint8Array(0))).toBeNull()
  })
})

describe('pruefePfadListe', () => {
  it('akzeptiert ein nichtleeres Array aus Zeichenketten', () => {
    expect(pruefePfadListe(['a.png', 'b.jpg'])).toEqual(['a.png', 'b.jpg'])
  })
  it('lehnt leeres Array, Nicht-Array und leere Eintraege ab', () => {
    expect(pruefePfadListe([])).toBeNull()
    expect(pruefePfadListe('a.png')).toBeNull()
    expect(pruefePfadListe(null)).toBeNull()
    expect(pruefePfadListe(['a.png', ''])).toBeNull()
    expect(pruefePfadListe(['a.png', 42])).toBeNull()
  })
})

describe('berechneSeitenlayout', () => {
  it('"bild": die Seite ist genau das Bild bei 96 dpi, kein Rand', () => {
    const layout = berechneSeitenlayout({ breitePx: 960, hoehePx: 480 }, 'bild', 'auto', 10)
    expect(layout.seite).toEqual({ breite: pxZuPt(960), hoehe: pxZuPt(480) })
    expect(layout.bild).toEqual({ x: 0, y: 0, breite: pxZuPt(960), hoehe: pxZuPt(480) })
  })

  it('A4 hochkant: ein sehr schmales Bild wird an der Hoehe eingepasst', () => {
    // Seitenverhaeltnis 1:4 ist schmaler als A4 (0,707) - die Hoehe ist hier
    // der Flaschenhals, nicht die Breite.
    const layout = berechneSeitenlayout({ breitePx: 100, hoehePx: 400 }, 'a4', 'hoch', 0)
    expect(layout.seite).toEqual({ breite: A4_PT.breite, hoehe: A4_PT.hoehe })
    expect(layout.bild.hoehe).toBeCloseTo(A4_PT.hoehe, 5)
    expect(layout.bild.breite).toBeCloseTo(A4_PT.hoehe / 4, 5)
    expect(layout.bild.y).toBeCloseTo(0, 5)
    // Zentriert in der Breite: gleicher Abstand links und rechts.
    expect(layout.bild.x).toBeCloseTo(A4_PT.breite - layout.bild.x - layout.bild.breite, 5)
  })

  it('A4 hochkant: ein Bild nahe am Seitenverhaeltnis wird an der Breite eingepasst', () => {
    const layout = berechneSeitenlayout({ breitePx: 100, hoehePx: 120 }, 'a4', 'hoch', 0)
    expect(layout.bild.breite).toBeCloseTo(A4_PT.breite, 5)
    expect(layout.bild.hoehe).toBeCloseTo(A4_PT.breite * 1.2, 5)
  })

  it('A4 quer erzwingt Querformat der Seite, unabhaengig vom Bild', () => {
    const layout = berechneSeitenlayout({ breitePx: 100, hoehePx: 400 }, 'a4', 'quer', 0)
    expect(layout.seite.breite).toBeGreaterThan(layout.seite.hoehe)
    expect(layout.seite).toEqual({ breite: A4_PT.hoehe, hoehe: A4_PT.breite })
  })

  it('auto waehlt Querformat fuer ein breiteres-als-hohes Bild', () => {
    const layout = berechneSeitenlayout({ breitePx: 400, hoehePx: 100 }, 'letter', 'auto', 0)
    expect(layout.seite).toEqual({ breite: LETTER_PT.hoehe, hoehe: LETTER_PT.breite })
  })

  it('auto waehlt Hochformat fuer ein hoeheres-als-breites Bild', () => {
    const layout = berechneSeitenlayout({ breitePx: 100, hoehePx: 400 }, 'letter', 'auto', 0)
    expect(layout.seite).toEqual({ breite: LETTER_PT.breite, hoehe: LETTER_PT.hoehe })
  })

  it('Rand verkleinert die verfuegbare Flaeche und zentriert das Bild', () => {
    const ohneRand = berechneSeitenlayout({ breitePx: 100, hoehePx: 100 }, 'a4', 'hoch', 0)
    const mitRand = berechneSeitenlayout({ breitePx: 100, hoehePx: 100 }, 'a4', 'hoch', 20)
    expect(mitRand.bild.breite).toBeLessThan(ohneRand.bild.breite)
    // Zentriert: gleicher Abstand links und rechts.
    const rechterRand = mitRand.seite.breite - mitRand.bild.x - mitRand.bild.breite
    expect(rechterRand).toBeCloseTo(mitRand.bild.x, 5)
  })

  it('ein Rand groesser als die Seite ergibt ein leeres, aber gueltiges Layout', () => {
    const layout = berechneSeitenlayout({ breitePx: 100, hoehePx: 100 }, 'a4', 'hoch', 500)
    expect(layout.bild.breite).toBe(0)
    expect(layout.bild.hoehe).toBe(0)
    expect(Number.isFinite(layout.bild.x)).toBe(true)
  })

  it('lehnt ungueltige Bildabmessungen ab', () => {
    expect(() => berechneSeitenlayout({ breitePx: 0, hoehePx: 10 }, 'bild', 'auto', 0)).toThrow()
    expect(() => berechneSeitenlayout({ breitePx: 10, hoehePx: -1 }, 'a4', 'auto', 0)).toThrow()
  })
})

describe('mmZuPt / pxZuPt', () => {
  it('rechnet in beide Richtungen konsistent um', () => {
    expect(mmZuPt(25.4)).toBeCloseTo(72, 5)
    expect(pxZuPt(96)).toBeCloseTo(72, 5)
  })
})

describe('pruefeBildPdfAuftrag', () => {
  const gueltig = {
    seiten: [{ format: 'png', bytes: PNG_1X1, breitePx: 1, hoehePx: 1 }],
    seitengroesse: 'bild',
    ausrichtung: 'auto',
    randMm: 0,
    vorschlag: 'bilder'
  }

  it('akzeptiert einen wohlgeformten Auftrag', () => {
    expect(pruefeBildPdfAuftrag(gueltig)).not.toBeNull()
  })

  it('lehnt leere Seitenliste, falsche Formate und Groessen ab', () => {
    expect(pruefeBildPdfAuftrag({ ...gueltig, seiten: [] })).toBeNull()
    expect(pruefeBildPdfAuftrag(null)).toBeNull()
    expect(pruefeBildPdfAuftrag('x')).toBeNull()
    expect(
      pruefeBildPdfAuftrag({
        ...gueltig,
        seiten: [{ format: 'jpeg', bytes: PNG_1X1, breitePx: 1, hoehePx: 1 }]
      })
    ).toBeNull()
    expect(
      pruefeBildPdfAuftrag({
        ...gueltig,
        seiten: [{ format: 'png', bytes: PNG_1X1, breitePx: 0, hoehePx: 1 }]
      })
    ).toBeNull()
    expect(pruefeBildPdfAuftrag({ ...gueltig, seitengroesse: 'a5' })).toBeNull()
    expect(pruefeBildPdfAuftrag({ ...gueltig, ausrichtung: 'schief' })).toBeNull()
    expect(pruefeBildPdfAuftrag({ ...gueltig, randMm: -1 })).toBeNull()
    expect(pruefeBildPdfAuftrag({ ...gueltig, vorschlag: '' })).toBeNull()
  })

  it('lehnt eine Gesamtgroesse ueber dem Limit ab', () => {
    const riesig = new Uint8Array(MAX_BILDER_GESAMT_BYTES + 1)
    riesig.set(PNG_1X1, 0)
    expect(
      pruefeBildPdfAuftrag({
        ...gueltig,
        seiten: [{ format: 'png', bytes: riesig, breitePx: 1, hoehePx: 1 }]
      })
    ).toBeNull()
  })

  // Security M2/L4: die behaupteten Masse muessen zum Bildkopf passen, bevor
  // pdf-lib irgendetwas dekodiert - sonst dekodiert der Main ein Bild, dessen
  // wahre Groesse niemand vorher gesehen hat (16384x16384 aus 1 MB PNG).
  it('lehnt behauptete Masse ab, die nicht zum Bildkopf passen', () => {
    expect(
      pruefeBildPdfAuftrag({
        ...gueltig,
        // PNG_1X1 ist tatsaechlich 1x1 - hier wird 2x2 behauptet.
        seiten: [{ format: 'png', bytes: PNG_1X1, breitePx: 2, hoehePx: 2 }]
      })
    ).toBeNull()
  })

  it('lehnt Infinity, NaN und eine Kante ueber dem Limit ab', () => {
    for (const breitePx of [Infinity, NaN, -1, 0, MAX_BILD_KANTE_PX + 1]) {
      expect(
        pruefeBildPdfAuftrag({
          ...gueltig,
          seiten: [{ format: 'png', bytes: PNG_1X1, breitePx, hoehePx: 1 }]
        })
      ).toBeNull()
    }
  })

  it('lehnt ein Bild ueber dem Megapixel-Limit ab, auch unter der Kantengrenze', () => {
    // Kante je unter MAX_BILD_KANTE_PX, Produkt ueber MAX_BILD_MEGAPIXEL.
    const kante = Math.ceil(Math.sqrt(MAX_BILD_MEGAPIXEL)) + 1
    expect(kante).toBeLessThan(MAX_BILD_KANTE_PX)
    // Ein PNG, dessen IHDR genau diese Kante behauptet (Kopf reicht, der Rest
    // des "Bilds" wird nie dekodiert - die Ablehnung kommt vor `embedPng`).
    const png = new Uint8Array(PNG_1X1)
    const setzeU32 = (bytes: Uint8Array, versatz: number, wert: number): void => {
      bytes[versatz] = (wert >>> 24) & 0xff
      bytes[versatz + 1] = (wert >>> 16) & 0xff
      bytes[versatz + 2] = (wert >>> 8) & 0xff
      bytes[versatz + 3] = wert & 0xff
    }
    setzeU32(png, 16, kante)
    setzeU32(png, 20, kante)
    expect(
      pruefeBildPdfAuftrag({
        ...gueltig,
        seiten: [{ format: 'png', bytes: png, breitePx: kante, hoehePx: kante }]
      })
    ).toBeNull()
  })
})

describe('pngPixelmasse und jpegPixelmasse', () => {
  it('liest Breite und Hoehe aus dem IHDR-Chunk eines PNG', () => {
    expect(pngPixelmasse(PNG_1X1)).toEqual({ breite: 1, hoehe: 1 })
  })

  it('liefert null fuer einen zu kurzen oder falschen PNG-Kopf', () => {
    expect(pngPixelmasse(new Uint8Array(10))).toBeNull()
    const kaputt = new Uint8Array(PNG_1X1)
    kaputt[12] = 0
    expect(pngPixelmasse(kaputt)).toBeNull()
  })

  it('liest Breite und Hoehe aus dem SOF0-Marker eines JPEG', () => {
    // SOI, SOF0 (Laenge 8, Praezision 8, Hoehe 300, Breite 200), ein Fuellbyte.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x01, 0x2c, 0x00, 0xc8, 0x00
    ])
    expect(jpegPixelmasse(jpeg)).toEqual({ breite: 200, hoehe: 300 })
  })

  it('liefert null ohne SOI oder ohne SOF-Marker', () => {
    expect(jpegPixelmasse(new Uint8Array([0x00, 0x01]))).toBeNull()
    expect(jpegPixelmasse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })
})

describe('baueBilderPdf', () => {
  it('erzeugt ein PDF mit einer Seite je Bild, in Reihenfolge und Groesse des Auftrags', async () => {
    const auftrag = {
      seiten: [
        { format: 'png' as const, bytes: PNG_1X1, breitePx: 200, hoehePx: 100 },
        { format: 'png' as const, bytes: PNG_1X1, breitePx: 100, hoehePx: 200 }
      ],
      seitengroesse: 'bild' as const,
      ausrichtung: 'auto' as const,
      randMm: 0,
      vorschlag: 'test'
    }
    const bytes = await baueBilderPdf(auftrag)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: pxZuPt(200), height: pxZuPt(100) })
    expect(doc.getPage(1).getSize()).toEqual({ width: pxZuPt(100), height: pxZuPt(200) })
  })

  it('lehnt eine leere Seitenliste ab', async () => {
    await expect(
      baueBilderPdf({
        seiten: [],
        seitengroesse: 'bild',
        ausrichtung: 'auto',
        randMm: 0,
        vorschlag: 'x'
      })
    ).rejects.toThrow()
  })
})
