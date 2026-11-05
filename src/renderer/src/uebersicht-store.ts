import { create } from 'zustand'
import { KACHEL_MAX, KACHEL_MIN, KACHEL_STANDARD } from './viewer/raster'

/**
 * Die Seitenuebersicht (S6.2): ob sie offen ist und wie gross die Kacheln
 * sind. Ein Zustand der Bedienung, nicht des Dokuments - die Kachelgroesse
 * gilt fuer jeden Tab, und wer im Raster sortiert, will das beim naechsten
 * Tab meist auch.
 */
export interface UebersichtZustand {
  offen: boolean
  kachelBreite: number
  oeffne: () => void
  schliesse: () => void
  schalte: () => void
  setzeKachelBreite: (breite: number) => void
}

export const useUebersicht = create<UebersichtZustand>((set, get) => ({
  offen: false,
  kachelBreite: KACHEL_STANDARD,
  oeffne: () => {
    set({ offen: true })
  },
  schliesse: () => {
    set({ offen: false })
  },
  schalte: () => {
    set({ offen: !get().offen })
  },
  setzeKachelBreite: (breite) => {
    if (!Number.isFinite(breite)) return
    set({ kachelBreite: Math.min(KACHEL_MAX, Math.max(KACHEL_MIN, Math.round(breite))) })
  }
}))
