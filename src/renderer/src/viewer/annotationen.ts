import type {
  Annotation,
  AnnotationsTyp,
  AnnotationsZiel,
  Farbe
} from '../../../shared/annotations'
import { DARSTELLBARE_TYPEN } from '../../../shared/annotations'
import {
  ausrichtungAusQ,
  schriftFamilieAusName,
  stilAusName,
  STANDARD_SCHRIFTGROESSE
} from '../../../shared/freitext'
import {
  huelle,
  punktInRechteck,
  quadPointsZuRechtecken,
  rechteckZuBildschirm,
  type Bildschirmrechteck,
  type Matrix,
  type Punkt
} from './koordinaten'

/**
 * Von pdf.js gelesene Annotationen in das interne Modell umsetzen (S2.1).
 *
 * Durchgehend defensiv, wie `wandleGliederung` in Sidebar.tsx: die Felder
 * kommen aus einem fremden Dokument. Ein Datensatz ohne brauchbares Rechteck
 * wird uebergangen statt an einer Nullstelle der Seite gezeichnet.
 */

/** `/F`-Flags aus der PDF-Spezifikation, so weit sie die Anzeige betreffen. */
const FLAG_HIDDEN = 2
const FLAG_NOVIEW = 32

function alsZeichenkette(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

/**
 * Zahlenfolgen aus pdf.js kommen mal als `Array`, mal als `Float32Array`
 * (`/QuadPoints` und `/InkList`). Beides landet hier als gewoehnliches Array.
 */
function zahlenliste(wert: unknown): number[] | null {
  if (Array.isArray(wert)) {
    return wert.every((eintrag) => typeof eintrag === 'number' && Number.isFinite(eintrag))
      ? (wert as number[])
      : null
  }
  if (wert instanceof Float32Array || wert instanceof Float64Array) {
    const liste = Array.from(wert)
    return liste.every((eintrag) => Number.isFinite(eintrag)) ? liste : null
  }
  return null
}

function rechteck(wert: unknown): [number, number, number, number] | null {
  const liste = zahlenliste(wert)
  if (liste === null || liste.length < 4) return null
  const [x1, y1, x2, y2] = liste as [number, number, number, number]
  // Sortiert ablegen: manche Dokumente nennen die Ecken in beliebiger Folge,
  // und jede Aufrufstelle einzeln sortieren zu lassen waere eine Fehlerquelle.
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
}

function farbe(wert: unknown): Farbe | null {
  const liste =
    wert instanceof Uint8ClampedArray || wert instanceof Uint8Array
      ? Array.from(wert)
      : zahlenliste(wert)
  if (liste === null || liste.length < 3) return null
  const [r, g, b] = liste as [number, number, number]
  return { r, g, b }
}

/**
 * `/BS /W`. pdf.js reicht den Rahmenstil als Objekt mit `width` durch; fehlt
 * er, nennt das Dokument keine Staerke, und `null` ist die ehrlichere Antwort
 * als eine erfundene Vorgabe.
 */
function strichstaerke(wert: unknown): number | null {
  if (typeof wert !== 'object' || wert === null || !('width' in wert)) return null
  const breite: unknown = wert.width
  return typeof breite === 'number' && Number.isFinite(breite) && breite > 0 ? breite : null
}

function text(wert: unknown): string {
  if (typeof wert === 'string') return wert
  if (typeof wert === 'object' && wert !== null && 'str' in wert) {
    return alsZeichenkette(wert.str)
  }
  return ''
}

function typVon(subtyp: string): AnnotationsTyp {
  return (DARSTELLBARE_TYPEN as readonly string[]).includes(subtyp)
    ? (subtyp as AnnotationsTyp)
    : 'Unbekannt'
}

/**
 * Wohin ein Link zeigt.
 *
 * Reihenfolge mit Absicht: ein internes Ziel schlaegt eine URL. Manche
 * Dokumente tragen beides ein, und der Sprung im Dokument ist dann das, was
 * gemeint war.
 *
 * Bei der URL steht `unsafeUrl` — die Angabe aus dem Dokument — vor `url`,
 * das pdf.js bereits gefiltert hat. Das ist kein Versehen: die Pruefung gehoert
 * in den Main-Prozess (`pruefeExternesZiel`), und der soll das echte Ziel
 * sehen. Wuerde hier schon gefiltert, koennte die Anwendung ein `file:`-Ziel
 * gar nicht mehr sichtbar ablehnen — es waere einfach verschwunden.
 */
function ziel(daten: Record<string, unknown>, typ: AnnotationsTyp): AnnotationsZiel | null {
  if (typ !== 'Link') return null
  const zielAngabe = daten['dest']
  if (typeof zielAngabe === 'string' ? zielAngabe.length > 0 : Array.isArray(zielAngabe)) {
    return { art: 'intern', ziel: zielAngabe }
  }
  const roh = daten['unsafeUrl'] ?? daten['url']
  return typeof roh === 'string' && roh.length > 0 ? { art: 'extern', url: roh } : null
}

/**
 * Schrift, Groesse, Farbe und Ausrichtung eines fremden `/FreeText` (S6.5,
 * Aufgabe 3) — aus dem, was pdf.js beim Lesen des `/DA`-Strings bereits
 * ausgewertet hat (`defaultAppearanceData`, `textAlignment`).
 *
 * Best-Effort wie beim Link-Ziel: ein Fremddokument kann jeden Schriftnamen
 * eintragen, und ohne verlaesslichen Namen bleibt Helvetica ohne Stil die
 * Vorgabe — dieselbe, die auch ein neues Textfeld bekommt.
 */
function freitextFelder(daten: Record<string, unknown>): Partial<Annotation> {
  const da = daten['defaultAppearanceData']
  const datenobjekt = typeof da === 'object' && da !== null ? (da as Record<string, unknown>) : {}
  const groesseRoh = datenobjekt['fontSize']
  const groesse =
    typeof groesseRoh === 'number' && groesseRoh > 0 ? groesseRoh : STANDARD_SCHRIFTGROESSE
  const nameRoh = datenobjekt['fontName']
  const name = typeof nameRoh === 'string' ? nameRoh : ''
  const stil = stilAusName(name)
  const textfarbe = farbe(datenobjekt['fontColor'])
  return {
    schriftFamilie: schriftFamilieAusName(name),
    schriftGroesse: groesse,
    schriftFett: stil.fett,
    schriftKursiv: stil.kursiv,
    ausrichtung: ausrichtungAusQ(daten['textAlignment']),
    // Bei FreeText ist das die sichtbare Textfarbe (aus /DA), nicht /C
    // (Rahmenfarbe) — deshalb hier ueberschrieben statt uebernommen.
    ...(textfarbe !== null ? { farbe: textfarbe } : {})
  }
}

function striche(wert: unknown): number[][] | null {
  if (!Array.isArray(wert)) return null
  const zuege = wert
    .map(zahlenliste)
    .filter((zug): zug is number[] => zug !== null && zug.length >= 2)
  return zuege.length === 0 ? null : zuege
}

/**
 * Ein Datensatz von `PDFPageProxy.getAnnotations` als interne Annotation.
 *
 * `null`, wenn er nicht brauchbar ist — ohne Rechteck gibt es keine Stelle,
 * an der die Annotation liegen koennte.
 */
export function wandleAnnotation(roh: unknown, seite: number): Annotation | null {
  if (typeof roh !== 'object' || roh === null) return null
  const daten = roh as Record<string, unknown>

  const rect = rechteck(daten['rect'])
  if (rect === null) return null

  const subtyp = alsZeichenkette(daten['subtype'])
  const typ = typVon(subtyp)
  const flags = typeof daten['annotationFlags'] === 'number' ? daten['annotationFlags'] : 0
  const opazitaet = typeof daten['opacity'] === 'number' ? daten['opacity'] : 1

  return {
    id: alsZeichenkette(daten['id']),
    seite,
    typ,
    subtyp,
    rect,
    quadPoints: zahlenliste(daten['quadPoints']),
    striche: striche(daten['inkLists']),
    farbe: farbe(daten['color']),
    strichstaerke: strichstaerke(daten['borderStyle']),
    opazitaet: Math.min(1, Math.max(0, opazitaet)),
    autor: text(daten['titleObj']),
    inhalt: text(daten['contentsObj']),
    erstellt: typeof daten['creationDate'] === 'string' ? daten['creationDate'] : null,
    geaendert: typeof daten['modificationDate'] === 'string' ? daten['modificationDate'] : null,
    versteckt: (flags & FLAG_HIDDEN) !== 0 || (flags & FLAG_NOVIEW) !== 0,
    ziel: ziel(daten, typ),
    roh,
    // Fremde /FreeText bleiben bearbeitbar (S6.5, Aufgabe 3): Schrift, Groesse,
    // Farbe und Ausrichtung kommen aus ihrem /DA, nicht aus unseren Vorgaben.
    ...(typ === 'FreeText' ? freitextFelder(daten) : {})
  }
}

/**
 * Eine ganze Seite. Datensaetze ohne `id` bekommen eine aus Seitennummer und
 * Stelle — doppelte React-Schluessel waeren sonst der Fehler, der sich am
 * schlechtesten finden laesst.
 */
export function wandleAnnotationen(rohe: unknown, seite: number): Annotation[] {
  if (!Array.isArray(rohe)) return []
  const gewandelt: Annotation[] = []
  rohe.forEach((eintrag, nummer) => {
    const annotation = wandleAnnotation(eintrag, seite)
    if (annotation === null) return
    gewandelt.push(
      annotation.id.length > 0
        ? annotation
        : { ...annotation, id: 'seite' + String(seite) + '-' + String(nummer) }
    )
  })
  return gewandelt
}

/**
 * Die Bildschirmrechtecke einer Annotation.
 *
 * Text-Markup hat je Zeile ein eigenes Rechteck; alles Uebrige genau eines.
 */
export function rechteckeFuer(annotation: Annotation, matrix: Matrix): Bildschirmrechteck[] {
  if (annotation.quadPoints !== null && annotation.quadPoints.length >= 8) {
    const aufgeteilt = quadPointsZuRechtecken(annotation.quadPoints, matrix)
    if (aufgeteilt.length > 0) return aufgeteilt
  }
  return [rechteckZuBildschirm(annotation.rect, matrix)]
}

/** Eine Annotation mit ihren bereits umgerechneten Rechtecken. */
export interface GezeichneteAnnotation {
  annotation: Annotation
  rechtecke: Bildschirmrechteck[]
}

export function zeichne(
  annotationen: readonly Annotation[],
  matrix: Matrix
): GezeichneteAnnotation[] {
  return annotationen.map((annotation) => ({
    annotation,
    rechtecke: rechteckeFuer(annotation, matrix)
  }))
}

/** Wieviel Rand ein Treffer bekommt. Eine Unterstreichung ist nur wenige Pixel hoch. */
export const TREFFER_TOLERANZ = 2

/**
 * Hit-Testing (S2.1, Aufgabe 6).
 *
 * Von hinten nach vorn: spaeter gezeichnete Annotationen liegen oben, und wer
 * auf eine Ueberlappung klickt, meint die obere. Geprueft werden die genauen
 * Rechtecke, nicht ihre Huelle — bei einer zweizeiligen Markierung liegt
 * zwischen den Zeilen kein Treffer.
 */
export function findeAnnotationUnter(
  punkt: Punkt,
  gezeichnete: readonly GezeichneteAnnotation[],
  toleranz: number = TREFFER_TOLERANZ
): Annotation | null {
  for (let i = gezeichnete.length - 1; i >= 0; i--) {
    const eintrag = gezeichnete[i]
    if (eintrag === undefined) continue
    if (eintrag.rechtecke.some((flaeche) => punktInRechteck(punkt, flaeche, toleranz))) {
      return eintrag.annotation
    }
  }
  return null
}

/** Die Huelle einer Annotation — Grundlage fuer ihre anklickbare Flaeche. */
export function huelleFuer(annotation: Annotation, matrix: Matrix): Bildschirmrechteck | null {
  return huelle(rechteckeFuer(annotation, matrix))
}
