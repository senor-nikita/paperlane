import type { Logger } from '../logging/logger'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { lade, speichere } from './store'

export interface SettingsService {
  lies: () => Settings
  aendere: (patch: SettingsPatch) => Settings
}

/**
 * Haelt die Einstellungen im Speicher und schreibt Aenderungen sofort durch.
 * Die Menge ist klein, ein verzoegertes Schreiben brauchte einen Abgleich beim
 * Beenden — und genau der geht bei einem Absturz verloren.
 */
export function erstelleSettingsService(
  datei: string,
  vorgabeAutor: string,
  log: Logger
): SettingsService {
  const zustand = lade(datei, vorgabeAutor)
  if (zustand.hinweis !== null) log.warn('Einstellungen: ' + zustand.hinweis)

  let aktuell = zustand.settings

  return {
    lies: () => aktuell,
    aendere: (patch) => {
      aktuell = { ...aktuell, ...patch }
      if (zustand.schreibbar) {
        speichere(datei, aktuell)
      } else {
        // Aus einer neueren Programmversion gelesen: die Aenderung gilt fuer
        // diese Sitzung, wird aber nicht zurueckgeschrieben.
        log.warn('Einstellungsaenderung nicht dauerhaft gespeichert', { grund: zustand.hinweis })
      }
      return aktuell
    }
  }
}
