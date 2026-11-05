// @vitest-environment node
import { Encodings } from '@pdf-lib/standard-fonts'
import { PDFDocument, PDFName, StandardFonts, type PDFDict, type PDFRef } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { wendeMutationAnMitBericht } from '../../src/main/mutation'
import {
  basiskodierung,
  glyphnameZuUnicode,
  istBasiskodierung,
  unicodeZuGlyphname
} from '../../src/main/textbearbeitung/kodierungen'
import { hexText, LexFehler, MAX_TIEFE, zahl, zerlege } from '../../src/main/textbearbeitung/lexer'
import { strombytes } from '../../src/main/textbearbeitung/pdfobjekte'
import { Schrift, schriftCache } from '../../src/main/textbearbeitung/schrift'
import { leseToUnicode, schreibeToUnicode } from '../../src/main/textbearbeitung/tounicode'
import { leseTrueType } from '../../src/main/textbearbeitung/truetype'
import { leseType1 } from '../../src/main/textbearbeitung/type1'
import { findeZeile, pdfjsZeilen } from '../helpers/pdfjs-zeilen'
import { liberationSans } from '../helpers/textfixtures'
import { baueType1 } from '../helpers/type1-programm'

/**
 * S6.6b: Lexer, Schriftmodell und die Glyphpruefung - dazu die beiden
 * Schriftarten, die die Fixtures sonst nicht abdecken: eine einfache
 * TrueType-Schrift (Office-Muster, WinAnsi) und ein eingebettetes
 * Type1-Programm (LaTeX-Muster).
 */

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs')
}, 60000)

const enc = new TextEncoder()

describe('Lexer', () => {
  it('liefert Operatoren mit Operanden und Byte-Bereichen', () => {
    const quelle = 'q 1 0 0 1 5 5 cm BT /F1 12 Tf (a\\(b\\)c) Tj [<0041> -20 (x)] TJ ET Q'
    const ops = zerlege(enc.encode(quelle))
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'BT', 'Tf', 'Tj', 'TJ', 'ET', 'Q'])
    const tj = ops[4]
    expect(quelle.slice(tj?.start, tj?.ende)).toBe('(a\\(b\\)c) Tj')
    expect(tj?.args[0]).toEqual({ t: 'text', bytes: enc.encode('a(b)c') })
    const tjFeld = ops[5]?.args[0]
    expect(tjFeld?.t).toBe('feld')
    expect(quelle.slice(ops[5]?.start, ops[5]?.ende)).toBe('[<0041> -20 (x)] TJ')
  })

  it('Escapes, Oktal, verschachtelte Klammern, Hex mit Leerraum und ungerader Laenge', () => {
    const ops = zerlege(enc.encode('(\\n\\r\\t\\b\\f\\101\\7x(y)\\\nz) Tj <41 4 > Tj'))
    expect(ops[0]?.args[0]).toEqual({
      t: 'text',
      bytes: Uint8Array.from([10, 13, 9, 8, 12, 65, 7, 120, 40, 121, 41, 122])
    })
    expect(ops[1]?.args[0]).toEqual({ t: 'text', bytes: Uint8Array.of(0x41, 0x40) })
  })

  it('Namen mit #-Escape, Dictionaries, Bool, null, Kommentare', () => {
    const ops = zerlege(
      enc.encode('% Kommentar\n/Span << /ActualText (x) /A#20B true /N null >> BDC EMC')
    )
    const d = ops[0]?.args[1]
    expect(ops[0]?.op).toBe('BDC')
    expect(d?.t === 'dict' && [...d.eintraege.keys()]).toEqual(['ActualText', 'A B', 'N'])
    expect(d?.t === 'dict' && d.eintraege.get('A B')).toEqual({ t: 'bool', v: true })
  })

  it('ueberspringt Inline-Bilder samt Binaerdaten', () => {
    const bytes = new Uint8Array([
      ...enc.encode('BI /W 2 /H 1 /BPC 8 /CS /G ID '),
      0x45,
      0x49,
      0x41,
      0xff,
      ...enc.encode(' EI BT ET')
    ])
    expect(zerlege(bytes).map((o) => o.op)).toEqual(['BI', 'BT', 'ET'])
  })

  it('verkraftet Muell, ohne haengen zu bleiben', () => {
    const ops = zerlege(enc.encode(') } { > ] 1 2 [ /a Tj ] (offen'))
    expect(ops.map((o) => o.op)).toEqual([])
    expect(zerlege(enc.encode('<< /a [ 1 2 >> x'))).toHaveLength(0)
  })

  it('begrenzt die Verschachtelung', () => {
    expect(() => zerlege(enc.encode('['.repeat(MAX_TIEFE + 1)))).toThrow(LexFehler)
  })

  it('schreibt Hex und Zahlen', () => {
    expect(hexText(Uint8Array.of(0, 15, 255))).toBe('<000fff>')
    expect(zahl(1.23456)).toBe('1.2346')
    expect(zahl(-0.00001)).toBe('0')
    expect(zahl(Number.NaN)).toBe('0')
  })
})

describe('ToUnicode', () => {
  it('liest bfchar und beide bfrange-Formen', () => {
    const cmap = [
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '2 beginbfchar <0003> <0041> <0004> <00660069> endbfchar',
      '2 beginbfrange <0010> <0012> <0061> <0020> <0021> [<00E4> <20AC>] endbfrange'
    ].join('\n')
    const tu = leseToUnicode(cmap)
    expect(tu.codelaenge).toBe(2)
    expect(Object.fromEntries(tu.zuordnung)).toEqual({
      3: 'A',
      4: 'fi',
      16: 'a',
      17: 'b',
      18: 'c',
      32: 'ä',
      33: '€'
    })
  })

  it('schreibt und liest sich zurueck', () => {
    const zuordnung = new Map<number, string>()
    for (let i = 0; i < 150; i++) zuordnung.set(i, String.fromCharCode(0x41 + (i % 26)))
    zuordnung.set(200, '€')
    const text = schreibeToUnicode(zuordnung, 1)
    expect(text.match(/beginbfchar/g)).toHaveLength(2)
    expect(leseToUnicode(text).zuordnung).toEqual(zuordnung)
  })

  it('ignoriert riesige Bereiche', () => {
    expect(leseToUnicode('beginbfrange <0000> <FFFFFF> <0041> endbfrange').zuordnung.size).toBe(0)
  })
})

describe('Kodierungen und Glyphnamen', () => {
  it('Basiskodierungen', () => {
    expect(istBasiskodierung('MacRomanEncoding')).toBe(true)
    expect(istBasiskodierung('Identity-H')).toBe(false)
    const mac = basiskodierung('MacRomanEncoding')
    expect(mac.get(0x80)).toBe('Adieresis')
    expect(mac.get(0xdb)).toBe('currency')
    expect(mac.get(0xff)).toBe('caron')
    expect(mac.has(0xf0)).toBe(false)
    const std = basiskodierung('StandardEncoding')
    expect(std.get(39)).toBe('quoteright')
    expect(std.get(0xae)).toBe('fi')
    expect(std.get(0xfb)).toBe('germandbls')
    expect(basiskodierung('WinAnsiEncoding').get(0x80)).toBe('Euro')
  })

  it('Glyphname <-> Unicode', () => {
    expect(glyphnameZuUnicode('adieresis')).toBe('ä')
    expect(glyphnameZuUnicode('uni20AC')).toBe('€')
    expect(glyphnameZuUnicode('u1F600')).toBe('\u{1F600}')
    expect(glyphnameZuUnicode('a.sc')).toBe('a')
    expect(glyphnameZuUnicode('gibtsnicht')).toBeNull()
    // Lateinisch Erweitert-A: Anfang, Mitte und Ende der Liste sitzen richtig.
    expect(glyphnameZuUnicode('Amacron')).toBe('Ā')
    expect(glyphnameZuUnicode('Lslash')).toBe('Ł')
    expect(glyphnameZuUnicode('zacute')).toBe('ź')
    expect(glyphnameZuUnicode('longs')).toBe('ſ')
    expect(unicodeZuGlyphname('ő')).toBe('ohungarumlaut')
    expect(unicodeZuGlyphname('ä')).toBe('adieresis')
    expect(unicodeZuGlyphname('中')).toBe('uni4E2D')
    expect(unicodeZuGlyphname('\u{1F600}')).toBe('u1F600')
  })
})

/** Offsets der glyf-Daten eines Glyphs - fuer "hohle" Slots wie bei Word. */
function hoehleAus(ttf: Uint8Array, zeichen: string): Uint8Array {
  const kopie = ttf.slice()
  const dv = new DataView(kopie.buffer)
  const tabellen = new Map<string, number>()
  for (let k = 0; k < dv.getUint16(4); k++) {
    const o = 12 + k * 16
    tabellen.set(String.fromCharCode(...kopie.subarray(o, o + 4)), dv.getUint32(o + 8))
  }
  const tt = leseTrueType(ttf)
  const gid = tt?.cmap(3, 1)?.(zeichen.codePointAt(0) ?? 0) ?? 0
  const lang = dv.getInt16((tabellen.get('head') ?? 0) + 50) === 1
  const loca = tabellen.get('loca') ?? 0
  const off = lang ? dv.getUint32(loca + gid * 4) : dv.getUint16(loca + gid * 2) * 2
  dv.setInt16((tabellen.get('glyf') ?? 0) + off, 0)
  return kopie
}

describe('TrueType-Leser', () => {
  it('cmap, Umriss und Breite von LiberationSans', () => {
    const tt = leseTrueType(liberationSans())
    expect(tt).not.toBeNull()
    if (tt === null) return
    const gidA = tt.cmap(3, 1)?.(0x41) ?? 0
    expect(gidA).toBeGreaterThan(0)
    expect(tt.hatUmriss(gidA)).toBe(true)
    expect(Math.round((tt.vorschub(gidA) * 1000) / tt.einheitenProEm)).toBe(667)
    const leer = tt.cmap(3, 1)?.(0x20) ?? 0
    expect(tt.hatUmriss(leer)).toBe(false)
    expect(tt.hatUmriss(tt.anzahlGlyphen + 5)).toBe(false)
    expect(tt.cmap(9, 9)).toBeNull()
  })

  it('erkennt hohle Glyph-Slots', () => {
    const tt = leseTrueType(hoehleAus(liberationSans(), 'Z'))
    const gid = tt?.cmap(3, 1)?.(0x5a) ?? 0
    expect(gid).toBeGreaterThan(0)
    expect(tt?.hatUmriss(gid)).toBe(false)
  })

  it('lehnt Kaputtes ab', () => {
    expect(leseTrueType(new Uint8Array(10))).toBeNull()
    expect(leseTrueType(enc.encode('OTTO' + ' '.repeat(40)))).toBeNull()
    expect(leseTrueType(liberationSans().slice(0, 300))).toBeNull()
  })
})

/** Die Glyphen der Type1-Teilmenge: was die Tests schreiben, und kein "q". */
const TYPE1_GLYPHEN = [
  'space',
  ...'HaloWetAndrZi'.split(''),
  'adieresis',
  'Lslash',
  'oacute',
  'zacute'
]

function type1Datei(): ReturnType<typeof baueType1> {
  return baueType1('PLTXAE+LmRoman10', TYPE1_GLYPHEN)
}

describe('Type1-Leser', () => {
  it('liest CharStrings mit Breiten', () => {
    const { bytes, laenge1, breiten } = type1Datei()
    const t1 = leseType1(bytes, laenge1)
    expect([...(t1?.glyphen.keys() ?? [])]).toEqual(['.notdef', ...TYPE1_GLYPHEN])
    expect(t1?.glyphen.get('A')).toBe(breiten.get('A'))
    expect(t1?.glyphen.get('space')).toBe(250)
    expect(t1?.standardKodierung).toBe(true)
    // Ohne Length1 findet der Leser "eexec" selbst.
    expect(leseType1(bytes, 0)?.glyphen.size).toBe(t1?.glyphen.size)
  })

  it('liest eine eingebaute Kodierung und verkraftet Muell', () => {
    const klartext = enc.encode(
      '/Encoding 256 array\ndup 65 /Alpha put\ndup 66 /B put\nreadonly def\ncurrentfile eexec\n'
    )
    const t1 = leseType1(new Uint8Array([...klartext, 1, 2, 3, 4, 5]), klartext.length)
    expect(t1?.kodierung.get(65)).toBe('Alpha')
    expect(t1?.standardKodierung).toBe(false)
    expect(t1?.glyphen.size).toBe(0)
    expect(leseType1(enc.encode('kein Programm'), 0)).toBeNull()
  })
})

interface Einbettung {
  schrift: (doc: PDFDocument) => PDFRef
}

function einfacheTrueType(ttf: Uint8Array): Einbettung {
  return {
    schrift: (doc) => {
      const ctx = doc.context
      const tt = leseTrueType(ttf)
      if (tt === null) throw new Error('kein TrueType')
      const widths: number[] = []
      for (let code = 32; code <= 255; code++) {
        let w = 0
        for (const cp of Encodings.WinAnsi.supportedCodePoints) {
          if (Encodings.WinAnsi.encodeUnicodeCodePoint(cp).code === code) {
            w = Math.round((tt.vorschub(tt.cmap(3, 1)?.(cp) ?? 0) * 1000) / tt.einheitenProEm)
            break
          }
        }
        widths.push(w)
      }
      const deskriptor = ctx.obj({
        Type: 'FontDescriptor',
        FontName: 'PLTXAD+LiberationSans',
        Flags: 32,
        FontBBox: [-200, -300, 1200, 1000],
        ItalicAngle: 0,
        Ascent: 900,
        Descent: -200,
        CapHeight: 700,
        StemV: 80,
        FontFile2: ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }))
      })
      return ctx.register(
        ctx.obj({
          Type: 'Font',
          Subtype: 'TrueType',
          BaseFont: 'PLTXAD+LiberationSans',
          FirstChar: 32,
          LastChar: 255,
          Widths: widths,
          Encoding: 'WinAnsiEncoding',
          FontDescriptor: ctx.register(deskriptor)
        })
      )
    }
  }
}

function type1Einbettung(): Einbettung {
  return {
    schrift: (doc) => {
      const ctx = doc.context
      const { bytes, laenge1, laenge2, breiten } = type1Datei()
      const win = basiskodierung('WinAnsiEncoding')
      const widths: number[] = []
      for (let code = 32; code <= 255; code++) widths.push(breiten.get(win.get(code) ?? '') ?? 0)
      const deskriptor = ctx.obj({
        Type: 'FontDescriptor',
        FontName: 'PLTXAE+LmRoman10',
        Flags: 34,
        FontBBox: [-200, -300, 1200, 1000],
        ItalicAngle: 0,
        Ascent: 900,
        Descent: -200,
        CapHeight: 700,
        StemV: 80,
        FontFile: ctx.register(
          ctx.flateStream(bytes, { Length1: laenge1, Length2: laenge2, Length3: 0 })
        )
      })
      return ctx.register(
        ctx.obj({
          Type: 'Font',
          Subtype: 'Type1',
          BaseFont: 'PLTXAE+LmRoman10',
          FirstChar: 32,
          LastChar: 255,
          Widths: widths,
          Encoding: ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [] }),
          FontDescriptor: ctx.register(deskriptor)
        })
      )
    }
  }
}

async function dokumentMit(einbettung: Einbettung): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  const ctx = doc.context
  const seite = doc.addPage([600, 800])
  const ref = einbettung.schrift(doc)
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  seite.node.set(PDFName.of('Resources'), ctx.obj({ Font: ctx.obj({ T1: ref, F1: helv.ref }) }))
  const inhalt =
    'BT /T1 14 Tf 72 700 Td (Hallo Welt) Tj ET\nBT /T1 14 Tf 72 670 Td (Andere Zeile) Tj ET\n' +
    'BT /F1 12 Tf 72 640 Td (Helvetica daneben) Tj ET'
  seite.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(enc.encode(inhalt))))
  return doc.save({ useObjectStreams: false })
}

async function ersetze(bytes: Uint8Array, alt: string, neu: string) {
  const vorher = await pdfjsZeilen(bytes)
  const zeile = findeZeile(vorher, alt)
  const e = await wendeMutationAnMitBericht(bytes, {
    art: 'textErsetzen',
    seite: 1,
    zeile,
    text: neu
  })
  const nachher = await pdfjsZeilen(e.bytes)
  const ersetzt = findeZeile(nachher, neu)
  expect(ersetzt.grundlinie).toBeCloseTo(zeile.grundlinie, 1)
  expect(ersetzt.von).toBeCloseTo(zeile.von, 1)
  for (const z of vorher) if (z !== zeile) expect(nachher.map((n) => n.text)).toContain(z.text)
  return e.bericht
}

describe('Einfache TrueType-Schrift (FontFile2, WinAnsi)', () => {
  it('neues Zeichen mit Umriss: Originalschrift', async () => {
    const bytes = await dokumentMit(einfacheTrueType(liberationSans()))
    expect(await ersetze(bytes, 'Hallo Welt', 'Hallo Zelt äöü')).toEqual({ schrift: 'original' })
  }, 30000)

  it('hohler Slot: Ersatzschrift statt unsichtbarem Zeichen', async () => {
    const bytes = await dokumentMit(einfacheTrueType(hoehleAus(liberationSans(), 'Z')))
    const bericht = await ersetze(bytes, 'Hallo Welt', 'Hallo Zelt')
    expect(bericht?.schrift).toBe('ersatz')
    expect(bericht?.grund).toMatch(/Glyph fehlt.*Z/)
    expect(bericht?.ersatzschrift).toBe('Helvetica')
  }, 30000)
})

describe('Eingebettetes Type1-Programm', () => {
  it('neues Zeichen aus den CharStrings: Originalschrift', async () => {
    const bytes = await dokumentMit(type1Einbettung())
    expect(await ersetze(bytes, 'Hallo Welt', 'Hallo Wält')).toEqual({ schrift: 'original' })
  }, 30000)

  it('Zeichen ausserhalb der Kodierung bekommt einen freien Code (Differences)', async () => {
    const bytes = await dokumentMit(type1Einbettung())
    expect(await ersetze(bytes, 'Andere Zeile', 'Łóź Zeile')).toEqual({ schrift: 'original' })
  }, 30000)

  it('Glyph fehlt in der Teilmenge: Ersatzschrift im Stil des Originals (Serif)', async () => {
    const bytes = await dokumentMit(type1Einbettung())
    const bericht = await ersetze(bytes, 'Hallo Welt', 'Hallo quer')
    expect(bericht?.schrift).toBe('ersatz')
    expect(bericht?.ersatzschrift).toBe('Times-Roman')
  }, 30000)

  it('Stil der Ersatzschrift aus den Deskriptor-Flags (Serif)', async () => {
    const doc = await PDFDocument.load(await dokumentMit(type1Einbettung()))
    const fonts = (doc.getPage(0).node.get(PDFName.of('Resources')) as PDFDict).get(
      PDFName.of('Font')
    ) as PDFDict
    const s = schriftCache(doc.context)(fonts.get(PDFName.of('T1')) as PDFRef)
    expect(s?.stil()).toEqual({ familie: 'Times', fett: false, kursiv: false })
    expect(s?.art).toBe('Type1 type1')
    expect(s?.kodiere('中', false)).toEqual({
      fehler: 'Glyph fehlt in der eingebetteten Schrift: 中'
    })
  })
})

describe('Schriftmodell', () => {
  it('Standard-14: Stil, Breiten, Unicode', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const f = (name: string): Schrift =>
      new Schrift(ctx, undefined, ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: name }))
    const fett = f('Helvetica-BoldOblique')
    expect(fett.stil()).toEqual({ familie: 'Helvetica', fett: true, kursiv: true })
    expect(f('Courier').stil().familie).toBe('Courier')
    expect(f('TimesNewRomanPS-BoldMT').stil()).toEqual({
      familie: 'Times',
      fett: true,
      kursiv: false
    })
    expect(f('Arial').std14).toBe('Helvetica')
    expect(f('Helvetica').art).toBe('Type1 (Standard-14)')
    expect(f('Unbekannt').art).toBe('Type1 (nicht eingebettet)')
    // StandardEncoding ohne /Encoding: 0x27 ist quoteright.
    expect(f('Helvetica').unicode(0x27)).toBe('’')
    expect(f('Helvetica').breite(0x41)).toBe(667)
    expect(f('Symbol').unicode(0x61)).toBe('α')
    expect(f('Helvetica').kodiere('Ω', false)).toEqual({
      fehler: 'nicht in der Kodierung der Schrift: Ω'
    })
  })

  it('Type0 mit fremder CMap und Identity-V: Probleme statt Raten', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const cid = ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'X', DW: 500 })
    const t0 = (cmap: string): Schrift =>
      new Schrift(
        ctx,
        undefined,
        ctx.obj({
          Type: 'Font',
          Subtype: 'Type0',
          BaseFont: 'X',
          Encoding: cmap,
          DescendantFonts: [cid]
        })
      )
    expect(t0('UniGB-UCS2-H').probleme[0]).toMatch(/CMap UniGB-UCS2-H/)
    expect(t0('Identity-V').probleme[0]).toMatch(/senkrechter Text/)
    expect(t0('Identity-H').probleme).toEqual([])
    expect(t0('Identity-H').breite(5)).toBe(500)
    expect(t0('Identity-H').kodiere('a', false)).toEqual({
      fehler: 'nicht eingebettete CID-Schrift'
    })
    expect(t0('Identity-H').dekodiere(Uint8Array.of(0, 65, 1))).toEqual([
      { code: 65, off: 0, len: 2 }
    ])
    const ohneKinder = new Schrift(
      ctx,
      undefined,
      ctx.obj({ Subtype: 'Type0', Encoding: 'Identity-H' })
    )
    expect(ohneKinder.probleme).toContain('Schrift ohne CID-Teil')
  })

  it('schriftCache: eine Schrift je Objekt, Kaputtes als null', async () => {
    const doc = await PDFDocument.create()
    const helv = await doc.embedFont(StandardFonts.Helvetica)
    await doc.save()
    const cache = schriftCache(doc.context)
    expect(cache(helv.ref)).toBe(cache(helv.ref))
    expect(cache(doc.context.nextRef())).toBeNull()
  })

  it('strombytes begrenzt die Groesse', () => {
    const ctx = PDFDocument.create()
    return ctx.then((doc) => {
      const s = doc.context.flateStream(new Uint8Array(5000))
      expect(strombytes(s, 100_000)).toHaveLength(5000)
      expect(() => strombytes(s, 100)).toThrow(/zu groß/)
      expect(strombytes(undefined)).toHaveLength(0)
    })
  })
})
