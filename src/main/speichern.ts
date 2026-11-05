import { dialog, type BrowserWindow } from 'electron'
import { realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { gibSchreibfrei, istSchreibfreigegeben, kanonisch } from './dokument'
import { t } from '../shared/i18n'

// Der electron-freie Kern liegt seit S3.2 in schreibpfad.ts (Begruendung
// dort). Von hier weitergereicht, damit Aufrufer und Tests eine Adresse haben.
export * from './schreibpfad'

/**
 * Der Schreibpfad (S2.3a) — der erste Zugriff dieser Anwendung auf eine fremde
 * Datei mit Schreibabsicht.
 *
 * Drei Dinge liegen hier zusammen, weil sie einander bedingen:
 *
 * 1. **Die Pruefung des Zielpfads** (Invariante 11). Sie steht im
 *    Main-Prozess, weil nur er weiss, welche Pfade ein Mensch benannt hat.
 * 2. **Das Anwenden der Aenderungen** mit pdf-lib, auf der neu gelesenen
 *    Originaldatei (ADR 0001, Punkt 3): der Renderer schickt nur, was sich
 *    geaendert hat, alles Uebrige bleibt so stehen, wie es war.
 * 3. **Das atomare Schreiben.** Temporaere Nachbardatei, dann Umbenennen.
 *
 * **D7 ist ein Sachzwang, keine Wahl:** pdf-lib kann nicht inkrementell
 * speichern. `save()` serialisiert immer vollstaendig neu, schreibt damit
 * Producer und ModDate um und macht vorhandene digitale Signaturen ungueltig.
 * Daher die nicht abschaltbare Warnung in `bestaetigeSignatur`.
 */

/** Endung der temporaeren Datei. Sie liegt im selben Verzeichnis wie das Ziel. */
export const TEMP_ENDUNG = '.paperlane-tmp'

export type Zielpruefung = { ok: true; pfad: string } | { ok: false; grund: string }

export interface PruefOptionen {
  /**
   * Aufloesung von Verknuepfungen. Einspritzbar, weil sich Symlinks unter
   * Windows nur mit erhoehten Rechten anlegen lassen — der Guard-Test soll den
   * Fall trotzdem pruefen koennen.
   */
  echterPfad?: (pfad: string) => Promise<string>
  /**
   * Erwartete Endung, Vorgabe `.pdf`; der PNG-Export (S4.2b) verlangt `.png`,
   * PDF nach Word (S6.7) `.docx`.
   */
  endung?: '.pdf' | '.png' | '.docx'
}

/**
 * Invariante 11: darf in diesen Pfad geschrieben werden?
 *
 * Der Vergleich laeuft ueber den **aufgeloesten** Pfad gegen eine Allowlist.
 * Das erledigt `..` und UNC-Pfade nebenbei: `C:\erlaubt\..\woanders\x.pdf`
 * loest sich zu `C:\woanders\x.pdf` auf und steht dort nicht.
 *
 * Verknuepfungen bekommen einen eigenen Schritt. Ein freigegebener Pfad kann
 * nachtraeglich durch einen Symlink ersetzt worden sein; dann zeigt der Name
 * weiter auf das Erlaubte, das Schreiben aber woandershin. Geschrieben wird
 * nur, wenn auch das Ziel der Verknuepfung freigegeben ist.
 */
export async function pruefeSchreibziel(
  pfad: unknown,
  optionen: PruefOptionen = {}
): Promise<Zielpruefung> {
  if (typeof pfad !== 'string' || pfad.trim().length === 0) {
    return { ok: false, grund: t('ziel.keinPfad') }
  }
  const endung = optionen.endung ?? '.pdf'
  if (extname(pfad).toLowerCase() !== endung) {
    return {
      ok: false,
      grund: t('ziel.endung', { endung: endung.slice(1).toUpperCase(), name: basename(pfad) })
    }
  }

  // Kanonisch, nicht nur aufgeloest: die Freigabeliste fuehrt Langformen,
  // und `realpath` unten liefert Langformen. Ein Kurzname (`RUNNER~1`)
  // an dieser Stelle liesse den Symlink-Vergleich fuer dieselbe Datei
  // anschlagen (siehe `kanonisch`).
  const voll = kanonisch(pfad)
  if (!istSchreibfreigegeben(voll)) {
    return {
      ok: false,
      grund: t('ziel.keineFreigabe', { name: basename(voll) })
    }
  }

  const aufloesen = optionen.echterPfad ?? realpath
  try {
    const echt = resolve(await aufloesen(voll))
    if (echt !== voll && !istSchreibfreigegeben(echt)) {
      return {
        ok: false,
        grund: t('ziel.andereDatei')
      }
    }
  } catch {
    // Die Datei gibt es noch nicht - der Normalfall bei "Speichern unter".
    // Dann gibt es auch keine Verknuepfung, die taeuschen koennte.
  }

  return { ok: true, pfad: voll }
}

/**
 * Schreibt atomar: erst in eine Nachbardatei, dann umbenennen.
 *
 * Dasselbe Muster wie beim Einstellungs-Store, aus demselben Grund: ein
 * Abbruch mitten im Schreiben laesst die alte Datei unversehrt, statt eine
 * halb geschriebene zu hinterlassen. Die temporaere Datei liegt im selben
 * Verzeichnis — ein Umbenennen ueber Laufwerksgrenzen hinweg scheitert unter
 * Windows.
 *
 * Zum Zeitpunkt des Umbenennens haelt diese Anwendung **kein** Handle auf die
 * Zieldatei: gelesen wird mit `readFile`, geschrieben mit `writeFile`, beide
 * schliessen sofort. Die Dateiwache aus S1.5 beendet die Aufrufstelle vorher,
 * sonst scheitert das Umbenennen unter Windows mit EPERM.
 */
export async function speichereAtomar(ziel: string, bytes: Uint8Array): Promise<void> {
  const temp = join(dirname(ziel), basename(ziel) + TEMP_ENDUNG)
  await writeFile(temp, bytes)
  try {
    await rename(temp, ziel)
  } catch (fehler) {
    // Die halbe Datei nicht liegen lassen. Scheitert auch das, bleibt sie —
    // die Originaldatei ist in jedem Fall unversehrt.
    await unlink(temp).catch(() => undefined)
    throw fehler
  }
}

/**
 * Fragt nach dem Zielpfad und gibt ihn zum Schreiben frei.
 *
 * Der Dialog **ist** die Freigabe: einen anderen Weg, einen Pfad in die
 * Schreib-Allowlist zu bekommen, gibt es nicht.
 */
export interface Zielart {
  titel: string
  filter: { name: string; extensions: string[] }
}

/** Die beiden Arten von Ziel, nach denen gefragt wird. */
// Getter statt Werte (S6.8): die Texte entstehen erst beim Fragen, in der
// dann aktiven Sprache.
export const ZIEL_PDF: Zielart = {
  get titel() {
    return t('dialog.speichernUnter')
  },
  get filter() {
    return { name: t('filter.pdf'), extensions: ['pdf'] }
  }
}
export const ZIEL_FDF: Zielart = {
  get titel() {
    return t('dialog.fdf')
  },
  get filter() {
    return { name: t('filter.fdf'), extensions: ['fdf'] }
  }
}
export const ZIEL_PNG: Zielart = {
  get titel() {
    return t('dialog.png')
  },
  get filter() {
    return { name: t('filter.png'), extensions: ['png'] }
  }
}

export async function frageZielpfad(
  fenster: BrowserWindow | null,
  vorschlag: string,
  art: Zielart = ZIEL_PDF
): Promise<string | null> {
  const optionen = {
    title: art.titel,
    defaultPath: vorschlag,
    filters: [art.filter]
  }
  const ergebnis =
    fenster === null
      ? await dialog.showSaveDialog(optionen)
      : await dialog.showSaveDialog(fenster, optionen)
  if (ergebnis.canceled || ergebnis.filePath === undefined) return null
  const voll = kanonisch(ergebnis.filePath)
  gibSchreibfrei(voll)
  return voll
}

/**
 * Die Rueckfrage, bevor ein Dokument mit veraenderten Seiten das Original
 * ueberschreibt (S4.1, Aufgabe 4). Geloeschte oder umsortierte Seiten sind
 * nach dem Schreiben nicht mehr in der Datei - "Speichern unter" ist der
 * Weg, das Original zu behalten. Vorgabe ist "Abbrechen".
 */
export async function bestaetigeUeberschreiben(fenster: BrowserWindow | null): Promise<boolean> {
  const frage = {
    type: 'warning' as const,
    title: t('ueberschreiben.titel'),
    message: t('ueberschreiben.frage'),
    detail: t('ueberschreiben.detail'),
    buttons: [t('ueberschreiben.knopf'), t('knopf.abbrechen')],
    defaultId: 1,
    cancelId: 1
  }
  const { response } =
    fenster === null
      ? await dialog.showMessageBox(frage)
      : await dialog.showMessageBox(fenster, frage)
  return response === 0
}

/**
 * Die Rueckfrage, bevor berechnete Dateinamen in einem gewaehlten Ordner
 * vorhandene Dateien ueberschreiben (Teilen S4.2a, PNG-Export S4.2b). Der
 * Ordner-Dialog fragt das nicht selbst - anders als der Speichern-Dialog,
 * der es fuer seine eine Datei tut. Vorgabe ist "Abbrechen".
 */
export async function bestaetigeDateienUeberschreiben(
  fenster: BrowserWindow | null,
  vorhanden: readonly string[]
): Promise<boolean> {
  if (vorhanden.length === 0) return true
  const frage = {
    type: 'warning' as const,
    title: t('dateien.titel'),
    message: t('dateien.frage', { anzahl: vorhanden.length }),
    detail: vorhanden.map((z) => basename(z)).join('\n'),
    buttons: [t('dateien.knopf'), t('knopf.abbrechen')],
    defaultId: 1,
    cancelId: 1
  }
  const { response } =
    fenster === null
      ? await dialog.showMessageBox(frage)
      : await dialog.showMessageBox(fenster, frage)
  return response === 0
}

/**
 * Die Warnung vor dem Flachlegen (S3.2, Aufgabe 2).
 *
 * Nicht abschaltbar, mit "Abbrechen" vorbelegt, und der Text sagt, was
 * verloren geht: das Formular als Formular. Wer danach etwas aendern will,
 * kann es nicht mehr.
 */
export async function bestaetigeFlachlegen(fenster: BrowserWindow | null): Promise<boolean> {
  const frage = {
    type: 'warning' as const,
    title: t('flach.titel'),
    message: t('flach.frage'),
    detail: t('flach.detail'),
    buttons: [t('flach.knopf'), t('knopf.abbrechen')],
    defaultId: 1,
    cancelId: 1
  }
  const { response } =
    fenster === null
      ? await dialog.showMessageBox(frage)
      : await dialog.showMessageBox(fenster, frage)
  return response === 0
}

/**
 * Die Signaturwarnung (Aufgabe 3).
 *
 * **Nicht abschaltbar** und mit "Abbrechen" vorbelegt: D7 macht jede
 * vorhandene Signatur ungueltig, und das ist nichts, was jemand aus Versehen
 * tun sollte.
 */
export async function bestaetigeSignatur(fenster: BrowserWindow | null): Promise<boolean> {
  const frage = {
    type: 'warning' as const,
    title: t('signaturen.titel'),
    message: t('signaturen.frage'),
    detail: t('signaturen.detail'),
    buttons: [t('signaturen.knopf'), t('knopf.abbrechen')],
    defaultId: 1,
    cancelId: 1
  }
  const { response } =
    fenster === null
      ? await dialog.showMessageBox(frage)
      : await dialog.showMessageBox(fenster, frage)
  return response === 0
}
