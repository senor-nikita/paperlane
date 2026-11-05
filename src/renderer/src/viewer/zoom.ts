import { gedrehteGroesse, SEITENABSTAND, type SeitenGroesse } from './layout'

export const ZOOMSTUFEN = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

/**
 * Groesste Kantenlaenge, die Browser fuer ein Canvas zulassen. Wird sie
 * ueberschritten, liefert der Browser ein leeres Canvas — ohne Fehlermeldung.
 * Deshalb wird der Zoom vorher begrenzt statt hinterher zu raten, warum die
 * Seite weiss bleibt.
 */
export const MAX_CANVAS_KANTE = 16384

export function begrenzeZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Liest eine getippte Zoomangabe: "150", "150 %", "87,5". Zahl ohne Prozentzeichen
 * gilt als Prozent. Liefert den Faktor (1,5), begrenzt auf den erlaubten Bereich,
 * oder `null`, wenn der Text keine Zahl ist.
 */
export function parseZoomEingabe(text: string): number | null {
  const treffer = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text)
  if (treffer === null) return null
  const prozent = Number((treffer[1] ?? '').replace(',', '.'))
  if (!Number.isFinite(prozent) || prozent <= 0) return null
  return begrenzeZoom(prozent / 100)
}

/**
 * Wie stark ein Rad-Schritt zoomt: ein Mausradrastern (100 Pixel) ergibt rund
 * 16 %. Stufenlos und multiplikativ - derselbe Weg wirkt bei 20 % und bei
 * 400 % gleich stark, nicht gleich viele Prozentpunkte.
 */
export const RAD_EMPFINDLICHKEIT = 0.0015

/**
 * Der Zoomfaktor eines Mausrad- oder Touchpad-Ereignisses (Strg + Rad). Nach
 * oben drehen vergroessert. `deltaMode` rechnet Zeilen- und Seitenschritte
 * (manche Mause, Firefox-Voreinstellungen) in Pixel um.
 */
export function radFaktor(deltaY: number, deltaMode: number): number {
  const pixel = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-pixel * RAD_EMPFINDLICHKEIT)
}

export function naechsteStufe(aktuell: number, richtung: 1 | -1): number {
  if (richtung === 1) {
    const groesser = ZOOMSTUFEN.find((stufe) => stufe > aktuell + 0.001)
    return begrenzeZoom(groesser ?? MAX_ZOOM)
  }
  const kleiner = [...ZOOMSTUFEN].reverse().find((stufe) => stufe < aktuell - 0.001)
  return begrenzeZoom(kleiner ?? MIN_ZOOM)
}

/**
 * Die Breite, die einer Seite bleibt, wenn `spalten` Seiten nebeneinander
 * stehen: der Abstand zwischen den Spalten geht von der Gesamtbreite ab.
 */
function breiteJeSpalte(verfuegbareBreite: number, spalten: number): number {
  return (verfuegbareBreite - (spalten - 1) * SEITENABSTAND) / spalten
}

export function passendZuBreite(
  groesse: SeitenGroesse,
  rotation: number,
  verfuegbareBreite: number,
  spalten = 1
): number {
  const gedreht = gedrehteGroesse(groesse, rotation)
  if (gedreht.breite <= 0) return 1
  return begrenzeZoom(breiteJeSpalte(verfuegbareBreite, spalten) / gedreht.breite)
}

export function passendZuSeite(
  groesse: SeitenGroesse,
  rotation: number,
  verfuegbareBreite: number,
  verfuegbareHoehe: number,
  spalten = 1
): number {
  const gedreht = gedrehteGroesse(groesse, rotation)
  if (gedreht.breite <= 0 || gedreht.hoehe <= 0) return 1
  return begrenzeZoom(
    Math.min(
      breiteJeSpalte(verfuegbareBreite, spalten) / gedreht.breite,
      verfuegbareHoehe / gedreht.hoehe
    )
  )
}

/**
 * Senkt den Zoom so weit, dass das Canvas die Kantenbegrenzung einhaelt.
 * Der Geraetepixelfaktor zaehlt mit: auf einem Bildschirm mit Faktor 2 ist das
 * Canvas doppelt so gross wie die dargestellte Flaeche.
 */
export function begrenzeFuerCanvas(
  zoom: number,
  groesse: SeitenGroesse,
  rotation: number,
  geraetePixel: number,
  maxKante: number = MAX_CANVAS_KANTE
): number {
  const gedreht = gedrehteGroesse(groesse, rotation)
  const laengsteKante = Math.max(gedreht.breite, gedreht.hoehe)
  if (laengsteKante <= 0 || geraetePixel <= 0) return zoom
  const hoechster = maxKante / (laengsteKante * geraetePixel)
  return Math.min(zoom, hoechster)
}
