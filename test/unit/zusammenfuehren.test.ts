import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, PDFName } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  einzelseiten,
  fuehreZusammen,
  pruefeBereiche,
  teile,
  teilname
} from '../../src/main/zusammenfuehren'

/**
 * Zusammenfuehren und Teilen (S4.2a), electron-freier Kern.
 *
 * Die Exit-Kriterien des Schritts: richtige Seitenzahl und -reihenfolge,
 * definiertes Verhalten bei kollidierenden Feldnamen, die erwarteten Teile.
 */
let annotiert: Uint8Array
let formular: Uint8Array
let einseitig: Uint8Array

beforeAll(async () => {
  annotiert = new Uint8Array(await readFile(resolve('test/fixtures/annotated.pdf')))
  formular = new Uint8Array(await readFile(resolve('test/fixtures/acroform.pdf')))
  einseitig = new Uint8Array(await readFile(resolve('test/fixtures/single-page.pdf')))
})

describe('fuehreZusammen', () => {
  it('haengt die Seiten in der genannten Reihenfolge aneinander', async () => {
    const ergebnis = await fuehreZusammen([annotiert, einseitig, formular])
    expect(ergebnis.seiten).toBe(2 + 1 + 1)
    const doc = await PDFDocument.load(ergebnis.bytes)
    expect(doc.getPageCount()).toBe(4)
    // Die Anmerkungen von annotated.pdf Seite 1 stehen auf Seite 1, die
    // Formularwidgets auf Seite 4 - die Reihenfolge ist die der Quellen.
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
    expect(doc.getPage(3).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
    expect(doc.getPage(2).node.Annots()?.size() ?? 0).toBe(0)
  })

  it('behaelt unterschiedliche Seitengroessen', async () => {
    const a4 = await PDFDocument.create()
    a4.addPage([595, 842])
    const quer = await PDFDocument.create()
    quer.addPage([1000, 300])
    const ergebnis = await fuehreZusammen([await a4.save(), await quer.save()])
    const doc = await PDFDocument.load(ergebnis.bytes)
    expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 })
    expect(doc.getPage(1).getSize()).toEqual({ width: 1000, height: 300 })
  })

  /**
   * pdf-lib traegt kopierte Widgets nicht ins AcroForm ein. Ohne die
   * Nacharbeit haette das Ergebnis Widgets, aber keine Felder.
   */
  it('uebernimmt die Formularfelder einer Quelle ins Ziel', async () => {
    const felderQuelle = (await PDFDocument.load(formular)).getForm().getFields().length
    const ergebnis = await fuehreZusammen([einseitig, formular])
    const doc = await PDFDocument.load(ergebnis.bytes)
    const felder = doc.getForm().getFields()
    expect(felder).toHaveLength(felderQuelle)
    expect(felder.map((f) => f.getName())).toContain('person.name')
    expect(ergebnis.umbenannt).toEqual([])
    // Der Speicherpfad aus S3.2 findet das Feld ueber den Namen.
    expect(doc.getForm().getTextField('person.name')).toBeDefined()
  })

  it('benennt kollidierende Feldnamen mit Suffix um und behaelt beide Werte', async () => {
    const ausgefuellt = await PDFDocument.load(formular)
    ausgefuellt.getForm().getTextField('person.name').setText('Zweite Kopie')
    const ergebnis = await fuehreZusammen([formular, await ausgefuellt.save()])
    const doc = await PDFDocument.load(ergebnis.bytes)
    const namen = doc
      .getForm()
      .getFields()
      .map((f) => f.getName())
    // Wurzel "person" kollidiert -> "person_2"; die Kinder haengen darunter.
    expect(namen).toContain('person.name')
    expect(namen).toContain('person_2.name')
    expect(ergebnis.umbenannt).toContainEqual({ von: 'person', nach: 'person_2' })
    expect(
      ergebnis.umbenannt.some((u) => u.von === 'zustimmung' && u.nach === 'zustimmung_2')
    ).toBe(true)
    expect(doc.getForm().getTextField('person_2.name').getText()).toBe('Zweite Kopie')
    // Dreimal dasselbe Formular: _2 und _3.
    const dreimal = await fuehreZusammen([formular, formular, formular])
    const namen3 = (await PDFDocument.load(dreimal.bytes))
      .getForm()
      .getFields()
      .map((f) => f.getName())
    expect(namen3).toContain('zustimmung_2')
    expect(namen3).toContain('zustimmung_3')
  })

  it('legt kein AcroForm an, wenn keine Quelle Felder hat', async () => {
    const ergebnis = await fuehreZusammen([einseitig, annotiert])
    const doc = await PDFDocument.load(ergebnis.bytes)
    expect(doc.catalog.has(PDFName.of('AcroForm'))).toBe(false)
  })

  it('lehnt eine leere Liste ab', async () => {
    await expect(fuehreZusammen([])).rejects.toThrow(/Keine Dokumente/)
  })
})

describe('Teilen', () => {
  it('liefert je Bereich eine Datei mit den richtigen Seiten', async () => {
    const teile3 = await teile(annotiert, [
      [1, 1],
      [2, 2],
      [1, 2]
    ])
    expect(teile3).toHaveLength(3)
    const [erste, zweite, beide] = await Promise.all(teile3.map((t) => PDFDocument.load(t)))
    expect(erste?.getPageCount()).toBe(1)
    expect(zweite?.getPageCount()).toBe(1)
    expect(beide?.getPageCount()).toBe(2)
    // Die Anmerkungen von Seite 1 sind im ersten Teil, nicht im zweiten.
    expect(erste?.getPage(0).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
    expect(zweite?.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
  })

  it('behaelt die Formularfelder eines Teils', async () => {
    const [teil] = await teile(formular, [[1, 1]])
    const doc = await PDFDocument.load(teil ?? new Uint8Array())
    expect(doc.getForm().getFields().length).toBeGreaterThan(0)
  })

  it('kennt Einzelseiten und Dateinamen', () => {
    expect(einzelseiten(3)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3]
    ])
    expect(teilname('bericht.pdf', [3, 3])).toBe('bericht-S3.pdf')
    expect(teilname('Bericht.PDF', [3, 5])).toBe('Bericht-S3-S5.pdf')
  })

  it('prueft Bereiche gegen die Seitenzahl', () => {
    expect(
      pruefeBereiche(
        [
          [1, 2],
          [2, 3]
        ],
        3
      )
    ).toEqual([
      [1, 2],
      [2, 3]
    ])
    expect(pruefeBereiche([], 3)).toBeNull()
    expect(pruefeBereiche([[0, 1]], 3)).toBeNull()
    expect(pruefeBereiche([[2, 1]], 3)).toBeNull()
    expect(pruefeBereiche([[1, 4]], 3)).toBeNull()
    expect(pruefeBereiche([[1, 1.5]], 3)).toBeNull()
    expect(pruefeBereiche([['1', 2]], 3)).toBeNull()
    expect(pruefeBereiche([[1]], 3)).toBeNull()
    expect(pruefeBereiche('1-3', 3)).toBeNull()
  })
})
