import { useMemo } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import { verschwundenText } from '../../shared/errors'
import type { GeoeffnetesDokument } from '../../shared/ipc'
import {
  nimmAnnotationenAuf,
  spieleAnnotationenEin,
  type AnnotationsStand
} from './annotations-store'
import { raeumeAuf } from './aufraeumen'
import { useBearbeitung } from './bearbeitung-store'
import { bruecke } from './bruecke'
import {
  gibDokumentAb,
  nimmDokumentAuf,
  passwortAusstehend,
  spieleDokumentEin,
  useDokument,
  type DokumentStand
} from './dokument-store'
import { nimmFormularAuf, spieleFormularEin, type FormularStand } from './formular-store'
import { nimmHistorieAuf, spieleHistorieEin, useHistorie, type HistorienStand } from './historie'
import {
  nimmMutationAuf,
  spieleMutationEin,
  useMutation,
  type MutationsStand
} from './mutation-store'
import { useAnzahlAenderungen, zaehleAenderungen } from './schale/speichern'
import {
  nimmSeitenauswahlAuf,
  spieleSeitenauswahlEin,
  type SeitenauswahlStand
} from './seitenauswahl-store'
import { nimmSucheAuf, spieleSucheEin, type SuchStand } from './suche-store'
import { laufenderVorgang } from './vorgaenge'
import { t } from '../../shared/i18n'

/**
 * Mehrere Dokumente, eines aktiv (S6.1a).
 *
 * **Architektur (entschieden):** ein aktiver Satz Stores plus diese Tab-Liste
 * mit Momentaufnahmen - kein Store je Tab. Dreissig Dateien lesen
 * `useDokument`, dazu `getState()` ausserhalb von React, und die Historie
 * haelt Closures auf die globalen Stores. All das bleibt richtig, solange nur
 * der aktive Tab handelt. Beim Wechsel wird der Stand des verlassenen Tabs
 * aus den Stores genommen (`nimm...Auf`) und der des Ziels eingespielt
 * (`spiele...Ein`); das Proxy wandert mit, geladen wird nichts.
 *
 * Damit kein asynchroner Schritt in den falschen Tab schreibt, ist Wechseln
 * und Schliessen gesperrt, solange geladen, nach dem Passwort gefragt,
 * mutiert, rueckgaengig gemacht, gespeichert oder gedruckt wird
 * (`sperrgrund`). Oeffnen und Schliessen laufen ausserdem nacheinander durch
 * eine Warteschlange: ein Dokument aus einer zweiten Instanz, das waehrend
 * einer Rueckfrage eintrifft, wartet, bis sie beantwortet ist.
 *
 * **Schnittstelle fuer die Tab-Leiste (S6.1b):**
 *
 * - `useTabs((z) => z.tabs)` - die Tabs in Anzeigereihenfolge (`id`, `pfad`,
 *   `name`, `verschwunden`).
 * - `useTabs((z) => z.aktiv)` - die Kennung des aktiven Tabs oder `null`
 *   (Startseite).
 * - `useGeaendertJeTab()` - ob ein Tab ungespeicherte Aenderungen hat, je
 *   Kennung. Abgeleitet: fuer den aktiven aus den Stores, fuer die anderen
 *   aus ihrer Momentaufnahme.
 * - `wechsle(id)`, `naechster(1 | -1)` - liefern `false`, wenn gesperrt
 *   (der Grund steht dann als Hinweis im Fenster).
 * - `schliesse(id)` - fragt bei Aenderungen nach; `false` heisst "bleibt offen".
 * - `sperrgrund()` - um Knoepfe waehrend der Sperre zu deaktivieren.
 *
 * Seit S6.1b bedient die Leiste (schale/Tableiste.tsx) diese Schnittstelle,
 * dazu Kuerzel und Menue ueber schale/befehle.ts; die Sitzung (Tabs beim
 * Neustart wieder oeffnen) liegt in schale/sitzung.ts und oeffnet ueber
 * `oeffneStill`.
 */

export interface Tab {
  id: string
  /** Der Pfad, wie ihn der Main in `GeoeffnetesDokument` geliefert hat. */
  pfad: string
  name: string
  /**
   * Die Datei ist ausserhalb der Anwendung verschwunden oder ersetzt worden
   * (S1.5, Fall 4). Am Tab vermerkt, weil die Meldung auch fuer einen Tab
   * kommen kann, der gerade nicht zu sehen ist.
   */
  verschwunden: boolean
}

/** Alles, was ein inaktiver Tab braucht, um beim Zurueckwechseln so dazustehen wie vorher. */
export interface Momentaufnahme {
  dokument: DokumentStand
  annotationen: AnnotationsStand
  formular: FormularStand
  historie: HistorienStand
  mutation: MutationsStand
  seitenauswahl: SeitenauswahlStand
  suche: SuchStand
  /** Beim Verlassen berechnet - der Stand aendert sich nicht, solange der Tab inaktiv ist. */
  geaendert: boolean
}

export interface TabsZustand {
  tabs: Tab[]
  aktiv: string | null
  /** Die Momentaufnahmen der **inaktiven** Tabs; der aktive lebt in den Stores. */
  staende: Readonly<Record<string, Momentaufnahme>>

  /**
   * Oeffnet ein vom Main geliefertes Dokument in einem neuen Tab. Ist sein
   * Pfad schon offen, wird nur dieser Tab aktiviert (Nutzerentscheidung) -
   * die ungespeicherten Aenderungen darin bleiben, wie sie sind.
   */
  oeffneOderAktiviere: (geoeffnet: GeoeffnetesDokument) => Promise<void>
  oeffneUeberDialog: () => Promise<void>
  /**
   * Drag & Drop, "Oeffnen mit", zweite Instanz, Zuletzt-Liste, Zusammenfuehren.
   * Liefert die Meldung, falls das Dokument nicht geoeffnet wurde (sonst
   * `null`) - wer mehrere Dateien nacheinander oeffnet, sammelt sie damit,
   * statt dass das naechste Laden den Hinweis zur vorigen ueberschreibt.
   */
  oeffneUeberPfad: (pfad: string) => Promise<string | null>
  /**
   * Oeffnen fuer die Sitzungswiederherstellung (S6.1b): derselbe Weg ueber den
   * Main wie `oeffneUeberPfad`, aber still - ein Fehlschlag setzt weder
   * Hinweis noch Fehlerseite; die Sitzung meldet alle auf einmal.
   */
  oeffneStill: (pfad: string) => Promise<Oeffnung>
  wechsle: (id: string) => boolean
  naechster: (richtung: 1 | -1) => boolean
  schliesse: (id: string) => Promise<boolean>
  /** Meldung `dokumentVerschwunden` aus dem Main. */
  meldeVerschwunden: (pfad: string) => void
}

/**
 * Wie ein Oeffnen ausging. `abgebrochen` ist die Passwortabfrage, die der
 * Nutzer weggeklickt hat - kein Fehler, den man ihm hinterher melden muesste.
 */
export type Oeffnung =
  { art: 'geoeffnet' } | { art: 'abgebrochen' } | { art: 'fehler'; meldung: string | null }

let naechsteNummer = 1

/** Ein Tab wird gerade geschlossen (Rueckfrage offen). */
let schliessenLaeuft = false

/**
 * Oeffnen und Schliessen nacheinander. Ohne das koennte ein Dokument aus dem
 * System mitten in das Laden eines anderen fallen, und beide naehmen den
 * Stand desselben verlassenen Tabs auf.
 */
let warteschlange: Promise<unknown> = Promise.resolve()

function nacheinander<T>(auftrag: () => Promise<T>): Promise<T> {
  const ergebnis = warteschlange.then(auftrag, auftrag)
  warteschlange = ergebnis.catch(() => undefined)
  return ergebnis
}

/**
 * Ob zwei Pfade dieselbe Datei meinen. Der Main liefert Pfade in seiner
 * Schreibweise; unter Windows koennen Gross-/Kleinschreibung und Trenner
 * trotzdem abweichen - etwa wenn ein Pfad aus der Zuletzt-Liste kommt und
 * der andere aus einem Dialog.
 */
export function gleicherPfad(a: string, b: string): boolean {
  if (a === b) return true
  const windows = (p: string): boolean => /^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\')
  if (!windows(a) || !windows(b)) return false
  const norm = (p: string): string => p.replace(/\//g, '\\').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Warum gerade nicht gewechselt oder geschlossen werden darf, `null` wenn es
 * geht. Jeder dieser Vorgaenge liest zu Beginn die Stores des aktiven Tabs
 * und schreibt nach einem `await` hinein - wechselte dazwischen der Tab,
 * landete das Ergebnis im falschen Dokument.
 */
export function sperrgrund(): string | null {
  const dokument = useDokument.getState()
  if (dokument.passwortFrage !== null || passwortAusstehend()) {
    return t('tabs.sperrePasswort')
  }
  if (dokument.ladeZustand === 'laedt') return t('tabs.sperreLaedt')
  if (useMutation.getState().laeuft !== null) return t('tabs.sperreMutation')
  if (useHistorie.getState().beschaeftigt) return t('tabs.sperreHistorie')
  const vorgang = laufenderVorgang()
  if (vorgang === 'speichern') return t('tabs.sperreSpeichern')
  if (vorgang === 'drucken') return t('tabs.sperreDrucken')
  if (vorgang !== null) return t('tabs.sperreVorgang')
  if (schliessenLaeuft) return t('tabs.sperreSchliessen')
  return null
}

function nimmAlleAuf(): Momentaufnahme {
  const annotationen = nimmAnnotationenAuf()
  const formular = nimmFormularAuf()
  const mutation = nimmMutationAuf()
  return {
    dokument: nimmDokumentAuf(),
    annotationen,
    formular,
    historie: nimmHistorieAuf(),
    mutation,
    seitenauswahl: nimmSeitenauswahlAuf(),
    suche: nimmSucheAuf(),
    geaendert:
      zaehleAenderungen({
        proSeite: annotationen.proSeite,
        urspruenglich: annotationen.urspruenglich,
        werte: formular.werte,
        ursprung: formular.ursprung,
        mutationen: mutation.anzahl
      }) > 0
  }
}

/**
 * Spielt einen Tab ein. Der Dokument-Store zuerst: `useMeldeAenderungen`
 * haengt am Pfad, und kaeme der Pfad nach den Anmerkungen, meldete es fuer
 * einen Augenblick den Stand des Ziels unter dem Pfad des verlassenen Tabs.
 */
function spieleAlleEin(stand: Momentaufnahme): void {
  spieleDokumentEin(stand.dokument)
  spieleAnnotationenEin(stand.annotationen)
  spieleFormularEin(stand.formular)
  spieleHistorieEin(stand.historie)
  spieleMutationEin(stand.mutation)
  spieleSeitenauswahlEin(stand.seitenauswahl)
  spieleSucheEin(stand.suche)
  // Die ausgewaehlte Anmerkung gehoert zum verlassenen Tab.
  useBearbeitung.getState().waehle(null)
}

/**
 * Seitencaches des verlassenen Dokuments freigeben. Das Proxy bleibt
 * gueltig; pdf.js liest die Seiten beim Zurueckwechseln neu. Scheitert es,
 * weil noch eine Seite zeichnet, bleibt der Speicher eben belegt, bis der Tab
 * das naechste Mal verlassen wird - kein Grund fuer eine Meldung.
 */
function raeumeProxyAuf(proxy: PDFDocumentProxy | null): void {
  if (proxy === null) return
  proxy.cleanup().catch(() => undefined)
}

/**
 * Ein geschlossener Tab gibt sein Dokument frei - ueber die Ladeaufgabe, wie
 * in `uebernimm`. Der gemeinsame Worker bleibt stehen (`stelleWorkerBereit`).
 */
function gibFrei(proxy: PDFDocumentProxy | null): void {
  if (proxy === null) return
  proxy.loadingTask.destroy().catch((fehler: unknown) => {
    console.error('Dokument liess sich nicht freigeben:', fehler)
  })
}

function meldeSchliessen(pfad: string): void {
  const api = bruecke()
  if (api === undefined) return
  api.dokumentSchliessen(pfad).catch((fehler: unknown) => {
    console.error('Schliessen liess sich dem Main nicht melden:', fehler)
  })
}

export const useTabs = create<TabsZustand>((set, get) => {
  const findeTab = (pfad: string): Tab | undefined =>
    get().tabs.find((tab) => gleicherPfad(tab.pfad, pfad))

  /** Wechsel ohne Sperrpruefung - fuer Aufrufer, die sie selbst gemacht haben. */
  const wechsleIntern = (id: string): void => {
    const { aktiv, staende, tabs } = get()
    const ziel = staende[id]
    if (id === aktiv || ziel === undefined) return
    const rest: Record<string, Momentaufnahme> = { ...staende }
    Reflect.deleteProperty(rest, id)
    let verlassen: PDFDocumentProxy | null = null
    if (aktiv !== null) {
      const stand = nimmAlleAuf()
      rest[aktiv] = stand
      verlassen = stand.dokument.dokument
    }
    // `aktiv` vor dem Einspielen: die Pfadnachfuehrung unten schreibt in den
    // aktiven Tab, und das muss dann schon das Ziel sein.
    set({ aktiv: id, staende: rest })
    spieleAlleEin(ziel)
    if (tabs.find((tab) => tab.id === id)?.verschwunden === true) {
      useDokument.getState().setzeHinweis(verschwundenText())
    }
    raeumeProxyAuf(verlassen)
  }

  const wechsleMitSperre = (id: string): boolean => {
    if (id === get().aktiv) return true
    const grund = sperrgrund()
    if (grund !== null) {
      useDokument.getState().setzeHinweis(grund)
      return false
    }
    wechsleIntern(id)
    return get().aktiv === id
  }

  /**
   * Nimmt einen Tab aus der Liste. War er aktiv, rueckt der rechte Nachbar
   * nach (sonst der linke); war es der letzte, bleibt die Startseite.
   */
  const entferne = (id: string): void => {
    const { tabs, aktiv, staende } = get()
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const uebrig = tabs.filter((tab) => tab.id !== id)
    if (id !== aktiv) {
      const rest: Record<string, Momentaufnahme> = { ...staende }
      Reflect.deleteProperty(rest, id)
      set({ tabs: uebrig, staende: rest })
      gibFrei(staende[id]?.dokument.dokument ?? null)
      return
    }
    const proxy = useDokument.getState().dokument
    const nachbar = tabs[index + 1] ?? tabs[index - 1]
    const zielStand = nachbar === undefined ? undefined : staende[nachbar.id]
    if (nachbar !== undefined && zielStand !== undefined) {
      const rest: Record<string, Momentaufnahme> = { ...staende }
      Reflect.deleteProperty(rest, nachbar.id)
      set({ tabs: uebrig, aktiv: nachbar.id, staende: rest })
      spieleAlleEin(zielStand)
      if (nachbar.verschwunden) useDokument.getState().setzeHinweis(verschwundenText())
    } else {
      set({ tabs: uebrig, aktiv: null })
      raeumeAuf()
      spieleDokumentEin(null)
      if (uebrig.length === 0) {
        // Erst jetzt ist wirklich nichts mehr offen: der leere Pfad setzt im
        // Main jeden Stand zurueck (Vertrag in shared/ipc.ts).
        bruecke()
          ?.dokumentGeaendert({ pfad: '', geaendert: false })
          .catch((fehler: unknown) => {
            console.error('Aenderungsstand konnte nicht gemeldet werden:', fehler)
          })
      }
    }
    gibFrei(proxy)
  }

  /** Setzt eine Meldung als Hinweis - ausser beim stillen Oeffnen der Sitzung. */
  const melde = (meldung: string | null, still: boolean): void => {
    if (!still && meldung !== null) useDokument.getState().setzeHinweis(meldung)
  }

  const oeffneIntern = async (geoeffnet: GeoeffnetesDokument, still = false): Promise<Oeffnung> => {
    const vorhanden = findeTab(geoeffnet.pfad)
    if (vorhanden !== undefined) {
      return wechsleMitSperre(vorhanden.id)
        ? { art: 'geoeffnet' }
        : { art: 'fehler', meldung: sperrgrund() }
    }
    const grund = sperrgrund()
    if (grund !== null) {
      const meldung = t('tabs.nichtGeoeffnet', { grund, name: geoeffnet.name })
      melde(meldung, still)
      // Der Main hat die Datei schon gelesen und bewacht sie; sie gehoert
      // aber zu keinem Tab.
      meldeSchliessen(geoeffnet.pfad)
      return { art: 'fehler', meldung }
    }

    const vorher = get().aktiv
    let verlassen: PDFDocumentProxy | null = null
    if (vorher !== null) {
      const stand = nimmAlleAuf()
      verlassen = stand.dokument.dokument
      set({ staende: { ...get().staende, [vorher]: stand } })
    }
    // Ausdruecklich und nicht erst im Effekt an der Ladenummer: der Stand des
    // verlassenen Tabs steckt in seiner Momentaufnahme, die Stores gehoeren
    // ab hier dem neuen Tab.
    raeumeAuf()
    gibDokumentAb()
    raeumeProxyAuf(verlassen)

    const id = 'tab-' + String(naechsteNummer++)
    set({
      tabs: [
        ...get().tabs,
        { id, pfad: geoeffnet.pfad, name: geoeffnet.name, verschwunden: false }
      ],
      aktiv: id
    })
    await useDokument.getState().uebernimm(geoeffnet)

    const ergebnis = useDokument.getState()
    if (ergebnis.ladeZustand === 'bereit') return { art: 'geoeffnet' }

    // Gescheitert oder abgebrochen: ein Tab ohne Dokument hilft niemandem.
    // Gab es einen vorigen, kommt er zurueck und die Meldung steht als
    // Hinweis darueber; sonst bleibt die Fehlerseite stehen - ausser beim
    // stillen Oeffnen: dort kommt vielleicht noch ein lesbarer Tab, und die
    // Sitzung meldet die Fehlschlaege gesammelt.
    const fehlgeschlagen = ergebnis.ladeZustand === 'fehler'
    const meldung = fehlgeschlagen ? ergebnis.fehler : ergebnis.hinweis
    const ausgang: Oeffnung = fehlgeschlagen ? { art: 'fehler', meldung } : { art: 'abgebrochen' }
    meldeSchliessen(geoeffnet.pfad)
    const uebrig = get().tabs.filter((tab) => tab.id !== id)
    const zurueck = vorher === null ? undefined : get().staende[vorher]
    if (vorher !== null && zurueck !== undefined) {
      const rest: Record<string, Momentaufnahme> = { ...get().staende }
      Reflect.deleteProperty(rest, vorher)
      set({ tabs: uebrig, aktiv: vorher, staende: rest })
      spieleAlleEin(zurueck)
      melde(meldung, still)
      return ausgang
    }
    set({ tabs: uebrig, aktiv: null })
    if (still) spieleDokumentEin(null)
    return ausgang
  }

  /** Der gemeinsame Weg ueber den Main fuer `oeffneUeberPfad` und `oeffneStill`. */
  const oeffnePfadIntern = async (pfad: string, still: boolean): Promise<Oeffnung> => {
    const api = bruecke()
    if (api === undefined) return { art: 'fehler', meldung: null }
    // Schon offen: nur aktivieren, und zwar **ohne** den Main zu fragen.
    // Ein erneutes Lesen dort koennte die Arbeitskopie des offenen Tabs
    // durch die Datei ersetzen - samt aller Mutationen.
    const vorhanden = findeTab(pfad)
    if (vorhanden !== undefined) {
      return wechsleMitSperre(vorhanden.id)
        ? { art: 'geoeffnet' }
        : { art: 'fehler', meldung: sperrgrund() }
    }
    const grund = sperrgrund()
    if (grund !== null) {
      melde(grund, still)
      return { art: 'fehler', meldung: grund }
    }
    const ergebnis = await api.dokumentOeffnePfad(pfad)
    if (!ergebnis.ok) {
      // Wer die Rueckfrage des Main selbst abgelehnt hat, braucht keine Meldung
      // und gilt nicht als fehlgeschlagen.
      if (ergebnis.abgebrochen === true) return { art: 'abgebrochen' }
      // Als Meldung, nicht als Fehlerzustand: ein abgelehnter Drop darf
      // das gerade offene Dokument nicht wegnehmen.
      melde(ergebnis.grund, still)
      return { art: 'fehler', meldung: ergebnis.grund }
    }
    return oeffneIntern(ergebnis.dokument, still)
  }

  return {
    tabs: [],
    aktiv: null,
    staende: {},

    oeffneOderAktiviere: (geoeffnet) =>
      nacheinander(async () => {
        await oeffneIntern(geoeffnet)
      }),

    oeffneUeberDialog: () =>
      nacheinander(async () => {
        const api = bruecke()
        if (api === undefined) return
        // Vor dem Dialog pruefen: wer erst waehlt und dann abgewiesen wird,
        // hat umsonst gesucht.
        const grund = sperrgrund()
        if (grund !== null) {
          useDokument.getState().setzeHinweis(grund)
          return
        }
        const geoeffnet = await api.dokumentOeffnen()
        if (geoeffnet === null) return
        await oeffneIntern(geoeffnet)
      }),

    oeffneUeberPfad: (pfad) =>
      nacheinander(async () => {
        const ausgang = await oeffnePfadIntern(pfad, false)
        return ausgang.art === 'fehler' ? ausgang.meldung : null
      }),

    oeffneStill: (pfad) => nacheinander(() => oeffnePfadIntern(pfad, true)),

    wechsle: (id) => {
      if (get().tabs.every((tab) => tab.id !== id)) return false
      return wechsleMitSperre(id)
    },

    naechster: (richtung) => {
      const { tabs, aktiv } = get()
      if (tabs.length < 2) return false
      const index = tabs.findIndex((tab) => tab.id === aktiv)
      const ziel = tabs[(index + richtung + tabs.length) % tabs.length]
      return ziel === undefined ? false : wechsleMitSperre(ziel.id)
    },

    schliesse: (id) =>
      nacheinander(async () => {
        const grund = sperrgrund()
        if (grund !== null) {
          useDokument.getState().setzeHinweis(grund)
          return false
        }
        const tab = get().tabs.find((eintrag) => eintrag.id === id)
        if (tab === undefined) return false
        const api = bruecke()
        schliessenLaeuft = true
        try {
          const geaendert =
            id === get().aktiv ? aktiverTabGeaendert() : get().staende[id]?.geaendert === true
          if (geaendert && api !== undefined) {
            // Modal im Main, vorbelegt ist Abbrechen; `true` heisst verwerfen.
            const verwerfen = await api.tabSchliessenFragen(tab.name)
            if (!verwerfen) return false
          }
          meldeSchliessen(tab.pfad)
          entferne(id)
          return true
        } finally {
          schliessenLaeuft = false
        }
      }),

    meldeVerschwunden: (pfad) => {
      const { tabs, aktiv } = get()
      // Findet sich kein Tab mit genau diesem Pfad, ist er bei nur einem
      // offenen Tab trotzdem eindeutig - der Main nennt den Pfad, den er
      // bewacht, und das ist der, den er beim Oeffnen geliefert hat.
      const tab = findeTab(pfad) ?? (tabs.length === 1 ? tabs[0] : undefined)
      if (tab === undefined) return
      set({
        tabs: tabs.map((eintrag) =>
          eintrag.id === tab.id ? { ...eintrag, verschwunden: true } : eintrag
        )
      })
      // Die geladenen Seiten bleiben lesbar, deshalb nur ein Hinweis - und
      // nur, wenn der Tab zu sehen ist. Beim Wechsel dorthin kommt er nach.
      if (tab.id === aktiv) useDokument.getState().setzeHinweis(verschwundenText())
    }
  }
})

/** Ob der aktive Tab ungespeicherte Aenderungen hat - dieselbe Rechnung wie in der Schale. */
function aktiverTabGeaendert(): boolean {
  const annotationen = nimmAnnotationenAuf()
  const formular = nimmFormularAuf()
  return (
    zaehleAenderungen({
      proSeite: annotationen.proSeite,
      urspruenglich: annotationen.urspruenglich,
      werte: formular.werte,
      ursprung: formular.ursprung,
      mutationen: useMutation.getState().anzahl
    }) > 0
  )
}

/**
 * Pfad und Name des aktiven Tabs folgen dem Dokument-Store: nach "Speichern
 * unter" lebt das Dokument unter neuem Namen weiter (`uebernimmZiel`), und
 * die Leiste soll ihn zeigen. Ein Pfad, der sich aendert, ist eine andere
 * Datei - ein Vermerk "verschwunden" gilt dann nicht mehr.
 */
useDokument.subscribe((zustand, vorher) => {
  if (zustand.pfad === vorher.pfad && zustand.name === vorher.name) return
  const { pfad, name } = zustand
  if (pfad === null || name === null) return
  const { aktiv, tabs } = useTabs.getState()
  const tab = tabs.find((eintrag) => eintrag.id === aktiv)
  if (tab === undefined || (tab.pfad === pfad && tab.name === name)) return
  useTabs.setState({
    tabs: tabs.map((eintrag) =>
      eintrag.id === aktiv
        ? { ...eintrag, pfad, name, verschwunden: eintrag.pfad === pfad && eintrag.verschwunden }
        : eintrag
    )
  })
})

/**
 * Ob jeder Tab ungespeicherte Aenderungen hat, je Kennung (fuer die Leiste in
 * S6.1b). Der aktive aus den Stores, die anderen aus ihrer Momentaufnahme.
 */
export function useGeaendertJeTab(): Readonly<Record<string, boolean>> {
  const aktivGeaendert = useAnzahlAenderungen() > 0
  const tabs = useTabs((zustand) => zustand.tabs)
  const aktiv = useTabs((zustand) => zustand.aktiv)
  const staende = useTabs((zustand) => zustand.staende)
  return useMemo(
    () =>
      Object.fromEntries(
        tabs.map((tab) => [
          tab.id,
          tab.id === aktiv ? aktivGeaendert : staende[tab.id]?.geaendert === true
        ])
      ),
    [tabs, aktiv, staende, aktivGeaendert]
  )
}

/** Nur fuer Tests: leere Liste, frische Warteschlange. */
export function setzeTabsZurueck(): void {
  naechsteNummer = 1
  schliessenLaeuft = false
  warteschlange = Promise.resolve()
  useTabs.setState({ tabs: [], aktiv: null, staende: {} })
}
