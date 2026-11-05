import { useEffect, useRef } from 'react'

/**
 * Fokus fuer die eingeblendeten Felder (S5.2a, Aufgabe 2).
 *
 * Die Felder der Schale - Drucken, Teilen, Zusammenfuehren, PNG-Export,
 * Signatur - erscheinen als Streifen im Dokumentfluss. Wer sie ueber ein
 * Kuerzel oder das Menue oeffnet, bekam bisher nichts davon mit: der Fokus
 * blieb, wo er war, und die Tabfolge fuehrte erst nach dreissig Stationen
 * dorthin. Schloss das Feld, stand der Fokus anschliessend am Anfang.
 *
 * Deshalb hier beides an einer Stelle: beim Erscheinen wandert der Fokus in
 * das Feld, beim Verschwinden zurueck zu der Stelle, an der er vorher stand.
 *
 * **Keine Fokusfalle.** Die Felder sind keine modalen Dialoge, sondern
 * Streifen ueber dem Dokument; der Rest der Anwendung bleibt bedienbar. Den
 * Fokus darin einzusperren waere nach WCAG 2.1.2 selbst ein Fehler.
 *
 * Der Hook nimmt an, dass er nur aus einem sichtbaren Feld aufgerufen wird -
 * die Felder werden auf- und abgebaut, nicht versteckt. Einbinden heisst
 * also "offen", Abbau heisst "geschlossen".
 */
export interface Feldfokus {
  /** An den aeussersten Kasten des Feldes haengen, zusammen mit `tabIndex={-1}`. */
  behaelterRef: React.RefObject<HTMLDivElement | null>
  /** An denselben Kasten haengen: Escape schliesst das Feld. */
  beiTaste: (ereignis: React.KeyboardEvent) => void
}

export function useFeldfokus(schliesse: () => void): Feldfokus {
  const behaelterRef = useRef<HTMLDivElement>(null)
  const vorherRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const behaelter = behaelterRef.current
    vorherRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    behaelter?.focus()

    return () => {
      // Nur zurueckgeben, wenn der Fokus noch im Feld lag oder mit ihm
      // verschwunden ist. Wer waehrend des Feldes bewusst woandershin
      // geklickt hat, soll dort bleiben - sonst spraenge der Fokus beim
      // Schliessen unter der Hand weg.
      const aktiv = document.activeElement
      const gehoertZumFeld =
        aktiv === null || aktiv === document.body || (behaelter?.contains(aktiv) ?? false)
      if (gehoertZumFeld) vorherRef.current?.focus()
      vorherRef.current = null
    }
  }, [])

  const beiTaste = (ereignis: React.KeyboardEvent): void => {
    if (ereignis.key !== 'Escape') return
    // Nicht weiterreichen: sonst setzte der globale Zuhoerer zusaetzlich das
    // Zeichenwerkzeug zurueck, und ein Escape taete zwei Dinge auf einmal.
    ereignis.stopPropagation()
    schliesse()
  }

  return { behaelterRef, beiTaste }
}
