import { create } from 'zustand'
import type { Mutation } from '../../shared/mutation'

/**
 * Der Stand der Mutationen (S4.0) — getrennt vom Dokument-Store, weil er
 * einen Dokumentwechsel **ueberleben** muss, der von einer Mutation selbst
 * ausgeloest wird: das Neuladen nach einer Mutation erhoeht `ladeNummer`
 * genau wie das Oeffnen einer anderen Datei, und das Aufraeumen am
 * Ladevorgang (`useAufraeumenBeiWechsel`) darf den Zaehler dann **nicht**
 * zuruecksetzen. `erwarteNeuladen` unterscheidet die beiden Faelle.
 */
export interface MutationsZustand {
  /**
   * Wie viele Mutationen seit dem letzten Speichern angewendet wurden. Sie
   * zaehlen als offene Aenderungen: die Arbeitskopie im Main ist nicht die
   * Datei auf der Platte.
   */
  anzahl: number
  /** Die gerade laufende Mutation, fuer die Fortschrittsanzeige (Aufgabe 5). */
  laeuft: Mutation | null
  /** Das naechste Neuladen gehoert zu einer Mutation, nicht zu einem Wechsel. */
  erwarteNeuladen: boolean
  /** Dauer der letzten Mutation in Millisekunden, fuer Hinweis und Tests. */
  letzteDauerMs: number | null

  beginne: (mutation: Mutation) => void
  beende: (angewendet: boolean, dauerMs?: number) => void
  /** Rueckgaengig (-1) und Wiederholen (+1) einer Mutation (S4.1). */
  zaehle: (delta: number) => void
  /**
   * Nach Rueckgaengig und Wiederholen einer Mutation (S7): ist der
   * wiederhergestellte Stand die Datei auf der Platte, ist nichts offen; sonst
   * mindestens eine Aenderung. Ein Rueckgaengig bis vor ein Speichern macht
   * das Dokument wieder ungespeichert, obwohl der Zaehler beim Speichern auf
   * null fiel - ein reines Herunterzaehlen bliebe bei null und liesse ein
   * ungespeichertes Dokument "sauber" aussehen.
   */
  nachStand: (sauber: boolean, delta: number) => void
  merkeGespeichert: () => void
  /** Beim Dokumentwechsel - aber nicht beim Neuladen nach einer Mutation. */
  vergiss: () => void
}

export const useMutation = create<MutationsZustand>((set, get) => ({
  anzahl: 0,
  laeuft: null,
  erwarteNeuladen: false,
  letzteDauerMs: null,

  beginne: (mutation) => {
    set({ laeuft: mutation, erwarteNeuladen: true })
  },
  beende: (angewendet, dauerMs) => {
    set({
      laeuft: null,
      erwarteNeuladen: false,
      anzahl: angewendet ? get().anzahl + 1 : get().anzahl,
      letzteDauerMs: dauerMs ?? get().letzteDauerMs
    })
  },
  zaehle: (delta) => {
    set({ anzahl: Math.max(0, get().anzahl + delta) })
  },
  nachStand: (sauber, delta) => {
    set({ anzahl: sauber ? 0 : Math.max(1, get().anzahl + delta) })
  },
  merkeGespeichert: () => {
    set({ anzahl: 0 })
  },
  vergiss: () => {
    if (get().erwarteNeuladen) return
    set({ anzahl: 0, laeuft: null, letzteDauerMs: null })
  }
}))

/**
 * Der Mutationsstand eines Tabs (S6.1): wie viele Mutationen seine
 * Arbeitskopie im Main von der Datei trennen. Eine laufende Mutation reist
 * nicht mit - solange sie laeuft, ist der Wechsel gesperrt.
 */
export interface MutationsStand {
  anzahl: number
  letzteDauerMs: number | null
}

export function nimmMutationAuf(): MutationsStand {
  const { anzahl, letzteDauerMs } = useMutation.getState()
  return { anzahl, letzteDauerMs }
}

export function spieleMutationEin(stand: MutationsStand): void {
  useMutation.setState({ ...stand, laeuft: null, erwarteNeuladen: false })
}
