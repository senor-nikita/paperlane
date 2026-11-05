import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'

/**
 * Der Schreibpfad im Main-Prozess (S2.3a).
 *
 * Die Ersatzregel aus §2.3 des Plans verlangt fuer jeden Main-Pfad mindestens
 * einen Test; `src/main/**` ist von der Coverage ausgenommen, nicht von der
 * Pruefung. Hier laufen die Teile, die ohne Fenster auskommen — die Dialoge
 * sind modal und gehoeren nicht in einen automatischen Lauf.
 *
 * Zwei Exit-Kriterien des Schritts haengen an diesem Test: die gespeicherte
 * Datei ist ein gueltiges PDF (Reparse), und ein abgebrochenes Schreiben
 * laesst die Originaldatei unversehrt.
 */
vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() }
}))

const { TEMP_ENDUNG, felder, hatSignatur, objektnummer, speichereAtomar, wendeAenderungenAn } =
  await import('../../src/main/speichern')

const FIXTURE = resolve('test/fixtures/annotated.pdf')

let verzeichnis: string
let quelle: Uint8Array

beforeAll(async () => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-speichern-'))
  quelle = new Uint8Array(await readFile(FIXTURE))
})

function annotation(teile: Partial<Annotation> & Pick<Annotation, 'id' | 'seite'>): Annotation {
  return {
    typ: 'Highlight',
    subtyp: 'Highlight',
    rect: [70, 752, 340, 782],
    quadPoints: null,
    striche: null,
    farbe: { r: 255, g: 212, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: '',
    erstellt: 'D:20260101120000Z',
    geaendert: 'D:20260101120000Z',
    versteckt: false,
    ziel: null,
    roh: null,
    ...teile
  }
}

const NICHTS: Aenderungen = { neue: [], geaendert: [], geloescht: [] }

/** Die Annotations-Dictionaries einer Seite eines gespeicherten Dokuments. */
async function annotationenVon(bytes: Uint8Array, seite = 1): Promise<PDFDict[]> {
  const dokument = await PDFDocument.load(bytes)
  const liste = dokument.getPage(seite - 1).node.Annots()
  if (liste === undefined) return []
  const treffer: PDFDict[] = []
  for (let stelle = 0; stelle < liste.size(); stelle++) treffer.push(liste.lookup(stelle, PDFDict))
  return treffer
}

describe('hatSignatur', () => {
  it('findet das Bytemuster /ByteRange', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /ByteRange [0 100 200 300] >>')
    expect(hatSignatur(bytes)).toBe(true)
  })

  it('meldet nichts fuer ein Dokument ohne Signatur', () => {
    expect(hatSignatur(quelle)).toBe(false)
  })

  it('laeuft ueber das Ende hinaus nicht ins Leere', () => {
    // Ein abgeschnittenes Muster am Dateiende darf nicht als Treffer gelten.
    expect(hatSignatur(new TextEncoder().encode('nur /ByteRan'))).toBe(false)
  })

  it('kommt mit einer leeren Datei zurecht', () => {
    expect(hatSignatur(new Uint8Array())).toBe(false)
  })
})

describe('objektnummer', () => {
  it.each([
    ['10R', 10],
    ['1R', 1],
    ['1234R', 1234]
  ])('liest %s als %i', (kennung, erwartet) => {
    expect(objektnummer(kennung)).toBe(erwartet)
  })

  // Selbsterzeugte Kennungen ("neu-1") haben kein Gegenstueck im Dokument.
  it.each([['neu-1'], ['R10'], [''], ['abc']])('meldet fuer %o keine Nummer', (kennung) => {
    expect(objektnummer(kennung)).toBeNull()
  })
})

describe('felder', () => {
  it('fuehrt die Pflichtfelder einer Annotation', async () => {
    const dokument = await PDFDocument.load(quelle)
    const werte = felder(annotation({ id: 'neu-1', seite: 1 }), dokument.context)

    expect(werte['Type']).toBe(PDFName.of('Annot'))
    expect(werte['Subtype']).toBe(PDFName.of('Highlight'))
    // Bit 3 (Print): ohne das fehlt die Anmerkung im Ausdruck.
    expect((werte['F'] as PDFNumber).asNumber()).toBe(4)
    expect((werte['CA'] as PDFNumber).asNumber()).toBe(1)
    // Hex-String seit Gate Phase 2 (H1): `decodeText` liefert den Klartext,
    // gleich ob Literal- oder Hex-String.
    expect((werte['T'] as PDFHexString).decodeText()).toContain('Testperson')
  })

  it('laesst weg, was das Dokument nicht nennt', async () => {
    const dokument = await PDFDocument.load(quelle)
    const werte = felder(
      annotation({ id: 'neu-1', seite: 1, farbe: null, erstellt: null, geaendert: null }),
      dokument.context
    )
    expect(werte['C']).toBeUndefined()
    expect(werte['M']).toBeUndefined()
    expect(werte['CreationDate']).toBeUndefined()
  })

  it('gibt einer Textnotiz ein Symbol', async () => {
    const dokument = await PDFDocument.load(quelle)
    const werte = felder(
      annotation({ id: 'neu-1', seite: 1, typ: 'Text', subtyp: 'Text' }),
      dokument.context
    )
    // Ohne /Name zeichnen fremde Betrachter gar nichts.
    expect(werte['Name']).toBe(PDFName.of('Comment'))
  })

  it('traegt Freihandzuege und Strichstaerke ein', async () => {
    const dokument = await PDFDocument.load(quelle)
    const werte = felder(
      annotation({
        id: 'neu-1',
        seite: 1,
        typ: 'Ink',
        subtyp: 'Ink',
        striche: [[10, 10, 20, 20]],
        strichstaerke: 3
      }),
      dokument.context
    )
    expect(werte['InkList']).toBeDefined()
    expect(werte['BS']).toBeDefined()
  })
})

describe('wendeAenderungenAn', () => {
  /** Exit-Kriterium: die gespeicherte Datei ist ein gueltiges PDF. */
  it('liefert ohne Aenderungen ein reparsbares Dokument', async () => {
    const bytes = await wendeAenderungenAn(quelle, NICHTS)
    const wieder = await PDFDocument.load(bytes)
    const original = await PDFDocument.load(quelle)
    expect(wieder.getPageCount()).toBe(original.getPageCount())
  })

  it('haengt eine neue Annotation an die Seite', async () => {
    const vorher = (await annotationenVon(quelle)).length
    const bytes = await wendeAenderungenAn(quelle, {
      ...NICHTS,
      neue: [annotation({ id: 'neu-1', seite: 1, inhalt: 'frisch' })]
    })
    const nachher = await annotationenVon(bytes)
    expect(nachher).toHaveLength(vorher + 1)
    const letzte = nachher[nachher.length - 1]
    expect(letzte?.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText()).toBe(
      'frisch'
    )
  })

  it('entfernt eine Annotation an ihrer Objektnummer', async () => {
    const vorhandene = await annotationenVon(quelle)
    expect(vorhandene.length).toBeGreaterThan(0)
    const dokument = await PDFDocument.load(quelle)
    const liste = dokument.getPage(0).node.Annots()
    const nummer = /^(\d+)/.exec(String(liste?.get(0)))?.[1]
    expect(nummer).toBeDefined()

    const bytes = await wendeAenderungenAn(quelle, { ...NICHTS, geloescht: [nummer + 'R'] })
    expect(await annotationenVon(bytes)).toHaveLength(vorhandene.length - 1)
  })

  /**
   * Die Zusage aus D7: nur die gefuehrten Felder werden ueberschrieben, alles
   * Uebrige bleibt verbatim stehen. Geprueft an einem Feld, das diese
   * Anwendung nicht kennt.
   */
  it('laesst unbekannte Felder einer geaenderten Annotation stehen', async () => {
    const dokument = await PDFDocument.load(quelle)
    const liste = dokument.getPage(0).node.Annots()
    const dict = liste?.lookup(0, PDFDict)
    expect(dict).toBeDefined()
    dict?.set(PDFName.of('PaperlaneFremdfeld'), PDFString.of('bitte stehen lassen'))
    const kennung = /^(\d+)/.exec(String(liste?.get(0)))?.[1]
    const mitFremdfeld = await dokument.save()

    const bytes = await wendeAenderungenAn(mitFremdfeld, {
      ...NICHTS,
      geaendert: [annotation({ id: kennung + 'R', seite: 1, inhalt: 'geaendert' })]
    })

    const nachher = await annotationenVon(bytes)
    const treffer = nachher.find(
      (eintrag) =>
        eintrag.get(PDFName.of('PaperlaneFremdfeld')) !== undefined &&
        eintrag.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText() === 'geaendert'
    )
    expect(treffer).toBeDefined()
  })

  /**
   * Gate Phase 2, H1 — der Fall, der durch 889 Tests gerutscht war, weil kein
   * Fixture-Text eine Klammer enthielt.
   *
   * pdf-lib schreibt `PDFString` roh, ohne Klammern oder Backslashes zu
   * maskieren. Eine schliessende Klammer in einer Notiz beendete den
   * Literal-String vorzeitig, und pdf-libs eigener Parser meldete beim
   * Reparse "Trying to parse invalid object" - die Annotation war weg.
   * Gemessen, bevor die Kodierung auf Hex-Strings umgestellt wurde.
   */
  it('ueberlebt Klammern, Backslashes und Umlaute in Texten (H1)', async () => {
    const inhalt = 'Klammer ) zu, Backslash \, Umlaute äöü, Apostroph ’'
    const autor = "O'Brien (IT)"
    const bytes = await wendeAenderungenAn(quelle, {
      ...NICHTS,
      neue: [annotation({ id: 'neu-1', seite: 1, inhalt, autor })]
    })

    // Erstens: das Dokument ist noch ein Dokument.
    const wieder = await PDFDocument.load(bytes)
    const liste = await annotationenVon(bytes)
    const letzte = liste[liste.length - 1]
    expect(letzte).toBeDefined()

    // Zweitens: der Text kommt unversehrt zurueck.
    const text = (name: string): string =>
      letzte?.lookup(PDFName.of(name), PDFString, PDFHexString).decodeText() ?? ''
    expect(text('Contents')).toBe(inhalt)
    expect(text('T')).toBe(autor)
    expect(wieder.getPageCount()).toBeGreaterThan(0)
  })

  it('ignoriert Kennungen ohne Objektnummer', async () => {
    const vorher = (await annotationenVon(quelle)).length
    const bytes = await wendeAenderungenAn(quelle, {
      ...NICHTS,
      geloescht: ['neu-1'],
      geaendert: [annotation({ id: 'neu-2', seite: 1 })]
    })
    expect(await annotationenVon(bytes)).toHaveLength(vorher)
  })
})

describe('speichereAtomar', () => {
  it('schreibt die Datei und laesst keine temporaere zurueck', async () => {
    const ziel = join(verzeichnis, 'ergebnis.pdf')
    const bytes = await wendeAenderungenAn(quelle, NICHTS)
    await speichereAtomar(ziel, bytes)

    expect(existsSync(ziel)).toBe(true)
    expect(existsSync(ziel + TEMP_ENDUNG)).toBe(false)
    // Reparse: was auf der Platte liegt, ist ein gueltiges PDF.
    await expect(PDFDocument.load(new Uint8Array(readFileSync(ziel)))).resolves.toBeDefined()
  })

  /**
   * Exit-Kriterium: die Originaldatei bleibt bei einem abgebrochenen Schreiben
   * intakt. Das ist die Aussage des Verfahrens und nicht die eines
   * Glueckstreffers — geschrieben wird in eine Nachbardatei, und erst das
   * Umbenennen macht das Ergebnis sichtbar. Ein Abbruch vor dem Umbenennen
   * kann die Originaldatei deshalb gar nicht erreichen.
   */
  it('laesst die Originaldatei unberuehrt, solange nicht umbenannt wurde', () => {
    const original = join(verzeichnis, 'unversehrt.pdf')
    writeFileSync(original, quelle)
    // Was ein Prozessabbruch mitten im Schreiben hinterlaesst: eine halbe
    // temporaere Nachbardatei.
    writeFileSync(original + TEMP_ENDUNG, '%PDF-1.7\nhalb geschrieben')

    expect(readFileSync(original)).toEqual(Buffer.from(quelle))
  })

  it('raeumt die temporaere Datei weg, wenn das Umbenennen scheitert', async () => {
    // Ein nicht leeres Verzeichnis als Ziel: `writeFile` auf den Nachbarn
    // gelingt, das Umbenennen darueber scheitert.
    const ziel = join(verzeichnis, 'sperrig.pdf')
    mkdirSync(ziel)
    writeFileSync(join(ziel, 'inhalt.txt'), 'belegt')

    await expect(speichereAtomar(ziel, new Uint8Array([1, 2, 3]))).rejects.toThrow()
    expect(existsSync(join(dirname(ziel), basename(ziel) + TEMP_ENDUNG))).toBe(false)
    expect(existsSync(ziel)).toBe(true)
  })
})
