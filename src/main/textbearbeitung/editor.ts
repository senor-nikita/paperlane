import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
  type PDFPage
} from 'pdf-lib'
import type { TextBericht } from '../../shared/mutation'
import type { TextZeile } from '../../shared/textzeilen'
import {
  nichtDarstellbareZeichen,
  normalisiereZeichen,
  standardSchriftname
} from '../freitext-schriften'
import {
  analysiereSeite,
  seitenRessourcen,
  type Analyse,
  type Glyph,
  type Strom,
  type Textzustand
} from './interpreter'
import { hexText, zahl, type Operator, type Wert } from './lexer'
import { nimm, nurDict, TextAbgelehnt } from './pdfobjekte'
import type { Teil } from './schrift'
import { glyphenDerZeile, glyphText, textStimmt } from './zuordnung'
import { t } from '../../shared/i18n'

/**
 * Eine Zeile loeschen oder ersetzen (S6.6b, ADR 0005).
 *
 * **Loeschen:** die Glyphen der Zeile werden aus ihren Show-Operatoren
 * herausgeschnitten und durch gleich grosse `TJ`-Verschiebungen ersetzt.
 * Alles, was danach im selben Operator oder ohne eigene Positionierung folgt,
 * bleibt exakt stehen - und die Bytes des Textes sind nicht mehr im Stream.
 * Liegt die Zeile in einem Form-XObject, wird es an Ort und Stelle geaendert,
 * wenn nur diese eine Stelle es benutzt; sonst bekommt die Seite eine Kopie.
 *
 * **Ersetzen:** danach der neue Text als eigener Textblock am Ende des
 * Seiteninhalts (der alte Inhalt in `q ... Q` gekapselt), mit der
 * Text-Rendering-Matrix und Farbe des ersten Glyphs. In der Originalschrift,
 * wenn **jedes** Zeichen einen Glyph mit Umriss hat - sonst die ganze Zeile
 * in der Standard-14-Ersatzschrift (D22), passend nach Stil gewaehlt.
 *
 * **Ablehnen** (Ausnahme `TextAbgelehnt`, nichts geaendert): Type3, CMaps
 * ausser Identity-H, Text in Mustern, als Beschneidungspfad oder unter
 * `ActualText`, Zeilen, deren Operatortext nicht dem pdf.js-Text entspricht,
 * geteilte Formen in verschachtelten Formen.
 */

const enc = new TextEncoder()

function schluessel(g: Glyph): string {
  return (
    g.strom +
    '|' +
    String(g.aufruf) +
    '|' +
    String(g.opIdx) +
    '|' +
    String(g.elemIdx) +
    '|' +
    String(g.off)
  )
}

/** Baut einen Show-Operator neu; entfernte Glyphen werden zu Verschiebungen. */
function baueOperator(
  op: Operator,
  eigene: readonly Glyph[],
  entfernt: ReadonlySet<string>
): string {
  const a = op.args
  let elemente: (Wert | undefined)[]
  let praefix = ''
  if (op.op === 'TJ') elemente = a[0]?.t === 'feld' ? a[0].werte : []
  else if (op.op === 'Tj') elemente = [a[0]]
  else if (op.op === "'") {
    elemente = [a[0]]
    praefix = 'T* '
  } else if (op.op === '"') {
    const aw = a[0]?.t === 'zahl' ? a[0].v : 0
    const ac = a[1]?.t === 'zahl' ? a[1].v : 0
    elemente = [a[2]]
    praefix = zahl(aw) + ' Tw ' + zahl(ac) + ' Tc T* '
  } else throw new TextAbgelehnt(t('text.unbekannterOperator', { op: op.op }))

  const teile: Teil[] = []
  const schiebe = (n: number): void => {
    const letztes = teile[teile.length - 1]
    if (typeof letztes === 'number') teile[teile.length - 1] = letztes + n
    else teile.push(n)
  }
  elemente.forEach((el, ei) => {
    if (el === undefined) return
    if (el.t === 'zahl') {
      schiebe(el.v)
      return
    }
    if (el.t !== 'text') return
    const glyphen = eigene.filter((g) => g.elemIdx === ei).sort((u, v) => u.off - v.off)
    let puffer: number[] = []
    let gesehen = 0
    for (const g of glyphen) {
      if (entfernt.has(schluessel(g))) {
        if (puffer.length > 0) teile.push(Uint8Array.from(puffer))
        puffer = []
        const nenner = g.zustand.tfs * g.zustand.th
        if (nenner === 0) throw new TextAbgelehnt(t('text.schriftgroesseNull'))
        schiebe((-g.tx / nenner) * 1000)
      } else for (let k = 0; k < g.len; k++) puffer.push(el.bytes[g.off + k] as number)
      gesehen = g.off + g.len
    }
    // Ein unvollstaendiger Rest-Code (ungerade Bytezahl bei 2-Byte-Codes) bleibt erhalten.
    for (let k = gesehen; k < el.bytes.length; k++) puffer.push(el.bytes[k] as number)
    if (puffer.length > 0) teile.push(Uint8Array.from(puffer))
  })
  const rumpf = teile.map((t) => (typeof t === 'number' ? zahl(t) : hexText(t))).join(' ')
  return praefix + '[' + rumpf + '] TJ'
}

interface Ersetzung {
  start: number
  ende: number
  text: string
}

function ersetzeBereiche(bytes: Uint8Array, ersetzungen: readonly Ersetzung[]): Uint8Array {
  const sortiert = [...ersetzungen].sort((u, v) => u.start - v.start)
  const teile: Uint8Array[] = []
  let pos = 0
  for (const e of sortiert) {
    if (e.start < pos) throw new TextAbgelehnt(t('text.ueberlappend'))
    teile.push(bytes.subarray(pos, e.start), enc.encode(e.text))
    pos = e.ende
  }
  teile.push(bytes.subarray(pos))
  const gesamt = teile.reduce((s, t) => s + t.length, 0)
  const out = new Uint8Array(gesamt)
  let o = 0
  for (const t of teile) {
    out.set(t, o)
    o += t.length
  }
  return out
}

function neuerName(d: PDFDict, praefix: string): string {
  for (let i = 1; ; i++) if (!d.has(PDFName.of(praefix + String(i)))) return praefix + String(i)
}

/** Die Ressourcen der Seite selbst - geerbte werden fuer diese Seite kopiert. */
function eigeneRessourcen(ctx: PDFContext, page: PDFPage): PDFDict {
  const eigene = nurDict(ctx, page.node.get(PDFName.of('Resources')))
  if (eigene !== undefined) return eigene
  const geerbt = seitenRessourcen(ctx, page)
  const kopie = geerbt === undefined ? ctx.obj({}) : geerbt.clone(ctx)
  page.node.set(PDFName.of('Resources'), kopie)
  return kopie
}

function unterDictFuerSchreiben(ctx: PDFContext, res: PDFDict, key: string): PDFDict {
  const vorhanden = nurDict(ctx, res.get(PDFName.of(key)))
  if (vorhanden !== undefined) return vorhanden
  const neu = ctx.obj({})
  res.set(PDFName.of(key), neu)
  return neu
}

/**
 * Wie oft wird jedes Form-XObject im Dokument benutzt? Gezaehlt werden
 * Ressourcen-Dictionaries, die es nennen, gewichtet mit der Zahl ihrer
 * Benutzer (Seiten, die sie direkt oder geerbt haben, und Formen). Eher zu
 * viel als zu wenig: im Zweifel wird kopiert, nie ein fremdes Vorkommen
 * mitgeaendert.
 */
function formNutzung(doc: PDFDocument): Map<string, number> {
  const ctx = doc.context
  const benutzer = new Map<PDFDict, number>()
  const zaehle = (d: PDFDict | undefined): void => {
    if (d !== undefined) benutzer.set(d, (benutzer.get(d) ?? 0) + 1)
  }
  for (const page of doc.getPages()) zaehle(seitenRessourcen(ctx, page))
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const st = obj.dict.get(PDFName.of('Subtype'))
      if (st instanceof PDFName && st.decodeText() === 'Form')
        zaehle(nurDict(ctx, obj.dict.get(PDFName.of('Resources'))))
    }
  }
  const nutzung = new Map<string, number>()
  for (const [res, anzahl] of benutzer) {
    const xo = nurDict(ctx, res.get(PDFName.of('XObject')))
    if (xo === undefined) continue
    for (const [, wert] of xo.entries()) {
      if (wert instanceof PDFRef)
        nutzung.set(wert.toString(), (nutzung.get(wert.toString()) ?? 0) + anzahl)
    }
  }
  return nutzung
}

/** Wie viele Seiten nennen diesen Content-Stream in ihrem `/Contents`? */
function inhaltNutzung(doc: PDFDocument, ref: PDFRef): number {
  let n = 0
  for (const page of doc.getPages()) {
    const c = page.node.get(PDFName.of('Contents'))
    if (c instanceof PDFRef && c === ref) n++
    const feld = nimm(doc.context, c)
    if (feld instanceof PDFArray && feld.asArray().some((x) => x === ref)) n++
  }
  return n
}

function streamMitNeuemInhalt(ctx: PDFContext, alt: PDFStream, bytes: Uint8Array): PDFStream {
  // Ohne Prototyp: ein Schluessel `__proto__` aus dem PDF bleibt ein Eintrag (L2).
  const eintraege = Object.create(null) as Record<string, PDFObject>
  for (const [k, v] of alt.dict.entries()) {
    const n = k.decodeText()
    if (n !== 'Length' && n !== 'Filter' && n !== 'DecodeParms') eintraege[n] = v
  }
  return ctx.flateStream(bytes, eintraege)
}

function pruefeZeile(gl: readonly Glyph[], zeile: TextZeile): void {
  if (gl.length === 0) {
    throw new TextAbgelehnt(t('text.nichtImInhalt'))
  }
  for (const g of gl) {
    const problem = g.schrift.probleme[0]
    if (problem !== undefined)
      throw new TextAbgelehnt(t('text.nichtBearbeitbar', { grund: problem }))
  }
  if (gl.some((g) => g.muster)) {
    throw new TextAbgelehnt(t('text.muster'))
  }
  if (gl.some((g) => g.zustand.tr >= 4)) {
    throw new TextAbgelehnt(t('text.beschneidung'))
  }
  if (gl.some((g) => g.actualText)) {
    throw new TextAbgelehnt(t('text.actualText'))
  }
  if (!textStimmt(gl, zeile)) {
    throw new TextAbgelehnt(t('text.zuordnung', { gefunden: glyphText(gl).slice(0, 60) }))
  }
}

/** Entfernt die Glyphen der Zeile aus allen betroffenen Stroemen. */
function entferne(
  doc: PDFDocument,
  page: PDFPage,
  ana: Analyse,
  gl: readonly Glyph[]
): Ersetzung[] {
  const ctx = doc.context
  const entfernt = new Set(gl.map(schluessel))
  const betroffen = new Map<string, { strom: string; aufruf: number; ops: Set<number> }>()
  for (const g of gl) {
    const k = g.strom + '#' + String(g.aufruf)
    const eintragBetroffen = betroffen.get(k) ?? {
      strom: g.strom,
      aufruf: g.aufruf,
      ops: new Set<number>()
    }
    eintragBetroffen.ops.add(g.opIdx)
    betroffen.set(k, eintragBetroffen)
  }
  const seitenErsetzungen: Ersetzung[] = []
  const nutzung = formNutzung(doc)

  for (const { strom, aufruf, ops } of betroffen.values()) {
    const st = ana.stroeme.get(strom) as Strom
    const ersetzungen: Ersetzung[] = []
    for (const opIdx of ops) {
      const op = st.ops[opIdx] as Operator
      const eigene = ana.glyphen.filter(
        (g) => g.strom === strom && g.opIdx === opIdx && g.aufruf === aufruf
      )
      ersetzungen.push({ start: op.start, ende: op.ende, text: baueOperator(op, eigene, entfernt) })
    }
    if (strom === 'seite') {
      seitenErsetzungen.push(...ersetzungen)
      continue
    }
    if (st.ref === undefined || st.stream === undefined) {
      throw new TextAbgelehnt(t('text.formOhneReferenz'))
    }
    const neu = streamMitNeuemInhalt(ctx, st.stream, ersetzeBereiche(st.bytes, ersetzungen))
    const geteilt = st.aufrufe > 1 || (nutzung.get(st.ref.toString()) ?? 0) > 1
    if (!geteilt) {
      ctx.assign(st.ref, neu)
      continue
    }
    const auf = ana.formAufrufe[aufruf]
    if (auf === undefined || auf.vonStrom !== 'seite') {
      throw new TextAbgelehnt(t('text.formMehrfach'))
    }
    const xo = unterDictFuerSchreiben(ctx, eigeneRessourcen(ctx, page), 'XObject')
    const name = neuerName(xo, 'PLTX')
    xo.set(PDFName.of(name), ctx.register(neu))
    const seite = ana.stroeme.get('seite') as Strom
    const doOp = seite.ops[auf.opIdx] as Operator
    seitenErsetzungen.push({ start: doOp.start, ende: doOp.ende, text: '/' + name + ' Do' })
  }
  return seitenErsetzungen
}

/**
 * `schriftName` ist das fertige, escapte Namens-Token samt `/` (Gate Phase 6,
 * L1): ein dekodierter Ressourcenname wie `F1 ET Q%` schriebe sonst
 * beliebige Operatoren in den Block, den wir anhaengen.
 */
function textblock(
  z: Textzustand,
  schriftName: string,
  tj: string,
  tc: number,
  tw: number,
  th: number,
  tr: number
): string {
  return (
    'q ' +
    z.fuellung +
    ' ' +
    z.kontur +
    ' ' +
    z.trm.map(zahl).join(' ') +
    ' cm BT ' +
    schriftName +
    ' ' +
    zahl(z.tfs) +
    ' Tf ' +
    zahl(tc) +
    ' Tc ' +
    zahl(tw) +
    ' Tw ' +
    zahl(th * 100) +
    ' Tz ' +
    zahl(z.ts) +
    ' Ts ' +
    String(tr) +
    ' Tr 1 0 0 1 0 0 Tm ' +
    tj +
    ' ET Q\n'
  )
}

/**
 * Das Namens-Token (escapt, mit `/`), unter dem die Seite diese Schrift
 * kennt - oder ein neues.
 */
function schriftnameAufSeite(ctx: PDFContext, page: PDFPage, obj: PDFRef | PDFDict): string {
  const fonts = unterDictFuerSchreiben(ctx, eigeneRessourcen(ctx, page), 'Font')
  const ref = obj instanceof PDFRef ? obj : ctx.register(obj)
  for (const [k, v] of fonts.entries()) if (v === ref) return k.toString()
  const name = neuerName(fonts, 'PLTF')
  fonts.set(PDFName.of(name), ref)
  return PDFName.of(name).toString()
}

/**
 * Loescht (`text` leer) oder ersetzt eine Zeile auf Seite `seite` (einsbasiert).
 * Wirft `TextAbgelehnt`, wenn die Zeile nicht sicher bearbeitbar ist.
 */
export async function ersetzeZeile(
  doc: PDFDocument,
  seite: number,
  zeile: TextZeile,
  text: string
): Promise<TextBericht> {
  if (doc.isEncrypted) throw new TextAbgelehnt(t('text.verschluesselt'))
  if (seite < 1 || seite > doc.getPageCount()) {
    throw new TextAbgelehnt(t('text.seiteFehlt', { seite }))
  }
  const ctx = doc.context
  const page = doc.getPage(seite - 1)
  const ana = analysiereSeite(ctx, page)
  const gl = glyphenDerZeile(ana.glyphen, zeile)
  pruefeZeile(gl, zeile)

  const seitenErsetzungen = entferne(doc, page, ana, gl)

  const neuerText = text.trim() === '' ? '' : text
  let einfuegen = ''
  let bericht: TextBericht = { schrift: 'keine' }
  if (neuerText !== '') {
    const g0 = gl.find((g) => g.uni !== null && g.uni.trim() !== '') ?? gl[0]
    if (g0 === undefined) throw new TextAbgelehnt(t('text.zeileLeer'))
    const z = g0.zustand
    const s = g0.schrift
    const kodiert = s.kodiere(neuerText, g0.unsichtbar)
    if ('teile' in kodiert) {
      s.wendeAn(kodiert.patches)
      const name = schriftnameAufSeite(ctx, page, z.schriftObjekt)
      const tj =
        '[' +
        kodiert.teile.map((t) => (typeof t === 'number' ? zahl(t) : hexText(t))).join(' ') +
        '] TJ'
      einfuegen = textblock(z, name, tj, z.tc, z.tw, z.th, z.tr)
      bericht = { schrift: 'original' }
    } else {
      const ersatzText = normalisiereZeichen(neuerText)
      const fehlend = nichtDarstellbareZeichen(ersatzText)
      if (fehlend.length > 0) {
        throw new TextAbgelehnt(
          t('text.nichtDarstellbar', {
            anzahl: fehlend.length,
            zeichen: fehlend.join(' '),
            grund: kodiert.fehler
          })
        )
      }
      const stil = s.stil()
      const standard = standardSchriftname(stil.familie, stil.fett, stil.kursiv)
      const schrift = await doc.embedFont(standard)
      const fonts = unterDictFuerSchreiben(ctx, eigeneRessourcen(ctx, page), 'Font')
      const name = neuerName(fonts, 'PLTE')
      fonts.set(PDFName.of(name), schrift.ref)
      const tj = schrift.encodeText(ersatzText).toString() + ' Tj'
      const tr = z.tr === 3 || z.tr === 7 ? 3 : z.tr
      einfuegen = textblock(z, PDFName.of(name).toString(), tj, 0, 0, 1, tr)
      bericht = { schrift: 'ersatz', ersatzschrift: standard, grund: kodiert.fehler }
    }
  }

  // Seiteninhalt schreiben; der alte Inhalt verschwindet aus der Datei, wenn
  // keine andere Seite ihn benutzt - sonst stuende der geloeschte Text noch drin.
  const seitenStrom = ana.stroeme.get('seite') as Strom
  const neu = ersetzeBereiche(seitenStrom.bytes, seitenErsetzungen)
  let inhalt: Uint8Array
  if (einfuegen === '') inhalt = neu
  else {
    const vor = enc.encode('q\n')
    const nach = enc.encode('\nQ\n' + einfuegen)
    inhalt = new Uint8Array(vor.length + neu.length + nach.length)
    inhalt.set(vor)
    inhalt.set(neu, vor.length)
    inhalt.set(nach, vor.length + neu.length)
  }
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(inhalt)))
  for (const ref of ana.inhaltRefs) {
    if (inhaltNutzung(doc, ref) === 0) ctx.delete(ref)
  }
  return bericht
}
