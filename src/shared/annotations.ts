/**
 * Das interne Annotationsmodell (S2.1, Aufgabe 4).
 *
 * Bewusst unabhaengig von der Struktur, die pdf.js liefert: S2.2 erzeugt und
 * aendert Annotationen, S2.3a schreibt sie mit pdf-lib zurueck. Beide Seiten
 * arbeiten gegen dieses Modell. Haenge die Oberflaeche direkt an die
 * pdf.js-Felder, waere jeder Bibliothekswechsel und jede Umbenennung dort ein
 * Umbau quer durch die Anwendung.
 *
 * Die Masse stehen durchgaengig in PDF-Benutzerkoordinaten: Ursprung unten
 * links, y waechst nach oben, Einheit Punkt. Die Umrechnung auf den Bildschirm
 * passiert an genau einer Stelle (viewer/koordinaten.ts) — nicht hier.
 */

import type { Ausrichtung, SchriftFamilie } from './freitext'
import { t } from './i18n'

/**
 * Die in S2.1 dargestellten Subtypen. `Unbekannt` steht fuer alles Uebrige:
 * solche Annotationen bleiben im Modell erhalten (siehe `roh`), werden aber
 * nicht gezeichnet. Sie wegzuwerfen waere der Anfang von Datenverlust.
 */
export type AnnotationsTyp =
  | 'Highlight'
  | 'Underline'
  | 'StrikeOut'
  | 'Text'
  | 'Ink'
  | 'Stamp'
  | 'Square'
  | 'Circle'
  | 'Link'
  /** Freier Text (S6.5) — eigener Typ, nicht zu verwechseln mit 'Text' (Notizzettel). */
  | 'FreeText'
  | 'Unbekannt'

/** Die Subtypen, die der Anzeige-Layer kennt — in der Reihenfolge des Plans. */
export const DARSTELLBARE_TYPEN = [
  'Highlight',
  'Underline',
  'StrikeOut',
  'Text',
  'Ink',
  'Stamp',
  'Square',
  'Circle',
  'Link',
  'FreeText'
] as const satisfies readonly AnnotationsTyp[]

export function istDarstellbar(typ: AnnotationsTyp): boolean {
  return (DARSTELLBARE_TYPEN as readonly AnnotationsTyp[]).includes(typ)
}

/** Farbkanaele 0..255, wie sie pdf.js aus dem `/C`-Feld liefert. */
export interface Farbe {
  r: number
  g: number
  b: number
}

/** Rechteck in PDF-Benutzerkoordinaten: `[x1, y1, x2, y2]`, unten links zuerst. */
export type PdfRechteck = readonly [number, number, number, number]

/**
 * Wohin ein `Link` zeigt.
 *
 * Die Trennung ist nicht kosmetisch: interne Ziele loest der Renderer selbst
 * auf (`loeseZielAuf`), externe gehen ueber den Main-Prozess, der das Schema
 * prueft und vorher fragt. Ein gemeinsamer Typ wuerde diese beiden Wege
 * verwischen.
 */
export type AnnotationsZiel =
  | { art: 'intern'; ziel: unknown }
  /** Das Ziel **wie im Dokument angegeben** — ungeprueft. Der Main prueft es. */
  | { art: 'extern'; url: string }

export interface Annotation {
  /** Von pdf.js vergeben, eindeutig im Dokument. */
  id: string
  /** Einsbasierte Seitennummer. */
  seite: number
  typ: AnnotationsTyp
  /** Der rohe Subtyp aus dem Dokument, auch fuer `Unbekannt`. */
  subtyp: string
  rect: PdfRechteck
  /**
   * Vier Eckpunkte je Textzeile, flach: `x1,y1,…,x4,y4` in der Reihenfolge
   * oben-links, oben-rechts, unten-links, unten-rechts. `null` bei
   * Annotationen ohne Text-Markup.
   *
   * Je Zeile ein eigener Viererblock — ein einzelnes Rechteck ueber den ganzen
   * Bereich waere bei mehrzeiligen Markierungen falsch (S2.2, Aufgabe 2).
   */
  quadPoints: readonly number[] | null
  /** Freihandzuege, je Zug eine flache Punktliste `x,y,x,y,…`. */
  striche: readonly (readonly number[])[] | null
  farbe: Farbe | null
  /**
   * Strichstaerke in PDF-Punkten (`/BS /W`). `null`, wenn das Dokument keine
   * nennt. Gebraucht ab S2.2 fuer Freihand und Rahmen; bei Text-Markup ohne
   * Bedeutung.
   */
  strichstaerke: number | null
  /** `/CA`, 0..1. Ohne Angabe 1. */
  opazitaet: number
  autor: string
  inhalt: string
  /** PDF-Datumszeichenketten, unveraendert. `null`, wenn nicht angegeben. */
  erstellt: string | null
  geaendert: string | null
  /** `/F`-Flag Hidden oder NoView. Solche Annotationen werden nicht gezeichnet. */
  versteckt: boolean
  ziel: AnnotationsZiel | null
  /**
   * Ein Bild fuer einen Stempel (S3.2): die grafische Signatur, als PNG- oder
   * JPEG-Data-URL. Optional und nicht `null`, damit nur die Stelle, die es
   * setzt, davon wissen muss. Ein Stempel mit Bild zeigt das Bild statt seines
   * Textes; sein `/AP` traegt das Bild als XObject.
   *
   * Das ist ein **Bild** und keine kryptografische Signatur — es belegt
   * nichts ausser, dass jemand es dort abgelegt hat.
   */
  bild?: string
  /**
   * Nur bei `FreeText` (S6.5): Schrift, Groesse in Punkten, Stil und
   * Ausrichtung. Optional wie `bild` — jede andere Stelle im Modell soll
   * nicht wissen muessen, dass es diese Felder gibt.
   */
  schriftFamilie?: SchriftFamilie
  schriftGroesse?: number
  schriftFett?: boolean
  schriftKursiv?: boolean
  ausrichtung?: Ausrichtung
  /**
   * Der unveraenderte Datensatz von pdf.js.
   *
   * Folge von D7 (vollstaendiges Neuschreiben): was diese Fassung nicht
   * versteht, darf nicht schon beim Einlesen verloren gehen. Zur Klarheit —
   * das ist **nicht** das PDF-Dictionary, sondern pdf.js' Lesart davon. Die
   * echten Objekte holt S2.3a beim Speichern erneut aus der Datei; `roh` traegt
   * bis dahin alles, was die Oberflaeche fuer unbekannte Typen braucht.
   */
  roh: unknown
}

/**
 * Anteil 0..1 von der Seitenoberkante, an dem die Annotation beginnt.
 *
 * Damit springt die Liste in der Seitenleiste an dieselbe Stelle, an der auch
 * ein Sprungziel landen wuerde (`Zielausrichtung` in viewer/ziel.ts) — beide
 * rechnen von oben, obwohl das PDF von unten misst.
 */
export function anteilVonOben(rect: PdfRechteck, seitenHoehe: number): number | null {
  if (seitenHoehe <= 0) return null
  const oben = Math.max(rect[1], rect[3])
  return Math.min(1, Math.max(0, (seitenHoehe - oben) / seitenHoehe))
}

/** Kurzer Text fuer die Liste in der Seitenleiste. */
export function beschriftung(annotation: Annotation): string {
  const inhalt = annotation.inhalt.replace(/\s+/g, ' ').trim()
  if (inhalt.length > 0) return inhalt
  if (annotation.ziel?.art === 'extern') return annotation.ziel.url
  const autor = annotation.autor.trim()
  return autor.length > 0 ? autor : t('anmerkung.ohneInhalt')
}
