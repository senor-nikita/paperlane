import type { PdfRechteck } from './annotations'
import { t } from './i18n'

/**
 * Formularfelder (S3.1) — das interne Modell, unabhaengig von pdf.js.
 *
 * Formularfelder sind Widget-Annotationen, aber sie sind **nicht** das, was
 * das Annotationsmodell aus S2.1 beschreibt: sie haben einen Wert, keine
 * Farbe; sie gehoeren zu einem Feld, das mehrere Widgets haben kann (eine
 * Auswahlknopf-Gruppe); und sie werden nicht vom Nutzer angelegt, sondern nur
 * ausgefuellt. Deshalb ein eigenes Modell und ein eigener Store — S3.2
 * schreibt Werte nach **Feldnamen**, nicht nach Annotations-Kennung.
 *
 * Liegt in `shared`, weil der Main-Prozess in S3.2 dieselben Typen braucht.
 */

export type Feldart =
  | 'text'
  | 'kontrollkaestchen'
  | 'auswahlknopf'
  | 'auswahlliste'
  | 'schaltflaeche'
  | 'signatur'
  | 'unbekannt'

/** Eine Option einer Auswahlliste: was gespeichert wird und was der Leser sieht. */
export interface Auswahloption {
  export: string
  anzeige: string
}

/**
 * Was ein Feld an Format verlangt — **erkannt, nicht ausgefuehrt.**
 *
 * Die PDF-Spezifikation kennt keine deklarative Zahl- oder Datumsangabe fuer
 * Textfelder. Formularwerkzeuge legen dafuer JavaScript-Aktionen an, fast immer
 * dieselben AF-Standardaufrufe (`AFNumber_Format`, `AFDate_FormatEx`, ...). Diese Aufrufe
 * werden hier per Muster wiedererkannt und in eine deklarative Pruefung
 * uebersetzt. Alles andere ist `skript`: nicht pruefbar, und der Leser
 * erfaehrt, dass hier etwas nicht ausgefuehrt wird (Invariante 6).
 */
export type Format =
  { art: 'zahl'; nachkommastellen: number } | { art: 'datum'; muster: string } | { art: 'skript' }

/** Der Wert eines Feldes — je Art eine Form. */
export type Feldwert = string | boolean | readonly string[]

export interface Formularfeld {
  /** Kennung des Widgets, wie pdf.js sie vergibt (`"11R"`). */
  id: string
  /** Vollstaendiger Feldname (`"person.name"`). Gruppen teilen ihn. */
  name: string
  art: Feldart
  seite: number
  rect: PdfRechteck
  schreibgeschuetzt: boolean
  pflicht: boolean
  versteckt: boolean
  /** Text: `null` ohne Begrenzung (`/MaxLen 0`). */
  maxLaenge: number | null
  mehrzeilig: boolean
  passwort: boolean
  /**
   * Kontrollkaestchen und Auswahlknopf: der An-Zustand **dieses** Widgets
   * (`/AS`-Name, z. B. `"Yes"` oder `"frau"`). Der Feldwert ist der
   * An-Zustand des gewaehlten Widgets oder `"Off"`.
   */
  exportwert: string | null
  /** Auswahlliste. */
  optionen: readonly Auswahloption[]
  /** Kombinationsfeld (Dropdown) statt Listenfeld. */
  kombiniert: boolean
  mehrfach: boolean
  format: Format | null
  /** Der Wert, wie er beim Lesen im Dokument stand. */
  ausgangswert: Feldwert
  /** `/TU` — die Beschreibung fuer Hilfsmittel und als Titel. */
  hilfetext: string | null
}

/** `/Off` ist der eine Zustand, den jedes Kontrollkaestchen und jede Gruppe kennt. */
export const AUS = 'Off'

/**
 * Erkennt die AF-Standardformatskripte, wie Formularwerkzeuge sie anlegen.
 *
 * Geprueft wird jedes Skript aus `Format`, `Keystroke` und `Validate`. Sobald
 * eines nicht zu den bekannten Aufrufen passt, gilt das ganze Feld als
 * `skript` — halb ausgefuehrte Regeln waeren schlimmer als gar keine.
 */
export function erkenneFormat(skripte: readonly string[]): Format | null {
  if (skripte.length === 0) return null
  let erkannt: Format | null = null
  for (const skript of skripte) {
    const zahl = /^AF(?:Number|Percent)_(?:Format|Keystroke)\(\s*(\d+)/.exec(skript)
    if (zahl !== null) {
      erkannt ??= { art: 'zahl', nachkommastellen: Number(zahl[1]) }
      continue
    }
    const datum = /^AFDate_(?:Format|Keystroke)Ex\(\s*["']([^"']+)["']/.exec(skript)
    if (datum !== null) {
      erkannt ??= { art: 'datum', muster: datum[1] ?? '' }
      continue
    }
    // Der numerische Kurzaufruf `AFDate_Format(2)` waehlt aus einer Tabelle;
    // ohne die Tabelle bleibt nur die Aussage "ein Datum".
    if (/^AFDate_(?:Format|Keystroke)\(/.test(skript)) {
      erkannt ??= { art: 'datum', muster: 'dd.mm.yyyy' }
      continue
    }
    return { art: 'skript' }
  }
  return erkannt
}

/** Das Datumsmuster der AF-Skripte (`dd.mm.yyyy`) als regulaerer Ausdruck. */
export function datumsmuster(muster: string): RegExp {
  let quelle = ''
  for (const teil of muster.match(/d+|m+|y+|H+|M+|s+|[^dmyHMs]+/g) ?? []) {
    const erstes = teil[0] ?? ''
    if ('dmyHMs'.includes(erstes)) {
      // `d` erlaubt ein oder zwei Ziffern, `dd` genau zwei, `yyyy` genau vier.
      quelle += teil.length === 1 ? '\\d{1,2}' : '\\d{' + String(teil.length) + '}'
    } else {
      quelle += teil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp('^' + quelle + '$')
}

/** Ein Wert ist leer, wenn nichts, nur Leerraum oder `/Off` darin steht. */
export function istLeer(wert: Feldwert): boolean {
  if (typeof wert === 'boolean') return !wert
  if (typeof wert === 'string') return wert.trim().length === 0 || wert === AUS
  return wert.length === 0
}

/**
 * Deklarative Pruefung eines Wertes gegen die Regeln seines Feldes.
 *
 * `null` heisst "in Ordnung". Ein `skript`-Format ergibt **kein** Urteil: was
 * das Skript pruefen wuerde, weiss niemand — die Ebene zeigt dafuer den
 * Hinweis, dass es nicht ausgefuehrt wird.
 */
export function pruefeWert(feld: Formularfeld, wert: Feldwert): string | null {
  if (feld.pflicht && istLeer(wert)) return t('formular.pflicht')
  if (typeof wert !== 'string') return null
  if (feld.maxLaenge !== null && wert.length > feld.maxLaenge) {
    return t('formular.hoechstens', { anzahl: feld.maxLaenge })
  }
  if (feld.format === null || wert.trim().length === 0) return null
  if (feld.format.art === 'zahl') {
    // Komma und Punkt als Dezimaltrenner: das Formular kommt meist aus einem
    // englischsprachigen Werkzeug, der Leser aus dem deutschen Sprachraum.
    return /^-?\d+(?:[.,]\d+)?$/.test(wert.trim()) ? null : t('formular.zahl')
  }
  if (feld.format.art === 'datum') {
    return datumsmuster(feld.format.muster).test(wert.trim())
      ? null
      : t('formular.datum', { muster: feld.format.muster })
  }
  return null
}

/**
 * Ob zwei Werte gleich sind. Listen werden inhaltlich verglichen, nicht ueber
 * ihre Identitaet — sonst zaehlte jede neue Auswahl als Aenderung.
 */
export function wertGleich(a: Feldwert, b: Feldwert): boolean {
  if (typeof a === 'string' || typeof a === 'boolean') return a === b
  if (typeof b === 'string' || typeof b === 'boolean') return false
  return a.length === b.length && a.every((eintrag, i) => eintrag === b[i])
}
