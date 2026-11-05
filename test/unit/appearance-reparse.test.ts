import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFStream,
  PDFString
} from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation, AnnotationsTyp } from '../../src/shared/annotations'
import { BILD_NAME, GEMALTE_TYPEN, SCHRIFT_NAME } from '../../src/main/erscheinungsbild'
import { alsPngUrl, kleinesPng } from '../helpers/png'

/**
 * **Exit-Kriterium 3a von S2.3b**, plattformunabhaengig und damit die Stufe,
 * die die Aussage traegt: erzeugen → speichern → **neu einlesen** → nachsehen,
 * dass jede Annotation ein `/AP` mit einem nicht leeren `/N`-Stream hat und
 * dessen `/BBox` das `/Rect` abdeckt.
 *
 * Das ist die Gegenmassnahme zu R1 in ihrer pruefbaren Form. Die zweite Stufe
 * — sieht ein fremder Betrachter es wirklich? — laeuft in
 * `test/e2e/appearance.chrome.spec.ts`.
 *
 * `speichern.ts` zieht `electron` wegen der Dialoge herein; hier laeuft nur
 * `wendeAenderungenAn`, also genuegt eine leere Attrappe.
 */
vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() }
}))

const { wendeAenderungenAn, zerlegeBildUrl, MAX_BILD_BYTES } =
  await import('../../src/main/speichern')

const FIXTURE = resolve('test/fixtures/annotated.pdf')
let quelle: Uint8Array

beforeAll(async () => {
  quelle = new Uint8Array(await readFile(FIXTURE))
})

function annotation(typ: AnnotationsTyp, nummer: number): Annotation {
  const unten = 600 - nummer * 50
  return {
    id: 'neu-' + String(nummer),
    seite: 1,
    typ,
    subtyp: typ,
    rect: [80, unten, 260, unten + 36],
    // Ein Viereck, das genau im Rect liegt - sonst faende die Markierung nichts.
    quadPoints: [80, unten + 36, 260, unten + 36, 80, unten, 260, unten],
    striche: [[90, unten + 6, 160, unten + 28, 250, unten + 6]],
    farbe: { r: 255, g: 128, b: 0 },
    strichstaerke: 2,
    opazitaet: 0.8,
    autor: 'Testperson',
    inhalt: typ === 'Stamp' ? 'Vertraulich' : 'Anmerkung',
    erstellt: 'D:20260101120000Z',
    geaendert: 'D:20260101120000Z',
    versteckt: false,
    ziel: null,
    roh: null
  }
}

/** Die Annotations-Dictionaries der ersten Seite eines gespeicherten Dokuments. */
async function ausDatei(bytes: Uint8Array): Promise<{ dokument: PDFDocument; liste: PDFDict[] }> {
  const dokument = await PDFDocument.load(bytes)
  const feld = dokument.getPage(0).node.Annots()
  const treffer: PDFDict[] = []
  if (feld !== undefined) {
    for (let i = 0; i < feld.size(); i++) treffer.push(feld.lookup(i, PDFDict))
  }
  return { dokument, liste: treffer }
}

function zahlenAus(feld: PDFArray | undefined): number[] {
  if (feld === undefined) return []
  const werte: number[] = []
  for (let i = 0; i < feld.size(); i++) werte.push(Number(String(feld.get(i))))
  return werte
}

const LEER: Aenderungen = { neue: [], geaendert: [], geloescht: [] }

/**
 * Der Bildstempel (S3.2): die grafische Signatur landet als Bild-XObject in
 * den Ressourcen des `/N`-Stroms. Ein fremder Betrachter braucht nur diesen
 * Strom — kein pdf.js, keine Kenntnis des Modells.
 */
describe('Bildstempel im gespeicherten Dokument', () => {
  const signatur = (nummer = 1): Annotation => ({
    ...annotation('Stamp', nummer),
    inhalt: 'Signatur ' + String(nummer),
    bild: alsPngUrl(kleinesPng())
  })

  async function normalstrom(bytes: Uint8Array, inhalt: string): Promise<PDFStream> {
    const { dokument, liste } = await ausDatei(bytes)
    const ap = finde(liste, inhalt)?.lookup(PDFName.of('AP'), PDFDict)
    expect(ap).toBeDefined()
    return dokument.context.lookup(ap?.get(PDFName.of('N')), PDFStream)
  }

  function bildstrom(strom: PDFStream): PDFStream {
    const xobjekte = strom.dict
      .lookup(PDFName.of('Resources'), PDFDict)
      .lookup(PDFName.of('XObject'), PDFDict)
    return strom.dict.context.lookup(xobjekte.get(PDFName.of(BILD_NAME)), PDFStream)
  }

  it('bettet das Bild als Image-XObject ein und zeichnet es im Strom', async () => {
    const neu = signatur()
    const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: [neu] })
    const strom = await normalstrom(bytes, neu.inhalt)
    const bild = bildstrom(strom)
    expect(String(bild.dict.get(PDFName.of('Subtype')))).toBe('/Image')
    expect(String(bild.dict.get(PDFName.of('Width')))).toBe('2')
    expect(String(bild.dict.get(PDFName.of('Height')))).toBe('2')

    const inhalt = Buffer.from(strom.getContents()).toString('latin1')
    expect(inhalt).toContain('/' + BILD_NAME + ' Do')
    // Keine Schrift: der Bildstempel hat keinen Text zu setzen.
    expect(String(strom.dict.get(PDFName.of('Resources')))).not.toContain('/Font')
  })

  it('bettet ein Bild je Stempel ein, nicht eines fuer alle', async () => {
    const zwei = [1, 2].map(signatur)
    const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: zwei })
    const stroeme = await Promise.all(zwei.map(async (a) => normalstrom(bytes, a.inhalt)))
    // Zwei Signaturen koennen verschieden sein; ein geteiltes Objekt waere hier
    // eine Optimierung, die im Fehlerfall das falsche Bild zeigte.
    expect(bildstrom(stroeme[0] as PDFStream)).not.toBe(bildstrom(stroeme[1] as PDFStream))
  })

  it('lehnt alles ab, was kein PNG oder JPEG ist', async () => {
    const svg = { ...signatur(), bild: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
    await expect(wendeAenderungenAn(quelle, { ...LEER, neue: [svg] })).rejects.toThrow(
      /PNG oder JPEG/
    )
    expect(() => zerlegeBildUrl('data:image/png;base64,')).toThrow(/erwartete Format/)
    // Gate Phase 3: der Dateikopf entscheidet, nicht der MIME-Typ. Ein als
    // PNG etikettiertes JPEG wird als JPEG eingebettet; Muell wird abgelehnt,
    // bevor pdf-lib einen unverstaendlichen Fehler daraus macht.
    expect(() => zerlegeBildUrl('data:image/png;base64,AAAA')).toThrow(/weder ein PNG/)
    expect(zerlegeBildUrl('data:image/png;base64,/9j/4AAQ').art).toBe('jpg')
    expect(zerlegeBildUrl(alsPngUrl(kleinesPng())).art).toBe('png')
    expect(() => zerlegeBildUrl('http://example.invalid/bild.png')).toThrow(/erwartete Format/)
    expect(() =>
      zerlegeBildUrl(
        'data:image/jpeg;base64,' + Buffer.alloc(MAX_BILD_BYTES + 1).toString('base64')
      )
    ).toThrow(/zu groß/)
  })
})

/** Die gerade gespeicherte Annotation anhand ihres Inhalts wiederfinden. */
function finde(liste: PDFDict[], inhalt: string): PDFDict | undefined {
  // Dekodieren statt vergleichen: seit Gate Phase 2 (H1) schreibt paperlane
  // Hex-Strings, und deren Serialisierung enthaelt den Klartext nicht.
  return liste.find((dict) => {
    const wert = dict.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)
    return wert !== undefined && wert.decodeText().includes(inhalt)
  })
}

describe('Round-Trip fuer jeden gezeichneten Typ', () => {
  it.each(GEMALTE_TYPEN)(
    '%s traegt nach dem Speichern ein /AP mit nicht leerem /N-Stream',
    async (typ) => {
      const neu = annotation(typ, 1)
      const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: [neu] })
      const { dokument, liste } = await ausDatei(bytes)

      const unsere = finde(liste, neu.inhalt)
      expect(unsere, 'Die gespeicherte Annotation wurde nicht wiedergefunden').toBeDefined()

      const ap = unsere?.lookup(PDFName.of('AP'), PDFDict)
      expect(ap, 'Ohne /AP ist die Anmerkung in fremden Betrachtern unsichtbar').toBeDefined()

      const stream = dokument.context.lookup(ap?.get(PDFName.of('N')), PDFStream)
      expect(stream).toBeInstanceOf(PDFStream)
      expect(stream.getContents().length).toBeGreaterThan(0)
    }
  )

  /**
   * `/BBox` muss das `/Rect` abdecken, sonst wird ein Teil des Bildes
   * abgeschnitten — oder, bei einer zu grossen `/BBox`, alles verkleinert.
   * Hier sind beide gleich; das ist die Entscheidung aus erscheinungsbild.ts.
   */
  it.each(GEMALTE_TYPEN)('%s hat eine /BBox, die das /Rect abdeckt', async (typ) => {
    const neu = annotation(typ, 2)
    const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: [neu] })
    const { dokument, liste } = await ausDatei(bytes)
    const unsere = finde(liste, neu.inhalt)
    const ap = unsere?.lookup(PDFName.of('AP'), PDFDict)
    const stream = dokument.context.lookup(ap?.get(PDFName.of('N')), PDFStream)

    const bbox = zahlenAus(stream.dict.lookup(PDFName.of('BBox'), PDFArray))
    const rect = zahlenAus(unsere?.lookup(PDFName.of('Rect'), PDFArray))
    expect(bbox).toHaveLength(4)
    expect(rect).toHaveLength(4)

    const [bx1 = 0, by1 = 0, bx2 = 0, by2 = 0] = bbox
    const [rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0] = rect
    expect(Math.min(bx1, bx2)).toBeLessThanOrEqual(Math.min(rx1, rx2))
    expect(Math.min(by1, by2)).toBeLessThanOrEqual(Math.min(ry1, ry2))
    expect(Math.max(bx1, bx2)).toBeGreaterThanOrEqual(Math.max(rx1, rx2))
    expect(Math.max(by1, by2)).toBeGreaterThanOrEqual(Math.max(ry1, ry2))
  })

  it.each(GEMALTE_TYPEN)('%s ist ein Form-XObject mit Einheitsmatrix', async (typ) => {
    const neu = annotation(typ, 3)
    const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: [neu] })
    const { dokument, liste } = await ausDatei(bytes)
    const stream = dokument.context.lookup(
      finde(liste, neu.inhalt)?.lookup(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N')),
      PDFStream
    )
    expect(String(stream.dict.get(PDFName.of('Subtype')))).toBe('/Form')
    expect(String(stream.dict.get(PDFName.of('Matrix')))).toBe('[ 1 0 0 1 0 0 ]')
  })
})

describe('Ressourcen im gespeicherten Dokument', () => {
  it('gibt einer Markierung den Mischmodus Multiply', async () => {
    const neu = annotation('Highlight', 1)
    const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: [neu] })
    const { dokument, liste } = await ausDatei(bytes)
    const stream = dokument.context.lookup(
      finde(liste, neu.inhalt)?.lookup(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N')),
      PDFStream
    )
    // Ohne Multiply legte sich eine deckende Flaeche ueber den Text.
    expect(String(stream.dict.get(PDFName.of('Resources')))).toContain('/Multiply')
  })

  /**
   * Ueber die Struktur und nicht ueber die Bytes: pdf-lib schreibt
   * Objektstroeme, und darin steht "Helvetica" komprimiert. Ein Bytevergleich
   * faende es in keinem der beiden Faelle und ginge aus dem falschen Grund
   * durch.
   */
  async function schriftverweis(bytes: Uint8Array, inhalt: string): Promise<string | null> {
    const { dokument, liste } = await ausDatei(bytes)
    const stream = dokument.context.lookup(
      finde(liste, inhalt)?.lookup(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N')),
      PDFStream
    )
    const ressourcen = stream.dict.lookup(PDFName.of('Resources'), PDFDict)
    const schriften = ressourcen.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (schriften === undefined) return null
    const verweis = schriften.get(PDFName.of(SCHRIFT_NAME))
    const schrift = dokument.context.lookup(verweis, PDFDict)
    expect(String(schrift.get(PDFName.of('BaseFont')))).toBe('/Helvetica')
    return String(verweis)
  }

  /**
   * Eine eingebettete Schrift vergroessert jede gespeicherte Datei. Wer nur
   * markiert, soll das nicht bezahlen.
   */
  it('bettet nur dann eine Schrift ein, wenn ein Stempel dabei ist', async () => {
    const ohneStempel = await wendeAenderungenAn(quelle, {
      ...LEER,
      neue: [annotation('Highlight', 1)]
    })
    const mitStempel = await wendeAenderungenAn(quelle, { ...LEER, neue: [annotation('Stamp', 1)] })
    expect(await schriftverweis(ohneStempel, 'Anmerkung')).toBeNull()
    expect(await schriftverweis(mitStempel, 'Vertraulich')).not.toBeNull()
  })

  it('bettet die Schrift auch bei mehreren Stempeln nur einmal ein', async () => {
    const drei = [1, 2, 3].map((nummer) => ({
      ...annotation('Stamp', nummer),
      inhalt: 'Stempel ' + String(nummer)
    }))
    const bytes = await wendeAenderungenAn(quelle, { ...LEER, neue: drei })

    const verweise = await Promise.all(
      drei.map(async (eintrag) => schriftverweis(bytes, eintrag.inhalt))
    )
    expect(verweise[0]).not.toBeNull()
    // Alle drei zeigen auf dasselbe Schriftobjekt. Einmal je Stempel
    // einzubetten blaehte das Dokument mit jeder Anmerkung weiter auf.
    expect(new Set(verweise).size).toBe(1)
  })
})

describe('Umgang mit einem vorhandenen Erscheinungsbild', () => {
  /** Haengt eine Annotation mit eigenem /AP an die erste Seite. */
  async function mitFremdemBild(
    subtyp: string,
    inhalt: string,
    stromtext: string
  ): Promise<{ bytes: Uint8Array; kennung: string }> {
    const dokument = await PDFDocument.load(quelle)
    const eigenerStrom = dokument.context.register(
      dokument.context.stream(stromtext, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 10, 10]
      })
    )
    const verweis = dokument.context.register(
      dokument.context.obj({
        Type: 'Annot',
        Subtype: subtyp,
        Rect: [80, 600, 260, 640],
        Contents: inhalt,
        AP: dokument.context.obj({ N: eigenerStrom })
      })
    )
    const seite = dokument.getPage(0).node
    if (seite.Annots() === undefined) seite.set(PDFName.of('Annots'), dokument.context.obj([]))
    seite.Annots()?.push(verweis)
    return { bytes: await dokument.save(), kennung: String(verweis.objectNumber) + 'R' }
  }

  async function stromNach(bytes: Uint8Array, inhalt: string): Promise<string> {
    const { dokument, liste } = await ausDatei(bytes)
    const stream = dokument.context.lookup(
      finde(liste, inhalt)?.lookup(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N')),
      PDFStream
    )
    return Buffer.from(stream.getContents()).toString('latin1')
  }

  /**
   * Ein fremder Stempel kann ein eingescanntes Firmenzeichen tragen. Es durch
   * unseren gestrichelten Rahmen zu ersetzen waere Datenverlust an einer
   * Stelle, an der wir nicht wissen, was wir wegnehmen.
   */
  it('laesst das Bild eines fremden Stempels stehen', async () => {
    const { bytes, kennung } = await mitFremdemBild('Stamp', 'fremd', '% fremdes Firmenzeichen')
    const geaendert: Annotation = { ...annotation('Stamp', 1), id: kennung, inhalt: 'fremd' }
    const nachher = await wendeAenderungenAn(bytes, { ...LEER, geaendert: [geaendert] })
    expect(await stromNach(nachher, 'fremd')).toContain('Firmenzeichen')
  })

  /**
   * Bei Typen, deren Aussehen sich vollstaendig aus den gefuehrten Feldern
   * ergibt, gibt es nichts zu verlieren — dort wird neu gezeichnet, sonst
   * bliebe eine umgefaerbte Markierung in fremden Betrachtern alt.
   */
  it('zeichnet eine geaenderte Markierung neu', async () => {
    const { bytes, kennung } = await mitFremdemBild('Highlight', 'markiert', '% altes Bild')
    const geaendert: Annotation = {
      ...annotation('Highlight', 1),
      id: kennung,
      inhalt: 'markiert'
    }
    const nachher = await wendeAenderungenAn(bytes, { ...LEER, geaendert: [geaendert] })
    const strom = await stromNach(nachher, 'markiert')
    expect(strom).not.toContain('altes Bild')
    expect(strom).toContain('re f')
  })
})
