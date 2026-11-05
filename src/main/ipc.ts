import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { APP_NAME } from '../shared/app-info'
import { aktiveSprache, t, type Sprache } from '../shared/i18n'
import { pruefeExternesZiel } from '../shared/externe-links'
import {
  IPC,
  type ExternesZielErgebnis,
  type GeoeffnetesDokument,
  type OeffnenErgebnis,
  type AnwendungsEreignis,
  type BildErgebnis,
  type FdfAuftrag,
  type MutationsAuftrag,
  type MutationsErgebnis,
  type StandAuftrag,
  type StandErgebnis,
  type Dokumentquelle,
  type DruckAntwort,
  type DruckAuftrag,
  type ExtrahierAuftrag,
  type ExtrahierErgebnis,
  type PngSchreibErgebnis,
  type PngZielAuftrag,
  type PngZielErgebnis,
  type TeilErgebnis,
  type ZusammenfuehrAuftrag,
  type ZusammenfuehrErgebnis,
  type AenderungsMeldung,
  type SpeicherAuftrag,
  type SpeicherErgebnis,
  type ZuletztEintrag,
  type BilderWahlErgebnis,
  type BildPdfErgebnis,
  type Bildquelle
} from '../shared/ipc'
import type { Feldwert } from '../shared/formulare'
import { pfadklasse } from '../shared/pfade'
import { MAX_ZULETZT_GEOEFFNET, pruefePatch, type Settings, type Sitzung } from '../shared/settings'
import { mkdir, open, readFile, stat } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import {
  istLesefreigegeben,
  istOffen,
  istSchreibfreigegeben,
  merkeOffen,
  vergissOffen,
  gibSchreibfrei,
  kanonisch,
  oeffnePfad,
  waehleDokumente,
  waehleVerzeichnis,
  oeffnePfadGeprueft,
  oeffneUeberDialog
} from './dokument'
import { erzeugeFdf, sammleFeldwerte } from './fdf'
import { ladeBildUeberDialog, waehleBilder } from './bild'
import { bestaetigeLesen } from './lesen-bestaetigen'
import {
  baueBilderPdf,
  bildformat,
  MAX_BILD_DATEI_BYTES,
  MAX_BILDER_GESAMT_BYTES,
  pruefeBildPdfAuftrag,
  pruefePfadListe
} from './bilderpdf'
import {
  aktuellerStand,
  arbeitskopie,
  brauchtPlattenstand,
  hatArbeitskopie,
  istSauber,
  merkeGespeichert,
  merkeStand,
  passtInsGesamtbudget,
  stelleStandHer,
  vergissArbeitskopie
} from './arbeitskopie'
import { wendeMutationAnMitBericht } from './mutation'
import {
  einzelseiten,
  extrahiere,
  extraktname,
  fuehreZusammen,
  pruefeBereiche,
  pruefeSeitenliste,
  teile,
  teilname
} from './zusammenfuehren'
import { fehlertext } from './fehlertext'
import { pruefeMutation } from '../shared/mutation'
import { pngName } from '../shared/bildmasse'
import { pruefeDruckOptionen } from '../shared/druck'
import { baueDruckvorlage } from './druck'
import type { DruckLauf, DruckAuftrag as DruckfensterAuftrag, DruckDienste } from './druckfenster'
import {
  bestaetigeDateienUeberschreiben,
  bestaetigeFlachlegen,
  bestaetigeSignatur,
  bestaetigeUeberschreiben,
  frageZielpfad,
  ZIEL_FDF,
  ZIEL_PNG,
  bildart,
  hatSignatur,
  pruefeSchreibziel,
  speichereAtomar,
  wendeAenderungenAn
} from './speichern'
import { ueberwache, type Wache } from './wache'
import { tabSchliessFrage } from './schliessen'
import { exportiereWord } from './word-export'
import type { Logger } from './logging/logger'
import type { SettingsService } from './settings/service'

export interface Dienste {
  settings: SettingsService
  log: Logger
  /** Pfad aus der Befehlszeile, falls die Anwendung mit einem Dokument startete. */
  startDokument: string | null
  /** Meldet ein Ereignis an den Renderer (ADR 0002). */
  melde: (ereignis: AnwendungsEreignis) => void
  /**
   * Startet einen Druck im versteckten Fenster (S4.3). Einspritzbar, damit
   * der Handler ohne echtes Fenster pruefbar ist.
   */
  drucke: (auftrag: DruckfensterAuftrag, dienste: DruckDienste) => DruckLauf
  /**
   * Nach einer Aenderung der Sprachwahl (S6.8): Sprache neu aufloesen und das
   * Menue neu bauen. Optional, damit Tests ohne Menue auskommen.
   */
  wendeSpracheAn?: () => void
}

/** Der laufende Druck - hoechstens einer, damit Abbrechen eindeutig ist. */
let laufenderDruck: DruckLauf | null = null

/**
 * Stand je offenem Dokument (S6.1, Tabs). Schluessel ist immer der
 * **kanonische** Pfad: der Renderer nennt Pfade in der Form, in der er sie
 * bekommen hat, und auf dem CI-Runner gibt es fuer denselben Temp-Ordner eine
 * 8.3-Kurz- und eine Langform. Ein roher Schluessel faende den Eintrag des
 * anderen nicht (zweimal CI-rot).
 *
 * Wache ueber jede geoeffnete Datei (S1.5, Fall 4): eine je Pfad. Ein neues
 * Dokument beendet nicht mehr die Wache der anderen - die sind ja noch offen;
 * beendet wird sie beim Schliessen des Tabs.
 */
const wachen = new Map<string, Wache>()

/**
 * Welche offenen Dateien sind ausserhalb der Anwendung verschwunden?
 *
 * S2.3a, Aufgabe 6: in sie wird nicht mehr zurueckgeschrieben. Was unter
 * ihrem Namen jetzt liegt, ist nicht mehr das Dokument, das der Leser geoeffnet
 * hat — es zu ueberschreiben waere Datenverlust an einer fremden Datei.
 */
const verschwunden = new Set<string>()

/** Ungespeicherte Aenderungen je Pfad, vom Renderer nachgefuehrt (S2.3a, Aufgabe 5). */
const ungespeichert = new Set<string>()

function beobachteDokument(dienste: Dienste, pfad: string): void {
  const schluessel = kanonisch(pfad)
  wachen.get(schluessel)?.beende()
  wachen.set(
    schluessel,
    ueberwache(schluessel, () => {
      verschwunden.add(schluessel)
      dienste.log.warn('Geoeffnete Datei verschwunden', { pfad: schluessel })
      dienste.melde({ art: 'dokumentVerschwunden', pfad: schluessel })
    })
  )
}

/** Beendet die Wache eines Pfads, etwa vor dem Umbenennen beim Speichern. */
function beendeWache(pfad: string): void {
  const schluessel = kanonisch(pfad)
  wachen.get(schluessel)?.beende()
  wachen.delete(schluessel)
}

/**
 * Ein Dokument ist (neu) geoeffnet: frisch von der Platte gelesen, also nicht
 * verschwunden, und unter Beobachtung. Der Aenderungsstand bleibt - ist der
 * Pfad schon in einem Tab offen, gehoert er diesem Tab.
 */
function nimmAuf(dienste: Dienste, pfad: string): void {
  merkeGeoeffnet(dienste, pfad)
  verschwunden.delete(kanonisch(pfad))
  beobachteDokument(dienste, pfad)
}

/** Ein Tab ist zu: alles vergessen, was der Main ueber sein Dokument hielt. */
function vergissDokument(pfad: string): void {
  const schluessel = kanonisch(pfad)
  beendeWache(schluessel)
  vergissArbeitskopie(schluessel)
  verschwunden.delete(schluessel)
  ungespeichert.delete(schluessel)
  vergissOffen(schluessel)
}

export function hatUngespeicherteAenderungen(): boolean {
  return ungespeichert.size > 0
}

/** Fuer die Frage beim Beenden: sie nennt die Zahl, wenn es mehrere sind. */
export function anzahlUngespeicherterDokumente(): number {
  return ungespeichert.size
}

/** Die Pfade der Dokumente mit ungespeicherten Aenderungen - die Frage beim Beenden nennt sie beim Namen. */
export function pfadeUngespeicherterDokumente(): string[] {
  return [...ungespeichert]
}

/** Nur fuer Tests: den Stand aller Dokumente vergessen. */
export function setzeDokumentstandZurueck(): void {
  for (const wache of wachen.values()) wache.beende()
  wachen.clear()
  verschwunden.clear()
  ungespeichert.clear()
}

/**
 * S6.1 hat im Speichern-Handler die Regel eingefuehrt: ein Ziel, das in einem
 * anderen Tab offen ist, wird abgelehnt - sonst weicht die Arbeitskopie jenes
 * Tabs still von der Platte ab und sein naechstes Speichern schreibt den
 * alten Stand zurueck. Review M2/Security L6: dieselbe Pruefung fehlte bei
 * Extrahieren (nur die eigene Quelle wurde ausgenommen) und bei Bilder zu
 * PDF (gar nicht). Gemeinsame Hilfsfunktion fuer alle "neue Datei"-Wege.
 */
function grundWennZielOffen(zielKanonisch: string, quelleKanonisch: string | null): string | null {
  if (zielKanonisch === quelleKanonisch) return null
  if (!istOffen(zielKanonisch)) return null
  return t('ziel.offenInTab', { name: basename(zielKanonisch) })
}

/** Laengster Pfad, den ein Tab-Kanal annimmt; laenger ist kein Pfad, sondern Unfug. */
const MAX_PFADLAENGE = 32 * 1024

function istPfadangabe(wert: unknown): wert is string {
  return typeof wert === 'string' && wert.length > 0 && wert.length <= MAX_PFADLAENGE
}

function pruefeAenderungsMeldung(eingabe: unknown): AenderungsMeldung | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  const pfad = wert['pfad']
  const geaendert = wert['geaendert']
  if (typeof pfad !== 'string' || pfad.length > MAX_PFADLAENGE) return null
  if (typeof geaendert !== 'boolean') return null
  return { pfad, geaendert }
}

function pruefeAuftrag(eingabe: unknown): SpeicherAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  const aenderungen = wert['aenderungen']
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  if (wert['ziel'] !== null && typeof wert['ziel'] !== 'string') return null
  if (typeof aenderungen !== 'object' || aenderungen === null) return null
  const teile = aenderungen as Record<string, unknown>
  if (!Array.isArray(teile['neue']) || !Array.isArray(teile['geaendert'])) return null
  if (!Array.isArray(teile['geloescht'])) return null
  // S3.2: Formularwerte und Flachlegen. Fehlen sie, gilt "nichts" - ein
  // Auftrag aus S2.3a bleibt gueltig. Sind sie da, muessen sie stimmen.
  const formularwerte = wert['formularwerte'] ?? {}
  if (!istFormularwerte(formularwerte)) return null
  const flachlegen = wert['flachlegen'] ?? false
  if (typeof flachlegen !== 'boolean') return null
  return { ...(wert as unknown as SpeicherAuftrag), formularwerte, flachlegen }
}

function pruefeMutationsAuftrag(eingabe: unknown): MutationsAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  const mutation = pruefeMutation(wert['mutation'])
  if (mutation === null) return null
  const aenderungen = wert['aenderungen']
  if (typeof aenderungen !== 'object' || aenderungen === null) return null
  const teile = aenderungen as Record<string, unknown>
  if (!Array.isArray(teile['neue']) || !Array.isArray(teile['geaendert'])) return null
  if (!Array.isArray(teile['geloescht'])) return null
  const formularwerte = wert['formularwerte'] ?? {}
  if (!istFormularwerte(formularwerte)) return null
  return {
    quelle: wert['quelle'],
    mutation,
    aenderungen: aenderungen as MutationsAuftrag['aenderungen'],
    formularwerte
  }
}

function pruefeZusammenfuehrAuftrag(eingabe: unknown): ZusammenfuehrAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const quellen = (eingabe as Record<string, unknown>)['quellen']
  if (!Array.isArray(quellen) || quellen.length === 0) return null
  if (!quellen.every((q) => typeof q === 'string' && q.length > 0)) return null
  return { quellen: quellen as string[] }
}

function pruefeTeilAuftrag(eingabe: unknown): { quelle: string; bereiche: unknown } | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  return { quelle: wert['quelle'], bereiche: wert['bereiche'] }
}

function pruefePngZielAuftrag(eingabe: unknown): PngZielAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  const seiten = wert['seiten']
  if (!Array.isArray(seiten) || seiten.length === 0 || seiten.length > MAX_PNG_SEITEN) return null
  if (!seiten.every((s) => typeof s === 'number' && Number.isInteger(s) && s >= 1)) return null
  const sortiert = [...new Set(seiten as number[])].sort((a, b) => a - b)
  return { quelle: wert['quelle'], seiten: sortiert }
}

function pruefePngSchreibAuftrag(eingabe: unknown): { pfad: string; bytes: Uint8Array } | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['pfad'] !== 'string' || wert['pfad'].length === 0) return null
  const bytes = wert['bytes']
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null
  return { pfad: wert['pfad'], bytes }
}

/** Mehr Seiten je Export waeren kein Bilderexport mehr, sondern ein Druck (S4.3). */
const MAX_PNG_SEITEN = 500

/**
 * Ein Canvas von 16384 x 16384 Pixeln ergibt als PNG im schlimmsten Fall
 * etwa eine Gigabyte; darueber ist etwas schiefgelaufen.
 */
const MAX_PNG_BYTES = 1024 * 1024 * 1024

function pruefeDruckAuftrag(eingabe: unknown): DruckAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  const optionen = pruefeDruckOptionen(wert['optionen'])
  if (optionen === null) return null
  const ziel = wert['ziel']
  if (ziel !== 'drucker' && ziel !== 'datei') return null
  const aenderungen = wert['aenderungen']
  if (typeof aenderungen !== 'object' || aenderungen === null) return null
  const teile = aenderungen as Record<string, unknown>
  if (!Array.isArray(teile['neue']) || !Array.isArray(teile['geaendert'])) return null
  if (!Array.isArray(teile['geloescht'])) return null
  const formularwerte = wert['formularwerte'] ?? {}
  if (!istFormularwerte(formularwerte)) return null
  return {
    quelle: wert['quelle'],
    optionen,
    ziel,
    aenderungen: aenderungen as DruckAuftrag['aenderungen'],
    formularwerte
  }
}

/**
 * Extrahier-Auftrag (S6.2). Die Seitenliste prueft der Handler erst am
 * Dokument, weil nur er die Seitenzahl kennt; hier nur die Form.
 */
function pruefeExtrahierAuftrag(eingabe: unknown): ExtrahierAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  if (!Array.isArray(wert['seiten'])) return null
  const aenderungen = wert['aenderungen']
  if (typeof aenderungen !== 'object' || aenderungen === null) return null
  const teile = aenderungen as Record<string, unknown>
  if (!Array.isArray(teile['neue']) || !Array.isArray(teile['geaendert'])) return null
  if (!Array.isArray(teile['geloescht'])) return null
  const formularwerte = wert['formularwerte'] ?? {}
  if (!istFormularwerte(formularwerte)) return null
  return {
    quelle: wert['quelle'],
    seiten: wert['seiten'] as number[],
    aenderungen: aenderungen as ExtrahierAuftrag['aenderungen'],
    formularwerte
  }
}

function pruefeStandAuftrag(eingabe: unknown): StandAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  const stand = wert['stand']
  if (typeof stand !== 'number' || !Number.isInteger(stand) || stand < 0) return null
  return { quelle: wert['quelle'], stand }
}

function pruefeFdfAuftrag(eingabe: unknown): FdfAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  if (typeof wert['quelle'] !== 'string' || wert['quelle'].length === 0) return null
  const formularwerte = wert['formularwerte'] ?? {}
  if (!istFormularwerte(formularwerte)) return null
  return { quelle: wert['quelle'], formularwerte }
}

/** Feldname → Zeichenkette, Wahrheitswert oder Liste von Zeichenketten. */
function istFormularwerte(eingabe: unknown): eingabe is Record<string, Feldwert> {
  if (typeof eingabe !== 'object' || eingabe === null || Array.isArray(eingabe)) return false
  return Object.values(eingabe as Record<string, unknown>).every(
    (wert) =>
      typeof wert === 'string' ||
      typeof wert === 'boolean' ||
      (Array.isArray(wert) && wert.every((eintrag) => typeof eintrag === 'string'))
  )
}

/**
 * Traegt einen Pfad vorn in die Liste der zuletzt geoeffneten Dokumente.
 *
 * Ein bereits vorhandener Eintrag wandert nach vorn statt sich zu verdoppeln.
 * Die Liste wird beschnitten, sonst waechst die Einstellungsdatei mit jedem je
 * geoeffneten Dokument.
 */
/**
 * Die Sitzung, bereinigt auf Pfade, die der Main-Prozess kennt (Lese- oder
 * Schreibfreigabe). Der aktive Tab bleibt derselbe, auch wenn davor welche
 * wegfallen.
 */
export function bereinigeSitzung(sitzung: Sitzung): Sitzung {
  const gemerkt = sitzung.tabs[sitzung.aktiv]
  const tabs = sitzung.tabs.filter(
    (pfad) => istLesefreigegeben(pfad) || istSchreibfreigegeben(pfad)
  )
  const aktiv = gemerkt === undefined ? 0 : Math.max(0, tabs.indexOf(gemerkt))
  return { tabs, aktiv }
}

/**
 * Steht der Pfad in einer Liste, die der Main-Prozess selbst fuehrt - der
 * Zuletzt-Liste oder der Sitzung? Dann hat ihn ein Mensch frueher benannt, und
 * das Oeffnen braucht keine Rueckfrage. Beide Listen kann der Renderer nicht
 * frei beschreiben (siehe `settingsSet`): die Zuletzt-Liste gar nicht, die
 * Sitzung nur mit Pfaden, die der Main kennt.
 *
 * Eintraege aus einer Einstellungsdatei, die es schon vor dieser Regel gab,
 * gelten als vertrauenswuerdig: sie stammen aus frueheren Laeufen.
 */
function kenntListen(dienste: Dienste, pfad: string): boolean {
  const voll = kanonisch(pfad)
  const stand = dienste.settings.lies()
  return [...stand.zuletztGeoeffnet, ...stand.sitzung.tabs].some(
    (eintrag) => kanonisch(eintrag) === voll
  )
}

function merkeGeoeffnet(dienste: Dienste, pfad: string): void {
  try {
    const vorher = dienste.settings.lies().zuletztGeoeffnet.filter((wert) => wert !== pfad)
    dienste.settings.aendere({
      zuletztGeoeffnet: [pfad, ...vorher].slice(0, MAX_ZULETZT_GEOEFFNET)
    })
  } catch (fehler) {
    // Die Liste ist Beiwerk: sie darf das Oeffnen nicht scheitern lassen.
    dienste.log.warn('Zuletzt geoeffnet konnte nicht gesichert werden', { fehler })
  }
}

/**
 * Registrierung aller Handler. Ausschliesslich `handle` — jeder Kanal hat eine
 * definierte Antwort. Jeder Handler validiert seine Eingaben hier im
 * Main-Prozess: der Renderer ist eine Sandbox fuer fremde Dokumente, seine
 * Nachrichten sind nicht vertrauenswuerdig.
 */
export function registerIpcHandlers(dienste: Dienste): void {
  ipcMain.handle(IPC.ping, (): string => 'pong')

  ipcMain.handle(IPC.settingsGet, (): Settings => dienste.settings.lies())

  ipcMain.handle(IPC.settingsSet, (_ereignis, eingabe: unknown): Settings => {
    const geprueft = pruefePatch(eingabe)
    if (!geprueft.gueltig) {
      // Abgelehnt und protokolliert, nicht stillschweigend geschluckt: sonst
      // verschwindet ein Tippfehler im Schluesselnamen spurlos.
      dienste.log.warn('Einstellungsaenderung abgelehnt', { grund: geprueft.grund })
      throw new Error('Ungueltige Einstellungsaenderung: ' + geprueft.grund)
    }
    const patch = { ...geprueft.patch }
    // Die Zuletzt-Liste fuehrt der Main selbst (`merkeGeoeffnet`); der Renderer
    // liest sie nur. Schriebe er sie, liesse sich ein beliebiger Pfad dort
    // eintragen, der bei jedem Start angefasst wird (existsSync, Oeffnen).
    if (patch.zuletztGeoeffnet !== undefined) {
      dienste.log.warn('Zuletzt-Liste vom Renderer ignoriert')
      delete patch.zuletztGeoeffnet
    }
    // Die Sitzung darf nur Pfade nennen, die der Main selbst kennt: Dialog,
    // Befehlszeile oder bereits gelesene Dokumente. Sonst stuende dort, was der
    // Renderer will, und der naechste Start las es ohne Rueckfrage.
    if (patch.sitzung !== undefined) patch.sitzung = bereinigeSitzung(patch.sitzung)
    const neu = dienste.settings.aendere(patch)
    if (patch.sprache !== undefined) dienste.wendeSpracheAn?.()
    return neu
  })

  ipcMain.handle(IPC.spracheGet, (): Sprache => aktiveSprache())

  ipcMain.handle(IPC.dokumentOeffnen, async (ereignis): Promise<GeoeffnetesDokument | null> => {
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    try {
      const geoeffnet = await oeffneUeberDialog(fenster)
      if (geoeffnet !== null) {
        dienste.log.info('Dokument geoeffnet', {
          name: geoeffnet.name,
          bytes: geoeffnet.bytes.byteLength
        })
        nimmAuf(dienste, geoeffnet.pfad)
      }
      return geoeffnet
    } catch (fehler) {
      dienste.log.error('Dokument konnte nicht gelesen werden', { fehler })
      throw fehler
    }
  })

  ipcMain.handle(IPC.dokumentBeimStart, async (): Promise<GeoeffnetesDokument | null> => {
    const pfad = dienste.startDokument
    if (pfad === null) return null
    try {
      const geoeffnet = await oeffnePfad(pfad)
      nimmAuf(dienste, geoeffnet.pfad)
      return geoeffnet
    } catch (fehler) {
      // Ein unlesbarer Startpfad darf die Anwendung nicht am Starten hindern.
      dienste.log.error('Startdokument konnte nicht gelesen werden', { pfad, fehler })
      return null
    }
  })

  ipcMain.handle(IPC.dokumentOeffnePfad, async (ereignis, eingabe: unknown) => {
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const ergebnis: OeffnenErgebnis = await oeffnePfadGeprueft(eingabe, {
      bekannt: (voll) => kenntListen(dienste, voll),
      bestaetige: (voll, netz) => bestaetigeLesen(fenster, [voll], netz)
    })
    if (!ergebnis.ok) {
      // Abgelehnt und protokolliert: ein Drop, der nichts tut, sieht nach
      // einem kaputten Programm aus.
      dienste.log.warn('Pfad abgelehnt', { grund: ergebnis.grund })
      return ergebnis
    }
    dienste.log.info('Dokument ueber Pfad geoeffnet', {
      name: ergebnis.dokument.name,
      bytes: ergebnis.dokument.bytes.byteLength
    })
    nimmAuf(dienste, ergebnis.dokument.pfad)
    return ergebnis
  })

  /**
   * Ein Verweis aus einem Dokument im Standardprogramm des Systems (S2.1).
   *
   * Drei Stufen, jede mit eigenem Grund:
   *
   * 1. **Schema-Allowlist** — `shell.openExternal` uebergibt an das
   *    Betriebssystem; ein `file:`- oder ein beliebiges registriertes Schema
   *    koennte dort ein Programm starten. Geprueft wird im Main, weil der
   *    Renderer fremde Dokumente anzeigt und nicht vertrauenswuerdig ist.
   * 2. **Bestaetigungsdialog mit dem vollstaendigen Ziel** — der Leser hat den
   *    Verweis nicht geschrieben; er soll sehen, wohin er fuehrt, bevor etwas
   *    aufgeht. Der Host steht eigens in der Meldung: bei
   *    `https://bekannt.example@fremd.example/` ist alles vor dem `@` nur
   *    Benutzerinformation.
   * 3. **Erst dann oeffnen.**
   */
  ipcMain.handle(IPC.externOeffnen, async (ereignis, eingabe: unknown) => {
    const geprueft = pruefeExternesZiel(eingabe)
    if (!geprueft.ok) {
      dienste.log.warn('Externer Verweis abgelehnt', { grund: geprueft.grund })
      const abgelehnt: ExternesZielErgebnis = { art: 'abgelehnt', grund: geprueft.grund }
      return abgelehnt
    }

    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const frage = {
      type: 'question' as const,
      title: APP_NAME,
      message:
        geprueft.host.length > 0 ? t('link.frageHost', { host: geprueft.host }) : t('link.frage'),
      detail: t('link.detail', { url: geprueft.url }),
      buttons: [t('knopf.oeffnen'), t('knopf.abbrechen')],
      defaultId: 1,
      cancelId: 1
    }
    const { response } =
      fenster === null
        ? await dialog.showMessageBox(frage)
        : await dialog.showMessageBox(fenster, frage)
    if (response !== 0) {
      dienste.log.info('Externer Verweis abgebrochen', { host: geprueft.host })
      const abgebrochen: ExternesZielErgebnis = { art: 'abgebrochen' }
      return abgebrochen
    }

    try {
      await shell.openExternal(geprueft.url)
      dienste.log.info('Externer Verweis geoeffnet', { host: geprueft.host })
      const geoeffnet: ExternesZielErgebnis = { art: 'geoeffnet' }
      return geoeffnet
    } catch (fehler) {
      // Etwa, wenn kein Programm fuer das Schema registriert ist. Der Nutzer
      // hat gerade "Oeffnen" gedrueckt und darf nicht ins Leere schauen.
      dienste.log.error('Externer Verweis liess sich nicht oeffnen', { fehler })
      const abgelehnt: ExternesZielErgebnis = {
        art: 'abgelehnt',
        grund: t('link.keinProgramm')
      }
      return abgelehnt
    }
  })

  /**
   * Aenderungsstand je Pfad (S6.1). Ein leerer Pfad heisst "alle" und ist
   * nur zum Zuruecksetzen gedacht; "alle sind geaendert" ergaebe keinen Sinn
   * und wird ignoriert. Eine kaputte Nutzlast ebenso - protokolliert, nicht
   * geworfen: der Renderer meldet den Stand beilaeufig aus einem Effekt, und
   * ein Fehler dort hielte nichts auf, was nicht ohnehin falsch ist.
   */
  ipcMain.handle(IPC.dokumentGeaendert, (_ereignis, eingabe: unknown): void => {
    const meldung = pruefeAenderungsMeldung(eingabe)
    if (meldung === null) {
      dienste.log.warn('Aenderungsmeldung verworfen')
      return
    }
    if (meldung.pfad === '') {
      if (!meldung.geaendert) ungespeichert.clear()
      return
    }
    const schluessel = kanonisch(meldung.pfad)
    if (meldung.geaendert) ungespeichert.add(schluessel)
    else ungespeichert.delete(schluessel)
  })

  /**
   * Ein Tab wird geschlossen (S6.1). Nur fuer Pfade, die der Main selbst
   * herausgegeben hat - sonst liesse sich ueber diesen Kanal wenigstens die
   * Arbeitskopie eines fremden Schluessels verwerfen, und das soll der
   * Renderer nicht einmal versuchen koennen.
   */
  ipcMain.handle(IPC.dokumentSchliessen, (_ereignis, eingabe: unknown): void => {
    if (!istPfadangabe(eingabe)) {
      dienste.log.warn('Schliessen abgelehnt', { grund: 'Kein Pfad.' })
      return
    }
    if (!istLesefreigegeben(eingabe) && !istSchreibfreigegeben(eingabe)) {
      dienste.log.warn('Schliessen abgelehnt', { grund: 'Pfad nicht herausgegeben.' })
      return
    }
    vergissDokument(eingabe)
    dienste.log.info('Dokument geschlossen', { name: basename(eingabe) })
  })

  /**
   * Rueckfrage vor dem Schliessen eines Tabs mit Aenderungen (S6.1). Modal
   * am Fenster des Absenders; `true` nur bei "Verwerfen". Alles, was keine
   * Zeichenkette ist, schliesst nicht - im Zweifel bleibt die Arbeit da.
   */
  ipcMain.handle(IPC.tabSchliessenFragen, async (ereignis, eingabe: unknown): Promise<boolean> => {
    if (typeof eingabe !== 'string' || eingabe.length === 0) {
      dienste.log.warn('Tab-Rueckfrage abgelehnt', { grund: 'Kein Name.' })
      return false
    }
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const frage = tabSchliessFrage(eingabe)
    const { response } =
      fenster === null
        ? await dialog.showMessageBox(frage)
        : await dialog.showMessageBox(fenster, frage)
    return response === 0
  })

  /**
   * Speichern und "Speichern unter" (S2.3a).
   *
   * Die Reihenfolge ist die Aussage: erst ablehnen, was gar nicht gehen darf,
   * dann fragen, dann schreiben. Ein Dialog fuer etwas, das anschliessend
   * abgelehnt wird, waere eine Zumutung.
   */
  ipcMain.handle(IPC.dokumentSpeichern, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): SpeicherErgebnis => {
      dienste.log.warn('Speichern abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }

    const auftrag = pruefeAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))

    // Gate Phase 2, H2: auch die **Quelle** muss ein Pfad sein, den der Main
    // selbst herausgegeben hat. Invariante 11 prueft das Ziel; ohne diese
    // Zeile konnte ein kompromittierter Renderer ein beliebiges lesbares PDF
    // als Quelle nennen und es mit einem freigegebenen Ziel ueberschreiben.
    // Die Schreibliste zaehlt mit: ein per "Speichern unter" gewaehlter Pfad
    // steht nur dort - und ist beim naechsten Strg+S die Quelle.
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }

    // Aufgabe 4: pdf-lib kann verschluesselte Dokumente nicht entschluesseln.
    // Mit `ignoreEncryption` kaemen unentschluesselte Streams heraus und das
    // neu geschriebene Dokument waere beschaedigt.
    if (auftrag.verschluesselt) {
      return abgelehnt(t('speichern.verschluesselt'))
    }

    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    let ziel = auftrag.ziel
    if (ziel === null) {
      ziel = await frageZielpfad(fenster, auftrag.quelle)
      if (ziel === null) return { art: 'abgebrochen' }
    } else if (verschwunden.has(kanonisch(auftrag.quelle))) {
      // Aufgabe 6. "Speichern unter" bleibt moeglich: ein anderer Zielort ist
      // gerade dann der Ausweg.
      return abgelehnt(t('speichern.verschwunden'))
    }

    const geprueft = await pruefeSchreibziel(ziel)
    if (!geprueft.ok) return abgelehnt(geprueft.grund)

    // S6.1: das Ziel ist in einem anderen Tab offen. Ueberschriebe man es,
    // zeigte jener Tab ein Dokument, das es so nicht mehr gibt, und sein
    // naechstes Speichern schriebe den alten Stand ueber den neuen zurueck.
    const quelleKanonisch = kanonisch(auftrag.quelle)
    const offenGrund = grundWennZielOffen(geprueft.pfad, quelleKanonisch)
    if (offenGrund !== null) return abgelehnt(offenGrund)

    // Vor dem Umbenennen darf niemand mehr auf der Zieldatei sitzen, sonst
    // scheitert es unter Windows mit EPERM. Gemerkt, ob da einer sass, damit
    // er nach einem Fehlschlag wieder aufzieht.
    const zielBeobachtet = wachen.has(geprueft.pfad)

    try {
      // Neu lesen statt ein Handle zu halten (ADR 0001, Punkt 4) - es sei
      // denn, S4.0 hat eine Arbeitskopie: dann ist sie der Stand, nicht die
      // Platte (siehe arbeitskopie.ts).
      // Kanonisch wie beim Anlegen (Mutations-Handler) und beim Vergessen
      // (`lies`): auf dem CI-Runner ist der Temp-Pfad ein 8.3-Kurzname, und
      // ein Schluessel in Kurzform faende die Kopie in Langform nicht.
      const quellbytes =
        arbeitskopie(quelleKanonisch) ?? new Uint8Array(await readFile(auftrag.quelle))
      if (hatSignatur(quellbytes) && !(await bestaetigeSignatur(fenster))) {
        return { art: 'abgebrochen' }
      }
      // S3.2, Aufgabe 2: Flachlegen ist nicht umkehrbar. Die Warnung ist
      // nicht abschaltbar und mit "Abbrechen" vorbelegt.
      if (auftrag.flachlegen && !(await bestaetigeFlachlegen(fenster))) {
        return { art: 'abgebrochen' }
      }
      // S4.1, Aufgabe 4: veraenderte Seiten ueberschreiben das Original nur
      // auf ausdrueckliche Bestaetigung. "Speichern unter" (anderes Ziel)
      // fragt nicht - dort bleibt das Original ohnehin liegen.
      if (
        hatArbeitskopie(quelleKanonisch) &&
        geprueft.pfad === quelleKanonisch &&
        !(await bestaetigeUeberschreiben(fenster))
      ) {
        return { art: 'abgebrochen' }
      }

      const bytes = await wendeAenderungenAn(quellbytes, auftrag.aenderungen, {
        formularwerte: auftrag.formularwerte,
        flachlegen: auftrag.flachlegen
      })
      // S7: Rueckgaengig reicht ueber das Speichern hinaus. Dazu bleiben die
      // Staende der Arbeitskopie erhalten; der Inhalt der Platte, den das
      // Speichern gleich ueberschreibt, wird vorher als Stand 0 festgehalten.
      // Das Flachlegen ist nicht umkehrbar und beendet die Vorgeschichte.
      const plattenBytes =
        !auftrag.flachlegen && brauchtPlattenstand(quelleKanonisch)
          ? new Uint8Array(await readFile(auftrag.quelle))
          : undefined
      beendeWache(geprueft.pfad)
      await speichereAtomar(geprueft.pfad, bytes)
      // Die Datei ist jetzt der Stand. Bei "Speichern unter" zieht der Verlauf
      // auf den neuen Pfad um - der Tab lebt dort weiter, der alte Pfad ist in
      // keinem Tab mehr offen.
      if (auftrag.flachlegen) vergissArbeitskopie(quelleKanonisch)
      else merkeGespeichert(quelleKanonisch, geprueft.pfad, bytes, plattenBytes)
      if (geprueft.pfad !== quelleKanonisch) vergissDokument(quelleKanonisch)
      merkeOffen(geprueft.pfad)
      ungespeichert.delete(geprueft.pfad)
      // Nach "Speichern unter" lebt das Dokument unter dem neuen Pfad weiter:
      // in der Zuletzt-Liste und unter der Wache. Sonst zeigte die Anwendung
      // eine Datei an, die sie nicht mehr beobachtet.
      nimmAuf(dienste, geprueft.pfad)
      dienste.log.info('Dokument gespeichert', { bytes: bytes.byteLength })
      const ergebnis: SpeicherErgebnis = {
        art: 'gespeichert',
        pfad: geprueft.pfad,
        name: basename(geprueft.pfad)
      }
      return ergebnis
    } catch (fehler) {
      dienste.log.error('Speichern fehlgeschlagen', { fehler })
      // Die Wache wieder setzen: das Dokument ist unveraendert offen.
      if (zielBeobachtet) beobachteDokument(dienste, geprueft.pfad)
      return abgelehnt(t('speichern.fehlerMain', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * FDF-Export (S3.2, Aufgabe 3). Dieselben Regeln wie beim Speichern: die
   * Quelle muss der Main selbst herausgegeben haben, das Ziel kommt aus dem
   * Dialog. Die Werte kommen aus der neu gelesenen Datei, ueberlagert von den
   * ungespeicherten Aenderungen des Renderers - so enthaelt der Export auch
   * Felder auf Seiten, die der Renderer nie gelesen hat.
   */
  ipcMain.handle(IPC.formularFdfExportieren, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): SpeicherErgebnis => {
      dienste.log.warn('FDF-Export abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeFdfAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }

    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const vorschlag = auftrag.quelle.replace(/\.pdf$/i, '') + '.fdf'
    const ziel = await frageZielpfad(fenster, vorschlag, ZIEL_FDF)
    if (ziel === null) return { art: 'abgebrochen' }
    if (!/\.fdf$/i.test(ziel)) return abgelehnt(t('fdf.nurFdf'))

    try {
      const quellbytes = new Uint8Array(await readFile(auftrag.quelle))
      const dokument = await PDFDocument.load(quellbytes)
      const felder = sammleFeldwerte(dokument, auftrag.formularwerte)
      if (felder.length === 0) return abgelehnt(t('fdf.keineFelder'))
      await speichereAtomar(ziel, erzeugeFdf(felder, basename(auftrag.quelle)))
      dienste.log.info('FDF exportiert', { felder: felder.length })
      const ergebnis: SpeicherErgebnis = { art: 'gespeichert', pfad: ziel, name: basename(ziel) }
      return ergebnis
    } catch (fehler) {
      dienste.log.error('FDF-Export fehlgeschlagen', { fehler })
      return abgelehnt(t('fdf.fehler', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * Eine Dokument-Mutation (S4.0, Aufgabe 1) - als **eine** Einheit:
   * Arbeitskopie holen oder aus der Datei anlegen, die ungespeicherten
   * Anmerkungen einspielen, mutieren, Arbeitskopie fortschreiben, Bytes
   * zurueckgeben. Der Renderer uebernimmt den Rest (Neuladen, Caches).
   *
   * Dieselbe Quellpruefung wie beim Speichern (Gate Phase 2, H2): der Main
   * mutiert nur, was er selbst herausgegeben hat.
   */
  ipcMain.handle(IPC.dokumentMutieren, async (_ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): MutationsErgebnis => {
      dienste.log.warn('Mutation abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeMutationsAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }
    const beginn = performance.now()
    try {
      // Der Schluessel der Arbeitskopie ist der kanonische Pfad - derselbe,
      // unter dem `lies` sie beim Neuoeffnen vergisst (8.3-Kurznamen in CI).
      const quelleKanonisch = kanonisch(auftrag.quelle)
      const ausgang =
        arbeitskopie(quelleKanonisch) ?? new Uint8Array(await readFile(auftrag.quelle))
      // Erst die ungespeicherten Anmerkungen und Formularwerte einspielen
      // (Aufgabe 3): nach dem Neuladen sind sie Bestand des Dokuments. Was
      // auf der geloeschten Seite lag, geht mit ihr - so wie ihr Inhalt.
      // Aber nur, wenn es etwas einzuspielen gibt: sonst kostete es eine
      // zweite vollstaendige Serialisierung - bei large-heavy.pdf rund eine
      // halbe Sekunde, ein Drittel des Budgets.
      const hatAenderungen =
        auftrag.aenderungen.neue.length +
          auftrag.aenderungen.geaendert.length +
          auftrag.aenderungen.geloescht.length >
          0 || Object.keys(auftrag.formularwerte).length > 0
      const mitAenderungen = hatAenderungen
        ? await wendeAenderungenAn(ausgang, auftrag.aenderungen, {
            formularwerte: auftrag.formularwerte
          })
        : ausgang
      const { bytes, bericht } = await wendeMutationAnMitBericht(mitAenderungen, auftrag.mutation)
      // S6.1: das gemeinsame Budget ueber alle Tabs. Lieber eine klare
      // Ablehnung als ein Main-Prozess, der am Speicher stirbt und dabei die
      // Arbeit aller Tabs mitnimmt.
      if (!passtInsGesamtbudget(quelleKanonisch, bytes)) {
        return abgelehnt(t('mutation.budget'))
      }
      const vorher = aktuellerStand(quelleKanonisch)
      const nachher = merkeStand(quelleKanonisch, bytes)
      // Die Arbeitskopie ist ungespeichert, auch wenn der Renderer nach dem
      // Neuladen keine offene Anmerkung mehr zaehlt.
      ungespeichert.add(quelleKanonisch)
      const dauerMs = Math.round(performance.now() - beginn)
      dienste.log.info('Mutation angewendet', {
        art: auftrag.mutation.art,
        bytes: bytes.byteLength,
        dauerMs
      })
      const ergebnis: MutationsErgebnis = {
        art: 'angewendet',
        dokument: { pfad: auftrag.quelle, name: basename(auftrag.quelle), bytes },
        dauerMs,
        stand: { vorher, nachher },
        ...(bericht === undefined ? {} : { bericht })
      }
      return ergebnis
    } catch (fehler) {
      dienste.log.error('Mutation fehlgeschlagen', { fehler })
      return abgelehnt(t('mutation.fehlerMain', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * Einen gemerkten Stand wiederherstellen (S4.1) - Rueckgaengig und
   * Wiederholen einer Mutation. Stand 0 heisst: die Datei selbst; dann
   * faellt die Arbeitskopie, und die Bytes kommen frisch von der Platte.
   */
  ipcMain.handle(IPC.dokumentStandHerstellen, async (_ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): StandErgebnis => {
      dienste.log.warn('Stand nicht wiederherstellbar', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeStandAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }
    try {
      const quelleKanonisch = kanonisch(auftrag.quelle)
      const gemerkt = stelleStandHer(quelleKanonisch, auftrag.stand)
      if (gemerkt === undefined) {
        return abgelehnt(t('stand.weg'))
      }
      const bytes = gemerkt ?? new Uint8Array(await readFile(auftrag.quelle))
      // Sauber heisst: der Stand ist, was auf der Platte steht. Nach einem
      // Speichern gilt das auch fuer eine Nummer ungleich 0 (S7), und ein
      // Rueckgaengig bis vor das Speichern macht das Dokument wieder ungespeichert.
      const sauber = istSauber(quelleKanonisch)
      if (sauber) ungespeichert.delete(quelleKanonisch)
      else ungespeichert.add(quelleKanonisch)
      dienste.log.info('Stand wiederhergestellt', { stand: auftrag.stand, bytes: bytes.byteLength })
      const ergebnis: StandErgebnis = {
        art: 'hergestellt',
        dokument: { pfad: auftrag.quelle, name: basename(auftrag.quelle), bytes },
        sauber
      }
      return ergebnis
    } catch (fehler) {
      dienste.log.error('Stand wiederherstellen fehlgeschlagen', { fehler })
      return abgelehnt(t('stand.fehler', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * Mehrere Dokumente waehlen (S4.2a). Seitenzahl je Datei ueber pdf-lib -
   * der Renderer zeigt sie in der Reihenfolgeliste und braucht dafuer keine
   * Bytes.
   */
  ipcMain.handle(IPC.dokumenteWaehlen, async (ereignis): Promise<Dokumentquelle[] | null> => {
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const pfade = await waehleDokumente(fenster)
    if (pfade === null) return null
    const quellen: Dokumentquelle[] = []
    for (const pfad of pfade) {
      try {
        const dokument = await PDFDocument.load(new Uint8Array(await readFile(pfad)))
        quellen.push({ pfad, name: basename(pfad), seiten: dokument.getPageCount() })
      } catch (fehler) {
        dienste.log.warn('Dokument fuer Zusammenfuehren nicht lesbar', {
          name: basename(pfad),
          fehler
        })
        quellen.push({ pfad, name: basename(pfad), seiten: 0 })
      }
    }
    return quellen
  })

  /**
   * Zusammenfuehren (S4.2a, Aufgabe 1): nur Quellen, die der Main selbst
   * herausgegeben hat; das Ziel kommt aus dem Dialog und wird damit frei.
   */
  ipcMain.handle(IPC.dokumenteZusammenfuehren, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): ZusammenfuehrErgebnis => {
      dienste.log.warn('Zusammenfuehren abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeZusammenfuehrAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    for (const quelle of auftrag.quellen) {
      if (!istLesefreigegeben(quelle) && !istSchreibfreigegeben(quelle)) {
        return abgelehnt(t('zusammen.nichtGewaehlt', { name: basename(quelle) }))
      }
    }
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    try {
      // Erst zusammenfuehren, dann nach dem Ziel fragen: eine Quelle, die
      // pdf-lib nicht lesen kann (verschluesselt, beschaedigt), soll vor dem
      // Dialog scheitern, nicht danach.
      const bytes: Uint8Array[] = []
      for (const quelle of auftrag.quellen) {
        // Die Arbeitskopie zaehlt: wer eine Seite geloescht hat und dann
        // zusammenfuehrt, meint den Stand, den er sieht.
        bytes.push(arbeitskopie(kanonisch(quelle)) ?? new Uint8Array(await readFile(quelle)))
      }
      const ergebnis = await fuehreZusammen(bytes)
      const erste = auftrag.quellen[0] ?? ''
      const vorschlag = t('zusammen.dateiname', { name: erste.replace(/\.pdf$/i, '') })
      const ziel = await frageZielpfad(fenster, vorschlag)
      if (ziel === null) return { art: 'abgebrochen' }
      const geprueft = await pruefeSchreibziel(ziel)
      if (!geprueft.ok) return abgelehnt(geprueft.grund)
      await speichereAtomar(geprueft.pfad, ergebnis.bytes)
      dienste.log.info('Dokumente zusammengefuehrt', {
        quellen: auftrag.quellen.length,
        seiten: ergebnis.seiten,
        umbenannt: ergebnis.umbenannt.length
      })
      const antwort: ZusammenfuehrErgebnis = {
        art: 'gespeichert',
        pfad: geprueft.pfad,
        name: basename(geprueft.pfad),
        seiten: ergebnis.seiten,
        umbenannt: ergebnis.umbenannt
      }
      return antwort
    } catch (fehler) {
      dienste.log.error('Zusammenfuehren fehlgeschlagen', { fehler })
      return abgelehnt(t('zusammen.fehlerMain', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * Teilen (S4.2a, Aufgabe 2): das Zielverzeichnis kommt aus dem Dialog, die
   * Dateinamen aus den Bereichen; jede Datei wird einzeln freigegeben und
   * atomar geschrieben. Vorhandene Dateien werden nur nach Rueckfrage
   * ueberschrieben.
   */
  ipcMain.handle(IPC.dokumentTeilen, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): TeilErgebnis => {
      dienste.log.warn('Teilen abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeTeilAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    try {
      const quelleKanonisch = kanonisch(auftrag.quelle)
      const bytes = arbeitskopie(quelleKanonisch) ?? new Uint8Array(await readFile(auftrag.quelle))
      const seitenzahl = (await PDFDocument.load(bytes)).getPageCount()
      const bereiche =
        auftrag.bereiche === 'einzelseiten'
          ? einzelseiten(seitenzahl)
          : pruefeBereiche(auftrag.bereiche, seitenzahl)
      if (bereiche === null) return abgelehnt(t('teilen.bereicheUngueltig'))

      const verzeichnis = await waehleVerzeichnis(fenster)
      if (verzeichnis === null) return { art: 'abgebrochen' }
      // Der Dialog erlaubt, einen Ordner neu anzulegen; ob er ihn dann
      // wirklich erzeugt, haengt vom Betriebssystem ab. Anlegen ist hier
      // ohne Risiko: der Nutzer hat genau diesen Ort benannt.
      await mkdir(verzeichnis, { recursive: true })
      const name = basename(auftrag.quelle)
      const ziele = bereiche.map((bereich) => join(verzeichnis, teilname(name, bereich)))
      const vorhanden = ziele.filter((ziel) => existsSync(ziel))
      if (!(await bestaetigeDateienUeberschreiben(fenster, vorhanden))) {
        return { art: 'abgebrochen' }
      }

      const teilbytes = await teile(bytes, bereiche)
      const dateien: string[] = []
      for (let i = 0; i < ziele.length; i++) {
        const ziel = ziele[i]
        const inhalt = teilbytes[i]
        if (ziel === undefined || inhalt === undefined) continue
        // Der Ordner ist gewaehlt, der Name berechnet - beides zusammen ist
        // die Freigabe (Invariante 11), dann dieselbe Pruefung wie beim Speichern.
        gibSchreibfrei(ziel)
        const geprueft = await pruefeSchreibziel(ziel)
        if (!geprueft.ok) return abgelehnt(geprueft.grund)
        await speichereAtomar(geprueft.pfad, inhalt)
        dateien.push(geprueft.pfad)
      }
      dienste.log.info('Dokument geteilt', { teile: dateien.length })
      const antwort: TeilErgebnis = { art: 'gespeichert', verzeichnis, dateien }
      return antwort
    } catch (fehler) {
      dienste.log.error('Teilen fehlgeschlagen', { fehler })
      return abgelehnt(t('teilen.fehlerMain', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * Seiten extrahieren (S6.2, Aufgabe 3): die gewaehlten Seiten der
   * Arbeitskopie samt ungespeicherter Aenderungen - wie beim Drucken - als
   * neue Datei. Das offene Dokument bleibt, wie es ist, und darf nicht das
   * Ziel sein.
   */
  ipcMain.handle(IPC.seitenExtrahieren, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): ExtrahierErgebnis => {
      dienste.log.warn('Extrahieren abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeExtrahierAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    try {
      const quelleKanonisch = kanonisch(auftrag.quelle)
      const ausgang =
        arbeitskopie(quelleKanonisch) ?? new Uint8Array(await readFile(auftrag.quelle))
      const hatAenderungen =
        auftrag.aenderungen.neue.length +
          auftrag.aenderungen.geaendert.length +
          auftrag.aenderungen.geloescht.length >
          0 || Object.keys(auftrag.formularwerte).length > 0
      const bytes = hatAenderungen
        ? await wendeAenderungenAn(ausgang, auftrag.aenderungen, {
            formularwerte: auftrag.formularwerte
          })
        : ausgang
      const seitenzahl = (await PDFDocument.load(bytes)).getPageCount()
      const seiten = pruefeSeitenliste(auftrag.seiten, seitenzahl)
      if (seiten === null) return abgelehnt(t('extrahieren.auswahlUngueltig'))
      // Erst extrahieren, dann fragen - wie beim Zusammenfuehren soll ein
      // Fehler vor dem Dialog kommen, nicht danach.
      const ergebnis = await extrahiere(bytes, seiten)
      const vorschlag = join(dirname(auftrag.quelle), extraktname(basename(auftrag.quelle), seiten))
      const ziel = await frageZielpfad(fenster, vorschlag)
      if (ziel === null) return { art: 'abgebrochen' }
      const geprueft = await pruefeSchreibziel(ziel)
      if (!geprueft.ok) return abgelehnt(geprueft.grund)
      if (geprueft.pfad === quelleKanonisch) {
        return abgelehnt(t('extrahieren.nichtUeberschreiben'))
      }
      const offenGrund = grundWennZielOffen(geprueft.pfad, quelleKanonisch)
      if (offenGrund !== null) return abgelehnt(offenGrund)
      await speichereAtomar(geprueft.pfad, ergebnis)
      dienste.log.info('Seiten extrahiert', { seiten: seiten.length })
      const antwort: ExtrahierErgebnis = {
        art: 'gespeichert',
        pfad: geprueft.pfad,
        name: basename(geprueft.pfad),
        seiten: seiten.length
      }
      return antwort
    } catch (fehler) {
      dienste.log.error('Extrahieren fehlgeschlagen', { fehler })
      return abgelehnt(t('extrahieren.fehlerMain', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * Drucken (S4.3, ADR 0003). Dieselbe Quellpruefung wie beim Speichern; die
   * Bytes sind die der Arbeitskopie samt ungespeicherter Aenderungen, wie bei
   * der Mutation (S4.0). Die Vorlage entsteht hier, gedruckt wird im
   * versteckten Fenster (`druckfenster.ts`); fuer die Datei fragt der
   * Speichern-Dialog vorher nach dem Ziel - und das darf nicht das geoeffnete
   * Dokument sein, sonst ueberschriebe der Druck das Original.
   */
  ipcMain.handle(IPC.dokumentDrucken, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): DruckAntwort => {
      dienste.log.warn('Drucken abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeDruckAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }
    if (laufenderDruck !== null) return abgelehnt(t('druck.laeuftSchon'))
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)

    let ziel: DruckfensterAuftrag['ziel'] = { art: 'drucker' }
    if (auftrag.ziel === 'datei') {
      const vorschlag = t('druck.dateiname', { name: auftrag.quelle.replace(/\.pdf$/i, '') })
      const pfad = await frageZielpfad(fenster, vorschlag)
      if (pfad === null) return { art: 'abgebrochen' }
      const geprueft = await pruefeSchreibziel(pfad)
      if (!geprueft.ok) return abgelehnt(geprueft.grund)
      if (geprueft.pfad === kanonisch(auftrag.quelle)) {
        return abgelehnt(t('druck.nichtUeberschreiben'))
      }
      ziel = { art: 'datei', pfad: geprueft.pfad }
    }

    try {
      dienste.melde({ art: 'druckFortschritt', phase: 'vorlage' })
      const quelleKanonisch = kanonisch(auftrag.quelle)
      const ausgang =
        arbeitskopie(quelleKanonisch) ?? new Uint8Array(await readFile(auftrag.quelle))
      const hatAenderungen =
        auftrag.aenderungen.neue.length +
          auftrag.aenderungen.geaendert.length +
          auftrag.aenderungen.geloescht.length >
          0 || Object.keys(auftrag.formularwerte).length > 0
      const bytes = hatAenderungen
        ? await wendeAenderungenAn(ausgang, auftrag.aenderungen, {
            formularwerte: auftrag.formularwerte
          })
        : ausgang
      const vorlage = await baueDruckvorlage(bytes, auftrag.optionen)
      laufenderDruck = dienste.drucke({ vorlage, ziel }, { log: dienste.log, melde: dienste.melde })
      const ergebnis = await laufenderDruck.ergebnis
      switch (ergebnis.art) {
        case 'gedruckt':
          return { art: 'gedruckt' }
        case 'gespeichert':
          return {
            art: 'gespeichert',
            pfad: ergebnis.pfad,
            name: basename(ergebnis.pfad),
            seiten: ergebnis.seiten
          }
        case 'abgebrochen':
          return { art: 'abgebrochen' }
        case 'fehler':
          return abgelehnt(ergebnis.grund)
      }
    } catch (fehler) {
      dienste.log.error('Drucken fehlgeschlagen', { fehler })
      return abgelehnt(t('druck.fehlerMain', { fehler: fehlertext(fehler) }))
    } finally {
      laufenderDruck = null
    }
  })

  /** Bricht den laufenden Druck ab (Aufgabe 3); `false`, wenn keiner laeuft. */
  ipcMain.handle(IPC.druckAbbrechen, () => {
    if (laufenderDruck === null) return false
    laufenderDruck.abbrechen()
    return true
  })

  /**
   * PNG-Export, Schritt 1 (S4.2b, Aufgabe 3): die Ziele. Eine Seite fragt
   * nach einer Datei, mehrere nach einem Ordner; die Namen folgen dem Schema
   * des Teilens (`bericht-S3.png`). Jeder Pfad wird einzeln freigegeben -
   * Invariante 11 bleibt eine Liste von Dateipfaden, kein Ordnerrecht.
   */
  ipcMain.handle(IPC.pngZieleWaehlen, async (ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): PngZielErgebnis => {
      dienste.log.warn('PNG-Export abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefePngZielAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
      return abgelehnt(t('auftrag.quelle'))
    }
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const name = basename(auftrag.quelle)
    try {
      if (auftrag.seiten.length === 1) {
        const seite = auftrag.seiten[0] ?? 1
        const vorschlag = join(dirname(auftrag.quelle), pngName(name, seite))
        const ziel = await frageZielpfad(fenster, vorschlag, ZIEL_PNG)
        if (ziel === null) return { art: 'abgebrochen' }
        if (!/\.png$/i.test(ziel)) return abgelehnt(t('png.nurPng'))
        const antwort: PngZielErgebnis = { art: 'freigegeben', ziele: [{ seite, pfad: ziel }] }
        return antwort
      }
      const verzeichnis = await waehleVerzeichnis(fenster)
      if (verzeichnis === null) return { art: 'abgebrochen' }
      await mkdir(verzeichnis, { recursive: true })
      const ziele = auftrag.seiten.map((seite) => ({
        seite,
        pfad: kanonisch(join(verzeichnis, pngName(name, seite)))
      }))
      const vorhanden = ziele.map((z) => z.pfad).filter((pfad) => existsSync(pfad))
      if (!(await bestaetigeDateienUeberschreiben(fenster, vorhanden))) {
        return { art: 'abgebrochen' }
      }
      for (const ziel of ziele) gibSchreibfrei(ziel.pfad)
      const antwort: PngZielErgebnis = { art: 'freigegeben', ziele }
      return antwort
    } catch (fehler) {
      dienste.log.error('PNG-Ziele fehlgeschlagen', { fehler })
      return abgelehnt(t('png.zielFehler', { fehler: fehlertext(fehler) }))
    }
  })

  /**
   * PNG-Export, Schritt 2: ein Bild schreiben. Der Pfad muss aus Schritt 1
   * stammen (Freigabe, Endung, Symlink-Pruefung wie beim Speichern), der
   * Inhalt muss am Kopf ein PNG sein - der Renderer liefert Eingabe, keine
   * Wahrheit.
   */
  ipcMain.handle(IPC.pngSchreiben, async (_ereignis, eingabe: unknown) => {
    const abgelehnt = (grund: string): PngSchreibErgebnis => {
      dienste.log.warn('PNG-Schreiben abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefePngSchreibAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    if (bildart(auftrag.bytes) !== 'png') return abgelehnt(t('png.keinPng'))
    if (auftrag.bytes.length > MAX_PNG_BYTES) return abgelehnt(t('png.zuGross'))
    const geprueft = await pruefeSchreibziel(auftrag.pfad, { endung: '.png' })
    if (!geprueft.ok) return abgelehnt(geprueft.grund)
    try {
      await speichereAtomar(geprueft.pfad, auftrag.bytes)
      dienste.log.info('PNG geschrieben', { bytes: auftrag.bytes.length })
      const antwort: PngSchreibErgebnis = { art: 'geschrieben', pfad: geprueft.pfad }
      return antwort
    } catch (fehler) {
      dienste.log.error('PNG-Schreiben fehlgeschlagen', { fehler })
      return abgelehnt(t('png.schreibFehler', { fehler: fehlertext(fehler) }))
    }
  })

  ipcMain.handle(IPC.bildLaden, async (ereignis): Promise<BildErgebnis> => {
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    const ergebnis = await ladeBildUeberDialog(fenster)
    if (ergebnis.art === 'abgelehnt') {
      dienste.log.warn('Signaturbild abgelehnt', { grund: ergebnis.grund })
    } else if (ergebnis.art === 'geladen') {
      dienste.log.info('Signaturbild geladen', { zeichen: ergebnis.url.length })
    }
    return ergebnis
  })

  ipcMain.handle(IPC.zuletztGeoeffnet, (): ZuletztEintrag[] =>
    // Ob die Datei noch da ist, entscheidet der Main-Prozess: der Renderer
    // sieht das Dateisystem nicht. Fehlende Eintraege bleiben in der Liste und
    // werden ausgegraut, statt kommentarlos zu verschwinden.
    dienste.settings.lies().zuletztGeoeffnet.map((pfad) => ({
      pfad,
      name: basename(pfad),
      // Nur lokale Pfade anfassen: `existsSync` auf `\\server\...` baut eine
      // Netzwerkverbindung auf, jedes Mal, wenn die Startseite erscheint.
      existiert: pfadklasse(pfad) === 'lokal' && existsSync(pfad)
    }))
  )

  /** PDF nach Word (S6.7): Pruefen, Dialog und Schreiben in `word-export.ts`. */
  ipcMain.handle(IPC.wordExportieren, (ereignis, eingabe: unknown) =>
    exportiereWord(BrowserWindow.fromWebContents(ereignis.sender), eingabe, dienste.log)
  )

  /**
   * Bilder zu PDF, Schritt 1 (S6.4, Aufgabe 1+2): `null` oeffnet den Dialog,
   * eine Pfadliste kommt aus Drag & Drop. Jede Datei wird einmal gelesen,
   * Kopf und Gesamtgroesse geprueft - wie beim Signaturbild ohne Eintrag in
   * die Lesefreigaben (der Renderer traegt danach nur noch Bytes).
   */
  ipcMain.handle(
    IPC.bilderWaehlen,
    async (ereignis, eingabe: unknown): Promise<BilderWahlErgebnis> => {
      const pfade =
        eingabe === null
          ? await waehleBilder(BrowserWindow.fromWebContents(ereignis.sender))
          : pruefePfadListe(eingabe)
      if (pfade === null) return { art: 'abgebrochen' }
      if (pfade.length === 0) return { art: 'abgelehnt', grund: t('bilder.keine') }
      // Eine Pfadliste aus Drag & Drop nennt der Renderer. Der Main liest sie nur
      // nach einer Rueckfrage, die alle neuen Dateien auf einmal zeigt (die
      // Bilder tragen sich in keine Freigabeliste ein, deshalb fragt jede Ablage).
      if (eingabe !== null) {
        const fremd = pfade.filter(
          (pfad) => !istLesefreigegeben(pfad) && !kenntListen(dienste, pfad)
        )
        if (
          fremd.length > 0 &&
          !(await bestaetigeLesen(BrowserWindow.fromWebContents(ereignis.sender), fremd, false))
        ) {
          return { art: 'abgebrochen' }
        }
      }

      const bilder: Bildquelle[] = []
      const abgelehnt: { name: string; grund: string }[] = []
      let gesamt = 0
      let gesamtUeberschritten = false
      for (const pfad of pfade) {
        const name = basename(pfad)
        // Review M4/Security M1: erst `stat` (kein Lesen), Einzel- und
        // Gesamtgroesse pruefen, dann nur den Kopf lesen - `readFile` erst,
        // wenn feststeht, dass die Datei ueberhaupt ein Bild ist. Eine
        // Kanonisierung wie beim Oeffnen loest einen symlinkten Pfad auf,
        // bevor `stat` ihm folgt.
        const echterPfad = kanonisch(pfad)
        try {
          const info = await stat(echterPfad)
          if (!info.isFile()) {
            abgelehnt.push({ name, grund: t('bilder.keineDatei') })
            continue
          }
          if (info.size === 0) {
            abgelehnt.push({ name, grund: t('bilder.dateiLeer') })
            continue
          }
          if (info.size > MAX_BILD_DATEI_BYTES) {
            abgelehnt.push({
              name,
              grund: t('bilder.zuGross', { mb: Math.round(MAX_BILD_DATEI_BYTES / (1024 * 1024)) })
            })
            continue
          }
          if (gesamt + info.size > MAX_BILDER_GESAMT_BYTES) {
            // Nicht mehr lesen, sobald das Gesamtbudget erschoepft ist - die
            // ganze Auswahl wird ohnehin abgelehnt (Aufgabe 6).
            gesamtUeberschritten = true
            gesamt += info.size
            continue
          }

          const griff = await open(echterPfad, 'r')
          let kopf: Uint8Array
          try {
            const puffer = Buffer.alloc(32)
            const { bytesRead } = await griff.read(puffer, 0, puffer.length, 0)
            kopf = new Uint8Array(puffer.subarray(0, bytesRead))
          } finally {
            await griff.close()
          }
          if (bildformat(kopf) === null) {
            abgelehnt.push({
              name,
              grund: t('bilder.format')
            })
            continue
          }

          const bytes = new Uint8Array(await readFile(echterPfad))
          const format = bildformat(bytes)
          if (format === null) {
            // Kopf und Vollinhalt widersprechen sich (Wettlauf mit einer
            // Aenderung der Datei zwischen den beiden Lesezugriffen) -
            // sicherheitshalber ablehnen statt dem ersten Befund zu trauen.
            abgelehnt.push({
              name,
              grund: t('bilder.format')
            })
            continue
          }
          gesamt += bytes.byteLength
          bilder.push({ name, format, bytes })
        } catch (fehler) {
          abgelehnt.push({ name, grund: t('bilder.lesefehler', { fehler: fehlertext(fehler) }) })
        }
      }
      if (gesamtUeberschritten || gesamt > MAX_BILDER_GESAMT_BYTES) {
        dienste.log.warn('Bilder abgelehnt: Gesamtgroesse', { gesamt })
        return {
          art: 'abgelehnt',
          grund: t('bilder.gesamtZuGross', {
            mb: Math.round(MAX_BILDER_GESAMT_BYTES / (1024 * 1024))
          })
        }
      }
      dienste.log.info('Bilder gewaehlt', { gewaehlt: bilder.length, abgelehnt: abgelehnt.length })
      return { art: 'gewaehlt', bilder, abgelehnt }
    }
  )

  /**
   * Bilder zu PDF, Schritt 2 (Aufgabe 3-6): der Renderer hat jedes Bild schon
   * auf PNG oder JPEG normalisiert und die EXIF-Ausrichtung angewendet
   * (R17). Hier entsteht nur noch das PDF, der Zielpfad und das atomare
   * Schreiben - wie beim Zusammenfuehren.
   */
  ipcMain.handle(IPC.bilderZuPdf, async (ereignis, eingabe: unknown): Promise<BildPdfErgebnis> => {
    const abgelehnt = (grund: string): BildPdfErgebnis => {
      dienste.log.warn('Bilder zu PDF abgelehnt', { grund })
      return { art: 'abgelehnt', grund }
    }
    const auftrag = pruefeBildPdfAuftrag(eingabe)
    if (auftrag === null) return abgelehnt(t('auftrag.form'))
    const fenster = BrowserWindow.fromWebContents(ereignis.sender)
    try {
      const bytes = await baueBilderPdf(auftrag)
      const vorschlag = auftrag.vorschlag.replace(/\.pdf$/i, '') + '.pdf'
      const ziel = await frageZielpfad(fenster, vorschlag)
      if (ziel === null) return { art: 'abgebrochen' }
      const geprueft = await pruefeSchreibziel(ziel)
      if (!geprueft.ok) return abgelehnt(geprueft.grund)
      // Review M2/Security L6: kein "eigene Quelle"-Ausnahme wie beim
      // Speichern - Bilder zu PDF hat keine Quelle, jedes andere offene
      // Dokument ist ein moegliches Ziel und muss abgelehnt werden.
      const offenGrund = grundWennZielOffen(geprueft.pfad, null)
      if (offenGrund !== null) return abgelehnt(offenGrund)
      await speichereAtomar(geprueft.pfad, bytes)
      dienste.log.info('Bilder zu PDF gespeichert', { seiten: auftrag.seiten.length })
      const antwort: BildPdfErgebnis = {
        art: 'gespeichert',
        pfad: geprueft.pfad,
        name: basename(geprueft.pfad),
        seiten: auftrag.seiten.length
      }
      return antwort
    } catch (fehler) {
      dienste.log.error('Bilder zu PDF fehlgeschlagen', { fehler })
      return abgelehnt(t('bilder.pdfFehler', { fehler: fehlertext(fehler) }))
    }
  })
}
