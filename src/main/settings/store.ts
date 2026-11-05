import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Settings } from '../../shared/settings'
import { migriere, vorgaben } from './schema'

export interface StoreZustand {
  settings: Settings
  /**
   * false, wenn die Datei von einer neueren Programmversion stammt. Dann wird
   * gelesen, aber nie zurueckgeschrieben.
   */
  schreibbar: boolean
  hinweis: string | null
}

/**
 * Der Dateipfad wird uebergeben statt hier ueber `app.getPath` ermittelt.
 * Nur so laesst sich der Store ohne laufende Anwendung testen — dasselbe
 * Muster wie bei resolveRendererFile.
 */
export function lade(datei: string, vorgabeAutor: string): StoreZustand {
  if (!existsSync(datei)) {
    return { settings: vorgaben(vorgabeAutor), schreibbar: true, hinweis: null }
  }

  let roh: unknown
  try {
    roh = JSON.parse(readFileSync(datei, 'utf8'))
  } catch (error) {
    const beiseite = legeBeiseite(datei)
    return {
      settings: vorgaben(vorgabeAutor),
      schreibbar: true,
      hinweis:
        'Einstellungen waren unlesbar (' + String(error) + '). Original gesichert unter ' + beiseite
    }
  }

  const ergebnis = migriere(roh, vorgabeAutor)
  if (ergebnis.art === 'zukunft') {
    return {
      settings: vorgaben(vorgabeAutor),
      schreibbar: false,
      hinweis:
        'Die Einstellungsdatei stammt aus Schemaversion ' +
        String(ergebnis.gefundeneVersion) +
        ' und damit aus einer neueren Programmversion. Sie wird nicht ueberschrieben.'
    }
  }
  if (ergebnis.art === 'vorgaben') {
    const beiseite = legeBeiseite(datei)
    return {
      settings: vorgaben(vorgabeAutor),
      schreibbar: true,
      hinweis: ergebnis.grund + ' Original gesichert unter ' + beiseite
    }
  }
  return {
    settings: ergebnis.settings,
    schreibbar: true,
    hinweis: ergebnis.angehoben ? 'Einstellungen auf die aktuelle Schemaversion angehoben.' : null
  }
}

/**
 * Schreibt atomar: erst in eine Nachbardatei, dann umbenennen. Ein Absturz
 * mitten im Schreiben laesst damit die alte Datei unversehrt, statt eine halb
 * geschriebene zu hinterlassen.
 *
 * Die temporaere Datei liegt bewusst im selben Verzeichnis — ein Rename ueber
 * Laufwerksgrenzen hinweg scheitert unter Windows.
 */
export function speichere(datei: string, settings: Settings): void {
  mkdirSync(dirname(datei), { recursive: true })
  const temp = datei + '.tmp'
  writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  renameSync(temp, datei)
}

/** Beschaedigte Dateien werden umbenannt, nicht geloescht. */
function legeBeiseite(datei: string): string {
  const ziel = datei + '.beschaedigt-' + String(Date.now())
  try {
    renameSync(datei, ziel)
  } catch {
    return '(Sicherung fehlgeschlagen)'
  }
  return ziel
}
