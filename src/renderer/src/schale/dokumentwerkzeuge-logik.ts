import { create } from 'zustand'
import { sammleAenderungen } from '../../../shared/aenderungen'
import type { Bereich } from '../../../shared/bereiche'
import type { DruckOptionen, Druckphase, Druckziel } from '../../../shared/druck'
import { verschluesseltText } from '../../../shared/errors'
import type { Feldwert } from '../../../shared/formulare'
import type { Dokumentquelle } from '../../../shared/ipc'
import { useAnnotationen } from '../annotations-store'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { geaenderteFelder, useFormular } from '../formular-store'
import { useTabs } from '../tabs-store'
import { beendeVorgang, beginneVorgang } from '../vorgaenge'
import { t } from '../../../shared/i18n'

/**
 * Zusammenfuehren, Teilen (S4.2a) und PNG-Export (S4.2b) auf der
 * Renderer-Seite.
 *
 * Der Renderer ordnet und beschreibt; gelesen und geschrieben wird im Main.
 * Drei Felder, die offen sein koennen (nie zwei zugleich): die
 * Reihenfolgeliste fuer das Zusammenfuehren, die Bereichseingabe fuer das
 * Teilen, Seiten und Aufloesung fuer den Export. Alles Zustaende der
 * Bedienung, nicht des Dokuments — deshalb ein eigener Store, der beim
 * Dokumentwechsel stehen bleibt (wer zusammenfuehrt, hat oft gar kein
 * Dokument offen).
 */
/**
 * `kuerzel` und `einstellungen` sind keine Dokumentwerkzeuge, sondern die
 * Kuerzeluebersicht und der Einstellungsdialog aus S5.2a. Sie teilen sich den
 * Zustand trotzdem mit den Feldern: es soll immer nur ein Streifen offen
 * sein, Escape soll ihn schliessen, und der Fokus soll hinein- und
 * zurueckwandern - all das haengt an diesem einen Wert.
 */
export type Werkzeug =
  | 'zusammenfuehren'
  | 'teilen'
  | 'png'
  | 'drucken'
  | 'kuerzel'
  | 'einstellungen'
  /** PDF nach Word (S6.7). */
  | 'word'

export interface DokumentwerkzeugZustand {
  offen: Werkzeug | null
  /** Die Quellen fuer das Zusammenfuehren in der gewaehlten Reihenfolge. */
  quellen: Dokumentquelle[]
  laeuft: boolean
  /** Beim PNG-Export: wie viele Bilder fertig sind. */
  fortschritt: { fertig: number; gesamt: number } | null
  /** Beim Drucken (S4.3): die Phase, die der Main zuletzt gemeldet hat. */
  druckphase: Druckphase | null

  oeffne: (was: Werkzeug) => void
  schliesse: () => void
  setzeQuellen: (quellen: Dokumentquelle[]) => void
  verschiebe: (index: number, richtung: -1 | 1) => void
  entferne: (index: number) => void
  setzeLaeuft: (laeuft: boolean) => void
  setzeFortschritt: (fortschritt: { fertig: number; gesamt: number } | null) => void
  setzeDruckphase: (phase: Druckphase | null) => void
}

export const useDokumentwerkzeuge = create<DokumentwerkzeugZustand>((set, get) => ({
  offen: null,
  quellen: [],
  laeuft: false,
  fortschritt: null,
  druckphase: null,

  oeffne: (was) => {
    set({ offen: was })
  },
  schliesse: () => {
    set({ offen: null })
  },
  setzeQuellen: (quellen) => {
    set({ quellen })
  },
  verschiebe: (index, richtung) => {
    const quellen = [...get().quellen]
    const ziel = index + richtung
    const a = quellen[index]
    const b = quellen[ziel]
    if (a === undefined || b === undefined) return
    quellen[index] = b
    quellen[ziel] = a
    set({ quellen })
  },
  entferne: (index) => {
    set({ quellen: get().quellen.filter((_, i) => i !== index) })
  },
  setzeLaeuft: (laeuft) => {
    set({ laeuft })
  },
  setzeFortschritt: (fortschritt) => {
    set({ fortschritt })
  },
  setzeDruckphase: (druckphase) => {
    set({ druckphase })
  }
}))

/**
 * Drucken (S4.3): der Main baut die Vorlage aus Arbeitskopie plus den
 * ungespeicherten Anmerkungen und Formularwerten - dieselbe Sammlung wie
 * beim Speichern - und druckt sie im versteckten Fenster. Bis die Antwort
 * kommt, zeigt das Feld die gemeldete Phase und bietet Abbrechen an.
 */
export async function druckeDokument(optionen: DruckOptionen, ziel: Druckziel): Promise<void> {
  const api = bruecke()
  const werkzeuge = useDokumentwerkzeuge.getState()
  const { pfad, setzeHinweis } = useDokument.getState()
  if (api === undefined || pfad === null || werkzeuge.laeuft) return
  const { proSeite, urspruenglich } = useAnnotationen.getState()
  const formular = useFormular.getState()
  const formularwerte: Record<string, Feldwert> = {}
  for (const name of geaenderteFelder(formular.werte, formular.ursprung)) {
    const wert = formular.werte[name]
    if (wert !== undefined) formularwerte[name] = wert
  }
  werkzeuge.setzeLaeuft(true)
  werkzeuge.setzeDruckphase('vorlage')
  // Der Hinweis am Ende gehoert zu diesem Tab; ein Wechsel ist bis dahin gesperrt (S6.1).
  beginneVorgang('drucken')
  try {
    const antwort = await api.dokumentDrucken({
      quelle: pfad,
      optionen,
      ziel,
      aenderungen: sammleAenderungen(proSeite, urspruenglich),
      formularwerte
    })
    if (antwort.art === 'abgebrochen') return
    if (antwort.art === 'abgelehnt') {
      setzeHinweis(antwort.grund)
      return
    }
    useDokumentwerkzeuge.getState().schliesse()
    setzeHinweis(
      antwort.art === 'gedruckt'
        ? t('druck.uebergeben')
        : t('druck.alsPdfFertig', { name: antwort.name, anzahl: antwort.seiten })
    )
  } catch (fehler) {
    console.error('Drucken fehlgeschlagen:', fehler)
    setzeHinweis(t('druck.fehler'))
  } finally {
    const stand = useDokumentwerkzeuge.getState()
    stand.setzeDruckphase(null)
    stand.setzeLaeuft(false)
    beendeVorgang('drucken')
  }
}

/** Bricht den laufenden Druck im Main ab (S4.3, Aufgabe 3). */
export async function brichDruckAb(): Promise<void> {
  const api = bruecke()
  if (api === undefined) return
  try {
    await api.druckAbbrechen()
  } catch (fehler) {
    console.error('Druck liess sich nicht abbrechen:', fehler)
  }
}

/**
 * Oeffnet das Zusammenfuehren: das geoeffnete Dokument steht vorn in der
 * Liste, der Dialog des Main liefert die weiteren. Bricht der Nutzer den
 * Dialog ab, bleibt das Feld offen, wenn schon etwas darin steht.
 */
export async function beginneZusammenfuehren(): Promise<void> {
  const werkzeuge = useDokumentwerkzeuge.getState()
  const { pfad, name, seitenzahl, ladeZustand, verschluesselt, setzeHinweis } =
    useDokument.getState()
  if (werkzeuge.offen !== 'zusammenfuehren') {
    // Ein passwortgeschuetztes Dokument kommt nicht in die Liste - pdf-lib
    // kann es nicht lesen. Andere Dateien zusammenfuehren geht trotzdem.
    if (verschluesselt) setzeHinweis(verschluesseltText())
    const start: Dokumentquelle[] =
      pfad !== null && name !== null && ladeZustand === 'bereit' && !verschluesselt
        ? [{ pfad, name, seiten: seitenzahl }]
        : []
    werkzeuge.setzeQuellen(start)
    werkzeuge.oeffne('zusammenfuehren')
  }
  await weitereQuellenWaehlen()
}

export async function weitereQuellenWaehlen(): Promise<void> {
  const api = bruecke()
  if (api === undefined) return
  const werkzeuge = useDokumentwerkzeuge.getState()
  try {
    const gewaehlt = await api.dokumenteWaehlen()
    if (gewaehlt === null) return
    const vorhanden = new Set(werkzeuge.quellen.map((q) => q.pfad))
    // Dieselbe Datei zweimal ist erlaubt (zwei Kopien hintereinander), aber
    // nicht aus Versehen: was schon in der Liste steht, kommt nur einmal dazu.
    const neue = gewaehlt.filter((q) => !vorhanden.has(q.pfad))
    useDokumentwerkzeuge.getState().setzeQuellen([...werkzeuge.quellen, ...neue])
  } catch (fehler) {
    console.error('Dokumente konnten nicht gewaehlt werden:', fehler)
    useDokument.getState().setzeHinweis(t('zusammen.waehlenFehler'))
  }
}

/** Fuehrt die Liste zusammen und oeffnet das Ergebnis. */
export async function fuehreZusammen(): Promise<void> {
  const api = bruecke()
  const werkzeuge = useDokumentwerkzeuge.getState()
  const { setzeHinweis } = useDokument.getState()
  if (api === undefined || werkzeuge.laeuft) return
  if (werkzeuge.quellen.length < 2) {
    setzeHinweis(t('zusammen.zuWenige'))
    return
  }
  werkzeuge.setzeLaeuft(true)
  try {
    const ergebnis = await api.dokumenteZusammenfuehren({
      quellen: werkzeuge.quellen.map((q) => q.pfad)
    })
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    useDokumentwerkzeuge.getState().schliesse()
    const hinweis =
      t('zusammen.fertig', { name: ergebnis.name, anzahl: ergebnis.seiten }) +
      (ergebnis.umbenannt.length > 0
        ? t('zusammen.umbenannt', {
            anzahl: ergebnis.umbenannt.length,
            von: ergebnis.umbenannt[0]?.von ?? '',
            nach: ergebnis.umbenannt[0]?.nach ?? ''
          })
        : '')
    // Das Ergebnis kommt in einen eigenen Tab (S6.1); die Quellen bleiben offen.
    await useTabs.getState().oeffneUeberPfad(ergebnis.pfad)
    useDokument.getState().setzeHinweis(hinweis)
  } catch (fehler) {
    console.error('Zusammenfuehren fehlgeschlagen:', fehler)
    setzeHinweis(t('zusammen.fehler'))
  } finally {
    useDokumentwerkzeuge.getState().setzeLaeuft(false)
  }
}

/** Teilt das geoeffnete Dokument in den Zielordner, den der Main erfragt. */
export async function teileDokument(bereiche: Bereich[] | 'einzelseiten'): Promise<void> {
  const api = bruecke()
  const werkzeuge = useDokumentwerkzeuge.getState()
  const { pfad, setzeHinweis } = useDokument.getState()
  if (api === undefined || pfad === null || werkzeuge.laeuft) return
  werkzeuge.setzeLaeuft(true)
  try {
    const ergebnis = await api.dokumentTeilen({ quelle: pfad, bereiche })
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    useDokumentwerkzeuge.getState().schliesse()
    setzeHinweis(
      t('teilen.fertig', { anzahl: ergebnis.dateien.length, ordner: ergebnis.verzeichnis })
    )
  } catch (fehler) {
    console.error('Teilen fehlgeschlagen:', fehler)
    setzeHinweis(t('teilen.fehler'))
  } finally {
    useDokumentwerkzeuge.getState().setzeLaeuft(false)
  }
}
