/**
 * Dokument-Mutationen (S4.0, S4.1): Aenderungen an der **Struktur** eines
 * Dokuments — Seiten loeschen, dauerhaft drehen, neu anordnen.
 *
 * Warum ein eigener Begriff neben den Anmerkungen aus Phase 2: eine Anmerkung
 * ist ein Eintrag in einer Liste, die der Renderer selbst fuehrt; eine
 * Mutation veraendert das Dokument, das pdf.js geladen hat — und **das laesst
 * sich nicht veraendern.** pdf.js liest, pdf-lib schreibt, und beide teilen
 * kein Objektmodell. Jede Mutation heisst deshalb: der Main serialisiert mit
 * pdf-lib neu, der Renderer laedt die neuen Bytes und wirft alles weg, was er
 * ueber das alte Dokument wusste. Diese Mechanik ist einmal gebaut und
 * gemessen (`test/perf`), bevor ein Werkzeug sie benutzt.
 *
 * Seitennummern sind durchgaengig **einsbasiert** und beziehen sich auf das
 * Dokument **vor** der Mutation.
 */

import { MAX_ZEILENTEXT, pruefeTextZeile, type TextZeile } from './textzeilen'
import { t } from './i18n'

export type Drehung = 90 | 180 | 270

export type Mutation =
  /** Eine oder mehrere Seiten loeschen. Mindestens eine bleibt. */
  | { art: 'seitenLoeschen'; seiten: readonly number[] }
  /**
   * Seiten **dauerhaft** drehen (`/Rotate` der Seite) — im Unterschied zur
   * Ansichtsdrehung aus S1.2, die nur die Darstellung betrifft und nichts in
   * die Datei schreibt.
   */
  | { art: 'seitenDrehen'; seiten: readonly number[]; grad: Drehung }
  /**
   * Neue Reihenfolge: `reihenfolge[i]` ist die alte Nummer der Seite, die
   * danach an Position `i + 1` steht. Eine Permutation von `1..n`.
   */
  | { art: 'seitenAnordnen'; reihenfolge: readonly number[] }
  /**
   * Seiten zuschneiden (S6.3, D21): die `/CropBox` je Seite setzen. Der
   * Inhalt ausserhalb bleibt in der Datei — das ist kein Schwaerzen.
   */
  | { art: 'seitenZuschneiden'; zuschnitte: readonly Zuschnitt[] }
  /**
   * Vorhandenen Text aendern (S6.6b, ADR 0005): genau **eine Zeile** auf
   * `seite` loeschen (`text` leer) oder durch `text` ersetzen - ohne
   * Umbruch. `zeile` ist die Zeile, wie der Renderer sie aus pdf.js bildet;
   * der Main findet ihre Glyphen im Content-Stream wieder.
   */
  | { art: 'textErsetzen'; seite: number; zeile: TextZeile; text: string }

/**
 * Was eine `textErsetzen`-Mutation getan hat (S6.6b): mit der
 * Originalschrift gesetzt, mit der Ersatzschrift (D22, sichtbar zu
 * markieren) oder nur geloescht.
 */
export interface TextBericht {
  schrift: 'original' | 'ersatz' | 'keine'
  /** Standard-14-Name der Ersatzschrift. */
  ersatzschrift?: string
  /** Warum die Originalschrift nicht reichte. */
  grund?: string
}

/**
 * Ein Rechteck in PDF-Benutzerkoordinaten `[x1, y1, x2, y2]`, sortiert
 * (`x1 < x2`, `y1 < y2`) — dieselbe Form wie `/CropBox`.
 */
export type Kasten = readonly [number, number, number, number]

/**
 * Der Zuschnitt einer Seite. `rahmen: null` heisst "Zuschnitt aufheben": die
 * CropBox wird wieder gleich der MediaBox. Ein Rahmen je Seite und nicht ein
 * gemeinsamer, weil Seiten unterschiedlich gross und gedreht sein koennen —
 * der Renderer rechnet die sichtbaren Raender fuer jede Seite einzeln um.
 */
export interface Zuschnitt {
  seite: number
  rahmen: Kasten | null
}

function istKasten(wert: unknown): wert is [number, number, number, number] {
  return (
    Array.isArray(wert) &&
    wert.length === 4 &&
    wert.every((z) => typeof z === 'number' && Number.isFinite(z)) &&
    (wert[0] as number) < (wert[2] as number) &&
    (wert[1] as number) < (wert[3] as number)
  )
}

function pruefeZuschnitte(wert: unknown): Zuschnitt[] | null {
  if (!Array.isArray(wert) || wert.length === 0) return null
  const zuschnitte: Zuschnitt[] = []
  for (const eintrag of wert) {
    if (typeof eintrag !== 'object' || eintrag === null) return null
    const { seite, rahmen } = eintrag as Record<string, unknown>
    if (typeof seite !== 'number') return null
    if (rahmen !== null && !istKasten(rahmen)) return null
    zuschnitte.push({ seite, rahmen })
  }
  return istSeitenliste(zuschnitte.map((z) => z.seite)) ? zuschnitte : null
}

function istSeitenliste(wert: unknown): wert is number[] {
  return (
    Array.isArray(wert) &&
    wert.length > 0 &&
    wert.every((s) => typeof s === 'number' && Number.isInteger(s) && s >= 1) &&
    new Set(wert).size === wert.length
  )
}

/**
 * Prueft eine Mutation aus dem Renderer. Der Renderer ist eine Sandbox fuer
 * fremde Dokumente; seine Nachrichten sind Eingabe, nicht Wahrheit. Was hier
 * nicht pruefbar ist (gibt es Seite 12?), prueft der Main am Dokument.
 */
export function pruefeMutation(eingabe: unknown): Mutation | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  switch (wert['art']) {
    case 'seitenLoeschen':
      return istSeitenliste(wert['seiten'])
        ? { art: 'seitenLoeschen', seiten: wert['seiten'] }
        : null
    case 'seitenDrehen': {
      const grad = wert['grad']
      if (grad !== 90 && grad !== 180 && grad !== 270) return null
      return istSeitenliste(wert['seiten'])
        ? { art: 'seitenDrehen', seiten: wert['seiten'], grad }
        : null
    }
    case 'seitenAnordnen':
      return istSeitenliste(wert['reihenfolge'])
        ? { art: 'seitenAnordnen', reihenfolge: wert['reihenfolge'] }
        : null
    case 'seitenZuschneiden': {
      const zuschnitte = pruefeZuschnitte(wert['zuschnitte'])
      return zuschnitte === null ? null : { art: 'seitenZuschneiden', zuschnitte }
    }
    case 'textErsetzen': {
      const { seite, text } = wert
      const zeile = pruefeTextZeile(wert['zeile'])
      if (zeile === null || !istSeitenliste([seite])) return null
      if (typeof text !== 'string' || text.length > MAX_ZEILENTEXT) return null
      // Eine Zeile, kein Absatz: Steuerzeichen (auch Umbrueche) sind kein Text.
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c < 32 || c === 127) return null
      }
      return { art: 'textErsetzen', seite: seite as number, zeile, text }
    }
    default:
      return null
  }
}

/** Kurzer Text fuer Fortschrittsanzeige, Hinweis und Historie. */
export function beschreibeMutation(mutation: Mutation): string {
  switch (mutation.art) {
    case 'seitenLoeschen':
      return t('mutation.seiteLoeschen', {
        anzahl: mutation.seiten.length,
        seite: mutation.seiten[0] ?? ''
      })
    case 'seitenDrehen':
      return t('mutation.seitenDrehen', {
        anzahl: mutation.seiten.length,
        seite: mutation.seiten[0] ?? '',
        grad: mutation.grad
      })
    case 'seitenAnordnen':
      return t('mutation.anordnen')
    case 'seitenZuschneiden': {
      const { zuschnitte } = mutation
      const aufheben = zuschnitte.every((z) => z.rahmen === null)
      const werte = { anzahl: zuschnitte.length, seite: zuschnitte[0]?.seite ?? '' }
      return aufheben ? t('mutation.zuschnittAufheben', werte) : t('mutation.zuschneiden', werte)
    }
    case 'textErsetzen':
      return mutation.text.trim() === ''
        ? t('mutation.zeileLoeschen', { seite: mutation.seite })
        : t('mutation.zeileErsetzen', { seite: mutation.seite })
  }
}

/**
 * Hinweis nach dem Anwenden (S6.6b): welche Schrift benutzt wurde. Die
 * Ersatzschrift ist **sichtbar** zu markieren (ADR 0005, Punkt 4) - dieser
 * Text steht im Hinweis und im Historieneintrag.
 */
export function beschreibeBericht(bericht: TextBericht): string {
  if (bericht.schrift === 'original') return t('bericht.original')
  if (bericht.schrift === 'keine') return t('bericht.keine')
  const schrift = bericht.ersatzschrift ?? ''
  return bericht.grund === undefined
    ? t('bericht.ersatz', { schrift })
    : t('bericht.ersatzGrund', { schrift, grund: bericht.grund })
}

/** Die Seitenzahl nach der Mutation. */
export function seitenzahlNach(seitenzahl: number, mutation: Mutation): number {
  return mutation.art === 'seitenLoeschen' ? seitenzahl - mutation.seiten.length : seitenzahl
}

/**
 * Auf welcher Seite die Ansicht nach der Mutation stehen soll, wenn sie
 * vorher auf `aktuell` stand.
 *
 * Loeschen: jede geloeschte Seite davor rueckt die Zaehlung um eins vor; die
 * aktuelle selbst geloescht heisst die Seite, die an ihre Stelle rueckt —
 * oder die letzte. Anordnen: die aktuelle Seite folgt an ihren neuen Platz.
 * Reine Funktion, damit die Faelle ohne laufende Anwendung pruefbar sind.
 */
export function seiteNachMutation(
  aktuell: number,
  mutation: Mutation,
  seitenzahlNeu: number
): number {
  if (seitenzahlNeu < 1) return 1
  let ziel = aktuell
  if (mutation.art === 'seitenLoeschen') {
    ziel = aktuell - mutation.seiten.filter((s) => s < aktuell).length
  } else if (mutation.art === 'seitenAnordnen') {
    const platz = mutation.reihenfolge.indexOf(aktuell)
    if (platz >= 0) ziel = platz + 1
  }
  return Math.min(Math.max(1, ziel), seitenzahlNeu)
}

/**
 * Die Reihenfolge, die entsteht, wenn `bewegte` Seiten **vor** die Seite
 * `vor` geschoben werden (`vor === seitenzahl + 1` heisst: ans Ende). Fuer
 * Drag & Drop in der Miniaturenleiste; hier, weil es reine Arithmetik ist.
 * Liefert `null`, wenn sich nichts aendert.
 */
export function reihenfolgeNachVerschieben(
  seitenzahl: number,
  bewegte: readonly number[],
  vor: number
): number[] | null {
  const bewegt = new Set(bewegte)
  const rest: number[] = []
  for (let s = 1; s <= seitenzahl; s++) if (!bewegt.has(s)) rest.push(s)
  // Die Zielposition unter den verbleibenden Seiten: wie viele davon liegen vor `vor`.
  const einfuegen = rest.filter((s) => s < vor).length
  const sortiert = [...bewegt].sort((a, b) => a - b)
  const neu = [...rest.slice(0, einfuegen), ...sortiert, ...rest.slice(einfuegen)]
  const unveraendert = neu.every((s, i) => s === i + 1)
  return unveraendert ? null : neu
}
