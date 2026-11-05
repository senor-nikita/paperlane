// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { STANDARD_DRUCKOPTIONEN, pruefeDruckOptionen } from '../../src/shared/druck'
import {
  baueDruckvorlage,
  entferneSkripte,
  gewaehlteSeiten,
  zaehleAnmerkungen
} from '../../src/main/druck'

/**
 * Die Druckvorlage (S4.3): Seitenauswahl, Ausrichtung, "An Seite anpassen",
 * Anmerkungen an/aus, und - der Kern von ADR 0003 - keine Skripte fuer den
 * Chromium-Betrachter.
 */
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve('test/fixtures', name)))

/** Text einer Seite ueber pdf.js, wie das Exit-Kriterium es verlangt. */
async function seitentext(bytes: Uint8Array, seite: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const auftrag = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await auftrag.promise
  try {
    const inhalt = await (await doc.getPage(seite)).getTextContent()
    return inhalt.items
      .map((eintrag) => ('str' in eintrag ? eintrag.str : ''))
      .join(' ')
      .trim()
  } finally {
    await auftrag.destroy()
  }
}

describe('gewaehlteSeiten', () => {
  it('loest Bereiche in eine sortierte Seitenmenge auf', () => {
    expect(gewaehlteSeiten('alle', 3)).toEqual([1, 2, 3])
    expect(
      gewaehlteSeiten(
        [
          [4, 5],
          [1, 2],
          [2, 2]
        ],
        6
      )
    ).toEqual([1, 2, 4, 5])
  })
})

describe('baueDruckvorlage', () => {
  it('haelt Seitenzahl und Text - das Exit-Kriterium an large-500', async () => {
    const vorlage = await baueDruckvorlage(fixture('large-500.pdf'), STANDARD_DRUCKOPTIONEN)
    expect(vorlage.seiten).toBe(500)
    for (const seite of [1, 250, 500]) {
      expect(await seitentext(vorlage.bytes, seite)).toContain('Seite ' + String(seite))
    }
  }, 60000)

  it('nimmt nur die gewaehlten Seiten und raeumt verwaiste Felder auf', async () => {
    const vorlage = await baueDruckvorlage(fixture('annotated.pdf'), {
      ...STANDARD_DRUCKOPTIONEN,
      seiten: [[2, 2]]
    })
    expect(vorlage.seiten).toBe(1)
    const formular = await baueDruckvorlage(fixture('acroform.pdf'), {
      ...STANDARD_DRUCKOPTIONEN,
      seiten: [[1, 1]]
    })
    const doc = await PDFDocument.load(formular.bytes)
    expect(doc.getForm().getFields().length).toBeGreaterThan(0)
  })

  it('richtet ueber /Rotate aus und laesst die Anmerkungen an der Seite', async () => {
    const quer = await baueDruckvorlage(fixture('annotated.pdf'), {
      ...STANDARD_DRUCKOPTIONEN,
      ausrichtung: 'quer',
      anpassen: false
    })
    const doc = await PDFDocument.load(quer.bytes)
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
    // Hochkant auf einer Hochkantseite: nichts zu tun.
    const hoch = await baueDruckvorlage(fixture('annotated.pdf'), {
      ...STANDARD_DRUCKOPTIONEN,
      ausrichtung: 'hochkant',
      anpassen: false
    })
    expect((await PDFDocument.load(hoch.bytes)).getPage(0).getRotation().angle).toBe(0)
  })

  it('passt abweichende Seiten auf das Blatt der ersten an und zentriert sie', async () => {
    // Ein Dokument mit A4 und einer halb so grossen zweiten Seite.
    const quelle = await PDFDocument.create()
    quelle.addPage([595, 842]).drawText('Eins', { x: 50, y: 750 })
    quelle.addPage([200, 500]).drawText('Zwei', { x: 20, y: 400 })
    const vorlage = await baueDruckvorlage(await quelle.save(), STANDARD_DRUCKOPTIONEN)
    const doc = await PDFDocument.load(vorlage.bytes)
    const zweite = doc.getPage(1)
    const box = zweite.getMediaBox()
    // Das Blatt hat die Masse der ersten Seite ...
    expect([box.width, box.height]).toEqual([595, 842])
    // ... und der Ursprung liegt so, dass der auf 842/500 skalierte Inhalt
    // (336,8 x 842) mittig sitzt.
    expect(box.x).toBeCloseTo(-(595 - 336.8) / 2, 1)
    expect(box.y).toBeCloseTo(0, 1)
    expect(await seitentext(vorlage.bytes, 2)).toBe('Zwei')
  })

  it('laesst ohne "Kommentare mitdrucken" nur die Formularfelder stehen', async () => {
    const ohne = await baueDruckvorlage(fixture('annotated.pdf'), {
      ...STANDARD_DRUCKOPTIONEN,
      kommentare: false
    })
    expect(zaehleAnmerkungen(await PDFDocument.load(ohne.bytes))).toBe(0)
    const mit = await baueDruckvorlage(fixture('annotated.pdf'), STANDARD_DRUCKOPTIONEN)
    expect(zaehleAnmerkungen(await PDFDocument.load(mit.bytes))).toBeGreaterThan(0)
    const formular = await baueDruckvorlage(fixture('acroform.pdf'), {
      ...STANDARD_DRUCKOPTIONEN,
      kommentare: false
    })
    expect((await PDFDocument.load(formular.bytes)).getForm().getFields().length).toBeGreaterThan(0)
  })

  it('lehnt leere und unmoegliche Auswahlen ab', async () => {
    await expect(
      baueDruckvorlage(fixture('annotated.pdf'), { ...STANDARD_DRUCKOPTIONEN, seiten: [] })
    ).rejects.toThrow(/Keine Seite/)
    await expect(
      baueDruckvorlage(fixture('annotated.pdf'), { ...STANDARD_DRUCKOPTIONEN, seiten: [[3, 3]] })
    ).rejects.toThrow(/ausserhalb/)
  })
})

describe('entferneSkripte', () => {
  it('nimmt dem eingebetteten JavaScript OpenAction und Namensbaum', async () => {
    const doc = await PDFDocument.load(fixture('js-embedded.pdf'))
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(true)
    const entfernt = entferneSkripte(doc)
    expect(entfernt).toBeGreaterThanOrEqual(2)
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(false)
    const namen = doc.catalog.lookup(PDFName.of('Names'))
    expect(namen instanceof PDFDict && namen.has(PDFName.of('JavaScript'))).toBe(false)
    // Ein zweiter Lauf findet nichts mehr; die Vorlage ist skriptfrei.
    expect(entferneSkripte(doc)).toBe(0)
    const vorlage = await baueDruckvorlage(fixture('js-embedded.pdf'), STANDARD_DRUCKOPTIONEN)
    expect(entferneSkripte(await PDFDocument.load(vorlage.bytes))).toBe(0)
  })
})

describe('pruefeDruckOptionen', () => {
  it('nimmt nur vollstaendige Optionen an', () => {
    expect(pruefeDruckOptionen(STANDARD_DRUCKOPTIONEN)).toEqual(STANDARD_DRUCKOPTIONEN)
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, ausrichtung: 'schief' })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, anpassen: 'ja' })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: 3 })).toBeNull()
    expect(pruefeDruckOptionen(null)).toBeNull()
  })

  it('prueft die Form jedes Bereichs, nicht nur das Array', () => {
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: [] })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: ['1-3'] })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: [[1]] })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: [[0, 2]] })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: [[3, 1]] })).toBeNull()
    expect(pruefeDruckOptionen({ ...STANDARD_DRUCKOPTIONEN, seiten: [[1.5, 2]] })).toBeNull()
    expect(
      pruefeDruckOptionen({
        ...STANDARD_DRUCKOPTIONEN,
        seiten: [
          [1, 3],
          [5, 5]
        ]
      })
    ).toEqual({
      ...STANDARD_DRUCKOPTIONEN,
      seiten: [
        [1, 3],
        [5, 5]
      ]
    })
  })
})
