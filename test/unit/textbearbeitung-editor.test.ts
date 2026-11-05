// @vitest-environment node
import { readFileSync } from 'node:fs'
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { wendeMutationAn, wendeMutationAnMitBericht } from '../../src/main/mutation'
import { analysiereSeite } from '../../src/main/textbearbeitung/interpreter'
import { glyphenDerZeile, textStimmt } from '../../src/main/textbearbeitung/zuordnung'
import type { TextBericht } from '../../src/shared/mutation'
import type { TextZeile } from '../../src/shared/textzeilen'
import {
  ablehnungsDokument,
  cidDokument,
  formDokument,
  ocrDokument,
  standardDokument
} from '../helpers/textfixtures'
import { findeZeile, pdfjsZeilen } from '../helpers/pdfjs-zeilen'

/**
 * S6.6b: Zeilen loeschen und ersetzen, gegen pdf.js als unabhaengiges Orakel
 * (ADR 0005, Punkt 6): die bearbeitete Zeile steht mit dem neuen Text an
 * derselben Grundlinie und demselben Anfang, jede andere Zeile der Seite ist
 * unveraendert (Text und Position), und geloeschter Text ist aus den
 * Datenstroemen verschwunden - nicht nur verdeckt.
 */

// pdf.js kalt zu laden dauert auf dem CI-Runner laenger als 5 s.
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs')
}, 60000)

async function bearbeite(
  bytes: Uint8Array,
  alt: string,
  neu: string,
  seite = 1
): Promise<{ bytes: Uint8Array; bericht?: TextBericht; zeile: TextZeile }> {
  const zeile = findeZeile(await pdfjsZeilen(bytes, seite), alt)
  const ergebnis = await wendeMutationAnMitBericht(bytes, {
    art: 'textErsetzen',
    seite,
    zeile,
    text: neu
  })
  return { ...ergebnis, zeile }
}

const nah = (a: number, b: number, toleranz: number): boolean => Math.abs(a - b) <= toleranz

/** Das Orakel: alle anderen Zeilen gleich, die bearbeitete neu oder weg. */
async function pruefeRundlauf(
  vorher: Uint8Array,
  nachher: Uint8Array,
  alt: string,
  neu: string,
  seite = 1
): Promise<void> {
  const v = await pdfjsZeilen(vorher, seite)
  const n = await pdfjsZeilen(nachher, seite)
  const bearbeitet = findeZeile(v, alt)
  for (const zeile of v) {
    if (zeile === bearbeitet) continue
    const gleich = n.find(
      (z) =>
        z.text === zeile.text &&
        z.winkel === zeile.winkel &&
        nah(z.grundlinie, zeile.grundlinie, 0.01) &&
        nah(z.von, zeile.von, 0.01) &&
        nah(z.bis, zeile.bis, 0.01)
    )
    expect(gleich, 'unveraendert: ' + zeile.text).toBeDefined()
  }
  if (neu === '') {
    expect(n).toHaveLength(v.length - 1)
    expect(n.map((z) => z.text)).not.toContain(alt)
  } else {
    expect(n).toHaveLength(v.length)
    const ersetzt = findeZeile(n, neu)
    expect(ersetzt.winkel).toBe(bearbeitet.winkel)
    expect(ersetzt.grundlinie).toBeCloseTo(bearbeitet.grundlinie, 1)
    expect(ersetzt.von).toBeCloseTo(bearbeitet.von, 1)
  }
}

/** Alle dekodierten Datenstroeme der Datei als Latin-1-Text. */
async function alleStroeme(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const teile: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        teile.push(Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'))
      } catch {
        teile.push(Buffer.from(obj.contents).toString('latin1'))
      }
    }
  }
  return teile.join('\n')
}

function hex(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex')
}

describe('Ersetzen mit der Originalschrift (Standard-14)', () => {
  const faelle: [string, string][] = [
    ['Rechnung Nr. 2026-041', 'Rechnung Nr. 2026-042'],
    ['Zweite Zeile mit Apostroph', 'Zweite Zeile geaendert'],
    ['Dritte Zeile mit Anfuehrung', 'Dritte Zeile: Größe 10€'],
    ['Kerning und Abstand', 'Kerning weg'],
    ['Spalte links', 'Links'],
    ['Rot mit Abstaenden', 'Rot und neu'],
    ['Skaliert mit cm', 'Skaliert neu'],
    ['Hochgestellt', 'Hoch'],
    ['Gedreht 90 Grad', 'Gedreht neu']
  ]
  for (const [alt, neu] of faelle) {
    it(
      alt + ' -> ' + neu,
      async () => {
        const bytes = await standardDokument()
        const e = await bearbeite(bytes, alt, neu)
        expect(e.bericht).toEqual({ schrift: 'original' })
        await pruefeRundlauf(bytes, e.bytes, alt, neu)
      },
      30000
    )
  }

  it('setzt Farbe und Textzustand der Zeile fort', async () => {
    const bytes = await standardDokument()
    const e = await bearbeite(bytes, 'Rot mit Abstaenden', 'Rot und neu')
    const stroeme = await alleStroeme(e.bytes)
    expect(stroeme).toMatch(
      /q 0\.8 0 0 rg 0 G 1 0 0 1 72 560 cm BT \/F1 12 Tf 1 Tc 3 Tw 90 Tz 0 Ts 0 Tr/
    )
  }, 30000)

  it('laesst die Eingabe unveraendert (Rueckgaengig braucht die alten Bytes)', async () => {
    const bytes = await standardDokument()
    const kopie = bytes.slice()
    await bearbeite(bytes, 'Zeile die bleibt', 'Anders')
    expect(Buffer.from(bytes).equals(Buffer.from(kopie))).toBe(true)
  }, 30000)
})

describe('Loeschen', () => {
  for (const alt of [
    'Erste Zeile im Absatz',
    'Zweite Zeile mit Apostroph',
    'Kerning und Abstand',
    'Spalte rechts',
    'Gedreht 90 Grad'
  ]) {
    it(
      alt,
      async () => {
        const bytes = await standardDokument()
        const e = await bearbeite(bytes, alt, '')
        expect(e.bericht).toEqual({ schrift: 'keine' })
        await pruefeRundlauf(bytes, e.bytes, alt, '')
      },
      30000
    )
  }

  it('entfernt die Bytes wirklich aus der Datei', async () => {
    const bytes = await standardDokument()
    expect(await alleStroeme(bytes)).toContain(hex('Zeile die bleibt'))
    const e = await bearbeite(bytes, 'Zeile die bleibt', '')
    const nachher = await alleStroeme(e.bytes)
    expect(nachher).not.toContain(hex('Zeile'.slice(0, 5) + ' die'))
    expect(nachher).not.toContain(hex('bleibt'))
    // Die Nachbarn stehen noch drin.
    expect(nachher).toContain(hex('Hochgestellt'))
  }, 30000)

  it('Leerzeichen allein gilt als Loeschen', async () => {
    const bytes = await standardDokument()
    const e = await bearbeite(bytes, 'Hochgestellt', '   ')
    expect(e.bericht).toEqual({ schrift: 'keine' })
    await pruefeRundlauf(bytes, e.bytes, 'Hochgestellt', '')
  }, 30000)

  it('Loeschen und Ersetzen hintereinander auf derselben Seite', async () => {
    const bytes = await standardDokument()
    const eins = await bearbeite(bytes, 'Erste Zeile im Absatz', '')
    const zwei = await bearbeite(eins.bytes, 'Rechnung Nr. 2026-041', 'Rechnung neu')
    await pruefeRundlauf(eins.bytes, zwei.bytes, 'Rechnung Nr. 2026-041', 'Rechnung neu')
    const drei = await bearbeite(zwei.bytes, 'Rechnung neu', 'Noch einmal')
    await pruefeRundlauf(zwei.bytes, drei.bytes, 'Rechnung neu', 'Noch einmal')
  }, 60000)
})

describe('Eingebettete CID-Teilmenge', () => {
  it('vorhandene Zeichen: Originalschrift', async () => {
    const bytes = await cidDokument()
    const e = await bearbeite(bytes, 'Rechnung 2026', 'Rechnung 2062')
    expect(e.bericht).toEqual({ schrift: 'original' })
    await pruefeRundlauf(bytes, e.bytes, 'Rechnung 2026', 'Rechnung 2062')
  }, 30000)

  it('fehlender Glyph: ganze Zeile in der Ersatzschrift, mit Grund', async () => {
    const bytes = await cidDokument()
    const e = await bearbeite(bytes, 'Rechnung 2026', 'Rechnung 2027')
    expect(e.bericht?.schrift).toBe('ersatz')
    expect(e.bericht?.ersatzschrift).toBe('Helvetica')
    expect(e.bericht?.grund).toContain('7')
    await pruefeRundlauf(bytes, e.bytes, 'Rechnung 2026', 'Rechnung 2027')
  }, 30000)

  it('Umlaute und Euro in der Ersatzschrift', async () => {
    const bytes = await cidDokument()
    const e = await bearbeite(bytes, 'Betrag 1.250,00 EUR', 'Betrag 1.250,00 € für Änderung')
    expect(e.bericht?.schrift).toBe('ersatz')
    await pruefeRundlauf(bytes, e.bytes, 'Betrag 1.250,00 EUR', 'Betrag 1.250,00 € für Änderung')
  }, 30000)

  it('Zeichen ausserhalb von WinAnsi: klare Ablehnung', async () => {
    const bytes = await cidDokument()
    await expect(bearbeite(bytes, 'Rechnung 2026', 'Rechnung 中')).rejects.toThrow(
      /Nicht darstellbar: 中/
    )
  }, 30000)

  it('loescht eine CID-Zeile', async () => {
    const bytes = await cidDokument()
    const e = await bearbeite(bytes, 'Betrag 1.250,00 EUR', '')
    await pruefeRundlauf(bytes, e.bytes, 'Betrag 1.250,00 EUR', '')
  }, 30000)
})

describe('Form-XObjects', () => {
  it('geteilte Kopfzeile: nur diese Seite bekommt die Aenderung', async () => {
    const bytes = await formDokument()
    const e = await bearbeite(bytes, 'Kopfzeile Firma', 'Kopfzeile Neu', 1)
    await pruefeRundlauf(bytes, e.bytes, 'Kopfzeile Firma', 'Kopfzeile Neu', 1)
    // Seite 2 zeigt weiter die alte Kopfzeile, an derselben Stelle.
    expect((await pdfjsZeilen(e.bytes, 2)).map((z) => z.text)).toEqual([
      'Kopfzeile Firma',
      'Text auf Seite 2'
    ])
  }, 30000)

  it('Form mit nur einer Benutzung wird an Ort und Stelle geaendert', async () => {
    const bytes = await formDokument()
    expect(await alleStroeme(bytes)).toContain(hex('Nur hier'))
    const e = await bearbeite(bytes, 'Nur hier in der Form', '', 1)
    await pruefeRundlauf(bytes, e.bytes, 'Nur hier in der Form', '', 1)
    expect(await alleStroeme(e.bytes)).not.toContain(hex('Nur hier'))
  }, 30000)

  it('verschachtelte Form', async () => {
    const bytes = await formDokument()
    const e = await bearbeite(bytes, 'Innere Form', 'Innen neu', 1)
    await pruefeRundlauf(bytes, e.bytes, 'Innere Form', 'Innen neu', 1)
  }, 30000)

  it('der alte Seiteninhalt verschwindet aus der Datei', async () => {
    const bytes = await formDokument()
    const e = await bearbeite(bytes, 'Text auf Seite 1', '', 1)
    const stroeme = await alleStroeme(e.bytes)
    expect(stroeme).not.toContain(hex('Seite 1'))
    expect(stroeme).toContain(hex('Seite 2'))
  }, 30000)
})

describe('Ablehnung ohne Aenderung', () => {
  const faelle: [string, RegExp][] = [
    ['aaa', /Type3/],
    ['Gemusterter Text', /Muster/],
    ['Mit Ersatztext', /ActualText/],
    ['Beschneidend', /Beschneidungspfad/]
  ]
  for (const [alt, grund] of faelle) {
    it(
      alt,
      async () => {
        const bytes = await ablehnungsDokument()
        await expect(bearbeite(bytes, alt, 'x')).rejects.toThrow(grund)
      },
      30000
    )
  }

  it('die normale Zeile daneben bleibt bearbeitbar', async () => {
    const bytes = await ablehnungsDokument()
    const e = await bearbeite(bytes, 'Normal bearbeitbar', 'Geaendert')
    await pruefeRundlauf(bytes, e.bytes, 'Normal bearbeitbar', 'Geaendert')
  }, 30000)

  it('Operatortext weicht vom pdf.js-Text ab', async () => {
    const bytes = await standardDokument()
    const zeile = { ...findeZeile(await pdfjsZeilen(bytes), 'Hochgestellt'), text: 'Etwas anderes' }
    await expect(
      wendeMutationAn(bytes, { art: 'textErsetzen', seite: 1, zeile, text: 'x' })
    ).rejects.toThrow(/nicht eindeutig zuordnen/)
  }, 30000)

  it('keine Glyphen an der Stelle (Anmerkung, Muster, falsche Seite)', async () => {
    const bytes = await standardDokument()
    const zeile = { ...findeZeile(await pdfjsZeilen(bytes), 'Hochgestellt'), grundlinie: 10 }
    await expect(
      wendeMutationAn(bytes, { art: 'textErsetzen', seite: 1, zeile, text: 'x' })
    ).rejects.toThrow(/nicht im Seiteninhalt/)
  }, 30000)

  it('Seite ausserhalb des Dokuments', async () => {
    const bytes = await standardDokument()
    const zeile = findeZeile(await pdfjsZeilen(bytes), 'Hochgestellt')
    await expect(
      wendeMutationAn(bytes, { art: 'textErsetzen', seite: 3, zeile, text: 'x' })
    ).rejects.toThrow(/Seite 3 gibt es nicht/)
  }, 30000)

  it('verschluesseltes Dokument', async () => {
    const bytes = new Uint8Array(readFileSync('test/fixtures/encrypted.pdf'))
    const zeile: TextZeile = {
      winkel: 0,
      dx: 1,
      dy: 0,
      grundlinie: 700,
      von: 72,
      bis: 200,
      groesse: 12,
      text: 'Geheim'
    }
    await expect(
      wendeMutationAn(bytes, { art: 'textErsetzen', seite: 1, zeile, text: 'x' })
    ).rejects.toThrow()
  }, 30000)
})

describe('Unsichtbarer OCR-Layer', () => {
  it('bleibt unsichtbar und durchsuchbar', async () => {
    const bytes = await ocrDokument()
    const e = await bearbeite(bytes, 'Erkannter Text', 'Korrigierter Text')
    expect(e.bericht?.schrift).toBe('original')
    await pruefeRundlauf(bytes, e.bytes, 'Erkannter Text', 'Korrigierter Text')
    expect(await alleStroeme(e.bytes)).toMatch(/3 Tr 1 0 0 1 0 0 Tm/)
  }, 30000)
})

describe('word.pdf (Fixture aus S6.7)', () => {
  it('ersetzt eine Absatzzeile, die Nachbarn bleiben stehen', async () => {
    const bytes = new Uint8Array(readFileSync('test/fixtures/word.pdf'))
    const alt = 'reihe zusammen. Die Werte wurden an drei Tagen erhoben'
    const neu = 'reihe zusammen. Die Werte wurden an vier Tagen erhoben'
    const e = await bearbeite(bytes, alt, neu)
    expect(e.bericht?.schrift).toBe('original')
    await pruefeRundlauf(bytes, e.bytes, alt, neu)
  }, 30000)

  it('loescht die Ueberschrift', async () => {
    const bytes = new Uint8Array(readFileSync('test/fixtures/word.pdf'))
    const e = await bearbeite(bytes, 'Methode', '')
    await pruefeRundlauf(bytes, e.bytes, 'Methode', '')
  }, 30000)
})

describe('Interpreter und Zuordnung', () => {
  it('findet zu jeder pdf.js-Zeile genau ihre Glyphen', async () => {
    for (const bytes of [await standardDokument(), await cidDokument(), await formDokument()]) {
      const doc = await PDFDocument.load(bytes)
      const ana = analysiereSeite(doc.context, doc.getPage(0))
      for (const zeile of await pdfjsZeilen(bytes)) {
        const gl = glyphenDerZeile(ana.glyphen, zeile)
        expect(textStimmt(gl, zeile), zeile.text).toBe(true)
      }
    }
  }, 30000)

  it('zaehlt Formaufrufe und merkt ActualText', async () => {
    const doc = await PDFDocument.load(await formDokument())
    const ana = analysiereSeite(doc.context, doc.getPage(0))
    expect(ana.formAufrufe.map((f) => f.name)).toEqual(['K1', 'E1', 'A1', 'I1'])
    expect(ana.formAufrufe[3]?.vonStrom).toContain('form:')
    const abl = await PDFDocument.load(await ablehnungsDokument())
    const glyphen = analysiereSeite(abl.context, abl.getPage(0)).glyphen
    expect(
      glyphen
        .filter((g) => g.actualText)
        .map((g) => g.uni)
        .join('')
    ).toBe('Mit Ersatztext')
    expect(glyphen.some((g) => g.muster)).toBe(true)
  }, 30000)

  it('Seite ohne Inhalt', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const ana = analysiereSeite(doc.context, doc.getPage(0))
    expect(ana.glyphen).toEqual([])
    expect(doc.getPage(0).node.get(PDFName.of('Contents'))).toBeUndefined()
  })
})
