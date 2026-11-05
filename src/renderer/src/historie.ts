import { create } from 'zustand'

/**
 * Die gemeinsame Rueckgaengig-Historie (S2.2, Aufgabe 7).
 *
 * **Eine** Historie, nicht eine je Bereich. Der Plan nennt zwei konkurrierende
 * Stacks als Risiko R7, und der Grund ist einfach: Strg+Z ist ein Befehl des
 * Nutzers an die Anwendung, nicht an ein Fenster darin. Haette die
 * Annotationsebene ihren eigenen Stapel und S4.1 einen zweiten fuer
 * Seitenoperationen, entschiede der Fokus darueber, was zurueckgenommen wird —
 * und der Nutzer koennte es nicht vorhersagen.
 *
 * Deshalb schon hier bewusst allgemein gehalten: ein Schritt weiss selbst, wie
 * er sich zurueck- und wiederholen laesst. S4.1 traegt seine Seitenoperationen
 * in dieselbe Liste ein, ohne dass dieses Modul davon erfahren muss.
 *
 * Bewusst eine Kommandohistorie und kein Zustands-Schnappschuss (ADR 0001,
 * D5): Seitenoperationen brauchen laut S4.0 Reserialisierung und Neuladen, und
 * das kann kein Schnappschuss rueckgaengig machen.
 */

export interface Schritt {
  /** Was der Schritt getan hat, in der Sprache des Nutzers: "Markierung". */
  beschreibung: string
  /**
   * Anmerkungsschritte sind synchron. Eine Mutation (S4.1) laeuft ueber den
   * Main und ein Neuladen und liefert ein Promise; solange es offen ist,
   * nimmt die Historie keinen weiteren Befehl an (`beschaeftigt`) - zwei
   * Neuladevorgaenge zugleich ergaeben zwei Wahrheiten.
   */
  ruecknehmen: () => void | Promise<void>
  wiederholen: () => void | Promise<void>
}

/**
 * Wie viele Schritte aufbewahrt werden. Unbegrenzt hiesse, jede geloeschte
 * Annotation bis zum Programmende im Speicher zu halten.
 */
export const MAX_SCHRITTE = 100

export interface HistorienZustand {
  vergangenheit: Schritt[]
  zukunft: Schritt[]
  /** Ein asynchroner Schritt laeuft; Rueckgaengig/Wiederholen warten. */
  beschaeftigt: boolean
  /**
   * Traegt einen **bereits ausgefuehrten** Schritt ein.
   *
   * Bewusst nicht "fuehre aus und merke": die Aufrufstelle hat die Aenderung
   * ohnehin schon gemacht, und ein zweiter Ausfuehrungsweg waere eine Quelle
   * doppelter Anwendung.
   */
  merke: (schritt: Schritt) => void
  rueckgaengig: () => void
  wiederholen: () => void
  /** Beim Dokumentwechsel: die Schritte gehoerten zur vorigen Datei. */
  leere: () => void
}

/**
 * Fuehrt einen Schritt aus und verschiebt ihn erst danach zwischen den Stapeln.
 * Bei einem Promise bleibt die Historie bis zur Erledigung beschaeftigt; ein
 * Fehlschlag laesst die Stapel unveraendert - der Schritt gilt dann als
 * nicht ausgefuehrt, und der Aufrufer hat den Grund gemeldet.
 */
function fuehreAus(
  set: (teil: Partial<HistorienZustand>) => void,
  schritt: Schritt,
  richtung: 'zurueck' | 'vor',
  danach: () => Partial<HistorienZustand>
): void {
  let ergebnis: void | Promise<void>
  try {
    ergebnis = richtung === 'zurueck' ? schritt.ruecknehmen() : schritt.wiederholen()
  } catch (fehler) {
    console.error('Historienschritt fehlgeschlagen:', fehler)
    return
  }
  if (ergebnis instanceof Promise) {
    set({ beschaeftigt: true })
    ergebnis
      .then(() => {
        set({ ...danach(), beschaeftigt: false })
      })
      .catch((fehler: unknown) => {
        console.error('Historienschritt fehlgeschlagen:', fehler)
        set({ beschaeftigt: false })
      })
    return
  }
  set(danach())
}

export const useHistorie = create<HistorienZustand>((set, get) => ({
  vergangenheit: [],
  zukunft: [],
  beschaeftigt: false,

  merke: (schritt) => {
    // Eine neue Aenderung macht die Zukunft ungueltig - das ist der
    // Normalfall jeder Historie und keine Ausnahme.
    set({
      vergangenheit: [...get().vergangenheit, schritt].slice(-MAX_SCHRITTE),
      zukunft: []
    })
  },

  rueckgaengig: () => {
    const { vergangenheit, beschaeftigt } = get()
    const letzter = vergangenheit[vergangenheit.length - 1]
    if (letzter === undefined || beschaeftigt) return
    // `danach` liest den Stand frisch: ein synchroner Schritt kann ihn schon
    // veraendert haben, bevor die Stapel verschoben werden.
    fuehreAus(set, letzter, 'zurueck', () => ({
      vergangenheit: get().vergangenheit.slice(0, -1),
      zukunft: [...get().zukunft, letzter]
    }))
  },

  wiederholen: () => {
    const { zukunft, beschaeftigt } = get()
    const naechster = zukunft[zukunft.length - 1]
    if (naechster === undefined || beschaeftigt) return
    fuehreAus(set, naechster, 'vor', () => ({
      vergangenheit: [...get().vergangenheit, naechster],
      zukunft: get().zukunft.slice(0, -1)
    }))
  },

  leere: () => {
    set({ vergangenheit: [], zukunft: [], beschaeftigt: false })
  }
}))

/**
 * Die Historie eines Tabs (S6.1). Die Schritte halten Closures auf die
 * **globalen** Stores - das bleibt richtig, weil nur der aktive Tab handelt
 * und seine Stores beim Zurueckwechseln wieder dieselben Werte tragen.
 * `beschaeftigt` reist nicht mit: waehrend ein Schritt laeuft, ist der
 * Wechsel gesperrt.
 */
export interface HistorienStand {
  vergangenheit: Schritt[]
  zukunft: Schritt[]
}

export function nimmHistorieAuf(): HistorienStand {
  const { vergangenheit, zukunft } = useHistorie.getState()
  return { vergangenheit, zukunft }
}

export function spieleHistorieEin(stand: HistorienStand): void {
  useHistorie.setState({ ...stand, beschaeftigt: false })
}
