import type { Bereich } from './bereiche'

/**
 * Die Druckoptionen (S4.3, Aufgabe 2) - vom Feld im Renderer gewaehlt, im Main
 * auf die Druckvorlage angewandt.
 */
export type Ausrichtung = 'auto' | 'hochkant' | 'quer'

export interface DruckOptionen {
  /** Einsbasierte, inklusive Bereiche - oder das ganze Dokument. */
  seiten: Bereich[] | 'alle'
  /** `auto` laesst jede Seite, wie sie liegt. */
  ausrichtung: Ausrichtung
  /** "An Seite anpassen": jede Seite auf das Blatt der ersten skaliert und zentriert. */
  anpassen: boolean
  /** Anmerkungen mitdrucken; Formularfelder bleiben in jedem Fall. */
  kommentare: boolean
}

/** Wohin der Druck geht: an den Drucker (Systemdialog) oder in eine PDF-Datei. */
export type Druckziel = 'drucker' | 'datei'

/** Die Phasen, die der Main dem Renderer meldet (Aufgabe 3). */
export type Druckphase = 'vorlage' | 'laden' | 'drucken'

export const STANDARD_DRUCKOPTIONEN: DruckOptionen = {
  seiten: 'alle',
  ausrichtung: 'auto',
  anpassen: true,
  kommentare: true
}

/**
 * Prueft Bereiche aus dem Renderer wie `istSeitenliste` in `mutation.ts`:
 * seine Nachrichten sind Eingabe, nicht Wahrheit. Ob eine Seite im Dokument
 * existiert, prueft der Main danach an der Druckvorlage.
 */
function istBereichsliste(wert: unknown): wert is Bereich[] {
  return (
    Array.isArray(wert) &&
    wert.length > 0 &&
    wert.every(
      (b) =>
        Array.isArray(b) &&
        b.length === 2 &&
        typeof b[0] === 'number' &&
        typeof b[1] === 'number' &&
        Number.isInteger(b[0]) &&
        Number.isInteger(b[1]) &&
        b[0] >= 1 &&
        b[1] >= b[0]
    )
  )
}

export function pruefeDruckOptionen(eingabe: unknown): DruckOptionen | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Record<string, unknown>
  const ausrichtung = wert['ausrichtung']
  if (ausrichtung !== 'auto' && ausrichtung !== 'hochkant' && ausrichtung !== 'quer') return null
  if (typeof wert['anpassen'] !== 'boolean' || typeof wert['kommentare'] !== 'boolean') return null
  const seiten = wert['seiten']
  if (seiten !== 'alle' && !istBereichsliste(seiten)) return null
  return {
    seiten,
    ausrichtung,
    anpassen: wert['anpassen'],
    kommentare: wert['kommentare']
  }
}
