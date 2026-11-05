import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  PDFArray,
  PDFCheckBox,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFObjectParser,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField
} from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { erzeugeFdf, sammleFeldwerte } from '../../src/main/fdf'

/**
 * Formulardaten speichern (S3.2).
 *
 * Drei Aussagen, alle ueber den Reparse: (1) eingetragene Werte stehen nach
 * dem Speichern in der Datei, (2) Flachlegen laesst keine Felder zurueck,
 * (3) das FDF hat die Struktur aus PDF 32000-1, Abschnitt 12.7.7.
 *
 * Zur dritten: auf diesem Rechner gibt es kein eigenstaendiges FDF-Werkzeug
 * (qpdf, pdftk, mutool fehlen), und pdf-libs `PDFDocument.load` verlangt
 * einen `%PDF-`-Kopf. Gelesen wird deshalb mit pdf-libs **Objektparser** -
 * ein fremder, spezifikationstreuer Parser fuer die PDF-Objektsyntax, der die
 * Struktur der Datei ohne Wohlwollen zerlegt.
 */
vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() }
}))

const { wendeAenderungenAn, wendeFormularwerteAn } = await import('../../src/main/speichern')

let quelle: Uint8Array
const NICHTS = { neue: [], geaendert: [], geloescht: [] }

beforeAll(async () => {
  quelle = new Uint8Array(await readFile(resolve('test/fixtures/acroform.pdf')))
})

describe('wendeFormularwerteAn', () => {
  it('traegt jede Feldart ein und liefert sie beim Reparse zurueck', async () => {
    const bytes = await wendeAenderungenAn(quelle, NICHTS, {
      formularwerte: {
        'person.name': 'Max Muster',
        zustimmung: true,
        anrede: 'herr',
        land: ['Schweiz'],
        sprachen: ['Deutsch', 'Franzoesisch'],
        notiz: 'Zeile eins\nZeile zwei'
      }
    })
    const form = (await PDFDocument.load(bytes)).getForm()
    expect(form.getTextField('person.name').getText()).toBe('Max Muster')
    expect(form.getCheckBox('zustimmung').isChecked()).toBe(true)
    expect(form.getRadioGroup('anrede').getSelected()).toBe('herr')
    expect(form.getDropdown('land').getSelected()).toEqual(['Schweiz'])
    expect(form.getOptionList('sprachen').getSelected()).toEqual(['Deutsch', 'Franzoesisch'])
    expect(form.getTextField('notiz').getText()).toBe('Zeile eins\nZeile zwei')
  })

  it('setzt Kontrollkaestchen und Gruppe wieder auf Off', async () => {
    const angekreuzt = await wendeAenderungenAn(quelle, NICHTS, {
      formularwerte: { zustimmung: true, anrede: 'frau' }
    })
    const bytes = await wendeAenderungenAn(angekreuzt, NICHTS, {
      formularwerte: { zustimmung: false, anrede: 'Off' }
    })
    const form = (await PDFDocument.load(bytes)).getForm()
    expect(form.getCheckBox('zustimmung').isChecked()).toBe(false)
    expect(form.getRadioGroup('anrede').getSelected()).toBeUndefined()
  })

  it('laesst ein schreibgeschuetztes Feld in Ruhe', async () => {
    const bytes = await wendeAenderungenAn(quelle, NICHTS, {
      formularwerte: { kennung: 'geaendert' }
    })
    expect((await PDFDocument.load(bytes)).getForm().getTextField('kennung').getText()).toBe(
      'K-2026'
    )
  })

  /** Still ueberspringen hiesse "Gespeichert" lesen und einen Wert verlieren. */
  it('wirft bei einem unbekannten Feldnamen', async () => {
    const dokument = await PDFDocument.load(quelle)
    expect(() => wendeFormularwerteAn(dokument, { gibtEsNicht: 'x' })).toThrow(/Unbekanntes/)
  })

  it('haelt Klammern und Umlaute in Feldwerten (H1 gilt auch hier)', async () => {
    const text = 'Klammer ) zu, Umlaute äöü'
    const bytes = await wendeAenderungenAn(quelle, NICHTS, {
      formularwerte: { 'person.name': text }
    })
    expect((await PDFDocument.load(bytes)).getForm().getTextField('person.name').getText()).toBe(
      text
    )
  })

  it('schreibt ohne Werte nichts um', async () => {
    const dokument = await PDFDocument.load(quelle)
    expect(wendeFormularwerteAn(dokument, {})).toEqual([])
  })
})

describe('Flachlegen', () => {
  /** Exit-Kriterium (Aufgabe 2): danach ist die Datei kein Formular mehr. */
  it('laesst keine Felder zurueck, aber die Werte auf der Seite', async () => {
    const bytes = await wendeAenderungenAn(quelle, NICHTS, {
      formularwerte: { 'person.name': 'Max Muster' },
      flachlegen: true
    })
    const dokument = await PDFDocument.load(bytes)
    expect(dokument.getForm().getFields()).toHaveLength(0)
    // Der Seiteninhalt traegt jetzt, was vorher im Feld stand: die
    // Appearance-Streams sind in die Seite gewandert, die Annotationen weg.
    expect(dokument.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
  })
})

/** Liest das erste Objekt einer FDF-Datei mit pdf-libs Objektparser. */
function leseFdf(bytes: Uint8Array): { kopf: string; wurzel: PDFDict; trailer: string } {
  const text = new TextDecoder('latin1').decode(bytes)
  const kopf = text.split('\n')[0] ?? ''
  const anfang = text.indexOf('1 0 obj') + '1 0 obj'.length
  const ende = text.indexOf('endobj')
  const koerper = text.slice(anfang, ende)
  const parser = PDFObjectParser.forBytes(new TextEncoder().encode(koerper), PDFContext.create())
  const objekt = parser.parseObject()
  if (!(objekt instanceof PDFDict)) throw new Error('Wurzel ist kein Dictionary')
  const trailer = text.slice(text.indexOf('trailer'))
  return { kopf, wurzel: objekt, trailer }
}

function textVon(objekt: unknown): string {
  if (objekt instanceof PDFHexString || objekt instanceof PDFString) return objekt.decodeText()
  throw new Error('Kein String: ' + String(objekt))
}

/** Sucht ein Feld im /Kids-Baum ueber seinen vollstaendigen Namen. */
function feldImBaum(felder: PDFArray, voll: string): PDFDict | null {
  const [erster, ...rest] = voll.split('.')
  for (let i = 0; i < felder.size(); i++) {
    const eintrag = felder.lookup(i, PDFDict)
    if (textVon(eintrag.get(PDFName.of('T'))) !== erster) continue
    if (rest.length === 0) return eintrag
    const kinder = eintrag.lookupMaybe(PDFName.of('Kids'), PDFArray)
    return kinder === undefined ? null : feldImBaum(kinder, rest.join('.'))
  }
  return null
}

describe('FDF-Export', () => {
  it('sammelt alle Felder des Dokuments, ueberlagert von den Aenderungen', async () => {
    const dokument = await PDFDocument.load(quelle)
    const felder = sammleFeldwerte(dokument, { 'person.name': 'Max Muster', zustimmung: true })
    const namen = felder.map((feld) => feld.name)
    // Aus dem Dokument, nicht aus dem Renderer: auch die ungeaenderten.
    expect(namen).toEqual(
      expect.arrayContaining(['person.name', 'zustimmung', 'anrede', 'land', 'kennung', 'sprachen'])
    )
  })

  /** Exit-Kriterium (Aufgabe 3): die Struktur nach der Spezifikation. */
  it('schreibt eine FDF-Datei nach PDF 32000-1, 12.7.7', async () => {
    const dokument = await PDFDocument.load(quelle)
    const bytes = erzeugeFdf(
      sammleFeldwerte(dokument, {
        'person.name': 'Max Muster',
        zustimmung: true,
        anrede: 'frau',
        land: ['Schweiz'],
        sprachen: ['Deutsch', 'Englisch']
      }),
      'acroform.pdf'
    )
    const { kopf, wurzel, trailer } = leseFdf(bytes)

    expect(kopf).toBe('%FDF-1.2')
    expect(trailer).toContain('/Root 1 0 R')
    expect(trailer.trimEnd().endsWith('%%EOF')).toBe(true)

    const fdf = wurzel.lookup(PDFName.of('FDF'), PDFDict)
    expect(textVon(fdf.get(PDFName.of('F')))).toBe('acroform.pdf')
    const felder = fdf.lookup(PDFName.of('Fields'), PDFArray)

    // Hierarchie ueber /Kids mit Teilnamen - nicht ein /T mit Punkt.
    const person = feldImBaum(felder, 'person')
    expect(person).not.toBeNull()
    expect(person?.get(PDFName.of('V'))).toBeUndefined()
    const name = feldImBaum(felder, 'person.name')
    expect(name).not.toBeNull()
    expect(textVon(name?.get(PDFName.of('V')))).toBe('Max Muster')

    // Kontrollkaestchen und Gruppe als Name, nicht als String.
    expect(String(feldImBaum(felder, 'zustimmung')?.get(PDFName.of('V')))).toBe('/Yes')
    expect(String(feldImBaum(felder, 'anrede')?.get(PDFName.of('V')))).toBe('/frau')

    // Einfachauswahl als String, Mehrfachauswahl als Feld.
    expect(textVon(feldImBaum(felder, 'land')?.get(PDFName.of('V')))).toBe('Schweiz')
    const sprachen = feldImBaum(felder, 'sprachen')?.lookup(PDFName.of('V'), PDFArray)
    expect(sprachen?.size()).toBe(2)
    expect(textVon(sprachen?.lookup(0))).toBe('Deutsch')
  })

  it('schreibt ungeaenderte Werte aus dem Dokument', async () => {
    const dokument = await PDFDocument.load(quelle)
    const { wurzel } = leseFdf(erzeugeFdf(sammleFeldwerte(dokument, {}), 'acroform.pdf'))
    const felder = wurzel.lookup(PDFName.of('FDF'), PDFDict).lookup(PDFName.of('Fields'), PDFArray)
    expect(textVon(feldImBaum(felder, 'person.name')?.get(PDFName.of('V')))).toBe('Erika Muster')
    expect(textVon(feldImBaum(felder, 'kennung')?.get(PDFName.of('V')))).toBe('K-2026')
    expect(String(feldImBaum(felder, 'zustimmung')?.get(PDFName.of('V')))).toBe('/Off')
    expect(String(feldImBaum(felder, 'anrede')?.get(PDFName.of('V')))).toBe('/Off')
  })

  it('maskiert nichts von Hand: Klammern und Umlaute ueberleben als Hex-String', async () => {
    const dokument = await PDFDocument.load(quelle)
    const text = 'Klammer ) zu, Umlaute äöü'
    const { wurzel } = leseFdf(
      erzeugeFdf(sammleFeldwerte(dokument, { 'person.name': text }), 'a).pdf')
    )
    const fdf = wurzel.lookup(PDFName.of('FDF'), PDFDict)
    expect(textVon(fdf.get(PDFName.of('F')))).toBe('a).pdf')
    const felder = fdf.lookup(PDFName.of('Fields'), PDFArray)
    expect(textVon(feldImBaum(felder, 'person.name')?.get(PDFName.of('V')))).toBe(text)
  })

  it('kennt die Feldklassen, die pdf-lib liefert', async () => {
    // Absicherung des Tests selbst: sollten sich die Klassen aendern, sagt
    // dieser Fall es, statt dass `sammleFeldwerte` still Felder verliert.
    const form = (await PDFDocument.load(quelle)).getForm()
    expect(form.getField('person.name')).toBeInstanceOf(PDFTextField)
    expect(form.getField('zustimmung')).toBeInstanceOf(PDFCheckBox)
    expect(form.getField('anrede')).toBeInstanceOf(PDFRadioGroup)
    expect(form.getField('land')).toBeInstanceOf(PDFDropdown)
    expect(form.getField('sprachen')).toBeInstanceOf(PDFOptionList)
  })
})
