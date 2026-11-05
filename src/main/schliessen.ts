import { basename, dirname } from 'node:path'
import { APP_NAME } from '../shared/app-info'
import { t } from '../shared/i18n'

/**
 * Die Warnung bei ungespeicherten Aenderungen (S2.3a, Aufgabe 5).
 *
 * Als eigenes Modul und nicht inline in index.ts, aus demselben Grund wie bei
 * menue.ts und window-options.ts: so ist die Regel ohne laufende Anwendung
 * pruefbar. Per E2E ginge es nicht — der Dialog ist modal und hielte den
 * Playwright-Lauf an.
 *
 * Die Reihenfolge ist die Aussage: `close` laesst sich nur **synchron**
 * aufhalten, also erst aufhalten, dann in Ruhe fragen, dann bei Bedarf noch
 * einmal schliessen — diesmal ohne Rueckfrage.
 */

/** Was von einem `BrowserWindow` gebraucht wird. Mehr nicht, damit es pruefbar bleibt. */
export interface SchliessbaresFenster {
  isDestroyed: () => boolean
  close: () => void
}

export interface SchliessUmgebung {
  /**
   * Der vom Renderer nachgefuehrte Stand: wie viele offene Dokumente
   * ungespeicherte Aenderungen haben (S6.1, je Tab eines).
   */
  anzahlAenderungen: () => number
  /**
   * Fragt nach; `true` heisst "verwerfen und schliessen". Die Anzahl geht
   * mit, damit die Frage sie nennen kann.
   */
  frage: (fenster: SchliessbaresFenster, anzahl: number, namen: string[]) => Promise<boolean>
  /**
   * Die Namen der Dokumente mit ungespeicherten Aenderungen (`anzeigeNamen`).
   * Wer viele Dokumente offen hat, sieht sonst nicht, in welchem er noch
   * speichern muss.
   */
  namen?: () => string[]
}

/**
 * Die Nachfrage, die der Main-Prozess stellt.
 *
 * Zwei Knoepfe und nicht drei: "Speichern" waere ein Rueckweg in den Renderer,
 * der den Aenderungssatz haelt — und das mitten im Schliessen. Wer sichern
 * will, bricht ab und drueckt Strg+S.
 */
export interface Rueckfrage {
  type: 'warning'
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

/** So viele Namen nennt die Rueckfrage; der Rest wird gezaehlt, damit der Dialog nicht ueberlaeuft. */
export const MAX_NAMEN = 10

/**
 * Die Namen der Dokumente mit ungespeicherten Aenderungen, wie die Rueckfrage
 * sie zeigt: der Dateiname, bei gleichen Namen mit dem Ordner dahinter - zwei
 * `bericht.pdf` aus verschiedenen Ordnern waeren sonst nicht zu unterscheiden.
 * Alphabetisch, damit die Reihenfolge nicht vom Zufall der Aenderungen abhaengt.
 */
export function anzeigeNamen(pfade: readonly string[]): string[] {
  const dateiname = (pfad: string): string => basename(pfad)
  const haeufigkeit = new Map<string, number>()
  for (const pfad of pfade) {
    const name = dateiname(pfad)
    haeufigkeit.set(name, (haeufigkeit.get(name) ?? 0) + 1)
  }
  return pfade
    .map((pfad) => {
      const name = dateiname(pfad)
      if ((haeufigkeit.get(name) ?? 0) < 2) return name
      const ordner = basename(dirname(pfad))
      return ordner.length > 0 ? name + ' (' + ordner + ')' : name
    })
    .sort((a, b) => a.localeCompare(b))
}

/** Die Namensliste im Text der Rueckfrage: ein Punkt je Dokument, der Rest gezaehlt. */
function nennDokumente(namen: readonly string[]): string {
  const gezeigt = namen
    .slice(0, MAX_NAMEN)
    .map((name) => '• ' + (name.length > MAX_TABNAME ? name.slice(0, MAX_TABNAME) + '...' : name))
  const weitere = namen.length - gezeigt.length
  if (weitere > 0) gezeigt.push(t('schliessen.weitere', { anzahl: weitere }))
  return gezeigt.join('\n')
}

/**
 * Die Frage beim Beenden. Seit S6.1 koennen mehrere Dokumente offen sein;
 * haben mehrere davon Aenderungen, nennt sie deren Zahl - "dieses Dokument"
 * waere dann eine Untertreibung dessen, was verloren geht. Bei einem bleibt
 * der Wortlaut wie vor S6.1.
 */
export function schliessFrage(anzahl: number, namen: readonly string[] = []): Rueckfrage {
  const mehrere = anzahl > 1
  const erklaerung = mehrere ? t('schliessen.mehrereDetail') : t('schliessen.einesDetail')
  return {
    type: 'warning',
    title: APP_NAME,
    message: mehrere ? t('schliessen.mehrere', { anzahl }) : t('schliessen.eines'),
    detail: namen.length === 0 ? erklaerung : erklaerung + '\n\n' + nennDokumente(namen),
    buttons: [t('schliessen.verwerfen'), t('knopf.abbrechen')],
    // Vorbelegt ist "Abbrechen": Arbeit zu verlieren soll niemandem aus
    // Versehen passieren.
    defaultId: 1,
    cancelId: 1
  }
}

/**
 * Laengster Dokumentname in der Tab-Rueckfrage. Der Name kommt vom Renderer;
 * eine Zeichenkette von Megabytes soll keinen Dialog sprengen.
 */
export const MAX_TABNAME = 255

/**
 * Die Frage beim Schliessen **eines** Tabs (S6.1). Dieselben Knoepfe und
 * dieselbe Vorbelegung wie beim Beenden - wer beides kennt, soll nicht
 * zweimal lernen muessen, welcher Knopf was tut. Der Name steht in der
 * Nachricht, weil der Tab nicht der aktive sein muss.
 */
export function tabSchliessFrage(name: string): Rueckfrage {
  const kurz = name.length > MAX_TABNAME ? name.slice(0, MAX_TABNAME) + '...' : name
  return {
    type: 'warning',
    title: APP_NAME,
    message: t('schliessen.tab', { name: kurz }),
    detail: t('schliessen.tabDetail'),
    buttons: [t('schliessen.verwerfen'), t('knopf.abbrechen')],
    defaultId: 1,
    cancelId: 1
  }
}

/**
 * Baut den `close`-Zuhoerer.
 *
 * Fenster, deren Schliessen bereits bestaetigt wurde, stehen in einem
 * `WeakSet` — ohne die Marke fragte der zweite Durchlauf erneut und das
 * Fenster liesse sich nie schliessen. Ein `WeakSet`, damit ein geschlossenes
 * Fenster nicht in einer Liste weiterlebt.
 */
export function baueSchliessWaechter(
  umgebung: SchliessUmgebung
): (fenster: SchliessbaresFenster, ereignis: { preventDefault: () => void }) => void {
  const bestaetigt = new WeakSet<SchliessbaresFenster>()

  return (fenster, ereignis) => {
    const anzahl = umgebung.anzahlAenderungen()
    if (anzahl === 0 || bestaetigt.has(fenster)) return
    ereignis.preventDefault()
    const namen = umgebung.namen?.() ?? []
    void umgebung.frage(fenster, anzahl, namen).then((verwerfen) => {
      if (!verwerfen || fenster.isDestroyed()) return
      bestaetigt.add(fenster)
      // Bewusst `close` und nicht `destroy`: `destroy` loest kein `close` aus,
      // und die Fenstergeometrie wuerde dann nicht mehr gesichert.
      fenster.close()
    })
  }
}
