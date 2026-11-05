import type { Kasten, Zuschnitt } from '../../../shared/mutation'
import { effektiveDrehung } from './drehung'
import {
  baueTransformation,
  bildschirmZuPdf,
  rechteckZuBildschirm,
  type Bildschirmrechteck,
  type Punkt
} from './koordinaten'
import { t } from '../../../shared/i18n'

/**
 * Die Rechnung hinter dem Zuschneiden (S6.3) - reine Funktionen mit
 * Rundlauftests, aus demselben Grund wie `koordinaten.ts` (Risiko R6).
 *
 * **Das Modell: vier Raender in Punkten, so wie der Nutzer die Seite sieht.**
 * "Links" ist der linke Rand auf dem Bildschirm, gleich wie die Seite im
 * PDF gedreht ist (`/Rotate`) und wie die Ansicht gedreht ist. Das hat drei
 * Gruende: der Rahmen auf der Seite und die Felder in mm sprechen dieselbe
 * Sprache; dieselben Raender lassen sich auf andere Seiten uebertragen
 * ("Auswahl", "Alle Seiten"), auch wenn die anders gross oder gedreht sind;
 * und die Umrechnung in PDF-Koordinaten passiert an genau einer Stelle
 * (`rahmenAusRaendern`), ueber die Matrix aus `koordinaten.ts`, die auch
 * Canvas und Anmerkungen benutzen.
 *
 * `view` ist `PDFPageProxy.view`: die **sichtbare** Box, also die CropBox
 * geschnitten mit der MediaBox. Ein zweiter Zuschnitt schneidet deshalb
 * innerhalb des ersten, und eine vorhandene CropBox mit Ursprung ≠ 0,0 geht
 * ueber die Verschiebung in der Matrix von selbst richtig ein.
 */

export interface Raender {
  links: number
  oben: number
  rechts: number
  unten: number
}

/** Breite und Hoehe der sichtbaren Seite in Punkten, wie sie auf dem Bildschirm liegt. */
export interface Seitenmass {
  breite: number
  hoehe: number
}

export const MM_JE_PUNKT = 25.4 / 72

/** Kleinste Kante in Punkten - gleich `MIN_ZUSCHNITT_KANTE` im Main. */
export const MIN_KANTE = 10

export const KEINE_RAENDER: Raender = { links: 0, oben: 0, rechts: 0, unten: 0 }

export function zuMm(punkte: number): number {
  return Math.round(punkte * MM_JE_PUNKT * 10) / 10
}

export function ausMm(mm: number): number {
  return mm / MM_JE_PUNKT
}

/** Das Mass der sichtbaren Seite bei der gegebenen wirksamen Drehung. */
export function seitenmass(view: readonly number[], drehung: number): Seitenmass {
  const flaeche = rechteckZuBildschirm(view, baueTransformation(view, 1, drehung))
  return { breite: flaeche.breite, hoehe: flaeche.hoehe }
}

function klemme(wert: number, min: number, max: number): number {
  return Math.min(Math.max(wert, min), Math.max(min, max))
}

/**
 * Haelt die Raender in der Seite: keiner negativ (das hiesse ueber die
 * sichtbare Box hinaus), und zwischen gegenueberliegenden bleibt mindestens
 * `MIN_KANTE`. Links und oben haben Vorrang - wer den linken Rand ueber den
 * rechten zieht, schiebt den rechten vor sich her.
 */
export function begrenzeRaender(raender: Raender, mass: Seitenmass): Raender {
  const links = klemme(raender.links, 0, mass.breite - MIN_KANTE)
  const oben = klemme(raender.oben, 0, mass.hoehe - MIN_KANTE)
  return {
    links,
    oben,
    rechts: klemme(raender.rechts, 0, mass.breite - MIN_KANTE - links),
    unten: klemme(raender.unten, 0, mass.hoehe - MIN_KANTE - oben)
  }
}

/** Die Raender aus einem aufgezogenen Rechteck zwischen zwei Punkten (in Punkten). */
export function raenderAusZug(start: Punkt, ende: Punkt, mass: Seitenmass): Raender {
  const x1 = klemme(Math.min(start.x, ende.x), 0, mass.breite)
  const x2 = klemme(Math.max(start.x, ende.x), 0, mass.breite)
  const y1 = klemme(Math.min(start.y, ende.y), 0, mass.hoehe)
  const y2 = klemme(Math.max(start.y, ende.y), 0, mass.hoehe)
  return { links: x1, oben: y1, rechts: mass.breite - x2, unten: mass.hoehe - y2 }
}

/** Das sichtbare Rechteck der Raender in CSS-Pixeln beim gegebenen Zoom. */
export function flaecheAusRaendern(
  raender: Raender,
  mass: Seitenmass,
  zoom: number
): Bildschirmrechteck {
  return {
    links: raender.links * zoom,
    oben: raender.oben * zoom,
    breite: Math.max(0, mass.breite - raender.links - raender.rechts) * zoom,
    hoehe: Math.max(0, mass.hoehe - raender.oben - raender.unten) * zoom
  }
}

/** Woran der Nutzer zieht: eine Kante, eine Ecke oder das Innere (verschieben). */
export type Griff =
  | 'links'
  | 'rechts'
  | 'oben'
  | 'unten'
  | 'linksOben'
  | 'rechtsOben'
  | 'linksUnten'
  | 'rechtsUnten'
  | 'innen'

export const GRIFFE: readonly Exclude<Griff, 'innen'>[] = [
  'linksOben',
  'oben',
  'rechtsOben',
  'rechts',
  'rechtsUnten',
  'unten',
  'linksUnten',
  'links'
]

/**
 * Die Raender, nachdem der Griff um `dx`/`dy` (Punkte, Bildschirmrichtung)
 * gezogen wurde - ausgehend vom Stand beim Zugriff, nicht vom letzten
 * Zwischenschritt, damit sich Rundungen nicht aufsummieren.
 */
export function zieheGriff(
  start: Raender,
  griff: Griff,
  dx: number,
  dy: number,
  mass: Seitenmass
): Raender {
  if (griff === 'innen') {
    // Verschieben: die Groesse bleibt, der Rahmen stoesst an die Seitenkanten.
    const verschiebungX = klemme(dx, -start.links, start.rechts)
    const verschiebungY = klemme(dy, -start.oben, start.unten)
    return {
      links: start.links + verschiebungX,
      rechts: start.rechts - verschiebungX,
      oben: start.oben + verschiebungY,
      unten: start.unten - verschiebungY
    }
  }
  const neu = { ...start }
  if (griff === 'links' || griff === 'linksOben' || griff === 'linksUnten') {
    neu.links = klemme(start.links + dx, 0, mass.breite - start.rechts - MIN_KANTE)
  }
  if (griff === 'rechts' || griff === 'rechtsOben' || griff === 'rechtsUnten') {
    neu.rechts = klemme(start.rechts - dx, 0, mass.breite - start.links - MIN_KANTE)
  }
  if (griff === 'oben' || griff === 'linksOben' || griff === 'rechtsOben') {
    neu.oben = klemme(start.oben + dy, 0, mass.hoehe - start.unten - MIN_KANTE)
  }
  if (griff === 'unten' || griff === 'linksUnten' || griff === 'rechtsUnten') {
    neu.unten = klemme(start.unten - dy, 0, mass.hoehe - start.oben - MIN_KANTE)
  }
  return neu
}

/** Auf Tausendstel Punkt: genug fuer jede Darstellung, und die Datei bekommt keine 17 Stellen. */
function runde(wert: number): number {
  return Math.round(wert * 1000) / 1000
}

/**
 * Raender → Rahmen in PDF-Benutzerkoordinaten, sortiert - das, was als
 * `/CropBox` in die Datei geht. `null`, wenn nach Abzug der Raender weniger
 * als `MIN_KANTE` uebrig bleibt (die Seite ist kleiner als die Raender).
 */
export function rahmenAusRaendern(
  view: readonly number[],
  drehung: number,
  raender: Raender
): Kasten | null {
  const mass = seitenmass(view, drehung)
  const breite = mass.breite - raender.links - raender.rechts
  const hoehe = mass.hoehe - raender.oben - raender.unten
  if (breite < MIN_KANTE - 1e-6 || hoehe < MIN_KANTE - 1e-6) return null
  if (Math.min(raender.links, raender.rechts, raender.oben, raender.unten) < 0) return null
  const matrix = baueTransformation(view, 1, drehung)
  const a = bildschirmZuPdf({ x: raender.links, y: raender.oben }, matrix)
  const b = bildschirmZuPdf(
    { x: mass.breite - raender.rechts, y: mass.hoehe - raender.unten },
    matrix
  )
  if (a === null || b === null) return null
  return [
    runde(Math.min(a.x, b.x)),
    runde(Math.min(a.y, b.y)),
    runde(Math.max(a.x, b.x)),
    runde(Math.max(a.y, b.y))
  ]
}

/** Die Umkehrung: welche Raender ein Rahmen auf dieser Seite laesst. */
export function raenderAusRahmen(
  view: readonly number[],
  drehung: number,
  rahmen: Kasten
): Raender {
  const mass = seitenmass(view, drehung)
  const flaeche = rechteckZuBildschirm(rahmen, baueTransformation(view, 1, drehung))
  return {
    links: flaeche.links,
    oben: flaeche.oben,
    rechts: mass.breite - flaeche.links - flaeche.breite,
    unten: mass.hoehe - flaeche.oben - flaeche.hoehe
  }
}

/** Was von einer Seite gebraucht wird - `PDFPageProxy` erfuellt das. */
export interface SeitenGeometrie {
  view: readonly number[]
  rotate: number
}

export interface GeometrieQuelle {
  getPage: (nummer: number) => Promise<SeitenGeometrie>
}

/**
 * Dieselben Raender fuer mehrere Seiten, je Seite in PDF-Koordinaten
 * umgerechnet. Liefert eine Fehlermeldung statt einer halben Liste, wenn
 * eine Seite fuer die Raender zu klein ist.
 */
export async function berechneZuschnitte(
  quelle: GeometrieQuelle,
  seiten: readonly number[],
  raender: Raender,
  ansichtsDrehung: number
): Promise<{ zuschnitte: Zuschnitt[] } | { fehler: string }> {
  const zuschnitte: Zuschnitt[] = []
  for (const seite of seiten) {
    const geometrie = await quelle.getPage(seite)
    const drehung = effektiveDrehung(geometrie.rotate, ansichtsDrehung)
    const rahmen = rahmenAusRaendern(geometrie.view, drehung, raender)
    if (rahmen === null) {
      return { fehler: t('zuschnitt.zuKlein', { seite }) }
    }
    zuschnitte.push({ seite, rahmen })
  }
  return { zuschnitte }
}
