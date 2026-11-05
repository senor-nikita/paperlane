import {
  clip,
  degrees,
  endPath,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFPage
} from 'pdf-lib'
import type { Bereich } from '../shared/bereiche'
import type { DruckOptionen } from '../shared/druck'
import type { Kasten } from '../shared/mutation'
import { wendeMutationAn } from './mutation'
import { leseKasten, schneide, sichtbarerKasten } from './zuschnitt'

/**
 * Die Druckvorlage (S4.3, ADR 0003) - der electron-freie Kern des Druckens.
 *
 * Gedruckt wird nicht das DOM (S1.2 haelt nur wenige Seiten darin) und nicht
 * ein Raster aus pdf.js (Invariante 6 liesse die Anmerkungen weg), sondern
 * **das PDF selbst**: eine Vorlage, die pdf-lib aus dem Dokument ableitet und
 * die der Chromium-eigene PDF-Betrachter in einem versteckten Fenster druckt
 * (`druckfenster.ts`). Alles, was der Nutzer waehlt, wird hier ins PDF
 * eingebaut - Seitenauswahl, Ausrichtung, Skalierung, Anmerkungen -, und
 * alles, was der Betrachter nicht sehen soll, wird hier entfernt: die
 * Skripte des Dokuments (`entferneSkripte`). Vektoriell, mit Text, ohne
 * Speicher je Seite; die Kosten sind die des Speicherpfads (D7).
 */
export interface Druckvorlage {
  bytes: Uint8Array
  seiten: number
}

/** Die gewaehlten Seiten, aufsteigend und ohne Doppelte. */
export function gewaehlteSeiten(bereiche: Bereich[] | 'alle', seitenzahl: number): number[] {
  if (bereiche === 'alle') return Array.from({ length: seitenzahl }, (_, i) => i + 1)
  const menge = new Set<number>()
  for (const [von, bis] of bereiche) {
    for (let s = von; s <= bis; s++) menge.add(s)
  }
  return [...menge].sort((a, b) => a - b)
}

export async function baueDruckvorlage(
  bytes: Uint8Array,
  optionen: DruckOptionen
): Promise<Druckvorlage> {
  const gesamt = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
  const gewaehlt = gewaehlteSeiten(optionen.seiten, gesamt)
  if (gewaehlt.length === 0) throw new Error('Keine Seite gewaehlt.') // KEIN-UI-TEXT: Invariante, parseBereiche prueft vorher
  // KEIN-UI-TEXT: Invariante, parseBereiche prueft vorher
  if (gewaehlt.some((s) => s < 1 || s > gesamt)) throw new Error('Seite ausserhalb des Dokuments.')

  // Die nicht gewaehlten Seiten fallen wie bei der Mutation aus S4.1 - samt
  // der Formularfelder, deren Widgets damit verschwinden.
  const menge = new Set(gewaehlt)
  const weg = Array.from({ length: gesamt }, (_, i) => i + 1).filter((s) => !menge.has(s))
  const reduziert =
    weg.length === 0 ? bytes : await wendeMutationAn(bytes, { art: 'seitenLoeschen', seiten: weg })

  const dokument = await PDFDocument.load(reduziert, { updateMetadata: false })
  entferneSkripte(dokument)
  const seiten = dokument.getPages()
  const erste = seiten[0]
  if (erste === undefined) throw new Error('Keine Seite gewaehlt.') // KEIN-UI-TEXT: Invariante

  for (const seite of seiten) {
    if (!optionen.kommentare) behalteNurFormularfelder(dokument, seite)
    richteAus(seite, optionen.ausrichtung)
  }
  if (optionen.anpassen) {
    const blatt = sichtbareGroesse(erste)
    for (const seite of seiten) passeAn(dokument, seite, blatt)
  }
  return { bytes: await dokument.save(), seiten: seiten.length }
}

/**
 * Breite und Hoehe, wie der Betrachter die Seite zeigt (`/Rotate`
 * beruecksichtigt). Seit S6.3 aus der sichtbaren Box (CropBox geschnitten
 * mit MediaBox) statt aus der MediaBox: eine zugeschnittene Seite ist so
 * gross wie ihr Zuschnitt.
 */
function sichtbareGroesse(seite: PDFPage): { breite: number; hoehe: number } {
  const kasten = sichtbarerKasten(seite)
  const width = kasten[2] - kasten[0]
  const height = kasten[3] - kasten[1]
  return istQuerGedreht(seite) ? { breite: height, hoehe: width } : { breite: width, hoehe: height }
}

function istQuerGedreht(seite: PDFPage): boolean {
  return ((seite.getRotation().angle % 360) + 360) % 180 !== 0
}

/**
 * Dreht ueber `/Rotate`, nie ueber den Inhalt: so folgen Anmerkungen und
 * Formularfelder der Seite, wie in S4.1.
 */
function richteAus(seite: PDFPage, ausrichtung: DruckOptionen['ausrichtung']): void {
  if (ausrichtung === 'auto') return
  const sichtbar = sichtbareGroesse(seite)
  const liegtQuer = sichtbar.breite > sichtbar.hoehe
  const willQuer = ausrichtung === 'quer'
  if (liegtQuer === willQuer) return
  seite.setRotation(degrees((seite.getRotation().angle + 90) % 360))
}

/**
 * "An Seite anpassen": Inhalt und Anmerkungen gleichmaessig auf das Blatt
 * skalieren und darauf zentrieren. Zentriert wird ueber den Ursprung der
 * MediaBox statt ueber ein Verschieben des Inhalts - dann bleiben die
 * Anmerkungen ohne eigene Verschiebung an ihrer Stelle.
 */
function passeAn(
  dokument: PDFDocument,
  seite: PDFPage,
  blatt: { breite: number; hoehe: number }
): void {
  // Zentriert wird der **sichtbare** Bereich (S6.3). Vorher stand hier die
  // MediaBox - und weil unten alle Boxen auf das Blatt gesetzt werden, war
  // jeder Zuschnitt im Druck mit der Standardeinstellung wieder weg.
  const vorher = sichtbarerKasten(seite)
  const media = leseKasten(seite, 'MediaBox') ?? vorher
  const beschnitten = vorher.some((wert, i) => Math.abs(wert - (media[i] ?? wert)) > 1e-6)
  const sichtbar = sichtbareGroesse(seite)
  const faktor = Math.min(blatt.breite / sichtbar.breite, blatt.hoehe / sichtbar.hoehe)
  if (Math.abs(faktor - 1) > 1e-6) seite.scale(faktor, faktor)
  // `scale` skaliert Inhalt und Anmerkungen um den Ursprung - der sichtbare
  // Bereich wandert mit.
  const kasten: Kasten = [
    vorher[0] * faktor,
    vorher[1] * faktor,
    vorher[2] * faktor,
    vorher[3] * faktor
  ]
  // Das Blatt in den Koordinaten der (ungedrehten) Seite.
  const quer = istQuerGedreht(seite)
  const box = quer
    ? { breite: blatt.hoehe, hoehe: blatt.breite }
    : { breite: blatt.breite, hoehe: blatt.hoehe }
  const x = kasten[0] - (box.breite - (kasten[2] - kasten[0])) / 2
  const y = kasten[1] - (box.hoehe - (kasten[3] - kasten[1])) / 2
  if (beschnitten) blendeAusserhalbAus(dokument, seite, kasten)
  seite.setMediaBox(x, y, box.breite, box.hoehe)
  seite.setCropBox(x, y, box.breite, box.hoehe)
  seite.setBleedBox(x, y, box.breite, box.hoehe)
  seite.setTrimBox(x, y, box.breite, box.hoehe)
  seite.setArtBox(x, y, box.breite, box.hoehe)
}

/**
 * Eine zugeschnittene Seite, deren Blatt groesser ist als der Zuschnitt,
 * zeigte im Rand um den Zuschnitt herum wieder, was der Zuschnitt verbirgt.
 * Deshalb wird der Inhalt auf den Zuschnitt beschnitten (Clip-Pfad um die
 * Inhaltsstroeme), und Anmerkungen, die ganz ausserhalb liegen, kommen nicht
 * in die Vorlage - genau die blendet auch der Betrachter aus. Das Dokument
 * selbst bleibt unberuehrt; das hier ist nur die Druckvorlage.
 */
function blendeAusserhalbAus(dokument: PDFDocument, seite: PDFPage, kasten: Kasten): void {
  seite.node.normalize()
  const kontext = dokument.context
  const anfang = kontext.register(
    kontext.contentStream([
      pushGraphicsState(),
      rectangle(kasten[0], kasten[1], kasten[2] - kasten[0], kasten[3] - kasten[1]),
      clip(),
      endPath()
    ])
  )
  const ende = kontext.register(kontext.contentStream([popGraphicsState()]))
  seite.node.wrapContentStreams(anfang, ende)

  const annots = seite.node.Annots()
  if (annots === undefined) return
  const bleiben = annots.asArray().filter((eintrag) => {
    const dict = eintrag instanceof PDFRef ? kontext.lookup(eintrag) : eintrag
    if (!(dict instanceof PDFDict)) return true
    const rect = dict.lookup(PDFName.of('Rect'))
    if (!(rect instanceof PDFArray) || rect.size() !== 4) return true
    const z = [0, 1, 2, 3].map((i) => {
      const n = rect.lookup(i)
      return n instanceof PDFNumber ? n.asNumber() : Number.NaN
    })
    if (z.some((n) => !Number.isFinite(n))) return true
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = z
    return (
      schneide([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)], kasten) !==
      null
    )
  })
  seite.node.set(PDFName.of('Annots'), kontext.obj(bleiben))
}

/** Ohne "Kommentare mitdrucken" bleiben nur die Widgets der Formularfelder. */
function behalteNurFormularfelder(dokument: PDFDocument, seite: PDFPage): void {
  const annots = seite.node.Annots()
  if (annots === undefined) return
  const widgets = annots.asArray().filter((eintrag) => subtypVon(dokument, eintrag) === 'Widget')
  seite.node.set(PDFName.of('Annots'), dokument.context.obj(widgets))
}

function subtypVon(dokument: PDFDocument, eintrag: unknown): string | null {
  const dict = eintrag instanceof PDFRef ? dokument.context.lookup(eintrag) : eintrag
  if (!(dict instanceof PDFDict)) return null
  const subtyp = dict.get(PDFName.of('Subtype'))
  return subtyp instanceof PDFName ? subtyp.decodeText() : null
}

/**
 * Entfernt alles, was ein PDF-Betrachter als Skript ausfuehren koennte:
 * `/OpenAction` und `/AA` am Katalog, den `/JavaScript`-Namensbaum, `/AA` an
 * Seiten, Anmerkungen und Feldern, `/A`-Aktionen vom Typ JavaScript.
 *
 * Der Chromium-Betrachter (PDFium) fuehrt Dokument-Skripte grundsaetzlich
 * aus - im Gegensatz zu pdf.js mit `enableScripting: false` (Invariante 6).
 * Die Vorlage bekommt deshalb keine mit; ein fremdes Dokument erreicht den
 * Betrachter nie in seiner Rohform (ADR 0003).
 */
export function entferneSkripte(dokument: PDFDocument): number {
  let entfernt = 0
  const katalog = dokument.catalog
  for (const schluessel of ['OpenAction', 'AA']) {
    if (katalog.has(PDFName.of(schluessel))) {
      katalog.delete(PDFName.of(schluessel))
      entfernt++
    }
  }
  const namen = katalog.lookup(PDFName.of('Names'))
  if (namen instanceof PDFDict && namen.has(PDFName.of('JavaScript'))) {
    namen.delete(PDFName.of('JavaScript'))
    entfernt++
  }
  for (const seite of dokument.getPages()) {
    if (seite.node.has(PDFName.of('AA'))) {
      seite.node.delete(PDFName.of('AA'))
      entfernt++
    }
    const annots = seite.node.Annots()
    if (annots === undefined) continue
    for (const eintrag of annots.asArray()) {
      const dict = eintrag instanceof PDFRef ? dokument.context.lookup(eintrag) : eintrag
      if (!(dict instanceof PDFDict)) continue
      if (dict.has(PDFName.of('AA'))) {
        dict.delete(PDFName.of('AA'))
        entfernt++
      }
      const aktion = dict.lookup(PDFName.of('A'))
      if (aktion instanceof PDFDict && istJavaScript(aktion)) {
        dict.delete(PDFName.of('A'))
        entfernt++
      }
    }
  }
  // Auch die Felder selbst koennen Aktionen tragen (Format, Validate…).
  if (katalog.has(PDFName.of('AcroForm'))) {
    for (const feld of dokument.getForm().getFields()) {
      if (feld.acroField.dict.has(PDFName.of('AA'))) {
        feld.acroField.dict.delete(PDFName.of('AA'))
        entfernt++
      }
    }
  }
  return entfernt
}

function istJavaScript(aktion: PDFDict): boolean {
  const art = aktion.get(PDFName.of('S'))
  return art instanceof PDFName && art.decodeText() === 'JavaScript'
}

/** Wieviele Anmerkungen (ohne Widgets) das Dokument traegt - fuer den Hinweis. */
export function zaehleAnmerkungen(dokument: PDFDocument): number {
  let zahl = 0
  for (const seite of dokument.getPages()) {
    const annots = seite.node.Annots()
    if (annots === undefined) continue
    zahl += annots.asArray().filter((e) => subtypVon(dokument, e) !== 'Widget').length
  }
  return zahl
}
