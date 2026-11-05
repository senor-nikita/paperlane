import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'

/**
 * S6.5, Aufgabe 5: Flachlegen schreibt `/FreeText` fest in den Seiteninhalt.
 *
 * `speichern.ts` zieht `electron` wegen der Dialoge herein; hier laeuft nur
 * `wendeAenderungenAn`, also genuegt eine leere Attrappe (wie in den
 * benachbarten Tests appearance-reparse.test.ts und formular-speichern.test.ts).
 */
vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() }
}))

const { wendeAenderungenAn } = await import('../../src/main/speichern')

let quelle: Uint8Array
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')

beforeAll(async () => {
  quelle = new Uint8Array(await readFile(resolve('test/fixtures/single-page.pdf')))
  // Vorladen statt je Test dynamisch zu importieren (Umgebungsvorgabe).
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
})

/** Position (e, f der Textmatrix) des ersten Vorkommens von `text` auf der Seite. */
async function textPosition(bytes: Uint8Array, gesucht: string): Promise<{ x: number; y: number }> {
  const auftrag = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await auftrag.promise
  try {
    const inhalt = await (await doc.getPage(1)).getTextContent()
    const treffer = inhalt.items.find(
      (eintrag) => 'str' in eintrag && eintrag.str.includes(gesucht)
    )
    if (treffer === undefined || !('transform' in treffer)) {
      throw new Error('Text "' + gesucht + '" nicht gefunden.')
    }
    const [, , , , x, y] = treffer.transform as number[]
    return { x: x ?? NaN, y: y ?? NaN }
  } finally {
    await auftrag.destroy()
  }
}

function freitext(): Annotation {
  return {
    id: 'neu-1',
    seite: 1,
    typ: 'FreeText',
    subtyp: 'FreeText',
    rect: [80, 600, 300, 640],
    quadPoints: null,
    striche: null,
    farbe: { r: 0, g: 0, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: 'Flachgelegter Text',
    erstellt: 'D:20260101120000Z',
    geaendert: 'D:20260101120000Z',
    versteckt: false,
    ziel: null,
    roh: null,
    schriftFamilie: 'Helvetica',
    schriftGroesse: 14,
    ausrichtung: 'links'
  }
}

const AENDERUNGEN: Aenderungen = { neue: [freitext()], geaendert: [], geloescht: [] }

function annotsAufSeite(dokument: PDFDocument): PDFDict[] {
  const feld = dokument.getPage(0).node.Annots()
  if (feld === undefined) return []
  const treffer: PDFDict[] = []
  for (let i = 0; i < feld.size(); i++) treffer.push(feld.lookup(i, PDFDict))
  return treffer
}

describe('Flachlegen (S3.2) und /FreeText', () => {
  it('behaelt die Annotation, wenn nicht flachgelegt wird', async () => {
    const bytes = await wendeAenderungenAn(quelle, AENDERUNGEN, {})
    const dokument = await PDFDocument.load(bytes)
    const annots = annotsAufSeite(dokument)
    expect(
      annots.some(
        (dict) =>
          dict.get(PDFName.of('Subtype')) instanceof PDFName &&
          (dict.get(PDFName.of('Subtype')) as PDFName).decodeText() === 'FreeText'
      )
    ).toBe(true)
  })

  it('entfernt die Annotation aus /Annots und schreibt ihr Aussehen in den Seiteninhalt', async () => {
    const bytes = await wendeAenderungenAn(quelle, AENDERUNGEN, { flachlegen: true })
    const dokument = await PDFDocument.load(bytes)
    const annots = annotsAufSeite(dokument)
    expect(
      annots.some(
        (dict) =>
          dict.get(PDFName.of('Subtype')) instanceof PDFName &&
          (dict.get(PDFName.of('Subtype')) as PDFName).decodeText() === 'FreeText'
      )
    ).toBe(false)

    // Der Seiteninhalt zeichnet jetzt ein Form-XObject: Beleg dafuer, dass das
    // /AP der Annotation (echte Textoperatoren) in die Seite uebernommen
    // wurde und nicht nur die Annotation verschwunden ist.
    const seite = dokument.getPage(0)
    const resourcen = seite.node.Resources()
    expect(String(resourcen?.lookup(PDFName.of('XObject')))).toContain('FreitextFlach')
  })

  it('lehnt beim Speichern Zeichen ab, die die Schrift nicht darstellen kann', async () => {
    const mitFremdemZeichen: Aenderungen = {
      neue: [{ ...freitext(), inhalt: 'Test 中 Zeichen' }],
      geaendert: [],
      geloescht: []
    }
    await expect(wendeAenderungenAn(quelle, mitFremdemZeichen, {})).rejects.toThrow(/Zeichen/)
  })

  /**
   * Review M3: eine **fremde** FreeText-Annotation (nicht von uns erzeugt)
   * hat haeufig `/BBox` ungleich `/Rect` und/oder eine Verschiebungsmatrix.
   * Ein blosses `Do` ohne die Abbildung nach PDF 32000-1, 12.5.5 zeichnet den
   * Text dann an der BBox-Position statt am Rect - meist unten links auf der
   * Seite. Der Test baut eine solche Annotation von Hand (BBox `[0 0 50 20]`,
   * Rect doppelt so gross an anderer Stelle) und prueft die **Position** des
   * flachgelegten Texts ueber pdf.js, nicht nur, dass ein XObject entsteht.
   */
  async function mitFremderFreitext(options: {
    bbox: [number, number, number, number]
    rect: [number, number, number, number]
    matrix?: [number, number, number, number, number, number]
    flags?: number
    /** Textposition im Koordinatensystem der BBox. Default: (5, 5) ab BBox-Ursprung. */
    textPosition?: [number, number]
  }): Promise<Uint8Array> {
    const dokument = await PDFDocument.load(quelle)
    const seite = dokument.getPage(0)
    const schrift = await dokument.embedFont(StandardFonts.Helvetica)
    const [tx, ty] = options.textPosition ?? [options.bbox[0] + 5, options.bbox[1] + 5]
    const inhalt = 'BT /F1 12 Tf ' + String(tx) + ' ' + String(ty) + ' Td (X) Tj ET'
    const formStrom = dokument.context.stream(inhalt, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: options.bbox,
      Matrix: options.matrix ?? [1, 0, 0, 1, 0, 0],
      Resources: dokument.context.obj({ Font: dokument.context.obj({ F1: schrift.ref }) })
    })
    const formRef = dokument.context.register(formStrom)
    const apDict = dokument.context.obj({ N: formRef })
    const annotDict = dokument.context.obj({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: options.rect,
      AP: apDict,
      ...(options.flags === undefined ? {} : { F: options.flags })
    })
    const annotRef = dokument.context.register(annotDict)
    seite.node.addAnnot(annotRef)
    return dokument.save()
  }

  it('bildet BBox und Rect einer fremden FreeText nach 12.5.5 ab, statt roh zu zeichnen', async () => {
    // BBox 50x20 an [0 0 50 20], Rect 100x40 an [200 300 300 340]:
    // Skalierung 2x in beiden Achsen, Verschiebung um (200, 300). Der Text
    // steht im Formular-Koordinatensystem bei (5, 5) -> erwartet (210, 310).
    const mitFremd = await mitFremderFreitext({ bbox: [0, 0, 50, 20], rect: [200, 300, 300, 340] })
    const flach = await wendeAenderungenAn(
      mitFremd,
      { neue: [], geaendert: [], geloescht: [] },
      {
        flachlegen: true
      }
    )
    const position = await textPosition(flach, 'X')
    expect(position.x).toBeCloseTo(210, 0)
    expect(position.y).toBeCloseTo(310, 0)
  })

  it('laesst eine eigene Annotation (BBox = Rect, Einheitsmatrix) unveraendert an ihrer Stelle', async () => {
    const eigen = await mitFremderFreitext({ bbox: [80, 600, 220, 640], rect: [80, 600, 220, 640] })
    const flach = await wendeAenderungenAn(
      eigen,
      { neue: [], geaendert: [], geloescht: [] },
      {
        flachlegen: true
      }
    )
    const position = await textPosition(flach, 'X')
    // Formular-Koordinate (5, 5) plus Rect-Ursprung (80, 600), Skalierung 1.
    expect(position.x).toBeCloseTo(85, 0)
    expect(position.y).toBeCloseTo(605, 0)
  })

  it('brennt eine versteckte FreeText (Flag Hidden) nicht in den Seiteninhalt ein', async () => {
    const versteckt = await mitFremderFreitext({
      bbox: [0, 0, 50, 20],
      rect: [200, 300, 300, 340],
      flags: 2
    })
    const flach = await wendeAenderungenAn(
      versteckt,
      { neue: [], geaendert: [], geloescht: [] },
      {
        flachlegen: true
      }
    )
    await expect(textPosition(flach, 'X')).rejects.toThrow(/nicht gefunden/)
    // Die Annotation ist trotzdem weg - sie war ohnehin nie sichtbar.
    const dokument = await PDFDocument.load(flach)
    expect(annotsAufSeite(dokument)).toHaveLength(0)
  })
})
