/**
 * Content-Stream-Lexer mit Byte-Offsets (S6.6b, ADR 0005).
 *
 * Zerlegt einen dekodierten Content-Stream in Operatoren samt Operanden und
 * dem Bytebereich `[start, ende)`, den der Operator mit seinen Operanden
 * belegt. Genau diesen Bereich schneidet der Editor spaeter aus und ersetzt
 * ihn - alles andere im Stream bleibt Byte fuer Byte stehen.
 *
 * Fremde Eingabe (Gate Phase 6, Security-Scan): jeder Schleifendurchlauf
 * rueckt mindestens ein Byte vor, Verschachtelung ist begrenzt, und die
 * Operatorenzahl hat eine Obergrenze. Kaputte Stellen werden uebersprungen,
 * nicht geworfen - pdf.js ist ebenso nachsichtig, und eine Zeile, die pdf.js
 * anzeigt, soll hier nicht an einem Schnipsel Muell drei Zeilen weiter
 * scheitern.
 */
import { t } from '../../shared/i18n'

export type Wert =
  | { t: 'zahl'; v: number }
  | { t: 'name'; v: string }
  | { t: 'text'; bytes: Uint8Array }
  | { t: 'feld'; werte: Wert[] }
  | { t: 'dict'; eintraege: Map<string, Wert> }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }

export interface Operator {
  op: string
  args: Wert[]
  /** Erstes Byte des ersten Operanden (oder des Operators). */
  start: number
  /** Erstes Byte hinter dem Operator. */
  ende: number
}

/** Tiefer verschachtelte Felder/Dictionaries gelten als Angriff, nicht als Inhalt. */
export const MAX_TIEFE = 32
/** Mehr Operatoren je Stream bearbeitet diese Fassung nicht. */
export const MAX_OPERATOREN = 2_000_000
/**
 * Mehr Operanden (samt Feld- und Dictionary-Inhalten) je Stream nicht (Gate
 * Phase 6, H1d): `0 0 0 ...` ohne Operator zaehlte sonst nie gegen
 * `MAX_OPERATOREN` und fuellte den Heap mit Millionen Wert-Objekten.
 */
export const MAX_WERTE = 4_000_000
/** Mehr Operanden vor einem einzigen Operator gibt es in echten Stroemen nicht. */
export const MAX_WERTE_JE_OPERATOR = 100_000

export class LexFehler extends Error {}

/**
 * Gemeinsames Budget mehrerer `zerlege`-Aufrufe (Seite und alle Formen einer
 * Analyse). Wird an Ort und Stelle heruntergezaehlt.
 */
export interface LexBudget {
  operatoren: number
  werte: number
}

/** Ein wachsender Byte-Puffer - statt `number[]`, das je Byte ein Feldelement kostet. */
class Puffer {
  private b = new Uint8Array(64)
  n = 0
  push(x: number): void {
    if (this.n === this.b.length) {
      const neu = new Uint8Array(this.b.length * 2)
      neu.set(this.b)
      this.b = neu
    }
    this.b[this.n++] = x
  }
  fertig(): Uint8Array {
    return this.b.slice(0, this.n)
  }
}

const LEER = new Set([0, 9, 10, 12, 13, 32])
const TRENNER = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37])
const ZAHL = /^[+-]?(\d+\.?\d*|\.\d+)$/

type Token =
  | { k: 'wert'; v: Wert; start: number; ende: number }
  | { k: 'feldAuf' | 'feldZu' | 'dictAuf' | 'dictZu' | 'muell'; start: number; ende: number }
  | { k: 'op'; v: string; start: number; ende: number }

class Lexer {
  i = 0
  constructor(readonly b: Uint8Array) {}

  private ueberspringeLeer(): void {
    const b = this.b
    while (this.i < b.length) {
      const c = b[this.i] as number
      if (LEER.has(c)) this.i++
      else if (c === 37) {
        while (this.i < b.length && b[this.i] !== 10 && b[this.i] !== 13) this.i++
      } else break
    }
  }

  private wort(): string {
    const b = this.b
    let s = ''
    while (this.i < b.length) {
      const c = b[this.i] as number
      if (LEER.has(c) || TRENNER.has(c)) break
      s += String.fromCharCode(c)
      this.i++
    }
    return s
  }

  naechstes(): Token | null {
    this.ueberspringeLeer()
    const b = this.b
    if (this.i >= b.length) return null
    const start = this.i
    const c = b[this.i] as number
    if (c === 40) {
      const v = this.literal()
      return { k: 'wert', v, start, ende: this.i }
    }
    if (c === 60) {
      if (b[this.i + 1] === 60) {
        this.i += 2
        return { k: 'dictAuf', start, ende: this.i }
      }
      const v = this.hex()
      return { k: 'wert', v, start, ende: this.i }
    }
    if (c === 62) {
      this.i += b[this.i + 1] === 62 ? 2 : 1
      return { k: b[start + 1] === 62 ? 'dictZu' : 'muell', start, ende: this.i }
    }
    if (c === 91 || c === 93) {
      this.i++
      return { k: c === 91 ? 'feldAuf' : 'feldZu', start, ende: this.i }
    }
    if (c === 47) {
      this.i++
      const roh = this.wort()
      return { k: 'wert', v: { t: 'name', v: nameDekodieren(roh) }, start, ende: this.i }
    }
    const s = this.wort()
    if (s === '') {
      // Unerwarteter Begrenzer: ")" "{" "}" - ein Byte weiter.
      this.i++
      return { k: 'muell', start, ende: this.i }
    }
    if (ZAHL.test(s)) return { k: 'wert', v: { t: 'zahl', v: parseFloat(s) }, start, ende: this.i }
    if (s === 'true' || s === 'false') {
      return { k: 'wert', v: { t: 'bool', v: s === 'true' }, start, ende: this.i }
    }
    if (s === 'null') return { k: 'wert', v: { t: 'null' }, start, ende: this.i }
    return { k: 'op', v: s, start, ende: this.i }
  }

  private literal(): Wert {
    const b = this.b
    this.i++
    const out = new Puffer()
    let tiefe = 1
    while (this.i < b.length) {
      const c = b[this.i++] as number
      if (c === 92) {
        if (this.i >= b.length) break
        const n = b[this.i++] as number
        if (n === 110) out.push(10)
        else if (n === 114) out.push(13)
        else if (n === 116) out.push(9)
        else if (n === 98) out.push(8)
        else if (n === 102) out.push(12)
        else if (n === 13) {
          if (b[this.i] === 10) this.i++
        } else if (n === 10) {
          // Zeilenfortsetzung
        } else if (n >= 48 && n <= 55) {
          let o = n - 48
          for (let k = 0; k < 2; k++) {
            const z = b[this.i]
            if (z === undefined || z < 48 || z > 55) break
            o = o * 8 + (z - 48)
            this.i++
          }
          out.push(o & 255)
        } else out.push(n)
      } else if (c === 40) {
        tiefe++
        out.push(c)
      } else if (c === 41) {
        tiefe--
        if (tiefe === 0) break
        out.push(c)
      } else out.push(c)
    }
    return { t: 'text', bytes: out.fertig() }
  }

  private hex(): Wert {
    const b = this.b
    this.i++
    const out = new Puffer()
    let hoch = -1
    while (this.i < b.length && b[this.i] !== 62) {
      const c = b[this.i++] as number
      const w = hexWert(c)
      if (w < 0) continue
      if (hoch < 0) hoch = w
      else {
        out.push((hoch << 4) | w)
        hoch = -1
      }
    }
    // Das schliessende `>` ueberspringen - aber nur, wenn es da ist. Ohne die
    // Pruefung stand ein unbeendeter Hex-String am Streamende ein Byte hinter
    // dem Ende, und der Editor schnitte mit einem Bereich ueber die Daten
    // hinaus (Fuzzing S6.10).
    if (this.i < b.length) this.i++
    // Ungerade Ziffernzahl: die fehlende letzte Ziffer ist 0.
    if (hoch >= 0) out.push(hoch << 4)
    return { t: 'text', bytes: out.fertig() }
  }

  /** Nach `ID`: Binaerdaten eines Inline-Bildes bis zum freistehenden `EI`. */
  ueberspringeInlineBild(): void {
    const b = this.b
    this.i++
    while (this.i < b.length - 1) {
      if (
        b[this.i] === 69 &&
        b[this.i + 1] === 73 &&
        LEER.has(b[this.i - 1] as number) &&
        (this.i + 2 >= b.length || LEER.has(b[this.i + 2] as number))
      ) {
        this.i += 2
        return
      }
      this.i++
    }
    this.i = b.length
  }
}

function hexWert(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 65 && c <= 70) return c - 55
  if (c >= 97 && c <= 102) return c - 87
  return -1
}

function nameDekodieren(roh: string): string {
  return roh.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

interface Offen {
  art: 'feld' | 'dict'
  werte: Wert[]
}

/**
 * Zerlegt einen Stream in Operatoren mit Byte-Bereichen. Mit `budget` teilen
 * sich mehrere Aufrufe eine Obergrenze (Gate Phase 6, H1d); ohne gilt sie je
 * Stream.
 */
export function zerlege(
  bytes: Uint8Array,
  budget: LexBudget = { operatoren: MAX_OPERATOREN, werte: MAX_WERTE }
): Operator[] {
  const lx = new Lexer(bytes)
  const ops: Operator[] = []
  let args: Wert[] = []
  let argStart = -1
  let werteSeitOperator = 0
  const stapel: Offen[] = []

  const zaehleWert = (): void => {
    budget.werte--
    werteSeitOperator++
    if (budget.werte < 0) throw new LexFehler(t('text.lexOperanden'))
    if (werteSeitOperator > MAX_WERTE_JE_OPERATOR) {
      throw new LexFehler(t('text.lexVorOperator'))
    }
  }
  const merkeStart = (start: number): void => {
    if (stapel.length === 0 && args.length === 0) argStart = start
  }
  const fuegeAn = (wert: Wert, start: number): void => {
    zaehleWert()
    const oben = stapel[stapel.length - 1]
    if (oben !== undefined) oben.werte.push(wert)
    else {
      merkeStart(start)
      args.push(wert)
    }
  }

  for (;;) {
    const tok = lx.naechstes()
    if (tok === null) break
    switch (tok.k) {
      case 'wert':
        fuegeAn(tok.v, tok.start)
        break
      case 'feldAuf':
      case 'dictAuf':
        if (stapel.length >= MAX_TIEFE) throw new LexFehler(t('text.lexTief'))
        merkeStart(tok.start)
        stapel.push({ art: tok.k === 'feldAuf' ? 'feld' : 'dict', werte: [] })
        break
      case 'feldZu':
      case 'dictZu': {
        const offen = stapel.pop()
        if (offen === undefined) break
        let wert: Wert
        if (offen.art === 'feld') wert = { t: 'feld', werte: offen.werte }
        else {
          const eintraege = new Map<string, Wert>()
          for (let k = 0; k + 1 < offen.werte.length; k += 2) {
            const schluessel = offen.werte[k] as Wert
            if (schluessel.t === 'name') eintraege.set(schluessel.v, offen.werte[k + 1] as Wert)
          }
          wert = { t: 'dict', eintraege }
        }
        zaehleWert()
        const oben = stapel[stapel.length - 1]
        if (oben !== undefined) oben.werte.push(wert)
        else args.push(wert)
        break
      }
      case 'muell':
        break
      case 'op': {
        const oben = stapel[stapel.length - 1]
        if (oben !== undefined) {
          // Ein Operator mitten in einem Feld: kaputt, als Name mitfuehren.
          oben.werte.push({ t: 'name', v: tok.v })
          break
        }
        const start = args.length > 0 ? argStart : tok.start
        if (tok.v === 'BI') {
          for (;;) {
            const t2 = lx.naechstes()
            if (t2 === null) break
            if (t2.k === 'op' && t2.v === 'ID') {
              lx.ueberspringeInlineBild()
              break
            }
          }
          ops.push({ op: 'BI', args: [], start, ende: lx.i })
        } else {
          ops.push({ op: tok.v, args, start, ende: tok.ende })
        }
        budget.operatoren--
        if (ops.length > MAX_OPERATOREN || budget.operatoren < 0) {
          throw new LexFehler(t('text.lexGross'))
        }
        args = []
        argStart = -1
        werteSeitOperator = 0
        break
      }
    }
  }
  return ops
}

/** Bytes als Hex-String-Token. */
export function hexText(bytes: Uint8Array): string {
  let s = '<'
  for (const x of bytes) s += x.toString(16).padStart(2, '0')
  return s + '>'
}

/** Zahl fuer den Stream: hoechstens vier Nachkommastellen, nie "-0" oder "NaN". */
export function zahl(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 10000) / 10000
  return String(Object.is(r, -0) ? 0 : r)
}
