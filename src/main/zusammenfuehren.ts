import type { Bereich } from '../shared/bereiche'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFPage
} from 'pdf-lib'
import { t } from '../shared/i18n'

/**
 * Zusammenfuehren und Teilen (S4.2a) — der electron-freie Kern.
 *
 * **Zusammenfuehren** kopiert die Seiten aller Quellen in ein neues Dokument.
 * pdf-lib kopiert dabei den Objektgraphen jeder Seite mit — Anmerkungen,
 * Formular-Widgets und deren `/Parent`-Felder —, traegt die Felder aber
 * **nicht** in das `/AcroForm` des Ziels ein. Ohne Nacharbeit haette das Ziel
 * Widgets ohne Formular: sichtbar, aber fuer `getForm()` unsichtbar, und der
 * Speicherpfad aus S3.2 faende die Felder nicht. `uebernimmFelder` haengt die
 * Wurzelfelder der kopierten Widgets ein.
 *
 * **Kollidierende Feldnamen** — dasselbe Formular zweimal, oder zwei
 * Formulare mit einem Feld `name` — bekommen einen Suffix: `name`, `name_2`,
 * `name_3`. Ein Feld gleichen Namens waere in PDF **ein** Feld mit mehreren
 * Widgets und einem gemeinsamen Wert; wer zwei ausgefuellte Formulare
 * zusammenfuehrt, will beide Werte behalten. Deshalb umbenennen, nicht
 * verschmelzen — und auch nicht flachlegen, das naehme dem Nutzer etwas weg,
 * ohne zu fragen.
 *
 * **Unterschiedliche Seitengroessen** sind kein Problem: jede Seite behaelt
 * ihre `/MediaBox`; der Viewer zeigt seit S1.2 gemischte Groessen.
 */

export interface Zusammenfuehrung {
  bytes: Uint8Array
  seiten: number
  /** Feldnamen, die wegen Kollision umbenannt wurden: alt → neu. */
  umbenannt: { von: string; nach: string }[]
}

export async function fuehreZusammen(quellen: readonly Uint8Array[]): Promise<Zusammenfuehrung> {
  if (quellen.length === 0) throw new Error('Keine Dokumente zum Zusammenfuehren.') // KEIN-UI-TEXT: Invariante, der IPC-Handler prueft vorher
  const ziel = await PDFDocument.create()
  const vergeben = new Set<string>()
  const umbenannt: { von: string; nach: string }[] = []

  for (const bytes of quellen) {
    const quelle = await PDFDocument.load(bytes, { updateMetadata: false })
    const indizes = quelle.getPageIndices()
    const kopiert = await ziel.copyPages(quelle, indizes)
    for (const seite of kopiert) ziel.addPage(seite)
    uebernimmFelder(ziel, kopiert, vergeben, umbenannt)
  }
  return { bytes: await ziel.save(), seiten: ziel.getPageCount(), umbenannt }
}

/**
 * Traegt die Wurzelfelder der Widgets auf `seiten` ins AcroForm des Ziels ein
 * und loest Namenskollisionen ueber einen Suffix am Wurzelnamen.
 */
function uebernimmFelder(
  ziel: PDFDocument,
  seiten: readonly PDFPage[],
  vergeben: Set<string>,
  umbenannt: { von: string; nach: string }[]
): void {
  const wurzeln = new Map<PDFDict, PDFRef>()
  for (const seite of seiten) {
    const annots = seite.node.Annots()
    if (annots === undefined) continue
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      const dict = ziel.context.lookup(ref)
      if (!(dict instanceof PDFDict)) continue
      if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue
      const wurzel = wurzelVon(ziel, dict, ref instanceof PDFRef ? ref : null)
      if (wurzel !== null) wurzeln.set(wurzel.dict, wurzel.ref)
    }
  }
  if (wurzeln.size === 0) return

  // Erst jetzt ein AcroForm anlegen: ein Dokument ohne Formular soll keines
  // bekommen, nur weil eine Quelle ohne Felder dabei war.
  const acroForm = ziel.getForm().acroForm
  const felder = acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray) ?? ziel.context.obj([])
  acroForm.dict.set(PDFName.of('Fields'), felder)

  for (const [dict, ref] of wurzeln) {
    const name = textVon(dict.get(PDFName.of('T')))
    if (name !== null) {
      let frei = name
      for (let n = 2; vergeben.has(frei); n++) frei = name + '_' + String(n)
      if (frei !== name) {
        dict.set(PDFName.of('T'), PDFHexString.fromText(frei))
        umbenannt.push({ von: name, nach: frei })
      }
      vergeben.add(frei)
    }
    felder.push(ref)
  }
}

/** Das oberste Feld ueber einem Widget - das Widget selbst, wenn es keines hat. */
function wurzelVon(
  dokument: PDFDocument,
  widget: PDFDict,
  widgetRef: PDFRef | null
): { dict: PDFDict; ref: PDFRef } | null {
  let dict = widget
  let ref: PDFRef | null = widgetRef
  for (let tiefe = 0; tiefe < 32; tiefe++) {
    const parentRef = dict.get(PDFName.of('Parent'))
    if (!(parentRef instanceof PDFRef)) break
    const parent = dokument.context.lookup(parentRef)
    if (!(parent instanceof PDFDict)) break
    dict = parent
    ref = parentRef
  }
  return ref === null ? null : { dict, ref }
}

function textVon(wert: unknown): string | null {
  if (wert instanceof PDFString || wert instanceof PDFHexString) return wert.decodeText()
  return null
}

/**
 * **Teilen**: `bereiche` sind einsbasierte, inklusive Intervalle; jedes wird
 * eine Datei. `einzelseiten(n)` liefert n Bereiche der Laenge eins.
 */
export type { Bereich }

export function einzelseiten(seitenzahl: number): Bereich[] {
  return Array.from({ length: seitenzahl }, (_, i) => [i + 1, i + 1] as const)
}

/**
 * Prueft eine Bereichsliste aus dem Renderer: Zahlen, einsbasiert, `von <= bis`,
 * innerhalb des Dokuments. Ueberlappungen sind erlaubt - wer die Seiten 1-3
 * und 2-5 als zwei Dateien will, soll sie bekommen.
 */
export function pruefeBereiche(eingabe: unknown, seitenzahl: number): Bereich[] | null {
  if (!Array.isArray(eingabe) || eingabe.length === 0) return null
  const bereiche: Bereich[] = []
  for (const b of eingabe) {
    if (!Array.isArray(b) || b.length !== 2) return null
    const [von, bis] = b as unknown[]
    if (typeof von !== 'number' || typeof bis !== 'number') return null
    if (!Number.isInteger(von) || !Number.isInteger(bis)) return null
    if (von < 1 || bis < von || bis > seitenzahl) return null
    bereiche.push([von, bis])
  }
  return bereiche
}

export async function teile(
  bytes: Uint8Array,
  bereiche: readonly Bereich[]
): Promise<Uint8Array[]> {
  const quelle = await PDFDocument.load(bytes, { updateMetadata: false })
  const ergebnis: Uint8Array[] = []
  for (const [von, bis] of bereiche) {
    const teil = await PDFDocument.create()
    const indizes = Array.from({ length: bis - von + 1 }, (_, i) => von - 1 + i)
    const kopiert = await teil.copyPages(quelle, indizes)
    for (const seite of kopiert) teil.addPage(seite)
    // Die Felder des Teils: dieselbe Nacharbeit wie beim Zusammenfuehren,
    // sonst waeren die Widgets im Teil formularlos.
    uebernimmFelder(teil, kopiert, new Set(), [])
    ergebnis.push(await teil.save())
  }
  return ergebnis
}

/**
 * **Extrahieren** (S6.2, Aufgabe 3): beliebige Seiten in beliebiger
 * Reihenfolge als **eine** neue Datei. Das Teilen kennt nur zusammenhaengende
 * Bereiche, eine Auswahl wie 1, 4, 7 ist keiner. Felder wie beim Teilen.
 */
export async function extrahiere(
  bytes: Uint8Array,
  seiten: readonly number[]
): Promise<Uint8Array> {
  const quelle = await PDFDocument.load(bytes, { updateMetadata: false })
  const ziel = await PDFDocument.create()
  const kopiert = await ziel.copyPages(
    quelle,
    seiten.map((seite) => seite - 1)
  )
  for (const seite of kopiert) ziel.addPage(seite)
  uebernimmFelder(ziel, kopiert, new Set(), [])
  return ziel.save()
}

/**
 * Prueft die Seitenliste eines Extrahier-Auftrags: ganze Zahlen im Dokument,
 * mindestens eine, keine doppelt - dieselbe Seite zweimal zu kopieren ergaebe
 * zwei Widgets mit demselben Feld, und das gewollt hat niemand.
 */
export function pruefeSeitenliste(eingabe: unknown, seitenzahl: number): number[] | null {
  if (!Array.isArray(eingabe) || eingabe.length === 0) return null
  const seiten: number[] = []
  for (const s of eingabe) {
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > seitenzahl) return null
    seiten.push(s)
  }
  return new Set(seiten).size === seiten.length ? seiten : null
}

/**
 * Dateiname fuer extrahierte Seiten: ein zusammenhaengender Bereich heisst wie
 * beim Teilen (`bericht-S3-S5.pdf`), alles andere `bericht-Auszug.pdf`.
 */
export function extraktname(basisname: string, seiten: readonly number[]): string {
  const erste = seiten[0]
  const zusammenhaengend = erste !== undefined && seiten.every((seite, i) => seite === erste + i)
  if (zusammenhaengend) return teilname(basisname, [erste, erste + seiten.length - 1])
  return t('extrakt.dateiname', { name: basisname.replace(/\.pdf$/i, '') })
}

/** Dateiname eines Teils: `bericht.pdf` → `bericht-S3.pdf` oder `bericht-S3-S5.pdf`. */
export function teilname(basisname: string, bereich: Bereich): string {
  const stamm = basisname.replace(/\.pdf$/i, '')
  const [von, bis] = bereich
  return (
    stamm + (von === bis ? '-S' + String(von) : '-S' + String(von) + '-S' + String(bis)) + '.pdf'
  )
}
