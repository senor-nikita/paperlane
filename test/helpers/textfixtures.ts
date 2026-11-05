import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  type PDFDict,
  type PDFPage,
  type PDFRef
} from 'pdf-lib'

/**
 * Testdokumente fuer "Text bearbeiten" (S6.6b) - deterministisch erzeugt wie
 * der Fixture-Korpus (feste Daten, feste Schriftnamen), aber zur Laufzeit
 * statt eingecheckt: die eingebetteten Schriften stammen aus
 * `pdfjs-dist/standard_fonts` (LiberationSans, OFL; Foxit, BSD) und sollen
 * nicht als Teil einer committeten Datei weiterverteilt werden.
 *
 * Unit-, E2E- und Chrome-Tests benutzen dieselben Erzeuger.
 */

const SCHRIFTEN = resolve('node_modules/pdfjs-dist/standard_fonts')

export function liberationSans(): Uint8Array {
  return new Uint8Array(readFileSync(resolve(SCHRIFTEN, 'LiberationSans-Regular.ttf')))
}

async function neu(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  return doc
}

async function speichere(doc: PDFDocument): Promise<Uint8Array> {
  doc.setCreationDate(new Date(0))
  doc.setModificationDate(new Date(0))
  doc.setProducer('')
  doc.setCreator('')
  return doc.save({ useObjectStreams: false })
}

/** Setzt einen eigenen Content-Stream und meldet Schriften unter festen Namen an. */
function setzeInhalt(
  doc: PDFDocument,
  seite: PDFPage,
  inhalt: string,
  schriften: Record<string, PDFRef>,
  xobjekte: Record<string, PDFRef> = {}
): void {
  const ctx = doc.context
  const font = ctx.obj({})
  for (const [name, ref] of Object.entries(schriften)) font.set(PDFName.of(name), ref)
  const xo = ctx.obj({})
  for (const [name, ref] of Object.entries(xobjekte)) xo.set(PDFName.of(name), ref)
  seite.node.set(PDFName.of('Resources'), ctx.obj({ Font: font, XObject: xo }))
  seite.node.set(
    PDFName.of('Contents'),
    ctx.register(ctx.flateStream(new TextEncoder().encode(inhalt)))
  )
}

function hex(text: string): string {
  let s = '<'
  for (const c of text) s += (c.codePointAt(0) ?? 0).toString(16).padStart(2, '0')
  return s + '>'
}

/**
 * Standard-14 (Helvetica, Times-Bold, WinAnsi, nicht eingebettet) mit allen
 * Textoperatoren: Tj, TJ mit Kerning, ' und " mit TL, T*, TD, Tc/Tw/Tz/Ts,
 * cm-Skalierung, zwei Spalten auf einer Grundlinie, Farbe.
 */
export async function standardDokument(): Promise<Uint8Array> {
  const doc = await neu()
  const seite = doc.addPage([600, 800])
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const times = await doc.embedFont(StandardFonts.TimesRomanBold)
  const inhalt = [
    'BT /F1 18 Tf 72 720 Td ' + hex('Rechnung Nr. 2026-041') + ' Tj ET',
    'BT /F1 12 Tf 14 TL 72 680 Td ' +
      hex('Erste Zeile im Absatz') +
      ' Tj ' +
      hex('Zweite Zeile mit Apostroph') +
      " ' 2 0.5 " +
      hex('Dritte Zeile mit Anfuehrung') +
      ' " ET',
    'BT /F1 12 Tf 72 620 Td [' +
      hex('Ke') +
      ' 40 ' +
      hex('rning und ') +
      ' -250 ' +
      hex('Abstand') +
      '] TJ ET',
    'BT /F2 12 Tf 72 590 Td ' +
      hex('Spalte links') +
      ' Tj 300 0 Td ' +
      hex('Spalte rechts') +
      ' Tj ET',
    '0.8 0 0 rg BT /F1 12 Tf 1 Tc 3 Tw 90 Tz 72 560 Td ' + hex('Rot mit Abstaenden') + ' Tj ET 0 g',
    'q 2 0 0 2 36 250 cm BT /F1 10 Tf 0 0 Td ' + hex('Skaliert mit cm') + ' Tj ET Q',
    'BT /F1 12 Tf 72 460 Td 5 Ts ' + hex('Hochgestellt') + ' Tj 0 Ts ET',
    'BT /F1 12 Tf 72 430 Td ' + hex('Zeile die bleibt') + ' Tj T* ET',
    'BT /F1 12 Tf 0 1 -1 0 560 300 Tm ' + hex('Gedreht 90 Grad') + ' Tj ET'
  ].join('\n')
  setzeInhalt(doc, seite, inhalt, { F1: helv.ref, F2: times.ref })
  return speichere(doc)
}

/**
 * Eingebettete CID-Teilmenge (Type0/Identity-H, pdf-lib + fontkit) - das
 * Muster von Office- und Browser-PDFs: nur die benutzten Glyphen, keine cmap.
 * "Rechnung 2026" enthaelt keine 7: "2027" braucht die Ersatzschrift.
 */
export async function cidDokument(): Promise<Uint8Array> {
  const doc = await neu()
  const schrift = await doc.embedFont(liberationSans(), {
    subset: true,
    customName: 'PLTXAB+LiberationSans'
  })
  const seite = doc.addPage([600, 800])
  seite.drawText('Rechnung 2026', { x: 72, y: 700, size: 16, font: schrift })
  seite.drawText('Betrag 1.250,00 EUR', { x: 72, y: 670, size: 12, font: schrift })
  seite.drawText('Bleibt unveraendert', { x: 72, y: 640, size: 12, font: schrift })
  return speichere(doc)
}

/**
 * Eine Kopfzeile als Form-XObject auf zwei Seiten (geteilt), dazu eine Form,
 * die nur einmal benutzt wird, und eine verschachtelte Form.
 */
export async function formDokument(): Promise<Uint8Array> {
  const doc = await neu()
  const ctx = doc.context
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const fontRes = (): PDFDict => ctx.obj({ Font: ctx.obj({ F1: helv.ref }) })
  const form = (inhalt: string, res: PDFDict): PDFRef =>
    ctx.register(
      ctx.flateStream(new TextEncoder().encode(inhalt), {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 600, 800],
        Resources: res
      })
    )
  const kopf = form('BT /F1 10 Tf 72 770 Td ' + hex('Kopfzeile Firma') + ' Tj ET', fontRes())
  const einmal = form('BT /F1 12 Tf 72 500 Td ' + hex('Nur hier in der Form') + ' Tj ET', fontRes())
  const innen = form('BT /F1 12 Tf 72 400 Td ' + hex('Innere Form') + ' Tj ET', fontRes())
  const aussenRes = fontRes()
  aussenRes.set(PDFName.of('XObject'), ctx.obj({ I1: innen }))
  const aussen = form('q 1 0 0 1 0 0 cm /I1 Do Q', aussenRes)
  for (let n = 1; n <= 2; n++) {
    const seite = doc.addPage([600, 800])
    const inhalt =
      '/K1 Do\nBT /F1 12 Tf 72 600 Td ' +
      hex('Text auf Seite ' + String(n)) +
      ' Tj ET' +
      (n === 1 ? '\n/E1 Do\n/A1 Do' : '')
    setzeInhalt(
      doc,
      seite,
      inhalt,
      { F1: helv.ref },
      n === 1 ? { K1: kopf, E1: einmal, A1: aussen } : { K1: kopf }
    )
  }
  return speichere(doc)
}

/** Faelle, die abgelehnt werden muessen: Type3, Muster, ActualText, Beschneidungspfad. */
export async function ablehnungsDokument(): Promise<Uint8Array> {
  const doc = await neu()
  const ctx = doc.context
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  // Type3: ein Quadrat je Glyph.
  const quadrat = ctx.register(
    ctx.flateStream(new TextEncoder().encode('500 0 0 0 500 500 d1 0 0 500 500 re f'))
  )
  const type3 = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, 0, 500, 500],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: ctx.obj({ a: quadrat }),
      Encoding: ctx.obj({ Type: 'Encoding', Differences: [97, PDFName.of('a')] }),
      FirstChar: 97,
      LastChar: 97,
      Widths: [500],
      Resources: ctx.obj({})
    })
  )
  const muster = ctx.register(
    ctx.flateStream(new TextEncoder().encode('0 0 1 rg 0 0 5 5 re f'), {
      Type: 'Pattern',
      PatternType: 1,
      PaintType: 1,
      TilingType: 1,
      BBox: [0, 0, 10, 10],
      XStep: 10,
      YStep: 10,
      Resources: ctx.obj({})
    })
  )
  const seite = doc.addPage([600, 800])
  const inhalt = [
    'BT /T3 12 Tf 72 700 Td ' + hex('aaa') + ' Tj ET',
    '/Pattern cs /P1 scn BT /F1 12 Tf 72 660 Td ' + hex('Gemusterter Text') + ' Tj ET 0 g',
    '/Span << /ActualText (Ersatz) >> BDC BT /F1 12 Tf 72 620 Td ' +
      hex('Mit Ersatztext') +
      ' Tj ET EMC',
    'q BT /F1 12 Tf 7 Tr 72 580 Td ' + hex('Beschneidend') + ' Tj ET Q',
    'BT /F1 12 Tf 72 540 Td ' + hex('Normal bearbeitbar') + ' Tj ET'
  ].join('\n')
  setzeInhalt(doc, seite, inhalt, { F1: helv.ref, T3: type3 })
  const res = seite.node.get(PDFName.of('Resources')) as PDFDict
  res.set(PDFName.of('Pattern'), ctx.obj({ P1: muster }))
  return speichere(doc)
}

/** Unsichtbarer OCR-Layer (3 Tr) - bearbeitbar, bleibt unsichtbar. */
export async function ocrDokument(): Promise<Uint8Array> {
  const doc = await neu()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const seite = doc.addPage([600, 800])
  setzeInhalt(
    doc,
    seite,
    'BT /F1 14 Tf 3 Tr 72 700 Td ' +
      hex('Erkannter Text') +
      ' Tj ET\nBT /F1 14 Tf 3 Tr 72 670 Td ' +
      hex('Zweite Zeile') +
      ' Tj ET',
    { F1: helv.ref }
  )
  return speichere(doc)
}
