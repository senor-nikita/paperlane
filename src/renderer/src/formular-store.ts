import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import { wertGleich, type Feldwert, type Formularfeld } from '../../shared/formulare'
import { wandleFelder } from './viewer/formularfelder'

/**
 * Die Formularfelder je Seite und ihre Werte (S3.1).
 *
 * Getrennt vom Annotations-Store, obwohl beides aus `getAnnotations` kommt:
 * Formularwerte haengen am **Feldnamen**, nicht am Widget — eine
 * Auswahlknopf-Gruppe hat zwei Widgets und einen Wert. pdf.js cached die
 * Antwort je Seite, der zweite Aufruf kostet keinen Worker-Gang.
 *
 * Wie in S2.3a: Aenderungen werden **abgeleitet**, nicht mitgeschrieben.
 * `ursprung` haelt, was beim Lesen im Dokument stand; was davon abweicht, ist
 * offen. Geschrieben wird seit S3.2 beim Speichern (`schale/speichern.ts`
 * sammelt die abweichenden Felder); danach setzt `merkeGespeichert` den
 * Ursprung auf den aktuellen Stand, und nichts gilt mehr als offen.
 */

/** `intent: 'display'` — dieselbe Absicht wie beim Annotations-Store. */
const ANZEIGE_ABSICHT = { intent: 'display' } as const

export interface FormularZustand {
  proSeite: Readonly<Record<number, readonly Formularfeld[]>>
  /** Aktuelle Werte je Feldname. Fehlt ein Name, gilt der Ausgangswert. */
  werte: Readonly<Record<string, Feldwert>>
  /** Was beim Lesen im Dokument stand, je Feldname. */
  ursprung: Readonly<Record<string, Feldwert>>

  ladeSeite: (dokument: PDFDocumentProxy, seite: number) => Promise<void>
  setzeWert: (name: string, wert: Feldwert) => void
  vergiss: () => void
  /**
   * Nach erfolgreichem Speichern (S3.2): der aktuelle Stand ist jetzt der
   * Stand im Dokument. Dasselbe Muster wie im Annotations-Store.
   */
  merkeGespeichert: () => void
}

const LEER = {
  proSeite: {} as Readonly<Record<number, readonly Formularfeld[]>>,
  werte: {} as Readonly<Record<string, Feldwert>>,
  ursprung: {} as Readonly<Record<string, Feldwert>>
}

let fuerDokument: PDFDocumentProxy | null = null

/** Wie im Annotations-Store: erkennt Antworten, die ein Tabwechsel ueberholt hat (S6.1). */
let generation = 0

export const useFormular = create<FormularZustand>((set, get) => ({
  ...LEER,

  vergiss: () => {
    fuerDokument = null
    generation += 1
    set({ ...LEER })
  },

  ladeSeite: async (dokument, seite) => {
    if (fuerDokument !== dokument) {
      fuerDokument = dokument
      generation += 1
      set({ ...LEER })
    }
    if (get().proSeite[seite] !== undefined) return
    const meine = generation
    try {
      const seitenObjekt = await dokument.getPage(seite)
      const rohe: unknown = await seitenObjekt.getAnnotations(ANZEIGE_ABSICHT)
      if (fuerDokument !== dokument || meine !== generation) return
      const felder = wandleFelder(rohe, seite)
      // Der Ausgangswert je Name - bei einer Gruppe tragen alle Widgets
      // denselben, das erste gewinnt.
      const ursprung: Record<string, Feldwert> = { ...get().ursprung }
      const werte: Record<string, Feldwert> = { ...get().werte }
      for (const feld of felder) {
        if (!(feld.name in ursprung)) ursprung[feld.name] = feld.ausgangswert
        if (!(feld.name in werte)) werte[feld.name] = feld.ausgangswert
      }
      set({ proSeite: { ...get().proSeite, [seite]: felder }, ursprung, werte })
    } catch (fehler) {
      console.error('Formularfelder von Seite ' + String(seite) + ' nicht lesbar:', fehler)
      if (fuerDokument === dokument && meine === generation) {
        set({ proSeite: { ...get().proSeite, [seite]: [] } })
      }
    }
  },

  setzeWert: (name, wert) => {
    set({ werte: { ...get().werte, [name]: wert } })
  },

  merkeGespeichert: () => {
    set({ ursprung: { ...get().werte } })
  }
}))

/** Die Formularwerte eines Tabs (S6.1), samt Ursprung - sonst gaelte nichts als geaendert. */
export interface FormularStand {
  proSeite: FormularZustand['proSeite']
  werte: FormularZustand['werte']
  ursprung: FormularZustand['ursprung']
  fuerDokument: PDFDocumentProxy | null
}

export function nimmFormularAuf(): FormularStand {
  const { proSeite, werte, ursprung } = useFormular.getState()
  return { proSeite, werte, ursprung, fuerDokument }
}

export function spieleFormularEin(stand: FormularStand): void {
  fuerDokument = stand.fuerDokument
  generation += 1
  useFormular.setState({ proSeite: stand.proSeite, werte: stand.werte, ursprung: stand.ursprung })
}

/** Die Namen der Felder, deren Wert vom Ausgangswert abweicht. */
export function geaenderteFelder(
  werte: Readonly<Record<string, Feldwert>>,
  ursprung: Readonly<Record<string, Feldwert>>
): string[] {
  return Object.keys(werte).filter((name) => {
    const alt = ursprung[name]
    const neu = werte[name]
    return alt !== undefined && neu !== undefined && !wertGleich(alt, neu)
  })
}
