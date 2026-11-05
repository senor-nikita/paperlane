import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  EREIGNIS_KANAL,
  pruefeEreignis,
  type IpcChannel,
  type AnwendungsEreignis,
  type PreloadApi
} from '../shared/ipc'

/**
 * Einziger Ort, an dem die untypisierte Antwort von `ipcRenderer.invoke` in den
 * Contract-Typ ueberfuehrt wird. Die Zusicherung traegt der Main-Prozess: jeder
 * Handler in src/main/ipc.ts ist gegen denselben Contract typisiert. Ein
 * zweiter solcher Uebergang darf nicht entstehen.
 */
async function invoke<T>(channel: IpcChannel, request?: unknown): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- begruendet im Kommentar oben
  return ipcRenderer.invoke(channel, request)
}

/**
 * Der einzige Zuhoerer, den das Preload einrichtet. Er nimmt nur den einen
 * Menuekanal an und gibt nur geprueste Nutzlast weiter (ADR 0002); ein
 * ungeprueftes `ipcRenderer.on` waere eine offene Tuer in den Renderer.
 *
 * Der Rueckgabewert meldet wieder ab. Ohne ihn haeufen sich die Zuhoerer bei
 * jedem Neuaufbau der Oberflaeche und ein Menueklick loeste mehrfach aus.
 */
function beiEreignis(rueckruf: (befehl: AnwendungsEreignis) => void): () => void {
  const zuhoerer = (_ereignis: unknown, nutzlast: unknown): void => {
    const geprueft = pruefeEreignis(nutzlast)
    if (geprueft === null) {
      console.error('Unbekannter Menuebefehl verworfen:', nutzlast)
      return
    }
    rueckruf(geprueft)
  }
  ipcRenderer.on(EREIGNIS_KANAL, zuhoerer)
  return () => {
    ipcRenderer.removeListener(EREIGNIS_KANAL, zuhoerer)
  }
}

/**
 * Nur die Contract-Methoden werden freigegeben — bewusst keine generische
 * "rufe beliebigen Kanal"-Bruecke, die die Prozessgrenze wieder aufheben wuerde.
 */
const api: PreloadApi = {
  ping: () => invoke(IPC.ping),
  settingsGet: () => invoke(IPC.settingsGet),
  settingsSet: (patch) => invoke(IPC.settingsSet, patch),
  spracheGet: () => invoke(IPC.spracheGet),
  dokumentOeffnen: () => invoke(IPC.dokumentOeffnen),
  dokumentBeimStart: () => invoke(IPC.dokumentBeimStart),
  dokumentOeffnePfad: (pfad) => invoke(IPC.dokumentOeffnePfad, pfad),
  zuletztGeoeffnet: () => invoke(IPC.zuletztGeoeffnet),
  externOeffnen: (url) => invoke(IPC.externOeffnen, url),
  dokumentSpeichern: (auftrag) => invoke(IPC.dokumentSpeichern, auftrag),
  dokumentGeaendert: (meldung) => invoke(IPC.dokumentGeaendert, meldung),
  formularFdfExportieren: (auftrag) => invoke(IPC.formularFdfExportieren, auftrag),
  bildLaden: () => invoke(IPC.bildLaden),
  dokumentMutieren: (auftrag) => invoke(IPC.dokumentMutieren, auftrag),
  dokumentStandHerstellen: (auftrag) => invoke(IPC.dokumentStandHerstellen, auftrag),
  dokumenteWaehlen: () => invoke(IPC.dokumenteWaehlen),
  dokumenteZusammenfuehren: (auftrag) => invoke(IPC.dokumenteZusammenfuehren, auftrag),
  dokumentTeilen: (auftrag) => invoke(IPC.dokumentTeilen, auftrag),
  pngZieleWaehlen: (auftrag) => invoke(IPC.pngZieleWaehlen, auftrag),
  pngSchreiben: (auftrag) => invoke(IPC.pngSchreiben, auftrag),
  dokumentDrucken: (auftrag) => invoke(IPC.dokumentDrucken, auftrag),
  druckAbbrechen: () => invoke(IPC.druckAbbrechen),
  dokumentSchliessen: (pfad) => invoke(IPC.dokumentSchliessen, pfad),
  tabSchliessenFragen: (name) => invoke(IPC.tabSchliessenFragen, name),
  seitenExtrahieren: (auftrag) => invoke(IPC.seitenExtrahieren, auftrag),
  bilderWaehlen: (pfade) => invoke(IPC.bilderWaehlen, pfade),
  bilderZuPdf: (auftrag) => invoke(IPC.bilderZuPdf, auftrag),
  wordExportieren: (auftrag) => invoke(IPC.wordExportieren, auftrag),
  beiEreignis,
  /**
   * `File.path` gibt es seit Electron 32 nicht mehr. Der Pfad ist nur noch
   * hier zu haben; im Renderer traegt eine fallengelassene Datei ihn nicht.
   */
  pfadVonDatei: (datei) => {
    try {
      return webUtils.getPathForFile(datei)
    } catch {
      // Nicht jede Ablage ist eine Datei aus dem Dateisystem.
      return ''
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
