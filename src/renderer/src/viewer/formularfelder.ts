import type { PdfRechteck } from '../../../shared/annotations'
import {
  AUS,
  erkenneFormat,
  type Auswahloption,
  type Feldart,
  type Feldwert,
  type Formularfeld
} from '../../../shared/formulare'

/**
 * Widget-Annotationen von pdf.js als Formularfelder (S3.1).
 *
 * Dasselbe Muster wie `annotationen.ts`: pdf.js liefert lose getypte
 * Datensaetze, und hier wird daraus das interne Modell — jedes Feld einzeln
 * geprueft, nichts geglaubt. Ein Datensatz ohne Rechteck oder ohne Feldnamen
 * ergibt `null`: ohne Ort gibt es nichts zu zeichnen, ohne Namen nichts zu
 * speichern.
 */

/** Die Ereignisse, deren Skripte ueber das Format eines Feldes entscheiden. */
const FORMAT_EREIGNISSE = ['Format', 'Keystroke', 'Validate'] as const

function zeichenkette(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

function rechteck(wert: unknown): PdfRechteck | null {
  if (!Array.isArray(wert) || wert.length !== 4) return null
  const zahlen = wert.map((eintrag: unknown) => (typeof eintrag === 'number' ? eintrag : NaN))
  if (zahlen.some((zahl) => !Number.isFinite(zahl))) return null
  const [a = 0, b = 0, c = 0, d = 0] = zahlen
  return [a, b, c, d]
}

function art(daten: Record<string, unknown>): Feldart {
  switch (daten['fieldType']) {
    case 'Tx':
      return 'text'
    case 'Btn':
      if (daten['pushButton'] === true) return 'schaltflaeche'
      return daten['radioButton'] === true ? 'auswahlknopf' : 'kontrollkaestchen'
    case 'Ch':
      return 'auswahlliste'
    case 'Sig':
      return 'signatur'
    default:
      return 'unbekannt'
  }
}

function optionen(wert: unknown): Auswahloption[] {
  if (!Array.isArray(wert)) return []
  const liste: Auswahloption[] = []
  for (const eintrag of wert as unknown[]) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const werte = eintrag as Record<string, unknown>
    const exportwert = zeichenkette(werte['exportValue'])
    const anzeige = zeichenkette(werte['displayValue'])
    liste.push({ export: exportwert, anzeige: anzeige.length > 0 ? anzeige : exportwert })
  }
  return liste
}

/**
 * Die Skripte aus `/AA`, so wie pdf.js sie einsammelt: eine `Map` von
 * Ereignisname auf Liste von Quelltexten. Nur gelesen, nie ausgefuehrt.
 */
function skripte(wert: unknown): string[] {
  if (!(wert instanceof Map)) return []
  const gesammelt: string[] = []
  for (const ereignis of FORMAT_EREIGNISSE) {
    const liste: unknown = wert.get(ereignis)
    if (!Array.isArray(liste)) continue
    for (const quelltext of liste as unknown[]) {
      if (typeof quelltext === 'string') gesammelt.push(quelltext)
    }
  }
  return gesammelt
}

/**
 * Der Feldwert in der Form, die das Modell fuer diese Feldart erwartet.
 *
 * - Text: die Zeichenkette.
 * - Kontrollkaestchen: `true`, wenn der Feldwert der An-Zustand des Widgets ist.
 * - Auswahlknopf: der An-Zustand des gewaehlten Widgets der Gruppe, sonst `Off`.
 * - Auswahlliste: die gewaehlten Exportwerte — pdf.js liefert ein Feld, auch
 *   bei Einfachauswahl.
 */
function wert(
  daten: Record<string, unknown>,
  feldart: Feldart,
  exportwert: string | null
): Feldwert {
  const roh = daten['fieldValue']
  switch (feldart) {
    case 'kontrollkaestchen':
      return typeof roh === 'string' && roh !== AUS && roh === exportwert
    case 'auswahlknopf':
      return typeof roh === 'string' && roh.length > 0 ? roh : AUS
    case 'auswahlliste':
      if (Array.isArray(roh)) return roh.filter((e): e is string => typeof e === 'string')
      return typeof roh === 'string' && roh.length > 0 ? [roh] : []
    default:
      return typeof roh === 'string' ? roh : ''
  }
}

export function wandleFeld(roh: unknown, seite: number): Formularfeld | null {
  if (typeof roh !== 'object' || roh === null) return null
  const daten = roh as Record<string, unknown>
  if (daten['subtype'] !== 'Widget') return null
  const rect = rechteck(daten['rect'])
  const name = zeichenkette(daten['fieldName'])
  if (rect === null || name.length === 0) return null

  const feldart = art(daten)
  // Bei Kontrollkaestchen heisst der An-Zustand `exportValue`, bei
  // Auswahlknoepfen `buttonValue` - pdf.js benennt beide verschieden.
  let exportwert: string | null = null
  if (feldart === 'kontrollkaestchen') exportwert = zeichenkette(daten['exportValue']) || 'Yes'
  if (feldart === 'auswahlknopf') exportwert = zeichenkette(daten['buttonValue']) || null
  const maxLen = daten['maxLen']

  return {
    id: zeichenkette(daten['id']),
    name,
    art: feldart,
    seite,
    rect,
    schreibgeschuetzt: daten['readOnly'] === true,
    pflicht: daten['required'] === true,
    versteckt: daten['hidden'] === true,
    maxLaenge: typeof maxLen === 'number' && maxLen > 0 ? maxLen : null,
    mehrzeilig: daten['multiLine'] === true,
    passwort: daten['password'] === true,
    exportwert,
    optionen: optionen(daten['options']),
    kombiniert: daten['combo'] === true,
    mehrfach: daten['multiSelect'] === true,
    format: erkenneFormat(skripte(daten['actions'])),
    ausgangswert: wert(daten, feldart, exportwert),
    hilfetext: zeichenkette(daten['alternativeText']) || null
  }
}

/**
 * Alle Widgets einer Seite, in der Reihenfolge des Dokuments.
 *
 * Die Reihenfolge ist die Tab-Reihenfolge: ohne `/Tabs`-Eintrag auf der Seite
 * gilt laut Spezifikation die Reihenfolge im `/Annots`-Feld, und genau die
 * liefert pdf.js. Die Ebene rendert die Felder in dieser Reihenfolge, und
 * der Browser tabt dann von selbst richtig.
 */
export function wandleFelder(rohe: unknown, seite: number): Formularfeld[] {
  if (!Array.isArray(rohe)) return []
  const felder: Formularfeld[] = []
  for (const eintrag of rohe as unknown[]) {
    const feld = wandleFeld(eintrag, seite)
    if (feld !== null) felder.push(feld)
  }
  return felder
}
