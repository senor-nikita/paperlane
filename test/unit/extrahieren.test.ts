import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  extrahiere,
  extraktname,
  fuehreZusammen,
  pruefeSeitenliste
} from '../../src/main/zusammenfuehren'

/**
 * Seiten extrahieren (S6.2, Aufgabe 3), electron-freier Kern.
 *
 * Ausgangsdokument: annotated.pdf (2 Seiten, Anmerkungen auf Seite 1),
 * single-page.pdf und acroform.pdf (1 Seite mit Formular) - vier Seiten,
 * deren Inhalt sich an Anmerkungen und Feldern unterscheiden laesst.
 */
let vierSeiten: Uint8Array

beforeAll(async () => {
  const lies = async (name: string): Promise<Uint8Array> =>
    new Uint8Array(await readFile(resolve('test/fixtures', name)))
  const ergebnis = await fuehreZusammen([
    await lies('annotated.pdf'),
    await lies('single-page.pdf'),
    await lies('acroform.pdf')
  ])
  vierSeiten = ergebnis.bytes
})

async function annotsJeSeite(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((seite) => seite.node.Annots()?.size() ?? 0)
}

describe('extrahiere', () => {
  it('kopiert die genannten Seiten in der genannten Reihenfolge', async () => {
    const vorher = await annotsJeSeite(vierSeiten)
    const ergebnis = await extrahiere(vierSeiten, [4, 1])
    const nachher = await annotsJeSeite(ergebnis)
    expect(nachher).toEqual([vorher[3], vorher[0]])
  })

  it('liefert einen Bereich wie 1-3 vollstaendig', async () => {
    const doc = await PDFDocument.load(await extrahiere(vierSeiten, [1, 2, 3]))
    expect(doc.getPageCount()).toBe(3)
  })

  it('liefert eine einzelne Seite', async () => {
    const doc = await PDFDocument.load(await extrahiere(vierSeiten, [4]))
    expect(doc.getPageCount()).toBe(1)
  })

  it('traegt die Formularfelder der extrahierten Seite ins Formular ein', async () => {
    const quelle = await PDFDocument.load(vierSeiten)
    const felder = quelle.getForm().getFields().length
    expect(felder).toBeGreaterThan(0)
    const doc = await PDFDocument.load(await extrahiere(vierSeiten, [4]))
    expect(doc.getForm().getFields().length).toBe(felder)
  })

  it('legt ohne Felder kein Formular an', async () => {
    const doc = await PDFDocument.load(await extrahiere(vierSeiten, [3]))
    expect(doc.getForm().getFields()).toHaveLength(0)
  })
})

describe('pruefeSeitenliste', () => {
  it('nimmt gueltige Seiten in ihrer Reihenfolge', () => {
    expect(pruefeSeitenliste([3, 1], 4)).toEqual([3, 1])
  })

  it.each([
    ['leer', []],
    ['keine Liste', '1-3'],
    ['Null', [0]],
    ['zu gross', [5]],
    ['Bruch', [1.5]],
    ['Text', ['1']],
    ['doppelt', [2, 2]]
  ])('lehnt ab: %s', (_fall, eingabe) => {
    expect(pruefeSeitenliste(eingabe, 4)).toBeNull()
  })
})

describe('extraktname', () => {
  it('benennt einen zusammenhaengenden Bereich wie das Teilen', () => {
    expect(extraktname('bericht.pdf', [1, 2, 3])).toBe('bericht-S1-S3.pdf')
  })

  it('benennt eine einzelne Seite wie das Teilen', () => {
    expect(extraktname('bericht.pdf', [4])).toBe('bericht-S4.pdf')
  })

  it('benennt eine verstreute Auswahl als Auszug', () => {
    expect(extraktname('Bericht.PDF', [1, 4])).toBe('Bericht-Auszug.pdf')
  })

  it('benennt eine umgekehrte Folge als Auszug', () => {
    expect(extraktname('bericht.pdf', [3, 2])).toBe('bericht-Auszug.pdf')
  })
})
