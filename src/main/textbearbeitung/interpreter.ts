import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
  type PDFPage
} from 'pdf-lib'
import {
  MAX_OPERATOREN,
  MAX_WERTE,
  zerlege,
  type LexBudget,
  type Operator,
  type Wert
} from './lexer'
import { eintrag, MAX_STROMBYTES, nimm, nurDict, strombytes, TextAbgelehnt } from './pdfobjekte'
import { schriftCache, type Schrift } from './schrift'
import { t } from '../../shared/i18n'

/**
 * Interpreter fuer Text- und Grafikzustand einer Seite (S6.6b, ADR 0005).
 *
 * Liefert je Glyph die Position im Seitenraum, den Vorschub, die Herkunft
 * (Strom, Aufruf, Operator, Array-Element, Byte-Offset im String) und den
 * Textzustand, der zum Neusetzen noetig ist. Laeuft rekursiv in
 * Form-XObjects (eigene `/Matrix`, eigene Ressourcen), mit Tiefenbegrenzung
 * und Schutz gegen Kreise.
 */

export type Matrix = [number, number, number, number, number, number]

export const EINHEIT: Matrix = [1, 0, 0, 1, 0, 0]

export function mal(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5]
  ]
}

function punkt(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Was zum Neusetzen einer Zeile an derselben Stelle gebraucht wird. */
export interface Textzustand {
  /** Text-Rendering-Matrix ohne Schriftgroesse: Tm x CTM am Glyphanfang. */
  trm: Matrix
  tfs: number
  tc: number
  tw: number
  th: number
  ts: number
  tr: number
  fuellung: string
  kontur: string
  schriftObjekt: PDFRef | PDFDict
}

export interface Glyph {
  strom: string
  /** Index in `formAufrufe` (-1 = Seiteninhalt). */
  aufruf: number
  opIdx: number
  elemIdx: number
  off: number
  len: number
  code: number
  uni: string | null
  x: number
  y: number
  ex: number
  ey: number
  /** Einheitsvektor der Schreibrichtung. */
  dx: number
  dy: number
  groesse: number
  /** Vorschub in Textraum-Einheiten (mit Tc, Tw, Tz). */
  tx: number
  schrift: Schrift
  unsichtbar: boolean
  actualText: boolean
  muster: boolean
  zustand: Textzustand
}

export interface Strom {
  id: string
  bytes: Uint8Array
  ops: Operator[]
  res: PDFDict | undefined
  ref: PDFRef | undefined
  stream: PDFStream | undefined
  aufrufe: number
}

export interface FormAufruf {
  vonStrom: string
  /** Aufruf, in dem der aufrufende Strom lief (-1 = Seite). */
  vonAufruf: number
  opIdx: number
  name: string
  ref: PDFRef | undefined
  id: string
}

export interface Analyse {
  stroeme: Map<string, Strom>
  glyphen: Glyph[]
  formAufrufe: FormAufruf[]
  /** Die Referenzen des bisherigen `/Contents`. */
  inhaltRefs: PDFRef[]
}

const MAX_FORMTIEFE = 8
/**
 * Budgets einer Analyse (Gate Phase 6, H1/H2). Jede Grenze gilt fuer die
 * Seite **samt** aller Formen zusammen - Tiefe und Kreisschutz allein halten
 * einen Faecher aus Formen nicht auf (n Aufrufe je Ebene ergeben n^Tiefe).
 *
 * `MAX_GLYPHEN`: jeder Glyph kostet einige hundert Bytes Heap; zwei
 * Millionen waren schon ueber ein Gigabyte.
 */
export const MAX_GLYPHEN = 200_000
export const MAX_FORMAUFRUFE = 10_000
/** Operatoren, die `lauf` insgesamt ausfuehrt (Formen zaehlen je Aufruf). */
export const MAX_AUSGEFUEHRT = 5_000_000
/** Dekodierte Bytes aus Seiteninhalt und Formen zusammen. */
export const MAX_ANALYSEBYTES = 64 * 1024 * 1024

interface Grafikzustand {
  ctm: Matrix
  fuellung: string
  kontur: string
  fuellraum: string
  konturraum: string
  muster: boolean
  tc: number
  tw: number
  th: number
  tl: number
  tfs: number
  tr: number
  ts: number
  schrift: Schrift | null
  schriftObjekt: PDFRef | PDFDict | null
}

function zahlAus(w: Wert | undefined): number {
  return w !== undefined && w.t === 'zahl' ? w.v : 0
}

function farbe(werte: number[], raum: string): string | null {
  const z = werte.map((v) => String(Math.round(v * 10000) / 10000)).join(' ')
  if (raum === 'DeviceGray' || werte.length === 1) return z + ' g'
  if (raum === 'DeviceRGB' || werte.length === 3) return z + ' rg'
  if (raum === 'DeviceCMYK' || werte.length === 4) return z + ' k'
  return null
}

/** Restbudget fuer dekodierte Bytes einer Analyse. */
interface Bytebudget {
  rest: number
}

/** Dekodiert einen Strom gegen das gemeinsame Bytebudget. */
function budgetiert(budget: Bytebudget, stream: PDFObject | undefined): Uint8Array {
  if (budget.rest <= 0) throw new TextAbgelehnt(t('text.zuKomplex'))
  const bytes = strombytes(stream, Math.min(MAX_STROMBYTES, budget.rest))
  budget.rest -= bytes.length + 1
  return bytes
}

/** Der Seiteninhalt als ein Byte-Feld (mehrere Streams mit Zeilenumbruch verbunden). */
function seitenInhalt(
  ctx: PDFContext,
  page: PDFPage,
  budget: Bytebudget
): { bytes: Uint8Array; refs: PDFRef[] } {
  const roh = page.node.get(PDFName.of('Contents'))
  const inhalt = nimm(ctx, roh)
  const teile: Uint8Array[] = []
  const refs: PDFRef[] = []
  if (inhalt instanceof PDFArray) {
    const gesehen = new Set<PDFObject>()
    for (const r of inhalt.asArray()) {
      // Dieselbe Referenz mehrfach in `/Contents` vervielfachte den Inhalt ohne
      // eigene Bytes in der Datei (Gate Phase 6, H1d).
      if (gesehen.has(r)) {
        throw new TextAbgelehnt(t('text.stromMehrfach'))
      }
      gesehen.add(r)
      if (r instanceof PDFRef) refs.push(r)
      teile.push(budgetiert(budget, nimm(ctx, r)))
    }
  } else if (inhalt !== undefined) {
    if (roh instanceof PDFRef) refs.push(roh)
    teile.push(budgetiert(budget, inhalt))
  }
  const gesamt = teile.reduce((s, t) => s + t.length + 1, 0)
  const bytes = new Uint8Array(gesamt)
  let o = 0
  for (const t of teile) {
    bytes.set(t, o)
    o += t.length
    bytes[o++] = 10
  }
  return { bytes, refs }
}

export function seitenRessourcen(ctx: PDFContext, page: PDFPage): PDFDict | undefined {
  let knoten: PDFDict | undefined = page.node
  for (let tiefe = 0; knoten !== undefined && tiefe < 64; tiefe++) {
    const r = nurDict(ctx, knoten.get(PDFName.of('Resources')))
    if (r !== undefined) return r
    knoten = nurDict(ctx, knoten.get(PDFName.of('Parent')))
  }
  return undefined
}

function unterDict(ctx: PDFContext, res: PDFDict | undefined, key: string): PDFDict | undefined {
  return nurDict(ctx, res?.get(PDFName.of(key)))
}

/** Analysiert eine Seite: alle Glyphen mit Herkunft und Zustand. */
export function analysiereSeite(ctx: PDFContext, page: PDFPage): Analyse {
  const holeSchrift = schriftCache(ctx)
  const stroeme = new Map<string, Strom>()
  const glyphen: Glyph[] = []
  const formAufrufe: FormAufruf[] = []
  const bytebudget: Bytebudget = { rest: MAX_ANALYSEBYTES }
  const lexBudget: LexBudget = { operatoren: MAX_OPERATOREN, werte: MAX_WERTE }
  let ausgefuehrt = 0
  const { bytes, refs } = seitenInhalt(ctx, page, bytebudget)
  stroeme.set('seite', {
    id: 'seite',
    bytes,
    ops: zerlege(bytes, lexBudget),
    res: seitenRessourcen(ctx, page),
    ref: undefined,
    stream: undefined,
    aufrufe: 1
  })

  const lauf = (
    stromId: string,
    start: Grafikzustand,
    tiefe: number,
    pfad: readonly string[],
    aufruf: number
  ): void => {
    const strom = stroeme.get(stromId)
    if (strom === undefined) return
    const res = strom.res
    let gs: Grafikzustand = { ...start }
    const stapel: Grafikzustand[] = []
    // Offene Markierungen (BMC/BDC) und wie viele davon ActualText tragen: ein
    // Zaehler statt `markiert.includes(true)` je Glyph (Gate Phase 6, H2d).
    const markiert: boolean[] = []
    let actualTextTiefe = 0
    let tm: Matrix = EINHEIT
    let tlm: Matrix = EINHEIT

    const naechsteZeile = (tx: number, ty: number): void => {
      tlm = mal([1, 0, 0, 1, tx, ty], tlm)
      tm = tlm
    }

    const zeige = (opIdx: number, elemente: readonly (Wert | undefined)[]): void => {
      const s = gs.schrift
      if (s === null || gs.schriftObjekt === null) return
      for (let ei = 0; ei < elemente.length; ei++) {
        const el = elemente[ei]
        if (el === undefined) continue
        if (el.t === 'zahl') {
          tm = mal([1, 0, 0, 1, (-el.v / 1000) * gs.tfs * gs.th, 0], tm)
          continue
        }
        if (el.t !== 'text') continue
        // Die Glyphgrenze vor dem Dekodieren: `dekodiere` legt je Code ein
        // Objekt an (Gate Phase 6, H1b).
        if (glyphen.length + Math.floor(el.bytes.length / s.bytesJeCode) > MAX_GLYPHEN) {
          throw new TextAbgelehnt(t('text.zuVielText'))
        }
        for (const { code, off, len } of s.dekodiere(el.bytes)) {
          s.benutzt.add(code)
          const w0 = s.breite(code) / 1000
          const wortabstand = code === 32 && len === 1 ? gs.tw : 0
          const tx = (w0 * gs.tfs + gs.tc + wortabstand) * gs.th
          const trm = mal(tm, gs.ctm)
          const [x, y] = punkt(trm, 0, gs.ts)
          const [ex, ey] = punkt(trm, tx, gs.ts)
          const laenge = Math.hypot(trm[0], trm[1]) || 1
          if (glyphen.length >= MAX_GLYPHEN) throw new TextAbgelehnt(t('text.zuVielText'))
          glyphen.push({
            strom: stromId,
            aufruf,
            opIdx,
            elemIdx: ei,
            off,
            len,
            code,
            uni: s.unicode(code),
            x,
            y,
            ex,
            ey,
            dx: trm[0] / laenge,
            dy: trm[1] / laenge,
            groesse: Math.abs(gs.tfs) * Math.hypot(trm[2], trm[3]),
            tx,
            schrift: s,
            unsichtbar: gs.tr === 3 || gs.tr === 7,
            actualText: actualTextTiefe > 0,
            muster: gs.muster,
            zustand: {
              trm,
              tfs: gs.tfs,
              tc: gs.tc,
              tw: gs.tw,
              th: gs.th,
              ts: gs.ts,
              tr: gs.tr,
              fuellung: gs.fuellung,
              kontur: gs.kontur,
              schriftObjekt: gs.schriftObjekt
            }
          })
          tm = mal([1, 0, 0, 1, tx, 0], tm)
        }
      }
    }

    const setzeFarbe = (a: Wert[], fuellen: boolean): void => {
      const raum = fuellen ? gs.fuellraum : gs.konturraum
      if (a.some((x) => x.t === 'name') || raum === 'Pattern') {
        if (fuellen) gs.muster = true
        return
      }
      const f = farbe(a.map(zahlAus), raum)
      if (f === null) return
      if (fuellen) {
        gs.fuellung = f
        gs.muster = false
      } else gs.kontur = f.replace(/ (g|rg|k)$/, (m) => m.toUpperCase())
    }

    strom.ops.forEach((o, i) => {
      if (++ausgefuehrt > MAX_AUSGEFUEHRT) throw new TextAbgelehnt(t('text.zuKomplex'))
      const a = o.args
      switch (o.op) {
        case 'q':
          if (stapel.length < 256) stapel.push({ ...gs })
          break
        case 'Q':
          gs = stapel.pop() ?? gs
          break
        case 'cm':
          if (a.length >= 6) gs.ctm = mal(a.map(zahlAus).slice(0, 6) as Matrix, gs.ctm)
          break
        case 'g':
          gs.fuellraum = 'DeviceGray'
          setzeFarbe(a, true)
          break
        case 'rg':
          gs.fuellraum = 'DeviceRGB'
          setzeFarbe(a, true)
          break
        case 'k':
          gs.fuellraum = 'DeviceCMYK'
          setzeFarbe(a, true)
          break
        case 'G':
          gs.konturraum = 'DeviceGray'
          setzeFarbe(a, false)
          break
        case 'RG':
          gs.konturraum = 'DeviceRGB'
          setzeFarbe(a, false)
          break
        case 'K':
          gs.konturraum = 'DeviceCMYK'
          setzeFarbe(a, false)
          break
        case 'cs':
        case 'CS': {
          const raum = a[0]?.t === 'name' ? a[0].v : ''
          const aufgeloest = ['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern'].includes(raum)
            ? raum
            : farbraumArt(ctx, res, raum)
          if (o.op === 'cs') {
            gs.fuellraum = aufgeloest
            gs.muster = aufgeloest === 'Pattern'
            gs.fuellung = '0 g'
          } else {
            gs.konturraum = aufgeloest
            gs.kontur = '0 G'
          }
          break
        }
        case 'sc':
        case 'scn':
          setzeFarbe(a, true)
          break
        case 'SC':
        case 'SCN':
          setzeFarbe(a, false)
          break
        case 'BT':
          tm = EINHEIT
          tlm = EINHEIT
          break
        case 'Tf': {
          const name = a[0]?.t === 'name' ? a[0].v : ''
          const roh = unterDict(ctx, res, 'Font')?.get(PDFName.of(name))
          const obj = roh instanceof PDFRef ? roh : nurDict(ctx, roh)
          gs.schriftObjekt = obj ?? null
          gs.schrift = obj === undefined ? null : holeSchrift(obj)
          gs.tfs = zahlAus(a[1])
          break
        }
        case 'Tc':
          gs.tc = zahlAus(a[0])
          break
        case 'Tw':
          gs.tw = zahlAus(a[0])
          break
        case 'Tz':
          gs.th = zahlAus(a[0]) / 100
          break
        case 'TL':
          gs.tl = zahlAus(a[0])
          break
        case 'Ts':
          gs.ts = zahlAus(a[0])
          break
        case 'Tr':
          gs.tr = zahlAus(a[0])
          break
        case 'Td':
          naechsteZeile(zahlAus(a[0]), zahlAus(a[1]))
          break
        case 'TD':
          gs.tl = -zahlAus(a[1])
          naechsteZeile(zahlAus(a[0]), zahlAus(a[1]))
          break
        case 'Tm':
          tlm = a.length >= 6 ? (a.map(zahlAus).slice(0, 6) as Matrix) : EINHEIT
          tm = tlm
          break
        case 'T*':
          naechsteZeile(0, -gs.tl)
          break
        case 'Tj':
          zeige(i, [a[0]])
          break
        case 'TJ':
          zeige(i, a[0]?.t === 'feld' ? a[0].werte : [])
          break
        case "'":
          naechsteZeile(0, -gs.tl)
          zeige(i, [a[0]])
          break
        case '"':
          gs.tw = zahlAus(a[0])
          gs.tc = zahlAus(a[1])
          naechsteZeile(0, -gs.tl)
          zeige(i, [a[2]])
          break
        case 'BMC':
          markiert.push(false)
          break
        case 'BDC': {
          const mitText = hatActualText(ctx, res, a[1])
          markiert.push(mitText)
          if (mitText) actualTextTiefe++
          break
        }
        case 'EMC':
          if (markiert.pop() === true) actualTextTiefe--
          break
        case 'Do': {
          const name = a[0]?.t === 'name' ? a[0].v : ''
          const roh = unterDict(ctx, res, 'XObject')?.get(PDFName.of(name))
          const x = nimm(ctx, roh)
          if (!(x instanceof PDFStream)) break
          const subtype = x.dict.get(PDFName.of('Subtype'))
          if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Form') break
          const ref = roh instanceof PDFRef ? roh : undefined
          const id = 'form:' + (ref !== undefined ? ref.toString() : name + '@' + stromId)
          if (formAufrufe.length >= MAX_FORMAUFRUFE) throw new TextAbgelehnt(t('text.zuKomplex'))
          formAufrufe.push({ vonStrom: stromId, vonAufruf: aufruf, opIdx: i, name, ref, id })
          const nr = formAufrufe.length - 1
          if (tiefe >= MAX_FORMTIEFE || pfad.includes(id)) break
          if (!stroeme.has(id)) {
            const fb = budgetiert(bytebudget, x)
            const fres = nurDict(ctx, x.dict.get(PDFName.of('Resources')))
            stroeme.set(id, {
              id,
              bytes: fb,
              ops: zerlege(fb, lexBudget),
              res: fres ?? res,
              ref,
              stream: x,
              aufrufe: 0
            })
          }
          const form = stroeme.get(id)
          if (form !== undefined) form.aufrufe++
          const m = eintrag(ctx, x.dict, 'Matrix')
          const matrix: Matrix =
            m instanceof PDFArray && m.size() === 6
              ? (m.asArray().map((v) => {
                  const z = nimm(ctx, v)
                  return z instanceof PDFNumber ? z.asNumber() : 0
                }) as Matrix)
              : EINHEIT
          lauf(id, { ...gs, ctm: mal(matrix, gs.ctm) }, tiefe + 1, [...pfad, id], nr)
          break
        }
        default:
          break
      }
    })
  }

  lauf(
    'seite',
    {
      ctm: EINHEIT,
      fuellung: '0 g',
      kontur: '0 G',
      fuellraum: 'DeviceGray',
      konturraum: 'DeviceGray',
      muster: false,
      tc: 0,
      tw: 0,
      th: 1,
      tl: 0,
      tfs: 0,
      tr: 0,
      ts: 0,
      schrift: null,
      schriftObjekt: null
    },
    0,
    ['seite'],
    -1
  )
  return { stroeme, glyphen, formAufrufe, inhaltRefs: refs }
}

/** Die Grundart eines benannten Farbraums (fuer die Zahl der Komponenten). */
function farbraumArt(ctx: PDFContext, res: PDFDict | undefined, name: string): string {
  const cs = nimm(ctx, unterDict(ctx, res, 'ColorSpace')?.get(PDFName.of(name)))
  if (cs instanceof PDFName) return cs.decodeText()
  if (cs instanceof PDFArray) {
    const art = cs.get(0)
    if (art instanceof PDFName) {
      const a = art.decodeText()
      if (a === 'Pattern') return 'Pattern'
      if (a === 'ICCBased') {
        const n = nimm(ctx, cs.get(1))
        const komponenten = n instanceof PDFStream ? n.dict.get(PDFName.of('N')) : undefined
        const k = komponenten instanceof PDFNumber ? komponenten.asNumber() : 0
        return k === 1 ? 'DeviceGray' : k === 4 ? 'DeviceCMYK' : 'DeviceRGB'
      }
      if (a === 'CalRGB' || a === 'Lab') return 'DeviceRGB'
      if (a === 'CalGray') return 'DeviceGray'
      return a
    }
  }
  return name
}

function hatActualText(ctx: PDFContext, res: PDFDict | undefined, w: Wert | undefined): boolean {
  if (w === undefined) return false
  if (w.t === 'dict') return w.eintraege.has('ActualText')
  if (w.t === 'name') {
    const eigenschaft = nurDict(ctx, unterDict(ctx, res, 'Properties')?.get(PDFName.of(w.v)))
    return eigenschaft?.has(PDFName.of('ActualText')) ?? false
  }
  return false
}
