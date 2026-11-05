import { Font, type FontNames } from '@pdf-lib/standard-fonts'
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, type PDFContext } from 'pdf-lib'
import type { SchriftFamilie } from '../../shared/freitext'
import {
  basiskodierung,
  glyphnameZuUnicode,
  istBasiskodierung,
  unicodeZuGlyphname
} from './kodierungen'
import {
  dict,
  eintrag,
  flacheZahlen,
  latin1,
  nameVon,
  nurDict,
  strombytes,
  zahlenfeld,
  zahlVon,
  type Zahlenfeld
} from './pdfobjekte'
import { leseToUnicode, schreibeToUnicode, type ToUnicode } from './tounicode'
import { leseTrueType, type TrueTypeProgramm } from './truetype'
import { leseType1, type Type1Programm } from './type1'
import { t } from '../../shared/i18n'

/**
 * Das Schriftmodell der Textbearbeitung (S6.6b, ADR 0005 Punkt 3).
 *
 * Kernfrage: laesst sich ein Zeichen mit der **Originalschrift** setzen? Ja
 * nur, wenn es einen Code dafuer gibt **und** der Glyph dahinter einen
 * Umriss hat (TrueType ueber `glyf`, Type1 ueber `/CharStrings`) - oder die
 * Schrift eine nicht eingebettete Standard-14 ist, deren Glyphen jeder
 * Betrachter mitbringt. Sonst setzt der Editor die ganze Zeile in der
 * Ersatzschrift (D22).
 *
 * Nebenbei: Codes aus Strings zerlegen, Breiten, Unicode je Code - genug, um
 * Glyphen zu positionieren und eine Zeile mit dem pdf.js-Text abzugleichen.
 */

export type Patch =
  | { art: 'breite'; code: number; wert: number }
  | { art: 'tounicode'; code: number; text: string }
  | { art: 'differences'; code: number; name: string }

export interface Code {
  code: number
  /** Byte-Offset im String und Laenge des Codes. */
  off: number
  len: number
}

/** Ein kodierter Text: Bytes oder Verschiebungen (wie in `TJ`). */
export type Teil = Uint8Array | number

export type Kodierung = { teile: Teil[]; patches: Patch[] } | { fehler: string }

type Programm =
  | { art: 'truetype'; tt: TrueTypeProgramm }
  | { art: 'type1'; t1: Type1Programm }
  | { art: 'unpruefbar'; beschreibung: string }

const STANDARD14: Record<string, FontNames> = {
  Helvetica: 'Helvetica' as FontNames,
  'Helvetica-Bold': 'Helvetica-Bold' as FontNames,
  'Helvetica-Oblique': 'Helvetica-Oblique' as FontNames,
  'Helvetica-BoldOblique': 'Helvetica-BoldOblique' as FontNames,
  'Times-Roman': 'Times-Roman' as FontNames,
  'Times-Bold': 'Times-Bold' as FontNames,
  'Times-Italic': 'Times-Italic' as FontNames,
  'Times-BoldItalic': 'Times-BoldItalic' as FontNames,
  Courier: 'Courier' as FontNames,
  'Courier-Bold': 'Courier-Bold' as FontNames,
  'Courier-Oblique': 'Courier-Oblique' as FontNames,
  'Courier-BoldOblique': 'Courier-BoldOblique' as FontNames,
  Symbol: 'Symbol' as FontNames,
  ZapfDingbats: 'ZapfDingbats' as FontNames,
  // Gebraeuchliche Aliasse (PDF 1.7, Anhang H.3 / pdf.js).
  Arial: 'Helvetica' as FontNames,
  ArialMT: 'Helvetica' as FontNames,
  'Arial,Bold': 'Helvetica-Bold' as FontNames,
  'Arial-BoldMT': 'Helvetica-Bold' as FontNames,
  'Arial,Italic': 'Helvetica-Oblique' as FontNames,
  'Arial-ItalicMT': 'Helvetica-Oblique' as FontNames,
  TimesNewRoman: 'Times-Roman' as FontNames,
  TimesNewRomanPSMT: 'Times-Roman' as FontNames,
  'TimesNewRoman,Bold': 'Times-Bold' as FontNames,
  'TimesNewRomanPS-BoldMT': 'Times-Bold' as FontNames,
  CourierNew: 'Courier' as FontNames,
  CourierNewPSMT: 'Courier' as FontNames
}

/** Hoechstens so viele gesetzte CID-Breiten je Schrift (Gate Phase 6, H2c). */
const MAX_BREITENSCHRITTE = 1_000_000

/** Gelesene ToUnicode-CMaps je Strom-Objekt; die Zuordnung wird nie veraendert. */
const TOUNICODE_CACHE = new WeakMap<object, ToUnicode>()

const LEERZEICHEN = new Set([' ', ' '])

export class Schrift {
  readonly benutzt = new Set<number>()
  readonly probleme: string[] = []
  readonly subtype: string
  readonly basisName: string
  readonly kurzName: string
  readonly eingebettet: boolean
  readonly bytesJeCode: 1 | 2
  /** Nicht eingebettete Standard-14 (auch ueber einen Alias). */
  readonly std14: FontNames | undefined
  private readonly afm: Font | undefined
  private readonly flags: number
  private readonly gewicht: number
  private readonly programm: Programm | null
  private toUnicode: ToUnicode | null = null
  // Type0
  private cidDict: PDFDict | undefined
  private readonly cidBreiten = new Map<number, number>()
  private dw = 1000
  private cidZuGid: ((cid: number) => number) | null = null
  private cidZuGidStrom = false
  // einfache Schriften
  private firstChar = 0
  private widths: number[] | undefined
  private kodierung = new Map<number, string>()
  private readonly differences = new Map<number, string>()
  private type3Skala = 1
  // noch nicht geschriebene Aenderungen
  private readonly neueBreiten = new Map<number, number>()
  private readonly neueToUnicode = new Map<number, string>()
  private readonly neueDifferences = new Map<number, string>()

  constructor(
    private readonly ctx: PDFContext,
    readonly ref: PDFRef | undefined,
    readonly dict: PDFDict
  ) {
    this.subtype = nameVon(ctx, dict, 'Subtype') ?? 'Type1'
    this.basisName = nameVon(ctx, dict, 'BaseFont') ?? '(ohne Namen)'
    this.kurzName = this.basisName.replace(/^[A-Z]{6}\+/, '')

    let deskriptor: PDFDict | undefined
    if (this.subtype === 'Type0') {
      this.bytesJeCode = 2
      deskriptor = this.leseType0()
    } else {
      this.bytesJeCode = 1
      deskriptor = nurDict(ctx, dict.get(PDFName.of('FontDescriptor')))
      this.leseEinfach()
    }
    this.flags = zahlVon(ctx, deskriptor, 'Flags') ?? 0
    this.gewicht = zahlVon(ctx, deskriptor, 'FontWeight') ?? 400
    this.programm = this.leseProgramm(deskriptor)
    this.eingebettet = this.programm !== null
    // `Object.hasOwn`: `/BaseFont /constructor` fand sonst die Object-Funktion (Gate Phase 6, L2).
    this.std14 =
      this.eingebettet || !Object.hasOwn(STANDARD14, this.kurzName)
        ? undefined
        : STANDARD14[this.kurzName]
    if (!this.eingebettet && this.subtype !== 'Type0' && this.subtype !== 'Type3') {
      try {
        this.afm = Font.load(this.std14 ?? 'Helvetica')
      } catch {
        this.afm = undefined
      }
    }
    if (this.subtype !== 'Type0' && !dict.has(PDFName.of('Encoding'))) this.eingebauteKodierung()

    const tu = eintrag(ctx, dict, 'ToUnicode')
    if (tu !== undefined && !(tu instanceof PDFName)) {
      try {
        // Mehrere Schriften nennen oft denselben Strom: einmal lesen genuegt.
        const bekannt = TOUNICODE_CACHE.get(tu)
        this.toUnicode = bekannt ?? leseToUnicode(latin1(strombytes(tu, 4 * 1024 * 1024)))
        if (bekannt === undefined) TOUNICODE_CACHE.set(tu, this.toUnicode)
      } catch {
        this.probleme.push(t('schrift.toUnicode', { schrift: this.kurzName }))
      }
    }
  }

  private leseType0(): PDFDict | undefined {
    const ctx = this.ctx
    const enc = eintrag(ctx, this.dict, 'Encoding')
    const cmap = enc instanceof PDFName ? enc.decodeText() : '(eingebettete CMap)'
    if (cmap === 'Identity-V') {
      this.probleme.push(t('schrift.senkrecht'))
    } else if (cmap !== 'Identity-H') {
      this.probleme.push(t('schrift.cmap', { cmap }))
    }
    const kinder = eintrag(ctx, this.dict, 'DescendantFonts')
    const cid = kinder instanceof PDFArray ? nurDict(ctx, kinder.get(0)) : undefined
    if (cid === undefined) {
      this.probleme.push(t('schrift.ohneCid'))
      return undefined
    }
    this.cidDict = cid
    this.dw = zahlVon(ctx, cid, 'DW') ?? 1000
    const w: Zahlenfeld = zahlenfeld(ctx, cid.get(PDFName.of('W'))) ?? []
    // Gate Phase 6, H2c: jedes Tripel darf bis zu 65 536 Breiten setzen - ohne
    // Gesamtbudget kosteten eine Million Tripel eine Viertelstunde.
    let schritte = 0
    for (let k = 0; k < w.length;) {
      const a = w[k]
      const b = w[k + 1]
      if (typeof a !== 'number') break
      if (Array.isArray(b)) {
        schritte += Math.min(b.length, 65536) + 1
        if (schritte > MAX_BREITENSCHRITTE) break
        b.forEach((x, j) => {
          if (typeof x === 'number' && j < 65536) this.cidBreiten.set(a + j, x)
        })
        k += 2
      } else {
        const wert = w[k + 2]
        if (typeof b !== 'number' || typeof wert !== 'number') break
        schritte += Math.max(0, Math.min(b - a + 1, 65536)) + 1
        if (schritte > MAX_BREITENSCHRITTE) break
        for (let c = a; c <= b && c - a < 65536; c++) this.cidBreiten.set(c, wert)
        k += 3
      }
    }
    if (schritte > MAX_BREITENSCHRITTE) {
      this.probleme.push(t('schrift.breiten', { schrift: this.kurzName }))
    }
    const c2g = eintrag(ctx, cid, 'CIDToGIDMap')
    if (c2g !== undefined && !(c2g instanceof PDFName)) {
      this.cidZuGidStrom = true
      try {
        const b = strombytes(c2g, 4 * 1024 * 1024)
        this.cidZuGid = (c) =>
          c * 2 + 1 < b.length ? ((b[c * 2] as number) << 8) | (b[c * 2 + 1] as number) : 0
      } catch {
        this.cidZuGid = () => 0
      }
    }
    return nurDict(ctx, cid.get(PDFName.of('FontDescriptor')))
  }

  private leseEinfach(): void {
    const ctx = this.ctx
    // Gate Phase 6, H1a: einfache Schriften haben Codes 0..255. Ein `/FirstChar`
    // ausserhalb liess den `/Widths`-Neuaufbau in `wendeAn` ueber Hunderte
    // Millionen Codes laufen (oder endlos, bei 1e308).
    const first = zahlVon(ctx, this.dict, 'FirstChar') ?? 0
    if (Number.isInteger(first) && first >= 0 && first <= 255) this.firstChar = first
    else this.probleme.push(t('schrift.firstChar', { schrift: this.kurzName }))
    this.widths = flacheZahlen(zahlenfeld(ctx, this.dict.get(PDFName.of('Widths'))))?.slice(
      0,
      256 - this.firstChar
    )
    const enc = eintrag(ctx, this.dict, 'Encoding')
    let basis = 'StandardEncoding'
    if (enc instanceof PDFName) basis = enc.decodeText()
    else if (enc instanceof PDFDict) {
      basis = nameVon(ctx, enc, 'BaseEncoding') ?? 'StandardEncoding'
      const diff = eintrag(ctx, enc, 'Differences')
      if (diff instanceof PDFArray) {
        let code = 0
        for (const x of diff.asArray()) {
          const v = this.ctx.lookup(x)
          if (v instanceof PDFNumber) code = v.asNumber()
          else if (v instanceof PDFName && code >= 0 && code < 256)
            this.differences.set(code++, v.decodeText())
        }
      }
    }
    this.kodierung = basiskodierung(istBasiskodierung(basis) ? basis : 'StandardEncoding')
    for (const [c, n] of this.differences) this.kodierung.set(c, n)
    if (this.subtype === 'Type3') {
      const fm = flacheZahlen(zahlenfeld(ctx, this.dict.get(PDFName.of('FontMatrix'))))
      this.type3Skala = (fm?.[0] ?? 0.001) * 1000
      this.probleme.push(t('schrift.type3', { schrift: this.kurzName }))
    }
  }

  /** Ohne `/Encoding`: die eingebaute Kodierung des Programms oder der Standard-14. */
  private eingebauteKodierung(): void {
    if (
      this.programm?.art === 'type1' &&
      !this.programm.t1.standardKodierung &&
      this.programm.t1.kodierung.size > 0
    ) {
      this.kodierung = new Map(this.programm.t1.kodierung)
    } else if (this.kurzName === 'Symbol') {
      this.kodierung = basiskodierung('Symbol')
    } else if (this.kurzName === 'ZapfDingbats') {
      this.kodierung = basiskodierung('ZapfDingbats')
    }
    for (const [c, n] of this.differences) this.kodierung.set(c, n)
  }

  private leseProgramm(deskriptor: PDFDict | undefined): Programm | null {
    if (deskriptor === undefined) return null
    const ctx = this.ctx
    for (const schluessel of ['FontFile', 'FontFile2', 'FontFile3']) {
      const s = eintrag(ctx, deskriptor, schluessel)
      if (s === undefined) continue
      try {
        const bytes = strombytes(s, 32 * 1024 * 1024)
        if (schluessel === 'FontFile') {
          const t1 = leseType1(bytes, zahlVon(ctx, dict(ctx, s), 'Length1') ?? 0)
          return t1 === null ? { art: 'unpruefbar', beschreibung: 'Type1' } : { art: 'type1', t1 }
        }
        const tt = leseTrueType(bytes)
        if (tt !== null) return { art: 'truetype', tt }
        const sub = nameVon(ctx, dict(ctx, s), 'Subtype') ?? schluessel
        return { art: 'unpruefbar', beschreibung: sub }
      } catch {
        return { art: 'unpruefbar', beschreibung: schluessel }
      }
    }
    return null
  }

  /**
   * Technische Beschreibung fuer Protokoll und Tests.
   * Erscheint in keiner Meldung.
   */
  // KEIN-UI-TEXT-BEGINN
  get art(): string {
    if (this.subtype === 'Type0') return 'Type0 ' + (this.programm?.art ?? 'nicht eingebettet')
    if (!this.eingebettet)
      return this.subtype + (this.std14 !== undefined ? ' (Standard-14)' : ' (nicht eingebettet)')
    return this.subtype + ' ' + (this.programm?.art ?? '')
  }
  // KEIN-UI-TEXT-ENDE

  dekodiere(bytes: Uint8Array): Code[] {
    const n = this.bytesJeCode
    const out: Code[] = []
    for (let k = 0; k + n <= bytes.length; k += n) {
      out.push({
        code:
          n === 2 ? ((bytes[k] as number) << 8) | (bytes[k + 1] as number) : (bytes[k] as number),
        off: k,
        len: n
      })
    }
    return out
  }

  /** Breite in Glyphraum-Einheiten (1/1000 em). */
  breite(code: number): number {
    const neu = this.neueBreiten.get(code)
    if (neu !== undefined) return neu
    if (this.subtype === 'Type0') return this.cidBreiten.get(code) ?? this.dw
    if (this.widths !== undefined) {
      const w = this.widths[code - this.firstChar]
      if (w !== undefined) return this.subtype === 'Type3' ? w * this.type3Skala : w
    }
    if (this.afm !== undefined) {
      const name = this.kodierung.get(code)
      return name === undefined ? 0 : (this.afm.getWidthOfGlyph(name) ?? 0)
    }
    return 0
  }

  unicode(code: number): string | null {
    const neu = this.neueToUnicode.get(code)
    if (neu !== undefined) return neu
    const tu = this.toUnicode?.zuordnung.get(code)
    if (tu !== undefined) return tu
    if (this.subtype === 'Type0') return null
    const name = this.kodierung.get(code)
    return name === undefined ? null : glyphnameZuUnicode(name)
  }

  /** Stil fuer die Ersatzschrift - aus Name und Deskriptor geraten. */
  stil(): { familie: SchriftFamilie; fett: boolean; kursiv: boolean } {
    const n = this.kurzName
    const fett =
      /bold|black|heavy|semibold|demi|,b\b/i.test(n) ||
      this.gewicht >= 600 ||
      (this.flags & 262144) !== 0
    const kursiv = /italic|oblique|,i\b|kursiv/i.test(n) || (this.flags & 64) !== 0
    let familie: SchriftFamilie = 'Helvetica'
    if ((this.flags & 1) !== 0 || /courier|mono|consol|typewriter|cmtt/i.test(n))
      familie = 'Courier'
    else if (/sans|arial|helvet|calibri|verdana|segoe|tahoma|gothic|grotesk/i.test(n))
      familie = 'Helvetica'
    else if (
      (this.flags & 2) !== 0 ||
      /times|serif|roman|cambria|georgia|garamond|minion|cmr|lmroman|book|palatino/i.test(n)
    ) {
      familie = 'Times'
    }
    return { familie, fett, kursiv }
  }

  private inversUnicode(): Map<string, number> {
    const m = new Map<string, number>()
    const add = (c: number): void => {
      const u = this.unicode(c)
      if (u !== null && u.length > 0 && !m.has(u)) m.set(u, c)
    }
    for (const c of [...this.benutzt].sort((a, b) => a - b)) add(c)
    if (this.toUnicode !== null) for (const c of this.toUnicode.zuordnung.keys()) add(c)
    for (const c of this.kodierung.keys()) add(c)
    return m
  }

  private codeFuerName(name: string): number | undefined {
    for (const [c, n] of this.kodierung) if (n === name) return c
    return undefined
  }

  private ttGid(tt: TrueTypeProgramm, code: number, zeichen: string | null): number {
    const l30 = tt.cmap(3, 0)
    if (l30 !== null) return l30(0xf000 + code) || l30(code)
    const l31 = tt.cmap(3, 1)
    if (l31 !== null && zeichen !== null) return l31(zeichen.codePointAt(0) ?? 0)
    const l10 = tt.cmap(1, 0)
    if (l10 !== null) return l10(code)
    return code < tt.anzahlGlyphen ? code : 0
  }

  private ttBreite(tt: TrueTypeProgramm, gid: number): number {
    return Math.round((tt.vorschub(gid) * 1000) / tt.einheitenProEm)
  }

  /** true = Glyph mit Umriss da, false = sicher nicht, null = nicht pruefbar. */
  private glyphVorhanden(code: number, zeichen: string, ohneUmriss: boolean): boolean | null {
    const p = this.programm
    if (p === null) {
      if (this.subtype === 'Type0') return null
      const name = this.kodierung.get(code)
      if (name === undefined) return null
      if (this.std14 !== undefined && this.afm !== undefined)
        return (this.afm.getWidthOfGlyph(name) ?? 0) > 0 || ohneUmriss
      return true
    }
    if (p.art === 'truetype') {
      if (this.subtype === 'Type0') {
        const gid = this.cidZuGid === null ? code : this.cidZuGid(code)
        if (gid <= 0 || gid >= p.tt.anzahlGlyphen) return false
        return ohneUmriss || p.tt.hatUmriss(gid)
      }
      const gid = this.ttGid(p.tt, code, zeichen)
      if (gid <= 0) return false
      return ohneUmriss || p.tt.hatUmriss(gid)
    }
    if (p.art === 'type1') {
      const name = this.kodierung.get(code)
      return name === undefined ? false : p.t1.glyphen.has(name)
    }
    return this.benutzt.has(code) ? true : null
  }

  /**
   * Kodiert einen Text mit dieser Schrift - oder begruendet, warum nicht.
   * Kein Mischen: scheitert ein Zeichen, scheitert der ganze Text.
   */
  kodiere(text: string, unsichtbar: boolean): Kodierung {
    if (this.probleme.length > 0) return { fehler: this.probleme[0] as string }
    const teile: Teil[] = []
    const patches: Patch[] = []
    const neu = new Map<string, number>()
    for (const zeichen of text) {
      const ergebnis = this.kodiereZeichen(zeichen, unsichtbar, neu, patches)
      if ('fehler' in ergebnis) {
        if (LEERZEICHEN.has(zeichen)) {
          // Ohne Leerzeichen-Glyph: eine Viertel-em-Luecke als Verschiebung.
          teile.push(-250)
          continue
        }
        return ergebnis
      }
      const letztes = teile[teile.length - 1]
      if (letztes instanceof Uint8Array) {
        const zusammen = new Uint8Array(letztes.length + ergebnis.bytes.length)
        zusammen.set(letztes)
        zusammen.set(ergebnis.bytes, letztes.length)
        teile[teile.length - 1] = zusammen
      } else teile.push(ergebnis.bytes)
    }
    return { teile, patches }
  }

  private alsBytes(code: number): Uint8Array {
    return this.bytesJeCode === 2 ? Uint8Array.of(code >> 8, code & 255) : Uint8Array.of(code & 255)
  }

  private kodiereZeichen(
    zeichen: string,
    unsichtbar: boolean,
    schonNeu: Map<string, number>,
    patches: Patch[]
  ): { bytes: Uint8Array } | { fehler: string } {
    const vorher = schonNeu.get(zeichen)
    if (vorher !== undefined) return { bytes: this.alsBytes(vorher) }
    const leer = LEERZEICHEN.has(zeichen)
    const inv = this.inversUnicode()
    const bekannt = inv.get(zeichen)

    if (bekannt !== undefined) {
      const pruefung = this.glyphVorhanden(bekannt, zeichen, unsichtbar || leer)
      if (pruefung === false) return { fehler: t('schrift.glyphFehlt', { zeichen }) }
      if (pruefung === true || this.benutzt.has(bekannt)) {
        if (this.breite(bekannt) === 0 && !leer) {
          const w = this.programmBreite(bekannt, zeichen)
          if (w === 0) return { fehler: t('schrift.keineBreite', { zeichen }) }
          if (!this.nurAfmBreiten()) patches.push({ art: 'breite', code: bekannt, wert: w })
          this.neueBreiten.set(bekannt, w)
        }
        if (this.toUnicode !== null && !this.toUnicode.zuordnung.has(bekannt)) {
          patches.push({ art: 'tounicode', code: bekannt, text: zeichen })
        }
        schonNeu.set(zeichen, bekannt)
        return { bytes: this.alsBytes(bekannt) }
      }
    }

    const p = this.programm
    if (p === null) {
      if (this.subtype === 'Type0') return { fehler: t('schrift.cidNichtEingebettet') }
      const name = unicodeZuGlyphname(zeichen)
      const code = this.codeFuerName(name)
      if (code === undefined) return { fehler: t('schrift.nichtKodiert', { zeichen }) }
      const w = this.afm?.getWidthOfGlyph(name) ?? 0
      if (w <= 0 && !leer) return { fehler: t('schrift.stdOhneGlyph', { zeichen }) }
      if (this.breite(code) === 0 && !this.nurAfmBreiten())
        patches.push({ art: 'breite', code, wert: w })
      this.neueBreiten.set(code, this.breite(code) || w)
      schonNeu.set(zeichen, code)
      return { bytes: this.alsBytes(code) }
    }

    if (this.subtype === 'Type0') {
      if (p.art !== 'truetype')
        return {
          fehler: t('schrift.cidNichtPruefbar', {
            art: p.art === 'type1' ? 'Type1' : p.beschreibung
          })
        }
      const l = p.tt.cmap(3, 1) ?? p.tt.cmap(3, 10) ?? p.tt.cmap(0, 3)
      if (l === null) return { fehler: t('schrift.ohneZeichentabelle', { zeichen }) }
      const gid = l(zeichen.codePointAt(0) ?? 0)
      if (gid <= 0 || gid >= p.tt.anzahlGlyphen)
        return { fehler: t('schrift.glyphFehlt', { zeichen }) }
      if (!leer && !unsichtbar && !p.tt.hatUmriss(gid))
        return { fehler: t('schrift.glyphFehlt', { zeichen }) }
      if (this.cidZuGidStrom) return { fehler: t('schrift.cidStrom') }
      const w = this.ttBreite(p.tt, gid)
      patches.push(
        { art: 'tounicode', code: gid, text: zeichen },
        { art: 'breite', code: gid, wert: w }
      )
      this.neueBreiten.set(gid, w)
      this.neueToUnicode.set(gid, zeichen)
      schonNeu.set(zeichen, gid)
      return { bytes: this.alsBytes(gid) }
    }

    if (p.art === 'type1') {
      const name = unicodeZuGlyphname(zeichen)
      if (!p.t1.glyphen.has(name)) return { fehler: t('schrift.glyphFehlt', { zeichen }) }
      let code = this.codeFuerName(name)
      if (code === undefined) {
        code = this.freierCode()
        if (code === undefined) return { fehler: t('schrift.keinCode') }
        patches.push({ art: 'differences', code, name })
        this.neueDifferences.set(code, name)
        this.kodierung.set(code, name)
      }
      const w = p.t1.glyphen.get(name) ?? 0
      if (this.breite(code) === 0) patches.push({ art: 'breite', code, wert: w })
      this.neueBreiten.set(code, this.breite(code) || w)
      if (this.toUnicode !== null) patches.push({ art: 'tounicode', code, text: zeichen })
      schonNeu.set(zeichen, code)
      return { bytes: this.alsBytes(code) }
    }

    if (p.art === 'truetype') {
      const name = unicodeZuGlyphname(zeichen)
      const code = this.codeFuerName(name)
      if (code === undefined) return { fehler: t('schrift.nichtKodiert', { zeichen }) }
      const gid = this.ttGid(p.tt, code, zeichen)
      if (gid <= 0 || (!leer && !unsichtbar && !p.tt.hatUmriss(gid))) {
        return { fehler: t('schrift.glyphFehlt', { zeichen }) }
      }
      const w = this.ttBreite(p.tt, gid)
      if (this.breite(code) === 0) patches.push({ art: 'breite', code, wert: w })
      this.neueBreiten.set(code, this.breite(code) || w)
      if (this.toUnicode !== null) patches.push({ art: 'tounicode', code, text: zeichen })
      schonNeu.set(zeichen, code)
      return { bytes: this.alsBytes(code) }
    }
    return { fehler: t('schrift.nichtPruefbar', { art: p.beschreibung }) }
  }

  /** Standard-14 ohne `/Widths`: Breiten kommen aus den AFM-Daten des Betrachters. */
  private nurAfmBreiten(): boolean {
    return this.subtype !== 'Type0' && this.widths === undefined && !this.eingebettet
  }

  private programmBreite(code: number, zeichen: string): number {
    const p = this.programm
    if (p?.art === 'truetype') {
      const gid =
        this.subtype === 'Type0' ? (this.cidZuGid?.(code) ?? code) : this.ttGid(p.tt, code, zeichen)
      return this.ttBreite(p.tt, gid)
    }
    if (p?.art === 'type1') {
      const name = this.kodierung.get(code)
      return name === undefined ? 0 : (p.t1.glyphen.get(name) ?? 0)
    }
    const name = this.kodierung.get(code)
    return name === undefined ? 0 : (this.afm?.getWidthOfGlyph(name) ?? 0)
  }

  private freierCode(): number | undefined {
    for (let c = 33; c < 256; c++) {
      if (!this.kodierung.has(c) && !this.benutzt.has(c)) return c
    }
    return undefined
  }

  /** Schreibt die Patches aus `kodiere` in das Schrift-Dictionary. */
  wendeAn(patches: readonly Patch[]): void {
    if (patches.length === 0) return
    const ctx = this.ctx
    const breiten = new Map<number, number>()
    const unicode = new Map<number, string>()
    const diffs = new Map<number, string>()
    for (const p of patches) {
      if (p.art === 'breite') breiten.set(p.code, p.wert)
      else if (p.art === 'tounicode') unicode.set(p.code, p.text)
      else diffs.set(p.code, p.name)
    }
    if (breiten.size > 0) {
      if (this.subtype === 'Type0' && this.cidDict !== undefined) {
        const w = ctx.obj([])
        const alt = eintrag(ctx, this.cidDict, 'W')
        if (alt instanceof PDFArray) for (const x of alt.asArray()) w.push(x)
        for (const [cid, b] of breiten) {
          w.push(ctx.obj(cid))
          w.push(ctx.obj([b]))
        }
        this.cidDict.set(PDFName.of('W'), w)
      } else if (this.subtype !== 'Type0') {
        const alt = this.widths ?? []
        const codes = [...breiten.keys()]
        // Auf 0..255 geklemmt: mehr Codes hat eine einfache Schrift nicht (H1a).
        const erst = Math.max(
          0,
          alt.length > 0 ? Math.min(this.firstChar, ...codes) : Math.min(...codes)
        )
        const letzt = Math.min(
          255,
          Math.max(alt.length > 0 ? this.firstChar + alt.length - 1 : 0, ...codes)
        )
        const neu: number[] = []
        for (let c = erst; c <= letzt; c++) neu.push(breiten.get(c) ?? alt[c - this.firstChar] ?? 0)
        this.dict.set(PDFName.of('FirstChar'), ctx.obj(erst))
        this.dict.set(PDFName.of('LastChar'), ctx.obj(letzt))
        this.dict.set(PDFName.of('Widths'), ctx.obj(neu))
        this.widths = neu
        this.firstChar = erst
      }
    }
    if (diffs.size > 0 && this.subtype !== 'Type0') {
      const enc = eintrag(ctx, this.dict, 'Encoding')
      const liste: (number | PDFName)[] = []
      for (const [c, n] of [...this.differences, ...diffs].sort((a, b) => a[0] - b[0])) {
        liste.push(c, PDFName.of(n))
        this.differences.set(c, n)
      }
      const encDict = ctx.obj({ Type: 'Encoding', Differences: liste })
      const basis =
        enc instanceof PDFName
          ? enc
          : enc instanceof PDFDict
            ? enc.get(PDFName.of('BaseEncoding'))
            : undefined
      if (basis !== undefined) encDict.set(PDFName.of('BaseEncoding'), basis)
      this.dict.set(PDFName.of('Encoding'), encDict)
    }
    if (unicode.size > 0) {
      const alle = new Map(this.toUnicode?.zuordnung ?? [])
      for (const [c, u] of unicode) alle.set(c, u)
      const text = schreibeToUnicode(alle, this.toUnicode?.codelaenge ?? this.bytesJeCode)
      const stream = ctx.flateStream(new TextEncoder().encode(text))
      this.dict.set(PDFName.of('ToUnicode'), ctx.register(stream))
      this.toUnicode = {
        zuordnung: alle,
        codelaenge: this.toUnicode?.codelaenge ?? this.bytesJeCode
      }
    }
    for (const [c, w] of breiten) this.neueBreiten.set(c, w)
  }
}

/** Eine Schrift je Dictionary; eine kaputte wird zur Schrift mit Problem, nicht zur Ausnahme. */
export function schriftCache(ctx: PDFContext): (obj: PDFRef | PDFDict) => Schrift | null {
  const cache = new Map<PDFRef | PDFDict, Schrift | null>()
  return (obj) => {
    const vorhanden = cache.get(obj)
    if (vorhanden !== undefined) return vorhanden
    const d = obj instanceof PDFRef ? nurDict(ctx, obj) : obj
    let schrift: Schrift | null = null
    if (d !== undefined) {
      try {
        schrift = new Schrift(ctx, obj instanceof PDFRef ? obj : undefined, d)
      } catch {
        schrift = null
      }
    }
    cache.set(obj, schrift)
    return schrift
  }
}
