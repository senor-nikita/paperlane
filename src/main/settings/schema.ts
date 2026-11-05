import {
  SCHEMA_VERSION,
  STANDARD_ANNOTATIONEN,
  STANDARD_ANSICHT,
  STANDARD_FENSTER,
  LEERE_SITZUNG,
  MAX_SITZUNG_PFADLAENGE,
  MAX_SITZUNG_TABS,
  istAnnotationsvorgaben,
  istAnsichtsvorgaben,
  type Annotationsvorgaben,
  type Ansichtsvorgaben,
  type Fenstergeometrie,
  type Leseposition,
  type Settings,
  type Sitzung
} from '../../shared/settings'
import { istSprachwahl } from '../../shared/i18n'

export function vorgaben(autorName: string): Settings {
  return {
    schemaVersion: SCHEMA_VERSION,
    autorName,
    fenster: { ...STANDARD_FENSTER },
    zuletztGelesen: {},
    zuletztGeoeffnet: [],
    annotationen: { ...STANDARD_ANNOTATIONEN },
    ansicht: { ...STANDARD_ANSICHT },
    sitzung: { tabs: [...LEERE_SITZUNG.tabs], aktiv: LEERE_SITZUNG.aktiv },
    sprache: 'auto'
  }
}

export type Migration =
  /** Gelesen und, falls noetig, angehoben. Darf zurueckgeschrieben werden. */
  | { art: 'ok'; settings: Settings; angehoben: boolean }
  /** Unlesbar oder unbrauchbar. Vorgaben verwenden, Original beiseitelegen. */
  | { art: 'vorgaben'; grund: string }
  /**
   * Von einer neueren Programmversion geschrieben. Nur lesen, NICHT
   * zurueckschreiben — sonst zerstoert eine aeltere Version die Konfiguration
   * einer neueren.
   */
  | { art: 'zukunft'; gefundeneVersion: number }

function uebernimmGeometrie(wert: unknown): Fenstergeometrie {
  if (typeof wert !== 'object' || wert === null) return { ...STANDARD_FENSTER }
  const g = wert as Record<string, unknown>
  return {
    breite: typeof g['breite'] === 'number' ? g['breite'] : STANDARD_FENSTER.breite,
    hoehe: typeof g['hoehe'] === 'number' ? g['hoehe'] : STANDARD_FENSTER.hoehe,
    x: typeof g['x'] === 'number' ? g['x'] : null,
    y: typeof g['y'] === 'number' ? g['y'] : null,
    maximiert: g['maximiert'] === true
  }
}

function uebernimmLesepositionen(wert: unknown): Record<string, Leseposition> {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return {}
  const ergebnis: Record<string, Leseposition> = {}
  for (const [pfad, eintrag] of Object.entries(wert as Record<string, unknown>)) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const l = eintrag as Record<string, unknown>
    if (typeof l['seite'] !== 'number' || typeof l['zoom'] !== 'number') continue
    ergebnis[pfad] = { seite: l['seite'], zoom: l['zoom'] }
  }
  return ergebnis
}

/**
 * Nimmt eine Pfadliste an und wirft alles weg, was keine Zeichenkette ist.
 *
 * Gekuerzt wird hier nicht: eine zu lange Liste aus einer fremden Datei laesst
 * sich sinnvoll beschneiden, und das tut die Aufrufstelle beim naechsten
 * Schreiben ohnehin.
 */
function uebernimmPfadliste(wert: unknown): string[] {
  if (!Array.isArray(wert)) return []
  return wert.filter((eintrag): eintrag is string => typeof eintrag === 'string')
}

/**
 * Vorgaben fuer Annotationen. Ganz oder gar nicht: eine halbe Angabe — Farbe
 * ohne Strichstaerke — ergaebe eine Mischung aus fremder Datei und Vorgabe,
 * die niemand mehr nachvollzieht.
 */
function uebernimmAnnotationen(wert: unknown): Annotationsvorgaben {
  // Feld fuer Feld: was die Datei sonst noch traegt, wird nicht mitgeschleppt.
  return istAnnotationsvorgaben(wert)
    ? { farbe: wert.farbe, strichstaerke: wert.strichstaerke }
    : { ...STANDARD_ANNOTATIONEN }
}

/** Vorgaben fuer die Ansicht; eine unbekannte Passung faellt auf die Vorgabe. */
function uebernimmAnsicht(wert: unknown): Ansichtsvorgaben {
  return istAnsichtsvorgaben(wert) ? { passung: wert.passung } : { ...STANDARD_ANSICHT }
}

/**
 * Die Sitzung (S6.1). Anders als bei den Annotationen nicht ganz oder gar
 * nicht: aus einer von Hand verdorbenen Liste bleiben die brauchbaren Pfade
 * uebrig - ein Tab weniger ist besser als gar keiner. Ein `aktiv`, das nicht
 * mehr passt, zeigt auf den ersten Tab.
 */
function uebernimmSitzung(wert: unknown): Sitzung {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) {
    return { tabs: [], aktiv: 0 }
  }
  const s = wert as Record<string, unknown>
  const roh = s['tabs']
  const tabs = Array.isArray(roh)
    ? roh
        .filter(
          (tab): tab is string =>
            typeof tab === 'string' && tab.length > 0 && tab.length <= MAX_SITZUNG_PFADLAENGE
        )
        .slice(0, MAX_SITZUNG_TABS)
    : []
  const aktiv = s['aktiv']
  const passt =
    typeof aktiv === 'number' && Number.isInteger(aktiv) && aktiv >= 0 && aktiv < tabs.length
  return { tabs, aktiv: passt ? aktiv : 0 }
}

/**
 * Hebt gelesene Daten auf die aktuelle Schemaversion.
 *
 * Version 0 bedeutet: eine Datei ohne `schemaVersion`. Das ist der reale
 * Altfall, denn genau so saehe eine von Hand angelegte Datei aus. Version 1
 * kannte weder Fenstergeometrie noch Lesepositionen; beide bekommen Vorgaben.
 * Version 2 kannte die Liste der zuletzt geoeffneten Dokumente nicht; sie
 * beginnt dann leer. Version 3 kannte die Vorgaben fuer Annotationen nicht.
 * Version 4 kannte die Vorgaben fuer die Ansicht nicht. Version 5 kannte
 * keine Sitzung (S6.1); sie beginnt leer. Version 6 kannte keine
 * Sprachwahl (S6.8); sie beginnt bei `auto`, folgt also der Systemsprache.
 *
 * Alle Felder werden einzeln uebernommen, nicht am Versionssprung entlang.
 * Eine Kette von Migrationsschritten waere mehr Code und braeche bei einer von
 * Hand halb gefuellten Datei genau dort, wo sie helfen sollte.
 */
export function migriere(roh: unknown, vorgabeAutor: string): Migration {
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) {
    return { art: 'vorgaben', grund: 'Kein Objekt.' }
  }
  const daten = roh as Record<string, unknown>
  const version = typeof daten['schemaVersion'] === 'number' ? daten['schemaVersion'] : 0

  if (version > SCHEMA_VERSION) {
    return { art: 'zukunft', gefundeneVersion: version }
  }

  const autorName = typeof daten['autorName'] === 'string' ? daten['autorName'] : vorgabeAutor
  return {
    art: 'ok',
    settings: {
      schemaVersion: SCHEMA_VERSION,
      autorName,
      fenster: uebernimmGeometrie(daten['fenster']),
      zuletztGelesen: uebernimmLesepositionen(daten['zuletztGelesen']),
      zuletztGeoeffnet: uebernimmPfadliste(daten['zuletztGeoeffnet']),
      annotationen: uebernimmAnnotationen(daten['annotationen']),
      ansicht: uebernimmAnsicht(daten['ansicht']),
      sitzung: uebernimmSitzung(daten['sitzung']),
      sprache: istSprachwahl(daten['sprache']) ? daten['sprache'] : 'auto'
    },
    angehoben: version < SCHEMA_VERSION
  }
}
