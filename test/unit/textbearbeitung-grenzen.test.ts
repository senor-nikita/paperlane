// @vitest-environment node
import { deflateSync } from 'node:zlib'
import {
  decodePDFRawStream,
  PDFDocument,
  type PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFContext,
  type PDFPage
} from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { wendeMutationAnMitBericht } from '../../src/main/mutation'
import {
  analysiereSeite,
  MAX_FORMAUFRUFE,
  MAX_GLYPHEN
} from '../../src/main/textbearbeitung/interpreter'
import { LexFehler, MAX_WERTE_JE_OPERATOR, zerlege } from '../../src/main/textbearbeitung/lexer'
import { strombytes, TextAbgelehnt } from '../../src/main/textbearbeitung/pdfobjekte'
import { Schrift } from '../../src/main/textbearbeitung/schrift'
import { leseToUnicode } from '../../src/main/textbearbeitung/tounicode'
import { leseTrueType } from '../../src/main/textbearbeitung/truetype'
import { findeZeile, pdfjsZeilen } from '../helpers/pdfjs-zeilen'

/**
 * Gate Phase 6 (Security-Review, H1/H2/M3/L1-L3): praeparierte Eingaben, die
 * den Main-Prozess vorher zum Absturz brachten (V8-OOM) oder minutenlang
 * blockierten. Jeder Fall endet jetzt schnell mit einer Ablehnung; die
 * Zeitgrenze im Test ist der Beleg (vorher: Sekunden bis Stunden, siehe
 * dem Sicherheitsreview der Textbearbeitung, Messtabelle).
 */

// pdf.js kalt zu laden dauert auf dem CI-Runner laenger als 5 s.
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs')
}, 60000)

const enc = new TextEncoder()

/** Misst eine Funktion und liefert ihre Ausnahme (oder `null`) samt Dauer. */
function gemessen(f: () => unknown): { fehler: unknown; ms: number } {
  const t = performance.now()
  try {
    f()
    return { fehler: null, ms: performance.now() - t }
  } catch (fehler) {
    return { fehler, ms: performance.now() - t }
  }
}

async function neueSeite(): Promise<{ doc: PDFDocument; ctx: PDFContext; page: PDFPage }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 800])
  return { doc, ctx: doc.context, page }
}

function setzeInhalt(ctx: PDFContext, page: PDFPage, text: string): void {
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(enc.encode(text))))
}

function helvetica(ctx: PDFContext, page: PDFPage, name = 'F1'): void {
  const font = ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' })
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { [name]: ctx.register(font) } }))
}

describe('H1a: /FirstChar ausserhalb 0..255', () => {
  /** Type1-Programm mit genau einem Glyph /A (hsbw 0 500), wie im Review-Fuzz. */
  function type1Programm(): { bytes: Uint8Array; laenge1: number } {
    const verschl = (klar: Uint8Array, r0: number): Uint8Array => {
      let r = r0
      const out = new Uint8Array(klar.length)
      for (let k = 0; k < klar.length; k++) {
        const c = (klar[k] as number) ^ (r >> 8)
        out[k] = c
        r = ((c + r) * 52845 + 22719) & 0xffff
      }
      return out
    }
    const cs = verschl(Uint8Array.of(0, 0, 0, 0, 139, 248, 136, 13, 14), 4330)
    const kopf = enc.encode(
      '%!PS-AdobeFont-1.0: Foo\n/Encoding StandardEncoding def\ncurrentfile eexec\n'
    )
    const teil1 = enc.encode('/lenIV 4 def\n/CharStrings 1 begin\n/A ' + String(cs.length) + ' RD ')
    const teil2 = enc.encode(' ND\nend\n')
    const klar = new Uint8Array(4 + teil1.length + cs.length + teil2.length)
    klar.set(teil1, 4)
    klar.set(cs, 4 + teil1.length)
    klar.set(teil2, 4 + teil1.length + cs.length)
    const bin = verschl(klar, 55665)
    const bytes = new Uint8Array(kopf.length + bin.length)
    bytes.set(kopf)
    bytes.set(bin, kopf.length)
    return { bytes, laenge1: kopf.length }
  }

  async function firstCharDokument(firstChar: number): Promise<Uint8Array> {
    const { doc, ctx, page } = await neueSeite()
    const { bytes, laenge1 } = type1Programm()
    const ff = ctx.register(ctx.flateStream(bytes, { Length1: laenge1 }))
    const fd = ctx.obj({ Type: 'FontDescriptor', FontName: 'Foo', Flags: 32, FontFile: ff })
    const font = ctx.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Foo',
      FirstChar: firstChar,
      LastChar: firstChar + 1,
      Widths: [0, 0],
      FontDescriptor: ctx.register(fd)
    })
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: ctx.register(font) } }))
    setzeInhalt(ctx, page, 'BT /F1 12 Tf 100 700 Td (AA) Tj ET')
    return doc.save()
  }

  it('lehnt die Zeile sofort ab statt Widths ueber 1e8 Codes neu aufzubauen', async () => {
    // Vorher: FATAL OOM nach 79 s (Review, Messtabelle H1a).
    const bytes = await firstCharDokument(100_000_000)
    const zeile = {
      winkel: 0,
      dx: 1,
      dy: 0,
      grundlinie: 700,
      von: 100,
      bis: 110,
      groesse: 12,
      text: 'AA'
    }
    const t = performance.now()
    await expect(
      wendeMutationAnMitBericht(bytes, { art: 'textErsetzen', seite: 1, zeile, text: 'A' })
    ).rejects.toThrow(TextAbgelehnt)
    expect(performance.now() - t).toBeLessThan(5000)
  }, 20000)

  it('markiert FirstChar 1e308 und negative Werte als Problem', async () => {
    for (const wert of [1e308, -5, 3.5, 256]) {
      const { ctx } = await neueSeite()
      const font = ctx.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: 'Helvetica',
        FirstChar: wert,
        Widths: [500]
      })
      const s = new Schrift(ctx, undefined, font)
      expect(s.probleme.join()).toContain('FirstChar')
    }
  })

  it('Widths-Neuaufbau bleibt in 0..255', async () => {
    const { ctx } = await neueSeite()
    const breiten = new Array<number>(300).fill(500)
    const font = ctx.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      FirstChar: 250,
      Widths: breiten
    })
    const s = new Schrift(ctx, undefined, font)
    expect(s.probleme).toEqual([])
    s.wendeAn([{ art: 'breite', code: 65, wert: 600 }])
    const erst = font.get(PDFName.of('FirstChar'))?.toString()
    const letzt = font.get(PDFName.of('LastChar'))?.toString()
    expect(erst).toBe('65')
    expect(letzt).toBe('255')
    expect(s.breite(65)).toBe(600)
    expect(s.breite(250)).toBe(500)
  })
})

describe('H1b: sehr langer String in Tj', () => {
  it('prueft die Glyphgrenze vor dem Dekodieren', async () => {
    // 20 Mio Zeichen, komprimiert wenige KB: vorher Gigabytes Heap.
    const { ctx, page } = await neueSeite()
    helvetica(ctx, page)
    setzeInhalt(ctx, page, 'BT /F1 1 Tf (' + 'A'.repeat(20_000_000) + ') Tj ET')
    const { fehler, ms } = gemessen(() => analysiereSeite(ctx, page))
    expect(fehler).toBeInstanceOf(TextAbgelehnt)
    expect((fehler as Error).message).toContain('zu viel Text')
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('knapp unter der Grenze wird noch analysiert', async () => {
    const { ctx, page } = await neueSeite()
    helvetica(ctx, page)
    setzeInhalt(ctx, page, 'BT /F1 1 Tf (' + 'A'.repeat(MAX_GLYPHEN) + ') Tj ET')
    expect(analysiereSeite(ctx, page).glyphen).toHaveLength(MAX_GLYPHEN)
  }, 30000)
})

describe('H1c: Faecher aus Form-XObjects', () => {
  it('begrenzt die Gesamtzahl der Formaufrufe (100 Do je Ebene, 5 Ebenen)', async () => {
    // Vorher: 100^5 Aufrufe ohne Kreis, FATAL OOM nach 49 s.
    const { ctx, page } = await neueSeite()
    let naechste: PDFRef | null = null
    for (let e = 0; e < 5; e++) {
      const inhalt = naechste === null ? 'q Q' : '/X Do\n'.repeat(100)
      const dict: Record<string, unknown> = {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 10, 10]
      }
      if (naechste !== null) dict['Resources'] = { XObject: { X: naechste } }
      naechste = ctx.register(ctx.flateStream(enc.encode(inhalt), dict as never))
    }
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { X: naechste } }))
    setzeInhalt(ctx, page, '/X Do')
    const { fehler, ms } = gemessen(() => analysiereSeite(ctx, page))
    expect(fehler).toBeInstanceOf(TextAbgelehnt)
    expect(ms).toBeLessThan(5000)
  }, 20000)

  it('eine flache Seite mit vielen Aufrufen unter der Grenze bleibt bearbeitbar', async () => {
    const { ctx, page } = await neueSeite()
    const form = ctx.register(
      ctx.flateStream(enc.encode('q Q'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] })
    )
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { X: form } }))
    setzeInhalt(ctx, page, '/X Do\n'.repeat(MAX_FORMAUFRUFE - 1))
    expect(analysiereSeite(ctx, page).formAufrufe).toHaveLength(MAX_FORMAUFRUFE - 1)
  }, 20000)
})

describe('H1d: Operanden ohne Operator, Seiteninhalt ohne Gesamtgrenze', () => {
  it('Operanden ohne Operator: LexFehler nach der Grenze je Operator', () => {
    // Vorher: `0 ` x 30 Mio -> 1,74 GB Heap.
    const bytes = enc.encode('0 '.repeat(5_000_000))
    const { fehler, ms } = gemessen(() => zerlege(bytes))
    expect(fehler).toBeInstanceOf(LexFehler)
    expect(ms).toBeLessThan(3000)
  })

  it('ein TJ-Feld unter der Grenze bleibt lesbar', () => {
    const ops = zerlege(enc.encode('[' + '(a) -5 '.repeat(MAX_WERTE_JE_OPERATOR / 2 - 1) + '] TJ'))
    expect(ops).toHaveLength(1)
  })

  it('Literale und Hex-Strings werden weiter richtig gelesen', () => {
    const ops = zerlege(enc.encode('(a\\(b\\)\\101\\n) Tj <41 42 4> Tj'))
    const erstes = ops[0]?.args[0]
    const zweites = ops[1]?.args[0]
    expect(erstes?.t === 'text' && [...erstes.bytes]).toEqual([97, 40, 98, 41, 65, 10])
    expect(zweites?.t === 'text' && [...zweites.bytes]).toEqual([0x41, 0x42, 0x40])
  })

  it('dieselbe Referenz mehrfach in /Contents wird abgelehnt', async () => {
    const { ctx, page } = await neueSeite()
    const ref = ctx.register(ctx.flateStream(enc.encode('q Q')))
    page.node.set(PDFName.of('Contents'), ctx.obj([ref, ref, ref]))
    expect(() => analysiereSeite(ctx, page)).toThrow(TextAbgelehnt)
  })

  it('Seiteninhalt und Formen teilen sich ein Bytebudget', async () => {
    // Zwei Stroeme mit je 40 MB (komprimiert klein): jeder einzeln unter
    // MAX_STROMBYTES, zusammen darueber.
    const { ctx, page } = await neueSeite()
    const gross = (): PDFRef =>
      ctx.register(
        PDFRawStream.of(
          ctx.obj({ Filter: 'FlateDecode' }),
          new Uint8Array(deflateSync(Buffer.alloc(40 * 1024 * 1024, 32)))
        )
      )
    page.node.set(PDFName.of('Contents'), ctx.obj([gross(), gross()]))
    const { fehler } = gemessen(() => analysiereSeite(ctx, page))
    expect(fehler).toBeInstanceOf(TextAbgelehnt)
  }, 30000)
})

describe('H2a/H2b: ToUnicode', () => {
  it('ohne schliessendes Schluesselwort linear statt quadratisch', () => {
    // 4 MB: vorher hochgerechnet ~110 s je Schrift.
    const text = 'beginbfchar '.repeat(333_000)
    const { fehler, ms } = gemessen(() => leseToUnicode(text))
    expect(fehler).toBeNull()
    expect(ms).toBeLessThan(3000)
    const offen = '<0000> <0000> ['.repeat(250_000)
    expect(gemessen(() => leseToUnicode('beginbfrange ' + offen)).ms).toBeLessThan(3000)
  })

  it('bfrange-Schleifen haben ein Arbeitsbudget', () => {
    // 200 000 volle Spannen: vorher hochgerechnet ~290 s je Schrift.
    const text = 'beginbfrange\n' + '<0000> <FFFF> <0041>\n'.repeat(200_000) + 'endbfrange'
    const { fehler, ms } = gemessen(() => leseToUnicode(text))
    expect(fehler).toBeNull()
    expect(ms).toBeLessThan(3000)
  })

  it('liest bfchar, beide bfrange-Formen, Codelaenge und Kommentare wie bisher', () => {
    const cmap = [
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '% ein Kommentar mit beginbfchar',
      '2 beginbfchar <0003> <0020> <0010> <00660069> endbfchar',
      '2 beginbfrange <0020> <0022> <0041> <0030> <0031> [<0078> <0079>] endbfrange',
      '1 beginbfchar <0050> <0051> ' // ohne endbfchar: zaehlt nicht
    ].join('\n')
    const tu = leseToUnicode(cmap)
    expect(tu.codelaenge).toBe(2)
    expect(Object.fromEntries(tu.zuordnung)).toEqual({
      3: ' ',
      16: 'fi',
      32: 'A',
      33: 'B',
      34: 'C',
      48: 'x',
      49: 'y'
    })
  })
})

describe('H2c: CID-/W mit Bereichen', () => {
  it('Gesamtbudget fuer gesetzte Breiten', async () => {
    // Vorher: je Tripel 65 536 Map.set, 20 000 Tripel ~18 s.
    const { ctx } = await neueSeite()
    const w: number[] = []
    for (let k = 0; k < 20_000; k++) w.push(0, 65535, 1)
    const cid = ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'X', W: w })
    const f = ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'X',
      Encoding: 'Identity-H',
      DescendantFonts: [cid]
    })
    let s: Schrift | undefined
    const { ms } = gemessen(() => (s = new Schrift(ctx, undefined, f)))
    expect(ms).toBeLessThan(3000)
    expect(s?.probleme.join()).toContain('Breitentabelle')
  }, 20000)
})

describe('H2d: tiefer BMC-Stapel', () => {
  it('ActualText ueber einen Zaehler statt includes je Glyph', async () => {
    // 400 000 offene BMC x 100 000 Glyphen: vorher O(Tiefe x Glyphen).
    const { ctx, page } = await neueSeite()
    helvetica(ctx, page)
    setzeInhalt(
      ctx,
      page,
      '/P BMC\n'.repeat(400_000) + 'BT /F1 1 Tf (' + 'A'.repeat(100_000) + ') Tj ET'
    )
    const { fehler, ms } = gemessen(() => analysiereSeite(ctx, page))
    expect(fehler).toBeNull()
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('ActualText gilt nur bis zum passenden EMC', async () => {
    const { ctx, page } = await neueSeite()
    helvetica(ctx, page)
    setzeInhalt(
      ctx,
      page,
      '/Span << /ActualText (x) >> BDC /P BMC BT /F1 1 Tf (a) Tj ET EMC BT (b) Tj ET EMC BT /F1 1 Tf (c) Tj ET'
    )
    const gl = analysiereSeite(ctx, page).glyphen
    expect(gl.map((g) => g.actualText)).toEqual([true, true, false])
  })
})

describe('M3: Filterketten mit Grenze je Stufe', () => {
  const roh = (ctx: PDFContext, dict: Record<string, unknown>, bytes: Uint8Array): PDFRawStream =>
    PDFRawStream.of(ctx.obj(dict as never) as unknown as PDFDict, bytes)

  it('doppeltes Flate: Ablehnung, bevor die Bombe entpackt ist', async () => {
    // Vorher: 1,5 GB entpackt, abgelehnt erst bei RSS 2,6 GB.
    const { ctx } = await neueSeite()
    const innen = deflateSync(Buffer.alloc(100 * 1024 * 1024, 32))
    const aussen = new Uint8Array(deflateSync(innen))
    const s = roh(ctx, { Filter: ['FlateDecode', 'FlateDecode'] }, aussen)
    const { fehler, ms } = gemessen(() => strombytes(s))
    expect(fehler).toBeInstanceOf(TextAbgelehnt)
    expect((fehler as Error).message).toContain('zu groß')
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('Flate mit leerem DecodeParms: dieselbe Grenze wie ohne', async () => {
    const { ctx } = await neueSeite()
    const innen = new Uint8Array(deflateSync(Buffer.alloc(8 * 1024 * 1024, 32)))
    const s = roh(ctx, { Filter: 'FlateDecode', DecodeParms: {} }, innen)
    expect(() => strombytes(s, 1024 * 1024)).toThrow(TextAbgelehnt)
    expect(strombytes(s)).toHaveLength(8 * 1024 * 1024)
  })

  it('ASCIIHex, ASCII85 und Ketten stimmen mit pdf-lib ueberein', async () => {
    const { ctx } = await neueSeite()
    const klar = enc.encode('BT /F1 12 Tf (Hallo Welt) Tj ET')
    const hex = [...klar].map((b) => b.toString(16).padStart(2, '0')).join(' ') + '>'
    const faelle = [
      roh(ctx, { Filter: 'ASCIIHexDecode' }, enc.encode(hex)),
      roh(ctx, { Filter: 'ASCII85Decode' }, enc.encode('9jqo^zBlbD-BleB1DJ+*+F(f,q~>')),
      roh(
        ctx,
        { Filter: ['ASCIIHexDecode', 'FlateDecode'] },
        enc.encode(
          [...deflateSync(klar)].map((b) => b.toString(16).padStart(2, '0')).join('') + '>'
        )
      )
    ]
    for (const s of faelle) {
      expect([...strombytes(s)]).toEqual([...decodePDFRawStream(s).decode()])
    }
  })

  it('abgeschnittenes Flate liefert den lesbaren Anfang', async () => {
    const { ctx } = await neueSeite()
    const voll = deflateSync(Buffer.from('q '.repeat(5000) + 'Q'))
    const s = roh(ctx, { Filter: 'FlateDecode' }, new Uint8Array(voll.subarray(0, voll.length - 6)))
    const bytes = strombytes(s)
    expect(bytes.length).toBeGreaterThan(1000)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('q q ')
  })

  it('andere Filter werden abgelehnt statt ungebremst dekodiert', async () => {
    const { ctx } = await neueSeite()
    for (const dict of [
      { Filter: 'LZWDecode' },
      { Filter: 'RunLengthDecode' },
      { Filter: 'FlateDecode', DecodeParms: { Predictor: 12, Columns: 4 } }
    ]) {
      expect(() => strombytes(roh(ctx, dict, Uint8Array.of(0, 1, 2)))).toThrow(TextAbgelehnt)
    }
  })
})

describe('L1: Schriftname im neuen Textblock', () => {
  it('gibt einen Ressourcennamen mit Leerzeichen und % escapt aus', async () => {
    const { doc, ctx, page } = await neueSeite()
    // Dekodiert "F1 ET Q%": roh eingesetzt kommentierte das `%` den Rest aus.
    helvetica(ctx, page, 'F1 ET Q%')
    setzeInhalt(ctx, page, 'BT /F1#20ET#20Q#25 12 Tf 100 700 Td (Hallo) Tj ET')
    const bytes = await doc.save()
    const zeile = findeZeile(await pdfjsZeilen(bytes), 'Hallo')
    const e = await wendeMutationAnMitBericht(bytes, {
      art: 'textErsetzen',
      seite: 1,
      zeile,
      text: 'Welt'
    })
    expect(e.bericht?.schrift).toBe('original')
    const neu = await PDFDocument.load(e.bytes)
    const inhalt = neu.getPage(0).node.get(PDFName.of('Contents'))
    const strom = neu.context.lookup(inhalt) as PDFRawStream
    const text = new TextDecoder('latin1').decode(decodePDFRawStream(strom).decode())
    expect(text).toContain('/F1#20ET#20Q#25 12 Tf')
    expect(text).not.toContain('F1 ET Q%')
    expect((await pdfjsZeilen(e.bytes)).map((z) => z.text)).toEqual(['Welt'])
  }, 30000)
})

describe('L2: Lookups mit Schluesseln aus dem PDF', () => {
  it('/BaseFont /constructor ist keine Standard-14', async () => {
    const { ctx } = await neueSeite()
    const s = new Schrift(
      ctx,
      undefined,
      ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'constructor' })
    )
    expect(s.std14).toBeUndefined()
  })

  it('/Encoding /constructor faellt auf StandardEncoding zurueck', async () => {
    const { ctx } = await neueSeite()
    const s = new Schrift(
      ctx,
      undefined,
      ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'constructor' })
    )
    expect(s.unicode(65)).toBe('A')
  })
})

describe('L3: TrueType-cmap bereichsgeprueft', () => {
  /** Minimales TrueType mit head, maxp, loca, glyf und einer leeren cmap am Dateiende. */
  function ttMitLeererCmap(): Uint8Array {
    const tabellen: [string, number][] = [
      ['head', 54],
      ['maxp', 6],
      ['loca', 4],
      ['glyf', 0],
      ['cmap', 0]
    ]
    const kopf = 12 + tabellen.length * 16
    const gesamt = kopf + tabellen.reduce((s, [, l]) => s + l, 0)
    const b = new Uint8Array(gesamt)
    const dv = new DataView(b.buffer)
    dv.setUint32(0, 0x00010000)
    dv.setUint16(4, tabellen.length)
    let offset = kopf
    tabellen.forEach(([tag, laenge], k) => {
      const o = 12 + k * 16
      for (let i = 0; i < 4; i++) b[o + i] = tag.charCodeAt(i)
      dv.setUint32(o + 8, offset)
      dv.setUint32(o + 12, laenge)
      if (tag === 'head') dv.setUint16(offset + 18, 1000)
      if (tag === 'maxp') dv.setUint16(offset + 4, 1)
      offset += laenge
    })
    return b
  }

  it('eine cmap der Laenge 0 am Dateiende wirft nicht, sondern liefert null', () => {
    const tt = leseTrueType(ttMitLeererCmap())
    expect(tt).not.toBeNull()
    expect(() => tt?.cmap(3, 1)).not.toThrow()
    expect(tt?.cmap(3, 1)).toBeNull()
  })
})

// S6.10, Fund des Fuzzers: ein unbeendeter Hex-String am Streamende liess
// den Operator ein Byte hinter dem Ende aufhoeren.
describe('Lexer am Streamende', () => {
  it('meldet keinen Bereich ueber das Ende hinaus', () => {
    for (const text of ['<4', '<', 'BI /W 2 <4c ID x EI', '(a) Tj <']) {
      const bytes = new TextEncoder().encode(text)
      for (const op of zerlege(bytes)) expect(op.ende).toBeLessThanOrEqual(bytes.length)
    }
  })
})
