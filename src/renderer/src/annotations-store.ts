import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import type { Annotation } from '../../shared/annotations'
import { wandleAnnotationen } from './viewer/annotationen'
import { t } from '../../shared/i18n'

/**
 * Die gelesenen Annotationen je Seite (S2.1).
 *
 * Warum ueberhaupt ein Store und nicht ein Effekt je Seite wie beim Textlayer:
 * die Liste in der Seitenleiste braucht **alle** Seiten, die Ebene nur die
 * sichtbare. Ohne gemeinsamen Zwischenspeicher laese die Anwendung dieselbe
 * Seite zweimal, sobald die Liste offen ist.
 *
 * Nichts davon laeuft beim Oeffnen. Ein Dokument mit 300 Seiten wuerde sonst
 * 300 Aufrufe an den Worker absetzen, bevor die erste Seite steht — genau das
 * Budget aus S1.2 (erste Seite unter zwei Sekunden), das Invariante 10 misst.
 */

/** `intent: 'display'` laesst pdf.js versteckte Annotationen aussortieren. */
const ANZEIGE_ABSICHT = { intent: 'display' } as const

export interface AnnotationsZustand {
  /**
   * Zwischenspeicher je einsbasierter Seitennummer. Ein fehlender Schluessel
   * heisst "noch nicht gelesen", ein leeres Feld "gelesen, nichts gefunden".
   */
  proSeite: Readonly<Record<number, readonly Annotation[]>>
  /**
   * Derselbe Bestand, wie er beim Lesen im Dokument stand (S2.3a).
   *
   * Aus dem Vergleich mit `proSeite` entsteht der Aenderungssatz — abgeleitet
   * und nicht mitgeschrieben (siehe shared/aenderungen.ts): fuenfzehn Schritte
   * vor und wieder zurueck ergeben so wieder "nichts geaendert".
   *
   * Ein fehlender Schluessel heisst "diese Seite hat nie jemand gelesen". Ihre
   * Anmerkungen bleiben beim Speichern unberuehrt; wuerde stattdessen der
   * gesamte Bestand als massgeblich gelten, loeschte ein Speichern alles, was
   * auf ungelesenen Seiten steht.
   */
  urspruenglich: Readonly<Record<number, readonly Annotation[]>>
  /** Alle Seiten gelesen — erst dann ist die Liste in der Seitenleiste vollstaendig. */
  vollstaendig: boolean
  /** Ein Lesevorgang ueber das ganze Dokument laeuft. */
  laeuft: boolean
  fehler: string | null

  ladeSeite: (dokument: PDFDocumentProxy, seite: number) => Promise<void>
  ladeAlles: (dokument: PDFDocumentProxy, seitenzahl: number) => Promise<void>
  /** Beim Dokumentwechsel. Ohne das zeigte die Liste die Anmerkungen des Vorgaengers. */
  vergiss: () => void

  /**
   * Ab hier die Aenderungen aus S2.2. Alles bleibt im Speicher — geschrieben
   * wird erst in S2.3a. Die Aktionen sind absichtlich schmal und umkehrbar:
   * die Historie baut ihre Rueckgaengig-Schritte aus genau diesen Bausteinen.
   */
  fuegeEin: (annotation: Annotation, stelle?: number) => void
  ersetze: (annotation: Annotation) => void
  entferne: (id: string) => void
  /** Die Annotation mit dieser Kennung, ueber alle gelesenen Seiten hinweg. */
  finde: (id: string) => Annotation | null

  /**
   * Nach erfolgreichem Speichern: der aktuelle Stand ist jetzt der Stand im
   * Dokument (S2.3a). Ohne das bliebe die Anwendung nach dem Speichern
   * "geaendert" und warnte beim Schliessen vor nichts.
   *
   * Nur die gelesenen Seiten wandern in den neuen Ursprung. Eine Seite, die
   * niemand gelesen hat, war am Speichern nicht beteiligt und bleibt
   * unbekannt — sonst gaelte ein leerer Bestand als ihr Original.
   */
  merkeGespeichert: () => void
}

const LEER = {
  proSeite: {} as Readonly<Record<number, readonly Annotation[]>>,
  urspruenglich: {} as Readonly<Record<number, readonly Annotation[]>>,
  vollstaendig: false,
  laeuft: false,
  fehler: null as string | null
}

/**
 * Zu welchem Dokument der Zwischenspeicher gehoert.
 *
 * Modulweit und nicht im Zustand, weil es keine Anzeige betrifft: der Wert
 * dient allein dazu, eine Antwort zu verwerfen, die erst eintrifft, wenn
 * laengst ein anderes Dokument offen ist.
 */
let fuerDokument: PDFDocumentProxy | null = null

/**
 * Zaehlt jeden Austausch des Bestands (Vergessen, Tabwechsel). Seit S6.1
 * reicht `fuerDokument` allein nicht mehr, um eine verspaetete Antwort zu
 * erkennen: wer von Tab A zu B und gleich zurueck wechselt, hat wieder
 * dasselbe Proxy - aber einen eingespielten Bestand, den ein noch laufendes
 * `ladeAlles` mit seiner veralteten Sammlung ueberschriebe.
 */
let generation = 0

async function leseSeite(dokument: PDFDocumentProxy, seite: number): Promise<Annotation[]> {
  const seitenObjekt = await dokument.getPage(seite)
  const rohe: unknown = await seitenObjekt.getAnnotations(ANZEIGE_ABSICHT)
  return wandleAnnotationen(rohe, seite)
}

export const useAnnotationen = create<AnnotationsZustand>((set, get) => {
  /** Ein neues Dokument raeumt den Zwischenspeicher, bevor irgendetwas gelesen wird. */
  const wechsleDokument = (dokument: PDFDocumentProxy): void => {
    if (fuerDokument === dokument) return
    fuerDokument = dokument
    generation += 1
    set({ ...LEER })
  }

  return {
    ...LEER,

    vergiss: () => {
      fuerDokument = null
      generation += 1
      set({ ...LEER })
    },

    ladeSeite: async (dokument, seite) => {
      wechsleDokument(dokument)
      if (get().proSeite[seite] !== undefined) return
      const meine = generation
      try {
        const gelesen = await leseSeite(dokument, seite)
        // Das Dokument kann waehrend des Lesens gewechselt haben. Die Antwort
        // gehoert dann zu einer Datei, die niemand mehr ansieht.
        if (fuerDokument !== dokument || meine !== generation) return
        set({
          proSeite: { ...get().proSeite, [seite]: gelesen },
          // Derselbe Wert in beiden Ablagen: gerade gelesen heisst
          // "unveraendert". Beide zeigen auf dasselbe Feld — es wird nirgends
          // an Ort und Stelle veraendert, jede Aktion legt ein neues an.
          urspruenglich: { ...get().urspruenglich, [seite]: gelesen }
        })
      } catch (fehler) {
        // Nicht verschlucken: eine Seite ohne Anmerkungen und eine Seite, deren
        // Anmerkungen nicht lesbar waren, sehen sonst gleich aus.
        console.error('Anmerkungen von Seite ' + String(seite) + ' nicht lesbar:', fehler)
        // Ohne Ursprung: was nicht gelesen werden konnte, darf beim Speichern
        // nicht als "im Dokument war hier nichts" durchgehen und die
        // vorhandenen Anmerkungen dieser Seite loeschen.
        if (fuerDokument === dokument && meine === generation) {
          set({ proSeite: { ...get().proSeite, [seite]: [] } })
        }
      }
    },

    ladeAlles: async (dokument, seitenzahl) => {
      wechsleDokument(dokument)
      if (get().vollstaendig || get().laeuft) return
      const meine = generation
      set({ laeuft: true, fehler: null })
      try {
        // Der Reihe nach und nicht alle auf einmal: der Worker ist derselbe,
        // den die Hauptansicht zum Zeichnen braucht. Ein Schwall von 300
        // Anfragen wuerde die Seite blockieren, die der Leser gerade ansieht.
        const gesammelt: Record<number, readonly Annotation[]> = { ...get().proSeite }
        const ursprung: Record<number, readonly Annotation[]> = { ...get().urspruenglich }
        for (let seite = 1; seite <= seitenzahl; seite++) {
          const vorhanden = gesammelt[seite]
          if (vorhanden !== undefined) continue
          const gelesen = await leseSeite(dokument, seite)
          if (fuerDokument !== dokument || meine !== generation) return
          gesammelt[seite] = gelesen
          ursprung[seite] = gelesen
        }
        set({ proSeite: gesammelt, urspruenglich: ursprung, vollstaendig: true, laeuft: false })
      } catch (fehler) {
        console.error('Anmerkungen konnten nicht gelesen werden:', fehler)
        if (fuerDokument !== dokument || meine !== generation) return
        set({
          laeuft: false,
          fehler: t('anmerkungen.unvollstaendig')
        })
      }
    },

    fuegeEin: (annotation, stelle) => {
      const vorhanden = [...(get().proSeite[annotation.seite] ?? [])]
      // Mit Stelle einfuegen, wo es sie gibt: nimmt die Historie eine Loeschung
      // zurueck, gehoert die Annotation wieder dorthin, wo sie lag - die
      // Reihenfolge entscheidet, was beim Ueberlappen oben liegt.
      vorhanden.splice(stelle ?? vorhanden.length, 0, annotation)
      // Kennt der Ursprung die Seite noch nicht, wird der Stand vor dem
      // Einfuegen zu ihrem Original. Ohne das faende `sammleAenderungen` diese
      // Seite nicht und die neue Anmerkung ginge beim Speichern verloren —
      // moeglich, wenn jemand zeichnet, bevor die Seite fertig gelesen ist.
      const ursprung = get().urspruenglich
      const ergaenzung =
        ursprung[annotation.seite] === undefined
          ? { urspruenglich: { ...ursprung, [annotation.seite]: [] } }
          : {}
      set({ proSeite: { ...get().proSeite, [annotation.seite]: vorhanden }, ...ergaenzung })
    },

    ersetze: (annotation) => {
      const vorhanden = get().proSeite[annotation.seite]
      if (vorhanden === undefined) return
      set({
        proSeite: {
          ...get().proSeite,
          // An derselben Stelle ersetzen und nicht anhaengen: die Reihenfolge
          // entscheidet, was beim Ueberlappen oben liegt.
          [annotation.seite]: vorhanden.map((eintrag) =>
            eintrag.id === annotation.id ? annotation : eintrag
          )
        }
      })
    },

    entferne: (id) => {
      const proSeite = { ...get().proSeite }
      for (const [seite, liste] of Object.entries(proSeite)) {
        if (!liste.some((eintrag) => eintrag.id === id)) continue
        proSeite[Number(seite)] = liste.filter((eintrag) => eintrag.id !== id)
        set({ proSeite })
        return
      }
    },

    finde: (id) => {
      for (const liste of Object.values(get().proSeite)) {
        const treffer = liste.find((eintrag) => eintrag.id === id)
        if (treffer !== undefined) return treffer
      }
      return null
    },

    merkeGespeichert: () => {
      const { proSeite, urspruenglich } = get()
      const neu: Record<number, readonly Annotation[]> = {}
      for (const schluessel of Object.keys(urspruenglich)) {
        const seite = Number(schluessel)
        neu[seite] = proSeite[seite] ?? []
      }
      set({ urspruenglich: neu })
    }
  }
})

/**
 * Alle bekannten Annotationen in Seitenreihenfolge.
 *
 * Bewusst eine Funktion und kein Selektor im Store: sie erzeugt bei jedem
 * Aufruf ein neues Feld, was in einem zustand-Selektor eine Endlosschleife
 * ausloesen wuerde. Die Aufrufstelle merkt sich das Ergebnis mit `useMemo`.
 */
export function alleAnnotationen(
  proSeite: Readonly<Record<number, readonly Annotation[]>>
): Annotation[] {
  return Object.keys(proSeite)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((seite) => [...(proSeite[seite] ?? [])])
}

/**
 * Der Bestand eines Tabs (S6.1). `urspruenglich` reist mit: ohne es waere der
 * Aenderungssatz nach dem Zurueckwechseln leer, und die Anmerkung ginge beim
 * Speichern verloren. `fuerDokument` auch - sonst hielte `ladeSeite` den
 * eingespielten Bestand fuer den eines fremden Dokuments und verwuerfe ihn.
 */
export interface AnnotationsStand {
  proSeite: AnnotationsZustand['proSeite']
  urspruenglich: AnnotationsZustand['urspruenglich']
  vollstaendig: boolean
  fehler: string | null
  fuerDokument: PDFDocumentProxy | null
}

export function nimmAnnotationenAuf(): AnnotationsStand {
  const { proSeite, urspruenglich, vollstaendig, fehler } = useAnnotationen.getState()
  return { proSeite, urspruenglich, vollstaendig, fehler, fuerDokument }
}

/**
 * Spielt den Bestand eines Tabs ein. Ein laufendes `ladeAlles` des vorigen
 * Tabs verliert dabei seine Generation und bricht ab; `laeuft` beginnt
 * deshalb falsch, und die Liste liest bei Bedarf neu.
 */
export function spieleAnnotationenEin(stand: AnnotationsStand): void {
  fuerDokument = stand.fuerDokument
  generation += 1
  useAnnotationen.setState({
    proSeite: stand.proSeite,
    urspruenglich: stand.urspruenglich,
    vollstaendig: stand.vollstaendig,
    fehler: stand.fehler,
    laeuft: false
  })
}
