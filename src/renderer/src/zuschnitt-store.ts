import { create } from 'zustand'
import { begrenzeRaender, type Raender, type Seitenmass } from './viewer/zuschnitt'

/**
 * Der Rahmen, den das Werkzeug "Zuschneiden" gerade zeigt (S6.3).
 *
 * Nur Bedienzustand: bis "Zuschneiden" gedrueckt ist, steht nichts davon im
 * Dokument. Der Rahmen gehoert zu genau einer Seite; sein Mass wird beim
 * Aufziehen mitgemerkt, damit die Felder in mm ohne die Seite rechnen koennen.
 */

/** Worauf "Zuschneiden" und "Zuschnitt aufheben" wirken. */
export type ZuschnittZiel = 'seite' | 'auswahl' | 'alle'

export interface ZuschnittZustand {
  /** Einsbasierte Seite des Rahmens, `null` wenn keiner aufgezogen ist. */
  seite: number | null
  mass: Seitenmass | null
  raender: Raender | null
  ziel: ZuschnittZiel

  setze: (seite: number, mass: Seitenmass, raender: Raender) => void
  /** Aendert die Raender des vorhandenen Rahmens - begrenzt auf die Seite. */
  aendere: (raender: Raender) => void
  setzeZiel: (ziel: ZuschnittZiel) => void
  verwerfe: () => void
}

export const useZuschnitt = create<ZuschnittZustand>((set, get) => ({
  seite: null,
  mass: null,
  raender: null,
  ziel: 'seite',

  setze: (seite, mass, raender) => {
    set({ seite, mass, raender: begrenzeRaender(raender, mass) })
  },
  aendere: (raender) => {
    const { mass } = get()
    if (mass === null) return
    set({ raender: begrenzeRaender(raender, mass) })
  },
  setzeZiel: (ziel) => {
    set({ ziel })
  },
  verwerfe: () => {
    set({ seite: null, mass: null, raender: null })
  }
}))
