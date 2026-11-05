/**
 * `/ToUnicode`-CMaps lesen und schreiben (S6.6b).
 *
 * Lesen: `bfchar` und `bfrange` (beide Formen), Codelaenge aus dem ersten
 * `codespacerange`. Schreiben: nur `bfchar`, in Bloecken zu 100 Eintraegen,
 * wie es die Spezifikation verlangt. Fremde Eingabe: Groesse und
 * Eintragszahl sind begrenzt, Bereiche ueber 65 536 Codes werden ignoriert.
 */

export interface ToUnicode {
  zuordnung: Map<number, string>
  codelaenge: number
}

const MAX_EINTRAEGE = 200_000
const MAX_TEXTLAENGE = 4 * 1024 * 1024
/**
 * Arbeitsbudget je CMap (Gate Phase 6, H2b): gezaehlt wird jeder Schritt in
 * einer `bfrange`-Schleife, nicht nur neue Codes - sonst kostet dieselbe
 * volle Spanne, tausendfach wiederholt, beliebig viel.
 */
const MAX_SCHRITTE = 1_000_000
/** Laengere Zielzeichenketten sind keine Zeichen, sondern Muell. */
const MAX_ZIELLAENGE = 512

function hexZuText(hex: string): string {
  if (hex.length <= 2) return hex.length === 0 ? '' : String.fromCharCode(parseInt(hex, 16))
  let s = ''
  for (let k = 0; k + 4 <= hex.length; k += 4)
    s += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16))
  return s
}

type CMapToken =
  { t: 'hex'; v: string } | { t: 'wort'; v: string } | { t: 'auf' } | { t: 'zu' } | { t: 'muell' }

function istHex(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

function istLeer(c: number): boolean {
  return c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32
}

/**
 * Zerlegt den CMap-Text in einem einzigen Durchlauf (Gate Phase 6, H2a):
 * vorher suchten Regex mit trager "beliebiges Zeichen"-Gruppe die Bloecke,
 * und ohne schliessendes Schluesselwort lief jede Startposition bis zum
 * Textende - quadratisch in der Laenge.
 */
function* cmapTokens(text: string): Generator<CMapToken> {
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    if (istLeer(c)) {
      i++
      continue
    }
    if (c === 37) {
      // Kommentar bis Zeilenende
      while (i < n && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++
      continue
    }
    if (c === 60) {
      if (text.charCodeAt(i + 1) === 60) {
        i += 2
        yield { t: 'muell' }
        continue
      }
      const start = i + 1
      let k = start
      while (k < n && istHex(text.charCodeAt(k))) k++
      if (text.charCodeAt(k) === 62) {
        yield { t: 'hex', v: text.slice(start, k) }
        i = k + 1
      } else {
        // Kein reiner Hex-String: nur das "<" verwerfen und weiterlesen.
        yield { t: 'muell' }
        i = start
      }
      continue
    }
    if (c === 91 || c === 93) {
      i++
      yield { t: c === 91 ? 'auf' : 'zu' }
      continue
    }
    if (c === 40) {
      // Literale wie die Registry im CIDSystemInfo: bis zur schliessenden Klammer ueberspringen.
      let tiefe = 0
      while (i < n) {
        const z = text.charCodeAt(i++)
        if (z === 92) i++
        else if (z === 40) tiefe++
        else if (z === 41 && --tiefe === 0) break
      }
      yield { t: 'muell' }
      continue
    }
    const start = i
    while (i < n) {
      const z = text.charCodeAt(i)
      if (istLeer(z) || z === 60 || z === 62 || z === 91 || z === 93 || z === 40 || z === 37) break
      i++
    }
    if (i === start) {
      i++
      yield { t: 'muell' }
    } else yield { t: 'wort', v: text.slice(start, i) }
  }
}

export function leseToUnicode(text: string): ToUnicode {
  const zuordnung = new Map<number, string>()
  if (text.length > MAX_TEXTLAENGE) return { zuordnung, codelaenge: 1 }
  let codelaenge = 1
  let raumGelesen = false
  let schritte = 0
  const setze = (code: number, wert: string): boolean => {
    zuordnung.set(code, wert)
    return zuordnung.size < MAX_EINTRAEGE && ++schritte < MAX_SCHRITTE
  }

  // Ein Block zaehlt wie bisher nur mit seinem schliessenden Schluesselwort;
  // sein Inhalt wird deshalb erst gesammelt und am Ende angewendet.
  type Block = { art: 'raum' | 'bfchar' | 'bfrange'; toks: CMapToken[] }
  const ENDE = { raum: 'endcodespacerange', bfchar: 'endbfchar', bfrange: 'endbfrange' }
  let block: Block | null = null

  const wendeAn = (b: Block): boolean => {
    const toks = b.toks
    if (b.art === 'raum') {
      const erstes = toks.find((x) => x.t === 'hex' && x.v.length > 0)
      if (!raumGelesen && erstes !== undefined && erstes.t === 'hex') {
        codelaenge = Math.max(1, Math.min(4, erstes.v.length / 2))
      }
      raumGelesen = true
      return true
    }
    if (b.art === 'bfchar') {
      for (let k = 0; k + 1 < toks.length; k++) {
        const a = toks[k] as CMapToken
        const z = toks[k + 1] as CMapToken
        if (a.t !== 'hex' || a.v.length === 0 || z.t !== 'hex') continue
        k++
        if (z.v.length > MAX_ZIELLAENGE) continue
        if (!setze(parseInt(a.v, 16), hexZuText(z.v))) return false
      }
      return true
    }
    for (let k = 0; k + 2 < toks.length; k++) {
      const a = toks[k] as CMapToken
      const e = toks[k + 1] as CMapToken
      const z = toks[k + 2] as CMapToken
      if (a.t !== 'hex' || e.t !== 'hex' || a.v.length === 0 || e.v.length === 0) continue
      const von = parseInt(a.v, 16)
      const bis = parseInt(e.v, 16)
      if (z.t === 'hex') {
        k += 2
        if (bis < von || bis - von > 65535 || z.v.length > MAX_ZIELLAENGE) continue
        const basis = hexZuText(z.v)
        if (basis.length === 0) continue
        const letztes = basis.charCodeAt(basis.length - 1)
        const stamm = basis.slice(0, -1)
        for (let c = von; c <= bis; c++) {
          if (!setze(c, stamm + String.fromCharCode((letztes + (c - von)) & 0xffff))) return false
        }
      } else if (z.t === 'auf') {
        const teile: string[] = []
        let j = k + 3
        for (; j < toks.length; j++) {
          const x = toks[j] as CMapToken
          if (x.t === 'zu') break
          if (x.t === 'hex') teile.push(x.v.length > MAX_ZIELLAENGE ? '' : hexZuText(x.v))
          else break
        }
        if (toks[j]?.t !== 'zu') continue
        k = j
        if (bis < von || bis - von > 65535) continue
        for (let c = von; c <= bis && c - von < teile.length; c++) {
          if (!setze(c, teile[c - von] as string)) return false
        }
      }
    }
    return true
  }

  for (const tok of cmapTokens(text)) {
    if (tok.t === 'wort') {
      if (block !== null && tok.v === ENDE[block.art]) {
        if (!wendeAn(block)) return { zuordnung, codelaenge }
        block = null
        continue
      }
      if (tok.v === 'begincodespacerange') block = { art: 'raum', toks: [] }
      else if (tok.v === 'beginbfchar') block = { art: 'bfchar', toks: [] }
      else if (tok.v === 'beginbfrange') block = { art: 'bfrange', toks: [] }
      else if (block !== null) block.toks.push(tok)
      continue
    }
    if (block !== null) block.toks.push(tok)
  }
  return { zuordnung, codelaenge }
}

export function schreibeToUnicode(
  zuordnung: ReadonlyMap<number, string>,
  codelaenge: number
): string {
  const hex = (n: number): string => n.toString(16).padStart(codelaenge * 2, '0')
  const utf16 = (s: string): string => {
    let o = ''
    for (let k = 0; k < s.length; k++) o += s.charCodeAt(k).toString(16).padStart(4, '0')
    return o
  }
  const eintraege = [...zuordnung.entries()].sort((a, b) => a[0] - b[0])
  let rumpf = ''
  for (let k = 0; k < eintraege.length; k += 100) {
    const teil = eintraege.slice(k, k + 100)
    rumpf += String(teil.length) + ' beginbfchar\n'
    for (const [code, wert] of teil) rumpf += '<' + hex(code) + '> <' + utf16(wert) + '>\n'
    rumpf += 'endbfchar\n'
  }
  const bis = 'FF'.repeat(codelaenge)
  const von = '00'.repeat(codelaenge)
  // Registry und CMap-Name sind feste Formatbezeichner der PDF-Spezifikation
  // (ToUnicode-CMap), kein Branding.
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' + // MARKENABGRENZUNG: Formatbezeichner
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' + // MARKENABGRENZUNG: Formatbezeichner
    '1 begincodespacerange\n<' +
    von +
    '> <' +
    bis +
    '>\nendcodespacerange\n' +
    rumpf +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  )
}
