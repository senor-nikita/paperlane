import { app, BrowserWindow, dialog, Menu, net, protocol, session } from 'electron'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_NAME, windowTitle } from '../shared/app-info'
import { loeseSpracheAuf, setzeSprache, t } from '../shared/i18n'
import { EREIGNIS_KANAL, type AnwendungsEreignis } from '../shared/ipc'
import { STANDARD_FENSTER } from '../shared/settings'
import { buildCsp } from './csp'
import { merkeSystempfad, pdfPfadAusArgv } from './dokument'
import {
  anzahlUngespeicherterDokumente,
  pfadeUngespeicherterDokumente,
  registerIpcHandlers
} from './ipc'
import { starteDruck } from './druckfenster'
import { baueKontextmenueVorlage } from './kontextmenue'
import { baueMenueVorlage } from './menue'
import { erstelleLogger, STANDARD_ARCHIVE, STANDARD_MAX_BYTES, type Logger } from './logging/logger'
import { isAllowedNavigation } from './navigation'
import { resolveRendererFile } from './renderer-path'
import { anzeigeNamen, baueSchliessWaechter, schliessFrage } from './schliessen'
import { erstelleSettingsService, type SettingsService } from './settings/service'
import { setzeTextWorker } from './mutation'
import erzeugeTextWorker from './textbearbeitung/textworker?nodeWorker'
import { createWebPreferences } from './window-options'

// Gate Phase 6: "Text aendern" liest fremde Content-Streams - in einem eigenen
// Worker mit Heap- und Zeitgrenze, nie im Main-Thread (textbearbeitung/isoliert.ts).
// `?nodeWorker` baut electron-vite als eigenen Chunk und liefert den Starter.
setzeTextWorker(erzeugeTextWorker)

/**
 * ADR 0000: Der Renderer wird im Produktionsbuild ueber ein eigenes,
 * privilegiertes `app://`-Schema ausgeliefert statt ueber `file://`.
 * Unter `file://` ist die Origin opak, wodurch `script-src 'self'` und
 * `worker-src 'self'` in der CSP keine verlaessliche Bedeutung haetten und der
 * pdf.js-Worker (S1.1) ausgerechnet im Build brechen wuerde.
 */
const RENDERER_DIR = join(import.meta.dirname, '..', 'renderer')
const PRELOAD_PATH = join(import.meta.dirname, '..', 'preload', 'index.cjs')
const RENDERER_ENTRY = 'app://bundle/index.html'

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const isDevelopment = devServerUrl !== undefined
const CSP = buildCsp(isDevelopment ? 'development' : 'production')

/**
 * Vor `app.whenReady()` steht kein Pfad fuer die Protokolldatei fest. Bis
 * dahin geht alles auf die Konsole; in onReady wird auf den Dateilogger
 * umgestellt. So braucht keine Aufrufstelle eine Null-Pruefung.
 */
let settingsDienst: SettingsService | null = null

let log: Logger = {
  error: (nachricht, daten) => {
    console.error(nachricht, daten ?? '')
  },
  warn: (nachricht, daten) => {
    console.warn(nachricht, daten ?? '')
  },
  info: (nachricht, daten) => {
    console.info(nachricht, daten ?? '')
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

/** Sperrt alles, was aus einem Dokumentbetrachter einen Browser machen wuerde. */
function hardenWebContents(win: BrowserWindow): void {
  const { webContents } = win

  webContents.setWindowOpenHandler(({ url }) => {
    log.warn('Fensteroeffnung blockiert', { url })
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, webContents.getURL())) return
    event.preventDefault()
    log.warn('Navigation blockiert', { url })
  })

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
    log.warn('Einbettung eines webview blockiert')
  })

  webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error('Renderer konnte nicht laden', { code, description, url })
  })
}

/**
 * Traegt einen Menuebefehl zum Renderer (ADR 0002).
 *
 * Ziel ist das fokussierte Fenster: bei mehreren Fenstern soll der Klick dort
 * wirken, wo der Nutzer gerade ist. Ohne Fenster wird verworfen und
 * protokolliert — ein stiller Fehlschlag waere hier nicht nachvollziehbar.
 */
function sendeEreignis(befehl: AnwendungsEreignis): void {
  const ziel = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (ziel === undefined) {
    log.warn('Menuebefehl ohne Fenster verworfen', { befehl })
    return
  }
  ziel.webContents.send(EREIGNIS_KANAL, befehl)
}

function zeigeUeberDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: t('menue.ueber', { app: APP_NAME }),
    message: APP_NAME,
    detail: t('ueber.detail', {
      version: app.getVersion(),
      electron: process.versions.electron
    })
  })
}

/**
 * Ohne eigenes Menue laege Electrons Standardmenue an — mit ihm verschwaende
 * es. Deshalb traegt die eigene Vorlage `role: 'copy'` und `'selectAll'`
 * ausdruecklich (siehe menue.ts).
 */
function setzeAnwendungsmenue(): void {
  const vorlage = baueMenueVorlage({
    plattform: process.platform,
    sende: (befehl) => {
      sendeEreignis({ art: 'befehl', befehl })
    },
    ueberAnwendung: zeigeUeberDialog
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(vorlage))
}

/**
 * Sprache aus Einstellung und Systemsprache aufloesen (S6.8) und das Menue
 * in ihr neu bauen. `app.getLocale()` ist unter Windows erst nach `ready`
 * verlaesslich - deshalb nicht beim Laden des Moduls.
 */
function wendeSpracheAn(): void {
  const wahl = settingsDienst?.lies().sprache ?? 'auto'
  const sprache = loeseSpracheAuf(wahl, app.getLocale())
  setzeSprache(sprache)
  log.info('Sprache', { wahl, sprache })
  setzeAnwendungsmenue()
}

function verbindeKontextmenue(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_ereignis, parameter) => {
    const vorlage = baueKontextmenueVorlage({
      auswahl: parameter.selectionText,
      kannKopieren: parameter.editFlags.canCopy,
      sende: sendeEreignis
    })
    Menu.buildFromTemplate(vorlage).popup({ window: win })
  })
}

/**
 * Absturz des Renderers, meist durch Speichermangel (S1.5, Fall 5).
 *
 * Ohne Behandlung bliebe ein weisses Fenster stehen, das nach einem kaputten
 * Programm aussieht und keinen Ausweg anbietet. Stattdessen: Meldung mit
 * Grund und ein Angebot, die Ansicht neu zu laden.
 */
function ueberwacheRendererAbsturz(win: BrowserWindow): void {
  win.webContents.on('render-process-gone', (_ereignis, details) => {
    log.error('Renderer beendet', { grund: details.reason, exitCode: details.exitCode })
    if (win.isDestroyed()) return
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: APP_NAME,
        message: t('absturz.nachricht'),
        detail:
          details.reason === 'oom'
            ? t('absturz.speicher')
            : t('absturz.grund', { grund: details.reason }),
        buttons: [t('absturz.neuLaden'), t('absturz.schliessen')],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0 && !win.isDestroyed()) win.reload()
      })
  })

  // Der pdf.js-Worker laeuft als eigener Prozess. Stirbt er, rendert nichts
  // mehr - das darf nicht unbemerkt bleiben.
  app.on('child-process-gone', (_ereignis, details) => {
    log.error('Kindprozess beendet', { typ: details.type, grund: details.reason })
  })
}

function createWindow(): void {
  // Geometrie der letzten Sitzung. Ohne x und y ueberlaesst Electron die Lage
  // dem Fenstermanager - das ist beim allerersten Start gewuenscht.
  const geometrie = settingsDienst?.lies().fenster ?? STANDARD_FENSTER
  const win = new BrowserWindow({
    width: geometrie.breite,
    height: geometrie.hoehe,
    ...(geometrie.x !== null && geometrie.y !== null ? { x: geometrie.x, y: geometrie.y } : {}),
    show: false,
    title: windowTitle(),
    webPreferences: createWebPreferences(PRELOAD_PATH)
  })

  hardenWebContents(win)
  ueberwacheRendererAbsturz(win)
  verbindeKontextmenue(win)
  warneVorUngespeichertem(win)
  sichereGeometrieBeimSchliessen(win)

  win.once('ready-to-show', () => {
    if (geometrie.maximiert) win.maximize()
    win.show()
  })

  void (devServerUrl === undefined ? win.loadURL(RENDERER_ENTRY) : win.loadURL(devServerUrl))
}

/**
 * Warnung bei ungespeicherten Aenderungen (S2.3a, Aufgabe 5).
 *
 * Die Regel selbst steht in schliessen.ts und ist dort ohne laufende Anwendung
 * pruefbar; hier wird sie nur an das echte Fenster und den echten Dialog
 * gehaengt. Der Stand kommt vom Renderer und liegt im Main bereit, weil zum
 * Zeitpunkt des Schliessens keine Zeit mehr fuer eine Nachfrage ist.
 */
const schliessWaechter = baueSchliessWaechter({
  anzahlAenderungen: anzahlUngespeicherterDokumente,
  namen: () => anzeigeNamen(pfadeUngespeicherterDokumente()),
  frage: async (fenster, anzahl, namen) => {
    const { response } = await dialog.showMessageBox(
      fenster as BrowserWindow,
      schliessFrage(anzahl, namen)
    )
    return response === 0
  }
})

function warneVorUngespeichertem(win: BrowserWindow): void {
  win.on('close', (ereignis) => {
    schliessWaechter(win, ereignis)
  })
}

/**
 * Beim Schliessen die Geometrie sichern. Bewusst nicht bei jedem Verschieben:
 * das schriebe die Einstellungsdatei dutzende Male je Sekunde.
 *
 * Im maximierten Zustand liefert getBounds die Maximalgroesse; gespeichert wird
 * deshalb getNormalBounds, sonst laesst sich das Fenster nach einem Neustart
 * nicht mehr sinnvoll wiederherstellen.
 */
function sichereGeometrieBeimSchliessen(win: BrowserWindow): void {
  win.on('close', () => {
    if (settingsDienst === null) return
    const masse = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
    try {
      settingsDienst.aendere({
        fenster: {
          breite: masse.width,
          hoehe: masse.height,
          x: masse.x,
          y: masse.y,
          maximiert: win.isMaximized()
        }
      })
    } catch (fehler) {
      log.error('Fenstergeometrie konnte nicht gesichert werden', { fehler })
    }
  })
}

/**
 * In Produktion kontrollieren wir die Antwort des `app://`-Handlers selbst und
 * setzen die CSP dort. Im Entwicklungsmodus liefert der Vite-Server aus, daher
 * wird der Header dort nachgeruestet. Beide Wege benutzen dieselbe Quelle.
 */
function serveRenderer(): void {
  protocol.handle('app', async (request) => {
    const file = resolveRendererFile(request.url, RENDERER_DIR)
    if (file === null) return new Response('Forbidden', { status: 403 })
    if (!existsSync(file)) return new Response('Not Found', { status: 404 })

    try {
      // `net.fetch` ist hier kein Netzwerkaufruf. Die URL stammt aus
      // `pathToFileURL` und traegt immer das Schema `file:`; der Pfad ist
      // zuvor von `resolveRendererFile` gegen RENDERER_DIR geprueft. Electrons
      // `net` ist hier der kuerzeste Weg zu einem Stream mit Statuscode und
      // Kopfzeilen (ADR 0000) — nicht der einzige: eine `Response` liesse sich
      // auch von Hand aus einem gelesenen Puffer bauen. Die Freigabe traegt
      // allein die `file:`-URL, nicht die Bequemlichkeit. Die Markierung steht
      // auf der Zeile selbst, weil der Guard zeilenweise prueft.
      const response = await net.fetch(pathToFileURL(file).toString()) // INVARIANTE-7
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', CSP)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    } catch (error) {
      // Ohne diesen Zweig waere ein Lesefehler eine unbehandelte Ablehnung im
      // Protokoll-Handler: der Renderer bekaeme gar keine Antwort.
      log.error('Auslieferung fehlgeschlagen', { url: request.url, error })
      return new Response('Internal Error', { status: 500 })
    }
  })
}

function applyDevelopmentCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP]
      }
    })
  })
}

function ermittleBenutzername(): string {
  try {
    return userInfo().username
  } catch {
    return 'Unbekannt'
  }
}

function onReady(): void {
  app.setName(APP_NAME)

  log = erstelleLogger({
    datei: join(app.getPath('logs'), 'paperlane.log'),
    maxBytes: STANDARD_MAX_BYTES,
    archive: STANDARD_ARCHIVE,
    konsole: true
  })
  log.info('Start', { entwicklungsmodus: isDevelopment })

  settingsDienst = erstelleSettingsService(
    join(app.getPath('userData'), 'settings.json'),
    ermittleBenutzername(),
    log
  )

  const startDokument = pdfPfadAusArgv(process.argv)
  if (startDokument !== null) log.info('Dokument aus der Befehlszeile', { startDokument })

  registerIpcHandlers({
    settings: settingsDienst,
    log,
    startDokument,
    melde: sendeEreignis,
    drucke: starteDruck,
    wendeSpracheAn
  })
  wendeSpracheAn()
  serveRenderer()
  if (isDevelopment) applyDevelopmentCsp()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function onStartupError(error: unknown): void {
  // Bewusst console: zu diesem Zeitpunkt steht der Dateilogger moeglicherweise
  // noch nicht.
  console.error('Start fehlgeschlagen:', error)
  app.quit()
}

/**
 * Ein Dokument, das das Betriebssystem uebergibt — "Oeffnen mit" oder ein
 * Doppelklick, waehrend die Anwendung schon laeuft.
 *
 * Gesendet wird nur der Pfad. Das Dokument holt der Renderer ueber
 * `dokumentOeffnePfad`, wo es ohnehin geprueft wird; die Bytes ueber den
 * Ereigniskanal zu schicken waere ein zweiter Weg an derselben Pruefung vorbei.
 */
function verarbeiteSystempfad(pfad: string | null): void {
  if (pfad === null) {
    log.warn('Kein PDF-Pfad in der Uebergabe gefunden')
    return
  }
  // Der Pfad kommt vom Betriebssystem und traegt deshalb das Schreibrecht.
  // Ohne dieses Gedaechtnis kaeme er ueber `dokumentOeffnePfad` als blosse
  // Angabe des Renderers zurueck und liesse sich nicht ueberschreiben
  // (Invariante 11, Freigabelisten in dokument.ts).
  merkeSystempfad(pfad)
  sendeEreignis({ art: 'dokumentAusSystem', pfad })
}

function focusExistingWindow(argv: string[]): void {
  log.info('Zweite Instanz gestartet', { argv })
  const [win] = BrowserWindow.getAllWindows()
  if (win === undefined) return
  if (win.isMinimized()) win.restore()
  win.focus()
  // In S0.2 empirisch festgestellt: die argv der zweiten Instanz enthaelt
  // neben den Nutzerargumenten auch Electron-Schalter und den Pfad der
  // ausfuehrbaren Datei. `argv[1]` blind zu nehmen waere falsch - deshalb
  // dieselbe reine Funktion wie beim Start.
  verarbeiteSystempfad(pdfPfadAusArgv(argv))
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', (_event, argv) => {
    focusExistingWindow(argv)
  })

  // macOS: Doppelklick auf eine Datei. Beim Kaltstart trifft das Ereignis ein,
  // bevor ein Fenster existiert; `sendeEreignis` protokolliert das dann. Die
  // Registrierung der Dateizuordnung selbst ist S5.3.
  app.on('open-file', (event, pfad) => {
    event.preventDefault()
    log.info('open-file empfangen', { pfad })
    verarbeiteSystempfad(pfad)
  })

  void app.whenReady().then(onReady, onStartupError)
} else {
  app.quit()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
