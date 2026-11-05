import { gedrehteGroesse, type SeitenGroesse, type SeitenPlatz } from './layout'

/**
 * Das Raster der Seitenuebersicht (S6.2) als reine Funktionen - wie
 * `layout.ts` fuer die Hauptansicht: die Virtualisierung braucht jede
 * Position, bevor eine Seite gezeichnet ist.
 *
 * Jede Seite bekommt eine Kachel gleicher Breite; hochformatige Seiten fuellen
 * sie in der Breite, querformatige werden nicht breiter als die Kachel und
 * nicht hoeher als ein A4-Hochformat darin. So bleibt eine Zeile ruhig, auch
 * wenn Formate gemischt sind. Die Zeilenhoehe richtet sich nach der hoechsten
 * Kachel der Zeile.
 */
export const RASTER_ABSTAND = 28
/** Hoehe der Seitennummer unter der Miniatur (siehe `Miniatur`). */
export const BESCHRIFTUNG = 14
export const KACHEL_MIN = 100
export const KACHEL_MAX = 360
export const KACHEL_STANDARD = 180
/**
 * Hoehe einer Kachel relativ zur Breite: A4 hochkant. Nicht genau √2 - A4 in
 * Punkten (595 x 842) liegt knapp darueber und fuellte die Kachel sonst nicht.
 */
const HOECHSTENS = 1.42

export interface RasterPlatz extends SeitenPlatz {
  /** Abstand vom linken Rand des Scrollbereichs, in CSS-Pixeln. */
  links: number
  /** Eigener Zoom je Kachel - Seiten unterschiedlicher Groesse fuellen sie gleich. */
  zoom: number
  zeile: number
  spalte: number
}

export interface RasterZeile {
  oben: number
  hoehe: number
}

export interface Raster {
  plaetze: RasterPlatz[]
  zeilen: RasterZeile[]
  spalten: number
  gesamthoehe: number
}

export function spaltenFuer(kachelBreite: number, verfuegbareBreite: number): number {
  return Math.max(
    1,
    Math.floor((verfuegbareBreite - RASTER_ABSTAND) / (kachelBreite + RASTER_ABSTAND))
  )
}

export function berechneRaster(
  groessen: readonly SeitenGroesse[],
  rotation: number,
  kachelBreite: number,
  verfuegbareBreite: number
): Raster {
  const spalten = spaltenFuer(kachelBreite, verfuegbareBreite)
  const plaetze: RasterPlatz[] = []
  const zeilen: RasterZeile[] = []
  let oben = RASTER_ABSTAND

  for (let start = 0; start < groessen.length; start += spalten) {
    const zeile = zeilen.length
    let hoechste = 0
    const inZeile: RasterPlatz[] = []
    for (let spalte = 0; spalte < spalten && start + spalte < groessen.length; spalte++) {
      const index = start + spalte
      const groesse = groessen[index]
      if (groesse === undefined) continue
      const gedreht = gedrehteGroesse(groesse, rotation)
      const zoom = Math.min(
        kachelBreite / Math.max(gedreht.breite, 1),
        (kachelBreite * HOECHSTENS) / Math.max(gedreht.hoehe, 1)
      )
      const breite = Math.floor(gedreht.breite * zoom)
      const hoehe = Math.floor(gedreht.hoehe * zoom) + BESCHRIFTUNG
      hoechste = Math.max(hoechste, hoehe)
      inZeile.push({
        index,
        zeile,
        spalte,
        zoom,
        breite,
        hoehe,
        oben,
        links:
          RASTER_ABSTAND +
          spalte * (kachelBreite + RASTER_ABSTAND) +
          Math.floor((kachelBreite - breite) / 2)
      })
    }
    plaetze.push(...inZeile)
    zeilen.push({ oben, hoehe: hoechste })
    oben += hoechste + RASTER_ABSTAND
  }
  return { plaetze, zeilen, spalten, gesamthoehe: oben }
}

/**
 * Die Zeilen im Sichtfenster samt Puffer, als Bereich von Seitenindizes.
 * `von === -1`, wenn nichts sichtbar ist.
 */
export function sichtbareKacheln(
  raster: Raster,
  scrollOben: number,
  sichtHoehe: number,
  pufferZeilen: number
): { von: number; bis: number } {
  const { zeilen, spalten, plaetze } = raster
  if (plaetze.length === 0) return { von: -1, bis: -1 }
  let erste = zeilen.findIndex((zeile) => zeile.oben + zeile.hoehe >= scrollOben)
  if (erste === -1) erste = zeilen.length - 1
  let letzte = erste
  while (
    letzte + 1 < zeilen.length &&
    (zeilen[letzte + 1]?.oben ?? Infinity) <= scrollOben + sichtHoehe
  ) {
    letzte++
  }
  const vonZeile = Math.max(0, erste - pufferZeilen)
  const bisZeile = Math.min(zeilen.length - 1, letzte + pufferZeilen)
  return {
    von: vonZeile * spalten,
    bis: Math.min(plaetze.length - 1, (bisZeile + 1) * spalten - 1)
  }
}

/**
 * Das Ziel einer Pfeiltaste im Raster: links/rechts eine Seite, hoch/runter
 * eine Zeile, Pos1/Ende an die Enden. `null` fuer jede andere Taste.
 */
export function zielImRaster(
  taste: string,
  seite: number,
  seitenzahl: number,
  spalten: number
): number | null {
  switch (taste) {
    case 'ArrowLeft':
      return Math.max(1, seite - 1)
    case 'ArrowRight':
      return Math.min(seitenzahl, seite + 1)
    case 'ArrowUp':
      return seite - spalten >= 1 ? seite - spalten : seite
    case 'ArrowDown':
      return seite + spalten <= seitenzahl ? seite + spalten : seite
    case 'Home':
      return 1
    case 'End':
      return seitenzahl
    default:
      return null
  }
}

/**
 * Wohin eine Auswahl mit Strg+Pfeil rueckt: die Einfuegestelle fuer
 * `reihenfolgeNachVerschieben` (alte Nummer, vor der eingefuegt wird;
 * `seitenzahl + 1` heisst ans Ende). `null`, wenn es nicht weitergeht.
 */
export function einfuegestelle(
  richtung: 'zurueck' | 'vor',
  seiten: readonly number[],
  seitenzahl: number
): number | null {
  if (seiten.length === 0) return null
  const kleinste = Math.min(...seiten)
  const groesste = Math.max(...seiten)
  if (richtung === 'zurueck') return kleinste > 1 ? kleinste - 1 : null
  return groesste < seitenzahl ? groesste + 2 : null
}
