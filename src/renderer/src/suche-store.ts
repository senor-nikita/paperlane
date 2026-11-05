import { create } from 'zustand'
import { useDokument } from './dokument-store'
import {
  baueSeitentext,
  findeTreffer,
  type Seitentext,
  type Suchoptionen,
  type Textelement,
  type Treffer
} from './viewer/suche'

export interface Seitentreffer {
  /** Einsbasierte Seitennummer. */
  seite: number
  treffer: Treffer[]
}

interface Seiteninhalt {
  elemente: Textelement[]
  seitentext: Seitentext
}

/**
 * Einmal geholter Seitentext bleibt liegen. Ohne Zwischenspeicher wuerde jede
 * Aenderung des Suchbegriffs alle Seiten erneut parsen — bei 500 Seiten ist das
 * der Unterschied zwischen fluessig und unbenutzbar.
 */
const textCache = new Map<number, Seiteninhalt>()
let cacheGehoertZu: string | null = null

export function leereTextCache(): void {
  textCache.clear()
  cacheGehoertZu = null
}

export async function holeSeiteninhalt(seite: number): Promise<Seiteninhalt | null> {
  const { dokument, pfad } = useDokument.getState()
  if (dokument === null) return null
  if (cacheGehoertZu !== pfad) {
    textCache.clear()
    cacheGehoertZu = pfad
  }
  const vorhanden = textCache.get(seite)
  if (vorhanden !== undefined) return vorhanden

  const seitenobjekt = await dokument.getPage(seite)
  const inhalt = await seitenobjekt.getTextContent()
  // getTextContent liefert Textelemente und Auszeichnungsmarken gemischt;
  // nur erstere tragen Text.
  const elemente: Textelement[] = []
  for (const eintrag of inhalt.items) {
    if (!('str' in eintrag)) continue
    elemente.push({ str: eintrag.str, hasEOL: eintrag.hasEOL })
  }
  const ergebnis: Seiteninhalt = { elemente, seitentext: baueSeitentext(elemente) }
  textCache.set(seite, ergebnis)
  return ergebnis
}

export interface SuchZustand {
  begriff: string
  optionen: Suchoptionen
  ergebnisse: Seitentreffer[]
  gesamt: number
  /** Einsbasierter Index im flachen Trefferstrom, 0 wenn keiner gewaehlt ist. */
  aktuell: number
  laeuft: boolean
  /**
   * null solange unbekannt. false bedeutet: das Dokument hat keinen
   * durchsuchbaren Text — bei einem Scan der Normalfall, und der Nutzer muss
   * das erfahren statt einen stillen Nulltreffer zu sehen.
   */
  hatDurchsuchbarenText: boolean | null

  setzeBegriff: (begriff: string) => void
  setzeOptionen: (optionen: Partial<Suchoptionen>) => void
  starte: () => Promise<void>
  zuruecksetzen: () => void
  weiter: (richtung: 1 | -1) => void
}

const LEER = {
  begriff: '',
  optionen: { achteAufGrossschreibung: false, nurGanzeWoerter: false } as Suchoptionen,
  ergebnisse: [] as Seitentreffer[],
  gesamt: 0,
  aktuell: 0,
  laeuft: false,
  hatDurchsuchbarenText: null as boolean | null
}

/** Zaehler, um einen laufenden Durchlauf bei neuer Eingabe zu verwerfen. */
let generation = 0

export function flacherTreffer(
  ergebnisse: readonly Seitentreffer[],
  index: number
): { seite: number; treffer: Treffer } | null {
  let zaehler = 0
  for (const eintrag of ergebnisse) {
    for (const treffer of eintrag.treffer) {
      zaehler += 1
      if (zaehler === index) return { seite: eintrag.seite, treffer }
    }
  }
  return null
}

export const useSuche = create<SuchZustand>((set, get) => ({
  ...LEER,

  setzeBegriff: (begriff) => {
    set({ begriff })
  },

  setzeOptionen: (teil) => {
    set({ optionen: { ...get().optionen, ...teil } })
  },

  zuruecksetzen: () => {
    generation += 1
    set({ ...LEER, optionen: get().optionen })
  },

  starte: async () => {
    const { begriff, optionen } = get()
    const { seitenzahl, aktuelleSeite } = useDokument.getState()
    generation += 1
    const meine = generation

    if (begriff.length === 0 || seitenzahl === 0) {
      set({ ergebnisse: [], gesamt: 0, aktuell: 0, laeuft: false })
      return
    }

    set({ laeuft: true, ergebnisse: [], gesamt: 0, aktuell: 0 })

    // Bei der aktuellen Seite beginnen: der Nutzer sucht meist in dem Teil,
    // den er gerade liest.
    const reihenfolge = Array.from(
      { length: seitenzahl },
      (_, i) => ((aktuelleSeite - 1 + i) % seitenzahl) + 1
    )
    const gesammelt = new Map<number, Treffer[]>()
    let textGefunden = false

    for (const seite of reihenfolge) {
      if (meine !== generation) return
      const inhalt = await holeSeiteninhalt(seite)
      if (inhalt === null) break
      if (inhalt.seitentext.roh.trim().length > 0) textGefunden = true
      const treffer = findeTreffer(inhalt.seitentext, begriff, optionen)
      if (treffer.length > 0) gesammelt.set(seite, treffer)

      const ergebnisse = [...gesammelt.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([nummer, liste]) => ({ seite: nummer, treffer: liste }))
      const gesamt = ergebnisse.reduce((summe, eintrag) => summe + eintrag.treffer.length, 0)
      set((vorher) => ({
        ergebnisse,
        gesamt,
        aktuell: vorher.aktuell === 0 && gesamt > 0 ? 1 : vorher.aktuell
      }))
    }

    if (meine !== generation) return
    set({ laeuft: false, hatDurchsuchbarenText: textGefunden })
  },

  weiter: (richtung) => {
    const { gesamt, aktuell } = get()
    if (gesamt === 0) return
    const naechster = ((aktuell - 1 + richtung + gesamt) % gesamt) + 1
    set({ aktuell: naechster })
  }
}))

/**
 * Was von der Suche zu einem Tab gehoert (S6.1): nur der Begriff. Treffer
 * und Textcache gehoeren zum Proxy und werden neu ermittelt, sobald jemand
 * sucht - sie mitzunehmen hiesse, Treffer einer Fassung zu zeigen, die eine
 * Mutation laengst ersetzt haben kann.
 */
export interface SuchStand {
  begriff: string
}

export function nimmSucheAuf(): SuchStand {
  return { begriff: useSuche.getState().begriff }
}

export function spieleSucheEin(stand: SuchStand): void {
  leereTextCache()
  useSuche.getState().zuruecksetzen()
  useSuche.setState({ begriff: stand.begriff })
}
