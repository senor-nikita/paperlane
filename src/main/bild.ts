import { dialog, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import type { BildErgebnis } from '../shared/ipc'
import { bildart, MAX_BILD_BYTES, type Bildart } from './schreibpfad'
import { t } from '../shared/i18n'

/**
 * Das Signaturbild (S3.2, Aufgabe 4): ein PNG oder JPEG, das der Nutzer
 * waehlt und das als Bildstempel ins Dokument kommt.
 *
 * Der Weg fuehrt ueber den Main, obwohl der Renderer ein `<input type="file">`
 * haette: so bleibt die Regel aus Invariante 11 unversehrt, dass **nur der
 * Main** Dateien liest, und die Pruefung des Inhalts liegt dort, wo auch
 * das Einbetten stattfindet. Der Renderer bekommt eine Data-URL — keinen
 * Pfad, den er sich merken oder weitergeben koennte.
 *
 * Es ist ein Bild. Es belegt nicht, wer unterschrieben hat, und es ist keine
 * kryptografische Signatur; dieser Satz steht auch in der Oberflaeche.
 */

// Die Erkennung am Dateikopf liegt im electron-freien Schreibpfad, weil sie
// dort beim Einbetten ein zweites Mal gebraucht wird (Gate Phase 3).
export { bildart, type Bildart }

export function alsDataUrl(bytes: Uint8Array, art: Bildart): string {
  const typ = art === 'png' ? 'png' : 'jpeg'
  return 'data:image/' + typ + ';base64,' + Buffer.from(bytes).toString('base64')
}

/** Prueft gelesene Bytes und macht daraus die Data-URL fuer den Renderer. */
export function pruefeBild(bytes: Uint8Array): BildErgebnis {
  if (bytes.byteLength === 0) return { art: 'abgelehnt', grund: t('bild.leer') }
  if (bytes.byteLength > MAX_BILD_BYTES) {
    return {
      art: 'abgelehnt',
      grund: t('bild.zuGross', { mb: Math.round(MAX_BILD_BYTES / (1024 * 1024)) })
    }
  }
  const art = bildart(bytes)
  if (art === null) {
    return { art: 'abgelehnt', grund: t('bild.format') }
  }
  return { art: 'geladen', url: alsDataUrl(bytes, art) }
}

/**
 * Bilder fuer "Aus Bildern erstellen…" waehlen (S6.4, Aufgabe 1): Mehrfachauswahl,
 * dieselbe fehlende Lesefreigabe wie beim Signaturbild — die Dateien werden im
 * Aufrufer genau einmal gelesen und danach nicht mehr gebraucht.
 */
export async function waehleBilder(fenster: BrowserWindow | null): Promise<string[] | null> {
  const optionen = {
    title: t('dialog.bilderWaehlen'),
    filters: [
      { name: t('filter.bilder'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
    ],
    properties: ['openFile' as const, 'multiSelections' as const]
  }
  const ergebnis =
    fenster === null
      ? await dialog.showOpenDialog(optionen)
      : await dialog.showOpenDialog(fenster, optionen)
  if (ergebnis.canceled || ergebnis.filePaths.length === 0) return null
  return ergebnis.filePaths
}

export async function ladeBildUeberDialog(fenster: BrowserWindow | null): Promise<BildErgebnis> {
  const optionen = {
    title: t('dialog.signaturbild'),
    filters: [{ name: t('filter.bilderPngJpeg'), extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile' as const]
  }
  const ergebnis =
    fenster === null
      ? await dialog.showOpenDialog(optionen)
      : await dialog.showOpenDialog(fenster, optionen)
  const [pfad] = ergebnis.filePaths
  if (ergebnis.canceled || pfad === undefined) return { art: 'abgebrochen' }
  // Bewusst **nicht** in die Lesefreigaben: die Datei wird genau einmal
  // gelesen, hier, und danach traegt der Renderer nur noch die Bytes. Ein
  // Eintrag in der Freigabeliste erlaubte spaeter Zugriffe, die niemand will.
  return pruefeBild(new Uint8Array(await readFile(pfad)))
}
