import { dialog, type BrowserWindow } from 'electron'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { GeoeffnetesDokument, OeffnenErgebnis } from '../shared/ipc'
import { pfadklasse } from '../shared/pfade'
import { arbeitskopie, vergissArbeitskopie } from './arbeitskopie'
import { t } from '../shared/i18n'

/**
 * Die kanonische Form eines Pfads — die eine Schreibweise, in der Freigabe
 * und Pruefung dieselbe Datei auch als dieselbe erkennen.
 *
 * `resolve` allein reicht nicht. Windows kennt fuer jeden Pfad eine Kurzform
 * (`C:\Users\RUNNER~1\...`) und eine Langform (`C:\Users\runneradmin\...`), und
 * welche `os.tmpdir()` liefert, haengt vom Rechner ab. `realpath` gibt immer
 * die Langform zurueck. Ein Pfad, der in Kurzform freigegeben und in Langform
 * geprueft wurde, galt damit als "andere Datei" — auf GitHubs Windows-Runnern
 * scheiterte jedes Speichern ueber eine bestehende Datei, waehrend es auf
 * einem Rechner mit kurzem Benutzernamen nie auffiel.
 *
 * Kanonisiert wird das **Verzeichnis**; der Dateiname bleibt, wie er ist.
 * So folgt diese Funktion keinem Symlink auf der Datei selbst — den muss
 * `pruefeSchreibziel` gerade sehen koennen. Gibt es das Verzeichnis nicht
 * (etwa bei einem Ziel, das erst entsteht), bleibt es bei `resolve`.
 *
 * **UNC-Pfade bleiben bei `resolve`.** `realpath` auf `\\server\share\...`
 * spricht den Rechner im Netz an und wartet, bis der antwortet oder die
 * Zeit ablaeuft — und diese Funktion laeuft auf Zeichenketten, die der
 * Renderer nennt. Ein fremdes Dokument darf den Main-Prozess nicht fuenf
 * Sekunden an einen nicht existierenden Server haengen. Kurznamen kommen auf
 * Netzfreigaben ohnehin nicht ueber `os.tmpdir()` herein.
 */
export function kanonisch(pfad: string): string {
  const voll = resolve(pfad)
  if (voll.startsWith('\\\\')) return voll
  try {
    return join(realpathSync.native(dirname(voll)), basename(voll))
  } catch {
    return voll
  }
}

/**
 * **Zwei** Freigabelisten, nicht eine (Invariante 11, scharf ab S2.3a).
 *
 * Bis S2.1 trug jeder gelesene Pfad sich in eine gemeinsame Liste ein. Solange
 * nichts schrieb, war das wirkungslos; ab S2.3a waere es eine
 * Rechteausweitung: der Renderer nennt beim Oeffnen ueber Drag & Drop oder die
 * Zuletzt-Liste einen Pfad, und derselbe Pfad waere damit zum Schreiben
 * freigegeben. Der Renderer ist aber eine Sandbox fuer fremde Dokumente — der
 * Main-Prozess kann einer Zeichenkette von dort nicht ansehen, ob wirklich ein
 * Mensch die Datei gemeint hat.
 *
 * Deshalb:
 *
 * - **Lesen** darf, was der Main kennt (Dialog, Befehlszeile, Systemereignis,
 *   Zuletzt-Liste, Sitzung) oder was der Nutzer auf Rueckfrage bestaetigt hat.
 *   Ein Pfad, den nur der Renderer nennt, wird erst nach einem Dialog des
 *   Betriebssystems gelesen (`oeffnePfadGeprueft`, `lesen-bestaetigen.ts`).
 * - **Schreiben** darf nur, was der Main-Prozess selbst aus einer Quelle
 *   ausserhalb des Renderers hat: aus einem Dateidialog, aus der Befehlszeile
 *   oder aus einem `open-file`-Ereignis des Betriebssystems.
 *
 * Folge fuer den Nutzer: ein per Drag & Drop geoeffnetes Dokument laesst sich
 * nicht mit "Speichern" ueberschreiben, wohl aber mit "Speichern unter" — der
 * Dialog ist genau die fehlende Bestaetigung.
 */
const leseFreigaben = new Set<string>()
const schreibFreigaben = new Set<string>()

/**
 * Pfade, die das Betriebssystem selbst uebergeben hat (Befehlszeile,
 * "Oeffnen mit", zweite Instanz).
 *
 * Der Main-Prozess schickt dem Renderer nur den Pfad; der holt das Dokument
 * dann ueber `dokumentOeffnePfad`. Ohne dieses Gedaechtnis kaeme derselbe Pfad
 * dort als blosse Renderer-Angabe an und verlore sein Schreibrecht.
 */
const systempfade = new Set<string>()

export function merkeSystempfad(pfad: string): void {
  systempfade.add(kanonisch(pfad))
}

export function istLesefreigegeben(pfad: string): boolean {
  return leseFreigaben.has(kanonisch(pfad))
}

export function istSchreibfreigegeben(pfad: string): boolean {
  return schreibFreigaben.has(kanonisch(pfad))
}

/**
 * Gibt einen Pfad zum Schreiben frei — ausschliesslich fuer das Ergebnis eines
 * Speichern-Dialogs. Der Nutzer hat den Ort dort selbst benannt.
 */
export function gibSchreibfrei(pfad: string): void {
  schreibFreigaben.add(kanonisch(pfad))
}

/**
 * Die Pfade, die gerade in einem Tab offen sind (S6.1), kanonisch.
 *
 * Nicht dasselbe wie die Freigaben: freigegeben bleibt ein Pfad auch nach
 * dem Schliessen seines Tabs, offen ist er nur, solange ein Tab ihn zeigt.
 * Zwei Dinge haengen daran: ein erneutes Lesen eines offenen Pfads darf seine
 * Arbeitskopie nicht verwerfen (`lies`), und "Speichern unter" darf nicht in
 * die Datei eines anderen Tabs schreiben.
 */
const offenePfade = new Set<string>()

export function istOffen(pfad: string): boolean {
  return offenePfade.has(kanonisch(pfad))
}

/** Nach "Speichern unter": das Dokument lebt unter dem neuen Pfad weiter. */
export function merkeOffen(pfad: string): void {
  offenePfade.add(kanonisch(pfad))
}

/** Ein Tab wurde geschlossen (oder sein Dokument zog per "Speichern unter" um). */
export function vergissOffen(pfad: string): void {
  offenePfade.delete(kanonisch(pfad))
}

/** Nur fuer Tests: die Listen leeren, damit Faelle sich nicht beeinflussen. */
export function setzeFreigabenZurueck(): void {
  leseFreigaben.clear()
  schreibFreigaben.clear()
  systempfade.clear()
  offenePfade.clear()
}

/**
 * Liest die Datei vollstaendig und schliesst sie sofort wieder.
 *
 * ADR 0001, Punkt 4: ueber die Sitzung bleibt kein Handle offen. Ein gehaltenes
 * Handle blockiert unter Windows das Loeschen und Umbenennen der Datei durch
 * andere Prozesse — damit waere der Fall "Datei wird waehrend des Betrachtens
 * geloescht" aus S1.5 kaum ausloesbar und das atomare Speichern aus S2.3a
 * scheiterte mit EPERM.
 */
async function lies(pfad: string, mitSchreibrecht: boolean): Promise<GeoeffnetesDokument> {
  const voll = kanonisch(pfad)
  const inhalt = await readFile(voll)
  leseFreigaben.add(voll)
  if (mitSchreibrecht) schreibFreigaben.add(voll)
  // S6.1: ist der Pfad schon in einem Tab offen, gehoert seine Arbeitskopie
  // zu diesem Tab - ein erneutes Oeffnen (Drop, Zuletzt-Liste, zweite
  // Instanz) verloere sonst ungespeicherte Seitenoperationen. Dann sind ihre
  // Bytes der Stand, nicht die Platte: gespeichert wuerde ohnehin sie.
  // Sonst gilt wie bisher die Platte; eine Arbeitskopie gehoerte zu einem
  // frueheren, laengst geschlossenen Ladevorgang.
  if (offenePfade.has(voll)) {
    const kopie = arbeitskopie(voll)
    if (kopie !== undefined) return { pfad: voll, name: basename(voll), bytes: kopie }
  } else {
    vergissArbeitskopie(voll)
    offenePfade.add(voll)
  }
  return { pfad: voll, name: basename(voll), bytes: new Uint8Array(inhalt) }
}

/**
 * Mehrere PDFs waehlen (S4.2a, Zusammenfuehren). Jeder gewaehlte Pfad bekommt
 * das Leserecht - der Dialog ist die Wahl des Menschen. Kein Schreibrecht:
 * die Quellen werden nur gelesen, das Ergebnis geht an einen eigenen Ort.
 */
export async function waehleDokumente(fenster: BrowserWindow | null): Promise<string[] | null> {
  const optionen = {
    title: t('dialog.zusammenfuehren'),
    filters: [{ name: t('filter.pdf'), extensions: ['pdf'] }],
    properties: ['openFile' as const, 'multiSelections' as const]
  }
  const ergebnis =
    fenster === null
      ? await dialog.showOpenDialog(optionen)
      : await dialog.showOpenDialog(fenster, optionen)
  if (ergebnis.canceled || ergebnis.filePaths.length === 0) return null
  const pfade = ergebnis.filePaths.map(kanonisch)
  for (const pfad of pfade) leseFreigaben.add(pfad)
  return pfade
}

/**
 * Ein Zielverzeichnis waehlen (S4.2a, Teilen). Das Verzeichnis selbst steht in
 * keiner Liste - freigegeben werden die Dateien, die darin entstehen, mit
 * ihren berechneten Namen (`gibSchreibfrei` je Datei durch den Aufrufer).
 * So bleibt Invariante 11 eine Liste von Dateipfaden, keine von Ordnern.
 */
export async function waehleVerzeichnis(fenster: BrowserWindow | null): Promise<string | null> {
  const optionen = {
    title: t('dialog.teileOrdner'),
    properties: ['openDirectory' as const, 'createDirectory' as const]
  }
  const ergebnis =
    fenster === null
      ? await dialog.showOpenDialog(optionen)
      : await dialog.showOpenDialog(fenster, optionen)
  const [pfad] = ergebnis.filePaths
  if (ergebnis.canceled || pfad === undefined) return null
  return kanonisch(pfad)
}

export async function oeffneUeberDialog(
  fenster: BrowserWindow | null
): Promise<GeoeffnetesDokument | null> {
  const optionen = {
    title: t('dialog.oeffnen'),
    filters: [{ name: t('filter.pdf'), extensions: ['pdf'] }],
    properties: ['openFile' as const]
  }
  const ergebnis =
    fenster === null
      ? await dialog.showOpenDialog(optionen)
      : await dialog.showOpenDialog(fenster, optionen)

  const [pfad] = ergebnis.filePaths
  if (ergebnis.canceled || pfad === undefined) return null
  return lies(pfad, true)
}

/**
 * Ein Pfad aus der Befehlszeile. Er kommt vom Betriebssystem und traegt
 * deshalb das Schreibrecht mit.
 */
export async function oeffnePfad(pfad: string): Promise<GeoeffnetesDokument> {
  merkeSystempfad(pfad)
  return lies(pfad, true)
}

/**
 * Oeffnet einen Pfad, den nicht der Dateidialog geliefert hat — aus Drag &
 * Drop, aus "Oeffnen mit" oder aus der Liste der zuletzt geoeffneten
 * Dokumente.
 *
 * Der Renderer ist eine Sandbox fuer fremde Dokumente; was von dort kommt,
 * wird hier geprueft und nicht geglaubt. Jeder Fehlschlag nennt seinen Grund:
 * eine fallengelassene Textdatei soll eine Meldung ergeben und nicht ein
 * stilles Nichts.
 */
export interface LeseOptionen {
  /** Kennt der Main diesen (kanonischen) Pfad aus einer eigenen Liste? Dann keine Rueckfrage. */
  bekannt?: (voll: string) => boolean
  /**
   * Fragt den Nutzer vor dem Lesen eines Pfads, den der Main nicht kennt;
   * `netz` heisst: er liegt auf einem anderen Rechner. `false` bricht ab.
   * Ohne diese Funktion wird ein unbekannter lokaler Pfad ohne Rueckfrage
   * gelesen - der Weg fuer Tests; `ipc.ts` uebergibt sie immer.
   */
  bestaetige?: (voll: string, netz: boolean) => Promise<boolean>
}

export async function oeffnePfadGeprueft(
  pfad: unknown,
  optionen: LeseOptionen = {}
): Promise<OeffnenErgebnis> {
  if (typeof pfad !== 'string' || pfad.trim().length === 0) {
    return { ok: false, grund: t('pfad.keiner') }
  }
  if (extname(pfad).toLowerCase() !== '.pdf') {
    return { ok: false, grund: t('pfad.keinPdf', { name: basename(pfad) }) }
  }
  try {
    // Wohin zeigt der Pfad? Bevor irgendetwas gelesen wird, und an der
    // Zeichenkette: ein Netzwerkpfad (`\\server\freigabe`, auch als `/\server`)
    // brachte den Main-Prozess zu DNS und SMB/NTLM - die Content-Security-
    // Policy gilt nur im Renderer. Geraete- und Namensraumpfade (`\\.\`, `\\?\`,
    // `CON`) lehnen wir ganz ab.
    const klasse = pfadklasse(pfad)
    if (klasse === 'geraet') return { ok: false, grund: t('pfad.geraet') }
    const voll = kanonisch(pfad)
    // Kennt der Main-Prozess den Pfad? Dann hat ihn ein Mensch benannt: der
    // Dateidialog, die Befehlszeile, ein Systemereignis, die Zuletzt-Liste oder
    // die Sitzung (beide fuehrt der Main selbst, `bekannt`). Alles andere nennt
    // nur der Renderer - und der ist eine Sandbox fuer fremde Dokumente, die
    // jede PDF der Platte anfordern koennte. Dafuer fragt der Main nach, mit
    // einem Dialog, den der Renderer nicht anklicken kann (`bestaetige`).
    // Auch ein Pfad aus dem Speichern-Dialog ist bekannt (`schreibFreigaben`):
    // der Nutzer hat ihn dort selbst benannt. Das trifft jede Datei, die die
    // Anwendung gerade erzeugt hat (Zusammenfuehren, Teilen, Bilder zu PDF) und
    // danach selbst oeffnet - dafuer soll niemand "Diese Datei oeffnen?" lesen.
    const bekannt =
      systempfade.has(voll) ||
      leseFreigaben.has(voll) ||
      schreibFreigaben.has(voll) ||
      optionen.bekannt?.(voll) === true
    if (!bekannt) {
      if (optionen.bestaetige !== undefined) {
        if (!(await optionen.bestaetige(voll, klasse === 'netz'))) {
          return { ok: false, grund: t('pfad.abgebrochen'), abgebrochen: true }
        }
      } else if (klasse === 'netz') {
        // Ohne Rueckfrage-Weg bleibt ein unbekannter Netzwerkpfad draussen.
        return { ok: false, grund: t('pfad.netzwerk') }
      }
    }
    // Schreibrecht nur, wenn der Main-Prozess diesen Pfad selbst vom
    // Betriebssystem hat. Alles andere ist eine Angabe des Renderers.
    return { ok: true, dokument: await lies(pfad, systempfade.has(voll)) }
  } catch (fehler) {
    const code = (fehler as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: false, grund: t('pfad.nichtGefunden', { name: basename(pfad) }) }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, grund: t('pfad.keinZugriff', { name: basename(pfad) }) }
    }
    return {
      ok: false,
      grund: fehler instanceof Error ? fehler.message : t('pfad.unbekannt')
    }
  }
}

/**
 * Sucht den vom Nutzer uebergebenen Dokumentpfad in einer Argumentliste.
 *
 * In S0.2 empirisch festgestellt: die argv enthaelt nicht nur Nutzerargumente,
 * sondern auch von Electron angehaengte Schalter wie
 * `--allow-file-access-from-files` oder `--standard-schemes=app` sowie den Pfad
 * der ausfuehrbaren Datei. `argv[1]` oder das letzte Element blind zu nehmen
 * waere falsch.
 *
 * Als reine Funktion ausgelegt, damit genau das pruefbar ist.
 */
export function pdfPfadAusArgv(argv: readonly string[]): string | null {
  // Das erste Element ist die ausfuehrbare Datei, "." der Projektpfad im
  // Entwicklungsmodus.
  const kandidaten = argv
    .slice(1)
    .filter((wert) => !wert.startsWith('-') && wert !== '.')
    .filter((wert) => extname(wert).toLowerCase() === '.pdf')
  return kandidaten[0] ?? null
}
