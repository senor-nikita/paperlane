import { Encodings } from '@pdf-lib/standard-fonts'

/**
 * Basiskodierungen und Glyphnamen (S6.6b) - so viel, wie Schriftmodell und
 * Zuordnung brauchen: Code -> Glyphname fuer die vier Basiskodierungen der
 * PDF-Spezifikation (Anhang D) und Glyphname <-> Unicode.
 *
 * WinAnsi, Symbol und ZapfDingbats kommen aus `@pdf-lib/standard-fonts`
 * (schon Laufzeitabhaengigkeit, D22); StandardEncoding und MacRomanEncoding
 * stehen hier, weil die Bibliothek sie nicht mitbringt.
 */

export type Basiskodierung =
  'StandardEncoding' | 'WinAnsiEncoding' | 'MacRomanEncoding' | 'Symbol' | 'ZapfDingbats'

type Tabelle = Map<number, string>

const NAME_ZU_UNICODE = new Map<string, string>()
const UNICODE_ZU_NAME = new Map<string, string>()

function merke(name: string, zeichen: string): void {
  if (!NAME_ZU_UNICODE.has(name)) NAME_ZU_UNICODE.set(name, zeichen)
  if (!UNICODE_ZU_NAME.has(zeichen)) UNICODE_ZU_NAME.set(zeichen, name)
}

function ausStandardFonts(kodierung: (typeof Encodings)[keyof typeof Encodings]): Tabelle {
  const tabelle: Tabelle = new Map()
  // Aufsteigend nach Codepunkt: bei Doppelbelegung ("space" auf 32 und 160,
  // "hyphen" auf 45 und 173) gewinnt der gebraeuchliche kleinere.
  const punkte = [...kodierung.supportedCodePoints].sort((a, b) => a - b)
  for (const cp of punkte) {
    const { code, name } = kodierung.encodeUnicodeCodePoint(cp)
    if (!tabelle.has(code)) tabelle.set(code, name)
    merke(name, String.fromCodePoint(cp))
  }
  return tabelle
}

const WIN_ANSI = ausStandardFonts(Encodings.WinAnsi)
const SYMBOL = ausStandardFonts(Encodings.Symbol)
const ZAPF = ausStandardFonts(Encodings.ZapfDingbats)

// Namen, die in WinAnsi fehlen, aber in Standard/MacRoman oder als Ligaturen
// vorkommen.
for (const [name, zeichen] of [
  ['fi', 'ﬁ'],
  ['fl', 'ﬂ'],
  ['ff', 'ﬀ'],
  ['ffi', 'ﬃ'],
  ['ffl', 'ﬄ'],
  ['dotlessi', 'ı'],
  ['Lslash', 'Ł'],
  ['lslash', 'ł'],
  ['minus', '−'],
  ['fraction', '⁄'],
  ['breve', '˘'],
  ['dotaccent', '˙'],
  ['ring', '˚'],
  ['hungarumlaut', '˝'],
  ['ogonek', '˛'],
  ['caron', 'ˇ'],
  ['quotesingle', "'"],
  ['grave', '`'],
  ['notequal', '≠'],
  ['infinity', '∞'],
  ['lessequal', '≤'],
  ['greaterequal', '≥'],
  ['partialdiff', '∂'],
  ['summation', '∑'],
  ['product', '∏'],
  ['pi', 'π'],
  ['integral', '∫'],
  ['Omega', 'Ω'],
  ['radical', '√'],
  ['approxequal', '≈'],
  ['Delta', '∆'],
  ['lozenge', '◊'],
  ['Ydieresis', 'Ÿ'],
  ['nbspace', ' '],
  ['sfthyphen', '­']
] as const) {
  merke(name, zeichen)
}

// Lateinisch Erweitert-A (U+0100-U+017F) nach der Glyphnamenliste (AGL) - die
// Namen, die Teilmengen aus LaTeX und Office fuer mitteleuropaeische
// Buchstaben benutzen.
;(
  'Amacron amacron Abreve abreve Aogonek aogonek Cacute cacute Ccircumflex ccircumflex ' +
  'Cdotaccent cdotaccent Ccaron ccaron Dcaron dcaron Dcroat dcroat Emacron emacron Ebreve ' +
  'ebreve Edotaccent edotaccent Eogonek eogonek Ecaron ecaron Gcircumflex gcircumflex Gbreve ' +
  'gbreve Gdotaccent gdotaccent Gcommaaccent gcommaaccent Hcircumflex hcircumflex Hbar hbar ' +
  'Itilde itilde Imacron imacron Ibreve ibreve Iogonek iogonek Idotaccent dotlessi IJ ij ' +
  'Jcircumflex jcircumflex Kcommaaccent kcommaaccent kgreenlandic Lacute lacute Lcommaaccent ' +
  'lcommaaccent Lcaron lcaron Ldot ldot Lslash lslash Nacute nacute Ncommaaccent ncommaaccent ' +
  'Ncaron ncaron napostrophe Eng eng Omacron omacron Obreve obreve Ohungarumlaut ohungarumlaut ' +
  'OE oe Racute racute Rcommaaccent rcommaaccent Rcaron rcaron Sacute sacute Scircumflex ' +
  'scircumflex Scedilla scedilla Scaron scaron Tcommaaccent tcommaaccent Tcaron tcaron Tbar ' +
  'tbar Utilde utilde Umacron umacron Ubreve ubreve Uring uring Uhungarumlaut uhungarumlaut ' +
  'Uogonek uogonek Wcircumflex wcircumflex Ycircumflex ycircumflex Ydieresis Zacute zacute ' +
  'Zdotaccent zdotaccent Zcaron zcaron longs'
)
  .split(' ')
  .forEach((name, i) => {
    merke(name, String.fromCharCode(0x100 + i))
  })

/** StandardEncoding (Anhang D): ASCII mit typografischen Hochkommas, dazu 161-251. */
const STANDARD: Tabelle = (() => {
  const t: Tabelle = new Map()
  for (const [code, name] of WIN_ANSI) if (code >= 32 && code <= 126) t.set(code, name)
  t.set(39, 'quoteright')
  t.set(96, 'quoteleft')
  const oben: [number, string][] = [
    [161, 'exclamdown'],
    [162, 'cent'],
    [163, 'sterling'],
    [164, 'fraction'],
    [165, 'yen'],
    [166, 'florin'],
    [167, 'section'],
    [168, 'currency'],
    [169, 'quotesingle'],
    [170, 'quotedblleft'],
    [171, 'guillemotleft'],
    [172, 'guilsinglleft'],
    [173, 'guilsinglright'],
    [174, 'fi'],
    [175, 'fl'],
    [177, 'endash'],
    [178, 'dagger'],
    [179, 'daggerdbl'],
    [180, 'periodcentered'],
    [182, 'paragraph'],
    [183, 'bullet'],
    [184, 'quotesinglbase'],
    [185, 'quotedblbase'],
    [186, 'quotedblright'],
    [187, 'guillemotright'],
    [188, 'ellipsis'],
    [189, 'perthousand'],
    [191, 'questiondown'],
    [193, 'grave'],
    [194, 'acute'],
    [195, 'circumflex'],
    [196, 'tilde'],
    [197, 'macron'],
    [198, 'breve'],
    [199, 'dotaccent'],
    [200, 'dieresis'],
    [202, 'ring'],
    [203, 'cedilla'],
    [205, 'hungarumlaut'],
    [206, 'ogonek'],
    [207, 'caron'],
    [208, 'emdash'],
    [225, 'AE'],
    [227, 'ordfeminine'],
    [232, 'Lslash'],
    [233, 'Oslash'],
    [234, 'OE'],
    [235, 'ordmasculine'],
    [241, 'ae'],
    [245, 'dotlessi'],
    [248, 'lslash'],
    [249, 'oslash'],
    [250, 'oe'],
    [251, 'germandbls']
  ]
  for (const [code, name] of oben) t.set(code, name)
  return t
})()

/** MacRomanEncoding: ASCII wie WinAnsi, obere Haelfte als Unicode (240 ist leer). */
const MAC_ROMAN: Tabelle = (() => {
  const t: Tabelle = new Map()
  for (const [code, name] of WIN_ANSI) if (code >= 32 && code <= 126) t.set(code, name)
  const oben = [
    0xc4, 0xc5, 0xc7, 0xc9, 0xd1, 0xd6, 0xdc, 0xe1, 0xe0, 0xe2, 0xe4, 0xe3, 0xe5, 0xe7, 0xe9, 0xe8,
    0xea, 0xeb, 0xed, 0xec, 0xee, 0xef, 0xf1, 0xf3, 0xf2, 0xf4, 0xf6, 0xf5, 0xfa, 0xf9, 0xfb, 0xfc,
    0x2020, 0xb0, 0xa2, 0xa3, 0xa7, 0x2022, 0xb6, 0xdf, 0xae, 0xa9, 0x2122, 0xb4, 0xa8, 0x2260,
    0xc6, 0xd8, 0x221e, 0xb1, 0x2264, 0x2265, 0xa5, 0xb5, 0x2202, 0x2211, 0x220f, 0x3c0, 0x222b,
    0xaa, 0xba, 0x3a9, 0xe6, 0xf8, 0xbf, 0xa1, 0xac, 0x221a, 0x192, 0x2248, 0x2206, 0xab, 0xbb,
    0x2026, 0x20, 0xc0, 0xc3, 0xd5, 0x152, 0x153, 0x2013, 0x2014, 0x201c, 0x201d, 0x2018, 0x2019,
    0xf7, 0x25ca, 0xff, 0x178, 0x2044, 0xa4, 0x2039, 0x203a, 0xfb01, 0xfb02, 0x2021, 0xb7, 0x201a,
    0x201e, 0x2030, 0xc2, 0xca, 0xc1, 0xcb, 0xc8, 0xcd, 0xce, 0xcf, 0xcc, 0xd3, 0xd4, 0, 0xd2, 0xda,
    0xdb, 0xd9, 0x131, 0x2c6, 0x2dc, 0xaf, 0x2d8, 0x2d9, 0x2da, 0xb8, 0x2dd, 0x2db, 0x2c7
  ]
  oben.forEach((cp, i) => {
    if (cp === 0) return
    const name = UNICODE_ZU_NAME.get(String.fromCodePoint(cp))
    if (name !== undefined) t.set(128 + i, name)
  })
  return t
})()

const TABELLEN: Record<Basiskodierung, Tabelle> = {
  StandardEncoding: STANDARD,
  WinAnsiEncoding: WIN_ANSI,
  MacRomanEncoding: MAC_ROMAN,
  Symbol: SYMBOL,
  ZapfDingbats: ZAPF
}

export function istBasiskodierung(name: string): name is Basiskodierung {
  // Nicht `in`: `/Encoding /constructor` faende sonst eine Prototyp-Eigenschaft (Gate Phase 6, L2).
  return Object.hasOwn(TABELLEN, name)
}

/** Eine frische, veraenderbare Kopie der Tabelle. */
export function basiskodierung(name: Basiskodierung): Map<number, string> {
  return new Map(TABELLEN[name])
}

/** Unicode zu einem Glyphnamen, wie pdf.js ihn ableitet (AGL-Teilmenge, uniXXXX, uXXXX). */
export function glyphnameZuUnicode(name: string): string | null {
  const direkt = NAME_ZU_UNICODE.get(name)
  if (direkt !== undefined) return direkt
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name)
  if (m !== null) return String.fromCodePoint(parseInt(m[1] as string, 16))
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (m !== null) {
    const cp = parseInt(m[1] as string, 16)
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : null
  }
  const punkt = name.indexOf('.')
  if (punkt > 0) return glyphnameZuUnicode(name.slice(0, punkt))
  return null
}

/** Glyphname fuer ein Zeichen (AGL-Name oder uniXXXX). */
export function unicodeZuGlyphname(zeichen: string): string {
  const name = UNICODE_ZU_NAME.get(zeichen)
  if (name !== undefined) return name
  const cp = zeichen.codePointAt(0) ?? 0
  return cp > 0xffff
    ? 'u' + cp.toString(16).toUpperCase()
    : 'uni' + cp.toString(16).toUpperCase().padStart(4, '0')
}
