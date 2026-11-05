/**
 * Typen und Validierung der Einstellungen. Im shared-Bereich, weil der Renderer
 * sie ueber den IPC-Contract sieht; gelesen und geschrieben wird ausschliesslich
 * im Main-Prozess.
 */
import { istSprachwahl, SPRACHWAHLEN, type Sprachwahl } from './i18n'

export const SCHEMA_VERSION = 7

export interface Fenstergeometrie {
  breite: number
  hoehe: number
  x: number | null
  y: number | null
  maximiert: boolean
}

export interface Leseposition {
  seite: number
  zoom: number
}

/**
 * Vorgaben fuer neue Annotationen (S2.2, Aufgabe 8).
 *
 * Der Autorenname steht getrennt davon in `autorName`: er kommt vom
 * Betriebssystem und gilt auch dort, wo gar nichts gezeichnet wird.
 */
export interface Annotationsvorgaben {
  /** Farbe als `#rrggbb`. */
  farbe: string
  /** Strichstaerke in PDF-Punkten. */
  strichstaerke: number
}

export const STANDARD_ANNOTATIONEN: Annotationsvorgaben = {
  // Das uebliche Markierungsgelb; es traegt schwarzen Text noch lesbar.
  farbe: '#ffd400',
  strichstaerke: 2
}

/** Grenzen fuer die Strichstaerke. Darunter unsichtbar, darueber unbrauchbar. */
export const MIN_STRICHSTAERKE = 0.5
export const MAX_STRICHSTAERKE = 12

/**
 * Wie die Ansicht den Zoom waehlt: frei (fester Wert), auf Seitenbreite oder
 * auf ganze Seite. Hier und nicht im Renderer, weil die Einstellungen den
 * Vorgabewert tragen und der Main-Prozess ihn pruefen muss.
 */
export type Passung = 'frei' | 'breite' | 'seite'

export const PASSUNGEN: readonly Passung[] = ['frei', 'breite', 'seite']

/** Vorgaben fuer die Ansicht beim Oeffnen eines Dokuments (S5.2a, Aufgabe 5). */
export interface Ansichtsvorgaben {
  passung: Passung
}

export const STANDARD_ANSICHT: Ansichtsvorgaben = {
  // Seitenbreite: fuellt das Fenster, ohne dass Text zu klein wird.
  passung: 'breite'
}

export function istPassung(wert: unknown): wert is Passung {
  return typeof wert === 'string' && (PASSUNGEN as readonly string[]).includes(wert)
}

export function istAnsichtsvorgaben(wert: unknown): wert is Ansichtsvorgaben {
  if (typeof wert !== 'object' || wert === null) return false
  return istPassung((wert as Record<string, unknown>)['passung'])
}

/**
 * Die Tabs beim letzten Beenden (S6.1), um sie beim naechsten Start
 * wiederherzustellen. `aktiv` ist der Index des Tabs, der vorn lag.
 *
 * Nur Pfade, keine Bytes und kein Aenderungsstand: ungespeicherte Arbeit
 * ueberlebt ein Beenden ohnehin nicht (die Rueckfrage sagt das). Geoeffnet
 * werden die Pfade beim Start vom Renderer ueber `dokumentOeffnePfad` - dort
 * werden sie geprueft wie jeder andere Pfad (Invariante 11); die Sitzung ist
 * kein Weg daran vorbei.
 */
export interface Sitzung {
  tabs: string[]
  aktiv: number
}

export const LEERE_SITZUNG: Sitzung = { tabs: [], aktiv: 0 }

/**
 * Wie viele Tabs die Sitzung festhaelt. Ein Tab-Limit gibt es nicht
 * (Entscheidung des Nutzers); diese Grenze schuetzt nur die
 * Einstellungsdatei vor einer beliebig langen Liste aus dem Renderer. Wer mehr
 * Tabs offen hat, bekommt beim naechsten Start die ersten davon zurueck - der
 * Renderer kuerzt vor dem Schreiben.
 */
export const MAX_SITZUNG_TABS = 100

/** Laengster Pfad in der Sitzung; laenger ist kein Pfad, sondern Unfug. */
export const MAX_SITZUNG_PFADLAENGE = 32 * 1024

export function istSitzung(wert: unknown): wert is Sitzung {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return false
  const s = wert as Record<string, unknown>
  const tabs = s['tabs']
  const aktiv = s['aktiv']
  if (!Array.isArray(tabs) || tabs.length > MAX_SITZUNG_TABS) return false
  const allePfade = tabs.every(
    (tab) => typeof tab === 'string' && tab.length > 0 && tab.length <= MAX_SITZUNG_PFADLAENGE
  )
  if (!allePfade) return false
  if (typeof aktiv !== 'number' || !Number.isInteger(aktiv) || aktiv < 0) return false
  // Bei leerer Liste gibt es keinen Tab, auf den `aktiv` zeigen koennte: 0.
  return tabs.length === 0 ? aktiv === 0 : aktiv < tabs.length
}

export interface Settings {
  schemaVersion: number
  /** Wird ab S2.2 als Autor neuer Annotationen verwendet. */
  autorName: string
  /** Groesse und Lage des Fensters beim letzten Beenden. */
  fenster: Fenstergeometrie
  /** Zuletzt gelesene Stelle je Dokumentpfad. */
  zuletztGelesen: Record<string, Leseposition>
  /** Zuletzt geoeffnete Dokumente, das juengste zuerst. */
  zuletztGeoeffnet: string[]
  /** Farbe und Strichstaerke, mit denen neue Annotationen entstehen. */
  annotationen: Annotationsvorgaben
  /** Passung, mit der ein Dokument ohne gemerkte Leseposition erscheint. */
  ansicht: Ansichtsvorgaben
  /** Die Tabs beim letzten Beenden (S6.1). */
  sitzung: Sitzung
  /**
   * Sprache der Oberflaeche (S6.8). `auto` folgt bei jedem Start der
   * Systemsprache; erst eine ausdrueckliche Wahl haelt sie fest.
   */
  sprache: Sprachwahl
}

/** Nur bekannte Schluessel duerfen gesetzt werden. */
export interface SettingsPatch {
  autorName?: string
  fenster?: Fenstergeometrie
  zuletztGelesen?: Record<string, Leseposition>
  zuletztGeoeffnet?: string[]
  annotationen?: Annotationsvorgaben
  ansicht?: Ansichtsvorgaben
  sitzung?: Sitzung
  sprache?: Sprachwahl
}

/** `#rrggbb`, sonst nichts: alles Weitere muesste die Oberflaeche deuten. */
export function istFarbe(wert: unknown): wert is string {
  return typeof wert === 'string' && /^#[0-9a-f]{6}$/i.test(wert)
}

export function istAnnotationsvorgaben(wert: unknown): wert is Annotationsvorgaben {
  if (typeof wert !== 'object' || wert === null) return false
  const v = wert as Record<string, unknown>
  return (
    istFarbe(v['farbe']) &&
    typeof v['strichstaerke'] === 'number' &&
    Number.isFinite(v['strichstaerke']) &&
    v['strichstaerke'] >= MIN_STRICHSTAERKE &&
    v['strichstaerke'] <= MAX_STRICHSTAERKE
  )
}

export const STANDARD_FENSTER: Fenstergeometrie = {
  breite: 1280,
  hoehe: 860,
  x: null,
  y: null,
  maximiert: false
}

/**
 * Wie viele Dokumente ihre Leseposition behalten. Ohne Grenze waechst die
 * Einstellungsdatei unbegrenzt mit jedem je geoeffneten Dokument.
 */
export const MAX_LESEPOSITIONEN = 50

/**
 * Wie viele Dokumente die Liste "zuletzt geoeffnet" fasst. Eine laengere Liste
 * hilft niemandem: gesucht wird darin ohnehin nur nach den letzten paar.
 */
export const MAX_ZULETZT_GEOEFFNET = 15

export type Validierung =
  { gueltig: true; patch: SettingsPatch } | { gueltig: false; grund: string }

function istZahl(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert)
}

function istGeometrie(wert: unknown): wert is Fenstergeometrie {
  if (typeof wert !== 'object' || wert === null) return false
  const g = wert as Record<string, unknown>
  return (
    istZahl(g['breite']) &&
    istZahl(g['hoehe']) &&
    (g['x'] === null || istZahl(g['x'])) &&
    (g['y'] === null || istZahl(g['y'])) &&
    typeof g['maximiert'] === 'boolean'
  )
}

function istLesepositionen(wert: unknown): wert is Record<string, Leseposition> {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return false
  return Object.values(wert as Record<string, unknown>).every((eintrag) => {
    if (typeof eintrag !== 'object' || eintrag === null) return false
    const l = eintrag as Record<string, unknown>
    return istZahl(l['seite']) && istZahl(l['zoom'])
  })
}

/**
 * Prueft eine Aenderung aus dem Renderer. Laeuft im Main-Prozess: der Renderer
 * ist eine Sandbox fuer fremde Dokumente, seine Eingaben sind nicht
 * vertrauenswuerdig. Unbekannte Schluessel werden abgelehnt, nicht ignoriert —
 * sonst verschwindet ein Tippfehler spurlos.
 */
// KEIN-UI-TEXT-BEGINN: Pruefgruende gehen ins Protokoll und in einen Fehler, den
// nur eine fehlerhafte Oberflaeche ausloest; der Nutzer sieht die Meldung des
// Einstellungsdialogs.
export function pruefePatch(eingabe: unknown): Validierung {
  if (typeof eingabe !== 'object' || eingabe === null || Array.isArray(eingabe)) {
    return { gueltig: false, grund: 'Erwartet wird ein Objekt.' }
  }
  const eintraege = Object.entries(eingabe as Record<string, unknown>)
  if (eintraege.length === 0) return { gueltig: false, grund: 'Leere Aenderung.' }

  const patch: SettingsPatch = {}
  for (const [schluessel, wert] of eintraege) {
    switch (schluessel) {
      case 'autorName': {
        if (typeof wert !== 'string') {
          return { gueltig: false, grund: 'autorName muss eine Zeichenkette sein.' }
        }
        if (wert.length > 200) {
          return { gueltig: false, grund: 'autorName ist laenger als 200 Zeichen.' }
        }
        patch.autorName = wert
        break
      }
      case 'fenster': {
        if (!istGeometrie(wert)) {
          return { gueltig: false, grund: 'fenster hat nicht die erwartete Form.' }
        }
        patch.fenster = wert
        break
      }
      case 'zuletztGelesen': {
        if (!istLesepositionen(wert)) {
          return { gueltig: false, grund: 'zuletztGelesen hat nicht die erwartete Form.' }
        }
        if (Object.keys(wert).length > MAX_LESEPOSITIONEN) {
          return {
            gueltig: false,
            grund: 'zuletztGelesen enthaelt mehr als ' + String(MAX_LESEPOSITIONEN) + ' Eintraege.'
          }
        }
        patch.zuletztGelesen = wert
        break
      }
      case 'zuletztGeoeffnet': {
        if (!Array.isArray(wert) || wert.some((eintrag) => typeof eintrag !== 'string')) {
          return { gueltig: false, grund: 'zuletztGeoeffnet muss eine Liste von Pfaden sein.' }
        }
        if (wert.length > MAX_ZULETZT_GEOEFFNET) {
          return {
            gueltig: false,
            grund:
              'zuletztGeoeffnet enthaelt mehr als ' + String(MAX_ZULETZT_GEOEFFNET) + ' Eintraege.'
          }
        }
        patch.zuletztGeoeffnet = wert as string[]
        break
      }
      case 'annotationen': {
        if (!istAnnotationsvorgaben(wert)) {
          return {
            gueltig: false,
            grund:
              'annotationen braucht farbe als #rrggbb und strichstaerke zwischen ' +
              String(MIN_STRICHSTAERKE) +
              ' und ' +
              String(MAX_STRICHSTAERKE) +
              '.'
          }
        }
        // Feld fuer Feld, nicht `wert` selbst: sonst reisten fremde
        // Zusatzschluessel aus dem Renderer bis in die Einstellungsdatei.
        patch.annotationen = { farbe: wert.farbe, strichstaerke: wert.strichstaerke }
        break
      }
      case 'ansicht': {
        if (!istAnsichtsvorgaben(wert)) {
          return {
            gueltig: false,
            grund: 'ansicht braucht passung als eines von ' + PASSUNGEN.join(', ') + '.'
          }
        }
        patch.ansicht = { passung: wert.passung }
        break
      }
      case 'sitzung': {
        if (!istSitzung(wert)) {
          return {
            gueltig: false,
            grund:
              'sitzung braucht tabs als Liste von hoechstens ' +
              String(MAX_SITZUNG_TABS) +
              ' nichtleeren Pfaden und aktiv als Index darin.'
          }
        }
        // Feld fuer Feld, wie bei den Annotationen: nichts Fremdes mitnehmen.
        patch.sitzung = { tabs: [...wert.tabs], aktiv: wert.aktiv }
        break
      }
      case 'sprache': {
        if (!istSprachwahl(wert)) {
          return {
            gueltig: false,
            grund: 'sprache braucht eines von ' + SPRACHWAHLEN.join(', ') + '.'
          }
        }
        patch.sprache = wert
        break
      }
      default:
        return { gueltig: false, grund: 'Unbekannter Schluessel: ' + schluessel }
    }
  }
  return { gueltig: true, patch }
}
// KEIN-UI-TEXT-ENDE
