import { create } from 'zustand'

/**
 * Die Mehrfachauswahl von Seiten in der Miniaturenleiste (S4.1, Aufgabe 1).
 *
 * Getrennt vom Dokument-Store: die Auswahl ist ein Zustand der Bedienung,
 * kein Merkmal des Dokuments, und sie faellt bei jedem Neuladen (auch nach
 * einer Mutation, weil sich die Seitennummern verschoben haben koennen).
 *
 * Bedienung wie im Dateimanager: Klick waehlt genau diese Seite, Strg+Klick
 * schaltet sie um, Umschalt+Klick waehlt den Bereich vom Anker bis hierher.
 */
export interface SeitenauswahlZustand {
  ausgewaehlt: ReadonlySet<number>
  /** Die zuletzt einzeln gewaehlte Seite - Ausgangspunkt fuer Umschalt+Klick. */
  anker: number | null

  klick: (seite: number, modifikatoren: { strg: boolean; umschalt: boolean }) => void
  /** Setzt die Auswahl direkt - etwa nach dem Ziehen mehrerer Seiten. */
  setze: (seiten: readonly number[]) => void
  leere: () => void
}

export const useSeitenauswahl = create<SeitenauswahlZustand>((set, get) => ({
  ausgewaehlt: new Set<number>(),
  anker: null,

  klick: (seite, { strg, umschalt }) => {
    const { ausgewaehlt, anker } = get()
    if (umschalt && anker !== null) {
      const von = Math.min(anker, seite)
      const bis = Math.max(anker, seite)
      const bereich = new Set<number>(strg ? ausgewaehlt : [])
      for (let s = von; s <= bis; s++) bereich.add(s)
      set({ ausgewaehlt: bereich })
      return
    }
    if (strg) {
      const neu = new Set(ausgewaehlt)
      if (neu.has(seite)) neu.delete(seite)
      else neu.add(seite)
      set({ ausgewaehlt: neu, anker: seite })
      return
    }
    set({ ausgewaehlt: new Set([seite]), anker: seite })
  },

  setze: (seiten) => {
    set({ ausgewaehlt: new Set(seiten), anker: seiten[0] ?? null })
  },

  leere: () => {
    set({ ausgewaehlt: new Set<number>(), anker: null })
  }
}))

/** Die Seitenauswahl eines Tabs (S6.1) - sie gilt fuer genau dessen Seiten. */
export interface SeitenauswahlStand {
  ausgewaehlt: ReadonlySet<number>
  anker: number | null
}

export function nimmSeitenauswahlAuf(): SeitenauswahlStand {
  const { ausgewaehlt, anker } = useSeitenauswahl.getState()
  return { ausgewaehlt, anker }
}

export function spieleSeitenauswahlEin(stand: SeitenauswahlStand): void {
  useSeitenauswahl.setState(stand)
}
