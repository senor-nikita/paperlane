import { useEffect } from 'react'
import type { GeoeffnetesDokument } from '../../../shared/ipc'
import {
  istSitzung,
  LEERE_SITZUNG,
  MAX_LESEPOSITIONEN,
  MAX_SITZUNG_TABS,
  type Leseposition,
  type Sitzung
} from '../../../shared/settings'
import { raeumeAuf } from '../aufraeumen'
import { useBearbeitung } from '../bearbeitung-store'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { gleicherPfad, useTabs, type Tab } from '../tabs-store'
import { t } from '../../../shared/i18n'

/**
 * Der Lebenszyklus einer Sitzung: das Dokument aus der Befehlszeile, das
 * Aufraeumen beim Wechsel und die Leseposition.
 *
 * Alles drei haengt am geoeffneten Dokument und an nichts sonst — deshalb in
 * einem eigenen Modul und nicht in der App-Schale, die davon nur weiss, dass
 * sie es einmal aufrufen muss.
 */

/** Wartezeit, bevor eine geaenderte Leseposition gesichert wird. */
export const SICHERN_NACH_MS = 1500

/**
 * Autor, Zeichenvorgaben und Ansichtsvorgabe aus den Einstellungen (S2.2,
 * Aufgabe 8; S5.2a, Aufgabe 5).
 *
 * Einmal beim Start. Der Autorenname kommt vom Betriebssystem, sofern die
 * Einstellungsdatei keinen eigenen traegt — das entscheidet der Main-Prozess
 * beim Anlegen der Vorgaben, nicht diese Stelle. Die Passung gilt fuer das
 * naechste geoeffnete Dokument; ein Startdokument, das vor der Antwort schon
 * geladen ist, behaelt die eingebaute Vorgabe.
 */
export function useAnnotationsvorgaben(): void {
  const setzeAutor = useBearbeitung((zustand) => zustand.setzeAutor)
  const setzeFarbe = useBearbeitung((zustand) => zustand.setzeFarbe)
  const setzeStrichstaerke = useBearbeitung((zustand) => zustand.setzeStrichstaerke)
  const setzeStandardPassung = useDokument((zustand) => zustand.setzeStandardPassung)

  useEffect(() => {
    const api = bruecke()
    if (api === undefined) return
    api
      .settingsGet()
      .then((einstellungen) => {
        setzeAutor(einstellungen.autorName)
        setzeFarbe(einstellungen.annotationen.farbe)
        setzeStrichstaerke(einstellungen.annotationen.strichstaerke)
        setzeStandardPassung(einstellungen.ansicht.passung)
      })
      .catch((error: unknown) => {
        // Kein Grund, das Zeichnen zu verhindern: der Store haelt brauchbare
        // Vorgaben. Verschwiegen wird der Fehlschlag trotzdem nicht.
        console.error('Vorgaben fuer Anmerkungen konnten nicht gelesen werden:', error)
      })
  }, [setzeAutor, setzeFarbe, setzeStrichstaerke, setzeStandardPassung])
}

/**
 * Die Tabs der letzten Sitzung als Settings-Schluessel `sitzung` (S6.1b):
 * gekuerzt auf `MAX_SITZUNG_TABS`, `aktiv` immer im Bereich - der Main lehnt
 * alles andere ab (`istSitzung`), und eine abgelehnte Sitzung waere still
 * verloren.
 */
export function alsSitzung(tabs: readonly Tab[], aktiv: string | null): Sitzung {
  const pfade = tabs.slice(0, MAX_SITZUNG_TABS).map((tab) => tab.pfad)
  const index = pfade.length === 0 ? 0 : tabs.findIndex((tab) => tab.id === aktiv)
  return { tabs: pfade, aktiv: index >= 0 && index < pfade.length ? index : 0 }
}

/** Dateiname aus einem Pfad, fuer den Sammelhinweis - beide Trenner, weil Windows. */
function dateiname(pfad: string): string {
  return pfad.split(/[\\/]/).pop() ?? pfad
}

export function sammelhinweis(fehlend: readonly string[]): string {
  const namen = fehlend.map(dateiname).join(', ')
  return t('sitzung.fehlend', { anzahl: fehlend.length, namen })
}

/**
 * Oeffnet die Tabs der letzten Sitzung und danach das Startdokument.
 *
 * Der Reihe nach und jeder Pfad ueber den Main (`oeffneStill` ->
 * `dokumentOeffnePfad`): die Sitzung ist kein Weg an der Pfadpruefung vorbei
 * (Invariante 11). Was fehlt oder sich nicht lesen laesst, wird still
 * uebersprungen und am Ende in **einem** Hinweis genannt - eine Meldung je
 * Datei ueberschriebe sich gegenseitig, und nur die letzte bliebe stehen.
 * Eine abgebrochene Passwortabfrage ueberspringt das Dokument ohne Meldung:
 * der Nutzer hat es selbst so gewollt.
 *
 * Das Startdokument aus der Befehlszeile (Doppelklick bei geschlossener
 * Anwendung) kommt **zuletzt** und wird damit der aktive Tab - der Nutzer hat
 * gerade diese Datei angeklickt. Steht es schon in der Sitzung, wird es nur
 * aktiviert (`oeffneOderAktiviere`).
 */
export async function stelleSitzungHer(
  sitzung: Sitzung,
  start: GeoeffnetesDokument | null
): Promise<void> {
  const fehlend: string[] = []
  for (const pfad of sitzung.tabs) {
    const ausgang = await useTabs.getState().oeffneStill(pfad)
    if (ausgang.art === 'fehler') fehlend.push(pfad)
  }
  const gemerkt = sitzung.tabs[sitzung.aktiv]
  if (gemerkt !== undefined) {
    const tab = useTabs.getState().tabs.find((eintrag) => gleicherPfad(eintrag.pfad, gemerkt))
    if (tab !== undefined) useTabs.getState().wechsle(tab.id)
  }
  if (start !== null) await useTabs.getState().oeffneOderAktiviere(start)
  if (fehlend.length > 0) {
    // Nach dem Startdokument: dessen Laden raeumte den Hinweis sonst weg.
    // Hat es selbst eine Meldung hinterlassen, bleibt sie davor stehen.
    const vorher = useDokument.getState().hinweis
    const text = sammelhinweis(fehlend)
    useDokument.getState().setzeHinweis(vorher === null ? text : vorher + ' ' + text)
  }
}

/**
 * Laeuft die Wiederherstellung schon? Einmal je Fenster: im StrictMode laeuft
 * der Effekt zweimal, und die Sitzung zweimal zu oeffnen hiesse, den
 * Sammelhinweis doppelt zu zaehlen.
 */
let wiederherstellung: Promise<void> | null = null

/**
 * Erst nach der Wiederherstellung sichern: eine Passwortabfrage mitten in der
 * Sitzung kann dauern, und eine halb geoeffnete Sitzung ueberschriebe
 * zwischenzeitlich die vollstaendige.
 */
let sichernErlaubt = false

/** Nur fuer Tests. */
export function setzeSitzungZurueck(): void {
  wiederherstellung = null
  sichernErlaubt = false
}

/**
 * Die letzte Sitzung wiederherstellen und das Dokument aus der Befehlszeile
 * uebernehmen (S6.1b) - beides beim Start, das Startdokument als letzter und
 * damit aktiver Tab.
 */
export function useStartdokument(): void {
  useEffect(() => {
    const api = bruecke()
    if (api === undefined) {
      console.error('Bruecke fehlt: window.api ist undefined. Das Preload wurde nicht geladen.')
      return
    }
    if (wiederherstellung !== null) return
    const sitzung = api
      .settingsGet()
      .then((einstellungen) => {
        // Der Main liefert nur gepruefte Einstellungen; eine fehlende oder
        // kaputte Sitzung (aeltere Datei, Test-Attrappe) ist einfach leer.
        const gemerkt: unknown = (einstellungen as Partial<typeof einstellungen>).sitzung
        return istSitzung(gemerkt) ? gemerkt : LEERE_SITZUNG
      })
      .catch((error: unknown) => {
        console.error('Sitzung konnte nicht gelesen werden:', error)
        return LEERE_SITZUNG
      })
    const start = api.dokumentBeimStart().catch((error: unknown) => {
      console.error('Startdokument konnte nicht geladen werden:', error)
      return null
    })
    wiederherstellung = Promise.all([sitzung, start])
      .then(([gemerkt, geoeffnet]) => stelleSitzungHer(gemerkt, geoeffnet))
      .catch((error: unknown) => {
        console.error('Sitzung konnte nicht wiederhergestellt werden:', error)
      })
      .finally(() => {
        sichernErlaubt = true
        sichereSitzung()
      })
  }, [])
}

function sichereSitzung(): void {
  const api = bruecke()
  if (api === undefined || !sichernErlaubt) return
  const { tabs, aktiv } = useTabs.getState()
  api.settingsSet({ sitzung: alsSitzung(tabs, aktiv) }).catch((error: unknown) => {
    console.error('Sitzung konnte nicht gesichert werden:', error)
  })
}

/**
 * Die offenen Tabs laufend als Sitzung sichern (S6.1b): bei jedem Oeffnen,
 * Schliessen und Wechsel, verzoegert wie die Leseposition - wer mit Strg+Tab
 * durch zehn Tabs laeuft, soll nicht zehnmal die Einstellungsdatei schreiben.
 *
 * Beim Schliessen des Fensters wird sofort gesichert: die Verzoegerung
 * liefe sonst ins Leere, und die Tabs der letzten Sekunde fehlten beim
 * naechsten Start. Die Nachricht an den Main geht noch vor dem Entladen
 * hinaus; auf die Antwort wartet niemand.
 */
export function useSitzungSichern(): void {
  useEffect(() => {
    let zeitgeber: ReturnType<typeof setTimeout> | null = null
    const abmelden = useTabs.subscribe((zustand, vorher) => {
      if (zustand.tabs === vorher.tabs && zustand.aktiv === vorher.aktiv) return
      if (zeitgeber !== null) clearTimeout(zeitgeber)
      zeitgeber = setTimeout(() => {
        zeitgeber = null
        sichereSitzung()
      }, SICHERN_NACH_MS)
    })
    const beimEntladen = (): void => {
      if (zeitgeber === null) return
      clearTimeout(zeitgeber)
      zeitgeber = null
      sichereSitzung()
    }
    window.addEventListener('beforeunload', beimEntladen)
    return () => {
      abmelden()
      window.removeEventListener('beforeunload', beimEntladen)
      if (zeitgeber !== null) clearTimeout(zeitgeber)
    }
  }, [])
}

/**
 * Was zum vorigen Dokument gehoerte, muss weg: sonst durchsuchte die Suche den
 * Text der alten Datei und die Anmerkungsliste zeigte deren Anmerkungen. Was
 * alles dazugehoert, steht in `raeumeAuf` (aufraeumen.ts).
 */
export function useAufraeumenBeiWechsel(): void {
  // Am Ladevorgang und nicht am Pfad: seit S2.3a kann ein Dokument seinen
  // Pfad wechseln, ohne neu geladen zu werden ("Speichern unter"). Haenge das
  // Aufraeumen am Pfad, warf es dort die eben gespeicherten Anmerkungen weg.
  const ladeNummer = useDokument((zustand) => zustand.ladeNummer)

  /**
   * Seit S4.0 ist dieser Effekt das **Cache-Invalidierungsprotokoll** einer
   * Mutation: das Neuladen nach einer Mutation erhoeht `ladeNummer` genauso
   * wie ein Dokumentwechsel, und alles hier muss weg, weil es zum alten
   * Dokument gehoerte - auch nach einer Mutation, denn Seitenzahlen und
   * Objektnummern haben sich verschoben. Nicht hier, weil am Proxy statt an
   * der Ladenummer haengend: Seiten-Canvases und Miniaturen (sie zeichnen
   * neu, sobald `dokument` wechselt) und das alte Proxy selbst
   * (`uebernimm` ruft `destroy`). Der Mutationszaehler ueberlebt das
   * Neuladen nach einer Mutation und faellt nur beim Wechsel.
   *
   * Ein **Tabwechsel** (S6.1) erhoeht die Ladenummer auch, raeumt aber nicht
   * auf: der Tab-Store hat den Stand des Ziels gerade eingespielt, und ein
   * Aufraeumen danach loeschte genau die Anmerkungen, zu denen der Nutzer
   * zurueckwollte.
   */
  useEffect(() => {
    const { ladeArt } = useDokument.getState()
    if (ladeArt === 'tab') return
    raeumeAuf(ladeArt !== 'mutation')
  }, [ladeNummer])
}

/**
 * Die zuletzt gelesene Stelle wiederherstellen und laufend sichern.
 *
 * Gesichert wird verzoegert: bei jedem Scrollschritt zu schreiben hiesse, die
 * Einstellungsdatei dutzende Male je Sekunde anzufassen.
 */
export function useLeseposition(): void {
  const pfad = useDokument((zustand) => zustand.pfad)
  const bereit = useDokument((zustand) => zustand.ladeZustand === 'bereit')
  const ladeNummer = useDokument((zustand) => zustand.ladeNummer)
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const zoom = useDokument((zustand) => zustand.zoom)
  const stelleLesepositionHer = useDokument((zustand) => zustand.stelleLesepositionHer)

  /**
   * Wiederherstellen gehoert zum **Laden**, nicht zum Pfad. Sonst spraenge die
   * Ansicht nach einem "Speichern unter" auf eine Stelle, die zu einer frueher
   * gelesenen Datei gleichen Namens gehoert. Der Pfad kommt deshalb aus dem
   * Store statt aus den Abhaengigkeiten.
   */
  useEffect(() => {
    const api = bruecke()
    const aktuellerPfad = useDokument.getState().pfad
    if (api === undefined || !bereit || aktuellerPfad === null) return
    // Nur beim Wechsel zu einer Datei. Nach einer Mutation stellt die
    // Pipeline die Ansicht selbst wieder her (S4.0), ein Tabwechsel bringt
    // sie aus der Momentaufnahme mit (S6.1); die gespeicherte Leseposition
    // wuerde beides ueberschreiben.
    if (useDokument.getState().ladeArt !== 'wechsel') return
    api
      .settingsGet()
      .then((einstellungen) => {
        const gemerkt = einstellungen.zuletztGelesen[aktuellerPfad]
        if (gemerkt !== undefined) stelleLesepositionHer(gemerkt.seite, gemerkt.zoom)
      })
      .catch((error: unknown) => {
        console.error('Leseposition konnte nicht gelesen werden:', error)
      })
  }, [bereit, ladeNummer, stelleLesepositionHer])

  useEffect(() => {
    const api = bruecke()
    if (api === undefined || !bereit || pfad === null) return undefined
    const zeitgeber = setTimeout(() => {
      void api
        .settingsGet()
        .then(async (einstellungen) => {
          const eintraege: [string, Leseposition][] = Object.entries(
            einstellungen.zuletztGelesen
          ).filter(([schluessel]) => schluessel !== pfad)
          // Aelteste verwerfen, damit die Datei nicht unbegrenzt waechst.
          const behalten = eintraege.slice(-(MAX_LESEPOSITIONEN - 1))
          behalten.push([pfad, { seite: aktuelleSeite, zoom }])
          await api.settingsSet({ zuletztGelesen: Object.fromEntries(behalten) })
        })
        .catch((error: unknown) => {
          console.error('Leseposition konnte nicht gesichert werden:', error)
        })
    }, SICHERN_NACH_MS)
    return () => {
      clearTimeout(zeitgeber)
    }
  }, [bereit, pfad, aktuelleSeite, zoom])
}
