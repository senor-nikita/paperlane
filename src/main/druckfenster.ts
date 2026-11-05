import { app, BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import type { AnwendungsEreignis } from '../shared/ipc'
import type { Druckvorlage } from './druck'
import type { Logger } from './logging/logger'
import { speichereAtomar } from './speichern'
import { createDruckWebPreferences } from './window-options'
import { t } from '../shared/i18n'

/**
 * Das Druckfenster (S4.3, ADR 0003): ein verstecktes `BrowserWindow`, in dem
 * der Chromium-eigene PDF-Betrachter die Druckvorlage laedt und druckt -
 * an den Drucker (Systemdialog) oder in eine PDF-Datei (`printToPDF`).
 *
 * Warum so und nicht ueber das DOM: S1.2 haelt nur wenige Seiten im DOM, ein
 * DOM-Druck ergaebe leere Blaetter; ein Raster aus pdf.js liesse die
 * Anmerkungen weg (Invariante 6) und kostete je Seite Speicher. Der
 * Betrachter druckt vektoriell, alle Seiten, mit Text, aus einem Stream -
 * gemessen in der Erkundung: 500 Seiten in rund 100 ms, ~125 MB im
 * Fensterprozess.
 *
 * Was das Fenster darf - und nur das: `plugins: true` fuer den Betrachter,
 * sonst dieselbe Haertung wie das Hauptfenster (`createDruckWebPreferences`),
 * **kein** Preload, keine Navigation, keine Fensteroeffnung. Es sieht nie das
 * Original, nur die Vorlage - ohne Skripte (`entferneSkripte`), nur mit den
 * gewaehlten Seiten.
 *
 * Der Betrachter nimmt nur `file:`-URLs (ein eigenes Schema und `data:` fuer
 * grosse Dokumente scheiterten in der Erkundung). Die Vorlage liegt deshalb
 * fuer die Dauer des Auftrags als Datei im temporaeren Verzeichnis des
 * Nutzers, mit zufaelligem Namen und nur fuer ihn lesbar, und wird danach
 * geloescht - auch bei Abbruch und Fehler.
 */
export type Druckziel = { art: 'drucker' } | { art: 'datei'; pfad: string }

export interface DruckAuftrag {
  vorlage: Druckvorlage
  ziel: Druckziel
}

export type DruckErgebnis =
  | { art: 'gedruckt' }
  | { art: 'gespeichert'; pfad: string; seiten: number }
  | { art: 'abgebrochen' }
  | { art: 'fehler'; grund: string }

export interface DruckLauf {
  ergebnis: Promise<DruckErgebnis>
  abbrechen: () => void
}

export interface DruckDienste {
  log: Logger
  melde: (ereignis: AnwendungsEreignis) => void
}

/** Wie lange auf den Betrachter gewartet wird, bis alle Seiten da sind. */
const LADEFRIST_MS = 60_000
const PROBE_ABSTAND_MS = 250

export function starteDruck(auftrag: DruckAuftrag, dienste: DruckDienste): DruckLauf {
  let abgebrochen = false
  let fenster: BrowserWindow | null = null
  const abbrechen = (): void => {
    abgebrochen = true
    if (fenster !== null && !fenster.isDestroyed()) fenster.destroy()
  }
  const ergebnis = (async (): Promise<DruckErgebnis> => {
    const temp = join(
      app.getPath('temp'),
      'paperlane-druck-' + randomBytes(16).toString('hex') + '.pdf'
    )
    try {
      await writeFile(temp, auftrag.vorlage.bytes, { mode: 0o600 })
      if (abgebrochen) return { art: 'abgebrochen' }
      fenster = new BrowserWindow({ show: false, webPreferences: createDruckWebPreferences() })
      haerte(fenster, dienste.log)
      dienste.melde({ art: 'druckFortschritt', phase: 'laden' })
      await fenster.loadURL(pathToFileURL(temp).toString())
      const bytes = await warteAufAlleSeiten(fenster, auftrag.vorlage.seiten, () => abgebrochen)
      if (abgebrochen || bytes === null) return { art: 'abgebrochen' }

      dienste.melde({ art: 'druckFortschritt', phase: 'drucken' })
      if (auftrag.ziel.art === 'datei') {
        await speichereAtomar(auftrag.ziel.pfad, bytes)
        dienste.log.info('Als PDF gedruckt', { seiten: auftrag.vorlage.seiten })
        return { art: 'gespeichert', pfad: auftrag.ziel.pfad, seiten: auftrag.vorlage.seiten }
      }
      const uebergeben = await druckeUeberDialog(fenster)
      if (abgebrochen) return { art: 'abgebrochen' }
      dienste.log.info('Druckauftrag beendet', { seiten: auftrag.vorlage.seiten, uebergeben })
      return uebergeben ? { art: 'gedruckt' } : { art: 'abgebrochen' }
    } catch (fehler) {
      if (abgebrochen) return { art: 'abgebrochen' }
      dienste.log.error('Drucken fehlgeschlagen', { fehler })
      return {
        art: 'fehler',
        grund: t('druck.fehlerFenster', {
          fehler: fehler instanceof Error ? fehler.message : String(fehler)
        })
      }
    } finally {
      if (fenster !== null && !fenster.isDestroyed()) fenster.destroy()
      await unlink(temp).catch(() => undefined)
    }
  })()
  return { ergebnis, abbrechen }
}

/** Dieselben Sperren wie am Hauptfenster - hier ohne jede Ausnahme. */
function haerte(fenster: BrowserWindow, log: Logger): void {
  const { webContents } = fenster
  webContents.setWindowOpenHandler(({ url }) => {
    log.warn('Druckfenster: Fensteroeffnung blockiert', { url })
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (ereignis, url) => {
    ereignis.preventDefault()
    log.warn('Druckfenster: Navigation blockiert', { url })
  })
  webContents.on('will-attach-webview', (ereignis) => {
    ereignis.preventDefault()
  })
  webContents.on('did-fail-load', (_ereignis, code, beschreibung) => {
    log.error('Druckfenster: Vorlage nicht geladen', { code, beschreibung })
  })
}

/**
 * Der Betrachter laedt das PDF nach `did-finish-load` im Hintergrund weiter
 * und meldet nicht, wann er fertig ist. Ein zu fruehes `printToPDF` liefert
 * ein leeres Blatt. Deshalb wird probiert, bis das Ergebnis so viele Seiten
 * hat wie die Vorlage - das ist zugleich die Ausgabe fuer das Dateiziel.
 */
async function warteAufAlleSeiten(
  fenster: BrowserWindow,
  erwartet: number,
  istAbgebrochen: () => boolean
): Promise<Uint8Array | null> {
  const frist = Date.now() + LADEFRIST_MS
  while (Date.now() < frist) {
    if (istAbgebrochen() || fenster.isDestroyed()) return null
    // Solange der Betrachter noch laedt, scheitert `printToPDF` ("Printing
    // failed") oder liefert ein leeres Blatt - beides heisst: noch warten.
    const bytes = await fenster.webContents
      .printToPDF({ printBackground: true })
      .then((puffer) => new Uint8Array(puffer))
      .catch(() => null)
    if (bytes !== null && (await hatSeiten(bytes, erwartet))) return bytes
    await new Promise((erfuelle) => setTimeout(erfuelle, PROBE_ABSTAND_MS))
  }
  throw new Error(t('druck.zeitUeberschritten'))
}

async function hatSeiten(bytes: Uint8Array, erwartet: number): Promise<boolean> {
  try {
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount() === erwartet
  } catch {
    return false
  }
}

/** `true`, wenn der Nutzer den Systemdialog mit "Drucken" verlassen hat. */
function druckeUeberDialog(fenster: BrowserWindow): Promise<boolean> {
  return new Promise((erfuelle, lehneAb) => {
    fenster.webContents.print({ printBackground: true }, (erfolg, grund) => {
      if (erfolg) {
        erfuelle(true)
      } else if (/cancel/i.test(grund)) {
        erfuelle(false)
      } else {
        lehneAb(new Error(grund))
      }
    })
  })
}
