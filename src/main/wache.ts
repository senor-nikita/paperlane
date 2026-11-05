import { watch, type FSWatcher } from 'node:fs'

/**
 * Beobachtet die geoeffnete Datei (S1.5, Fall 4).
 *
 * Wird sie ausserhalb der Anwendung geloescht oder ersetzt, soll der Leser das
 * erfahren — die bereits gerenderten Seiten bleiben lesbar, aber ab Phase 2
 * darf nicht mehr blind in die Datei zurueckgeschrieben werden.
 *
 * Immer nur eine Datei zugleich: es gibt genau ein offenes Dokument. Eine
 * frueher gesetzte Wache wird beim naechsten Oeffnen abgeloest, sonst
 * sammelten sich Beobachter ueber die Sitzung an.
 */
export interface Wache {
  /** Beendet die Beobachtung. Mehrfach aufrufbar. */
  beende: () => void
}

export function ueberwache(pfad: string, beiVerschwinden: () => void): Wache {
  let beobachter: FSWatcher | null = null
  let gemeldet = false

  const melde = (): void => {
    // Ein Loeschen erzeugt je nach Betriebssystem mehrere Ereignisse. Ohne
    // diese Sperre bekaeme der Renderer denselben Hinweis dreimal.
    if (gemeldet) return
    gemeldet = true
    beiVerschwinden()
  }

  try {
    beobachter = watch(pfad, (art) => {
      // `rename` deckt Loeschen, Verschieben und Ersetzen ab; ein reines
      // `change` heisst nur, dass jemand hineingeschrieben hat.
      if (art === 'rename') melde()
    })
    // Ein Fehler des Beobachters (etwa ein entferntes Laufwerk) darf die
    // Anwendung nicht mitreissen.
    beobachter.on('error', melde)
  } catch {
    // Nicht jedes Dateisystem laesst sich beobachten - etwa Netzlaufwerke.
    // Das ist kein Grund, das Oeffnen scheitern zu lassen; der Hinweis
    // entfaellt dann eben.
    beobachter = null
  }

  return {
    beende: () => {
      beobachter?.close()
      beobachter = null
    }
  }
}
