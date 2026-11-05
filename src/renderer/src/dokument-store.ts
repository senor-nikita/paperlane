import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFWorker } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { create } from 'zustand'
import type { GeoeffnetesDokument } from '../../shared/ipc'
import { STANDARD_ANSICHT, type Passung as SharedPassung } from '../../shared/settings'
import { PDFJS_HAERTUNG } from './pdf-haertung'
import { deuteFehler, type FehlerArt } from '../../shared/errors'
import type { SeitenGroesse } from './viewer/layout'
import type { Zielposition } from './viewer/ziel'
import { begrenzeZoom, naechsteStufe } from './viewer/zoom'
import { t } from '../../shared/i18n'

/**
 * Der eine pdf.js-Worker der Anwendung, ausdruecklich als `PDFWorker` und
 * nicht ueber `GlobalWorkerOptions.workerPort` (S6.1, Tabs).
 *
 * Der Unterschied ist die Lebensdauer: holt sich `getDocument` den Worker
 * selbst aus dem globalen Port, gehoert er der Ladeaufgabe, und
 * `loadingTask.destroy()` beendet ihn mit (pdf.js 6.3, `this._worker?.destroy()`).
 * Solange nur ein Dokument offen war, fiel das kaum auf. Mit Tabs legte das
 * Schliessen eines Tabs alle anderen lahm. Ein uebergebener Worker gehoert dem
 * Aufrufer; pdf.js laesst ihn beim Freigeben stehen.
 */
let worker: PDFWorker | null = null

/**
 * Aufloeser der offenen Passwortabfrage. Modulweit, weil die Antwort aus der
 * Oberflaeche kommt, die Frage aber tief im Ladevorgang entsteht.
 */
let passwortAufloeser: ((passwort: string | null) => void) | null = null

/** Ob gerade eine Passwortabfrage auf Antwort wartet - Tabwechsel sind dann gesperrt. */
export function passwortAusstehend(): boolean {
  return passwortAufloeser !== null
}

/**
 * Der Worker wird ueber Vites `?worker`-Import gebuendelt. Ihn per URL zu
 * laden ist der klassische Stolperstein: es funktioniert im Dev-Server und
 * bricht im Produktionsbuild (Risiko R2).
 */
function stelleWorkerBereit(): PDFWorker {
  worker ??= pdfjsLib.PDFWorker.create({ port: new PdfWorker() })
  return worker
}

/**
 * Fragt nach dem Passwort eines verschluesselten Dokuments. `null` bricht ab.
 *
 * `erneut` ist wahr, wenn das zuvor eingegebene Passwort falsch war — dann
 * muss die Oberflaeche das sagen, statt dieselbe Frage kommentarlos zu
 * wiederholen.
 */
export type PasswortGeber = (erneut: boolean) => Promise<string | null>

/**
 * Einzige Stelle, an der ein Dokument geladen wird. Der Guard-Test fuer
 * Invariante 6 prueft gegen diese Funktion; ein zweiter `getDocument`-Aufruf
 * anderswo wuerde die Haertung umgehen.
 */
export async function ladeDokument(
  bytes: Uint8Array,
  passwortGeber?: PasswortGeber
): Promise<PDFDocumentProxy> {
  const aufgabe = pdfjsLib.getDocument({
    data: bytes,
    worker: stelleWorkerBereit(),
    ...PDFJS_HAERTUNG
  })

  if (passwortGeber !== undefined) {
    // pdf.js fragt ueber diesen Rueckruf nach; `grund` ist 2, wenn das zuletzt
    // gelieferte Passwort falsch war. Das Passwort bleibt im Renderer und geht
    // nie an den Main-Prozess - es darf in keiner Datei landen.
    aufgabe.onPassword = (weiter: (passwort: string) => void, grund: number): void => {
      passwortGeber(grund === 2)
        .then((passwort) => {
          if (passwort === null) {
            // Abbruch: die Aufgabe verwerfen, damit pdf.js nicht weiterwartet.
            void aufgabe.destroy()
            return
          }
          weiter(passwort)
        })
        .catch((fehler: unknown) => {
          console.error('Passwortabfrage fehlgeschlagen:', fehler)
          void aufgabe.destroy()
        })
    }
  }

  return aufgabe.promise
}

/**
 * Erkennt XFA-Formulare (S1.5, Fall 7).
 *
 * Zwei Wege, weil einer nicht reicht: `isPureXfa` ist nur wahr, wenn das
 * Dokument ueberhaupt keinen statischen Inhalt hat. Der haeufigere Fall ist das
 * Hybrid-Formular mit Ausweichseite — dort steht `/XFA` im AcroForm, was pdf.js
 * als `IsXFAPresent` in den Metadaten meldet.
 */
async function erkenneXfa(dokument: PDFDocumentProxy): Promise<boolean> {
  if (dokument.isPureXfa === true) return true
  try {
    const { info } = await dokument.getMetadata()
    return (info as { IsXFAPresent?: unknown }).IsXFAPresent === true
  } catch (fehler) {
    // Fehlende Metadaten sind kein Grund, das Oeffnen scheitern zu lassen -
    // aber auch keiner, den Fehlschlag zu verschweigen.
    console.error('Metadaten konnten nicht gelesen werden:', fehler)
    return false
  }
}

/**
 * Die Berechtigungsflags aus dem `/Encrypt`-Verzeichnis (D13, entschieden in
 * S2.1: **anzeigen und ignorieren**).
 *
 * Sie sind keine Zugriffskontrolle. Wer das Dokument oeffnen kann, hat den
 * Schluessel; die Flags wirken nur, solange der Betrachter freiwillig
 * mitspielt, und jedes zweite Werkzeug tut das nicht. Sie zu befolgen hiesse
 * also, dem Nutzer Funktionen an seinen eigenen Dateien zu nehmen, ohne dass
 * irgendjemand dadurch geschuetzt waere. Sie stillschweigend zu uebergehen
 * hiesse, ihm zu verschweigen, dass der Autor etwas anderes wollte.
 *
 * Also: anzeigen, was der Autor sich gewuenscht hat, und es nicht erzwingen.
 */
const RECHTE: readonly { flag: number; text: () => string }[] = [
  { flag: 0x04, text: () => t('recht.drucken') },
  { flag: 0x08, text: () => t('recht.aendern') },
  { flag: 0x10, text: () => t('recht.kopieren') },
  { flag: 0x20, text: () => t('recht.kommentieren') },
  { flag: 0x100, text: () => t('recht.formulare') },
  { flag: 0x200, text: () => t('recht.hilfsmittel') },
  { flag: 0x400, text: () => t('recht.umstellen') },
  { flag: 0x800, text: () => t('recht.hochwertig') }
]

/**
 * Welche Rechte der Autor entzogen hat. Leer, wenn das Dokument keine
 * Einschraenkungen nennt — dann liefert `getPermissions` `null`.
 */
export async function leseEinschraenkungen(dokument: PDFDocumentProxy): Promise<string[]> {
  try {
    const erlaubt = await dokument.getPermissions()
    if (erlaubt === null) return []
    return RECHTE.filter(({ flag }) => !erlaubt.has(flag)).map(({ text }) => text())
  } catch (fehler) {
    // Kein Grund, das Oeffnen scheitern zu lassen - aber auch keiner, den
    // Fehlschlag zu verschweigen.
    console.error('Berechtigungen konnten nicht gelesen werden:', fehler)
    return []
  }
}

export type LadeZustand = 'leer' | 'laedt' | 'bereit' | 'fehler'
/** Aus dem shared-Bereich, weil die Einstellungen die Vorgabe tragen (S5.2a). */
export type Passung = SharedPassung

export const STANDARD_GROESSE: SeitenGroesse = { breite: 595, hoehe: 842 }

export interface DokumentZustand {
  ladeZustand: LadeZustand
  fehler: string | null
  pfad: string | null
  name: string | null
  seitenzahl: number
  aktuelleSeite: number
  dokument: PDFDocumentProxy | null
  zoom: number
  rotation: number
  passung: Passung
  /**
   * Groesse je Seite. Beim Oeffnen wird die Groesse der ersten Seite fuer alle
   * uebernommen — alle Seiten einzeln zu vermessen hiesse, 500 Seiten zu
   * parsen, bevor die erste erscheint. Sobald eine Seite tatsaechlich
   * gezeichnet wird, traegt sie ihre echte Groesse nach.
   */
  seitenGroessen: SeitenGroesse[]
  /**
   * Seite, zu der die Ansicht springen soll. Getrennt von `aktuelleSeite`,
   * weil diese beim Scrollen laufend nachgefuehrt wird — beides in einem Wert
   * ergaebe eine Rueckkopplung aus Scrollen und Springen.
   */
  sprungZiel: number | null
  /**
   * Wohin auf der Zielseite gesprungen werden soll, als Anteil 0..1 von der
   * Oberkante. `null` heisst Seitenanfang. Getrennt von `sprungZiel`, damit ein
   * Sprung ohne Positionsangabe nicht so aussieht, als waere er einer auf die
   * Seitenmitte.
   */
  sprungAnteil: number | null
  /**
   * Sichtbarkeit der Miniaturen-Sidebar. Bewusst nicht Teil von `LEER`: ein
   * neues Dokument zu oeffnen soll die Sidebar nicht zuklappen.
   */
  sidebarSichtbar: boolean
  /**
   * Kurze Meldung ueber dem Dokument, etwa nach einem abgelehnten Drop.
   *
   * Bewusst getrennt von `fehler`: eine fallengelassene Textdatei darf das
   * gerade gelesene Dokument nicht durch eine Fehlerseite ersetzen.
   */
  hinweis: string | null
  /**
   * Art des Ladefehlers. Die Oberflaeche macht ihr Verhalten daran fest, statt
   * Meldungstexte zu vergleichen (S1.5, Fehlertaxonomie).
   */
  fehlerArt: FehlerArt | null
  /**
   * XFA-Formular. Mit `enableXfa: false` zeigt pdf.js die im Dokument
   * hinterlegte Ausweichseite; ohne Hinweis saehe der Nutzer eine scheinbar
   * leere, korrekt geladene Seite.
   */
  istXfa: boolean
  /**
   * Rechte, die der Autor entzogen hat (D13). Sie werden angezeigt und nicht
   * durchgesetzt — sie sind eine Bitte an den Betrachter, keine Sperre.
   */
  eingeschraenkteRechte: string[]
  /** Offene Passwortabfrage; `erneut`, wenn das letzte Passwort falsch war. */
  passwortFrage: { erneut: boolean } | null
  /**
   * Mit Passwort geoeffnet (S2.3a, Aufgabe 4). pdf-lib kann verschluesselte
   * Dokumente nicht entschluesseln; alle Schreibpfade bleiben dann gesperrt.
   */
  verschluesselt: boolean
  /**
   * Zaehlt die Ladevorgaenge. Alles, was beim **Dokumentwechsel** aufzuraeumen
   * ist, haengt daran und nicht am Pfad: "Speichern unter" gibt demselben
   * geladenen Dokument einen neuen Pfad, und ein Aufraeumen wuerde dabei
   * genau die Anmerkungen wegwerfen, die gerade gespeichert wurden.
   */
  ladeNummer: number
  /**
   * Woher der letzte Ladevorgang kam (S4.0): ein **Wechsel** zu einer (anderen
   * oder erneut gelesenen) Datei, oder das **Neuladen** nach einer Mutation.
   * Die Leseposition aus den Einstellungen gilt nur fuer den Wechsel; nach
   * einer Mutation stellt die Pipeline die Ansicht selbst wieder her.
   *
   * Seit S6.1 dazu der **Tabwechsel** (`'tab'`): nichts wird geladen, der
   * Stand eines anderen Tabs wird eingespielt. Er loest weder das Aufraeumen
   * noch das Wiederherstellen der Leseposition aus - beides wuerde gerade
   * eingespielte Anmerkungen und die Ansicht des Tabs wegwerfen.
   */
  ladeArt: 'wechsel' | 'mutation' | 'tab'

  /**
   * Laedt ein Dokument. Mit `ansicht` ist es das Neuladen nach einer
   * Mutation (S4.0): dieselbe Datei in neuer Fassung, und die Ansicht soll
   * stehen bleiben, statt auf Seite 1 zu springen.
   */
  uebernimm: (geoeffnet: GeoeffnetesDokument | null, ansicht?: Ansicht) => Promise<void>
  /**
   * Nach "Speichern unter": dasselbe geladene Dokument lebt unter einem neuen
   * Namen weiter. Bewusst **kein** neues Laden — die Anmerkungen stehen im
   * Speicher, und die Datei auf der Platte traegt sie jetzt auch.
   */
  uebernimmZiel: (pfad: string, name: string) => void
  /** Antwort auf die Passwortabfrage; `null` bricht das Oeffnen ab. */
  beantwortePasswort: (passwort: string | null) => void
  /**
   * Liest einen Pfad neu **in den aktiven Tab** - nach dem Flachlegen, wenn
   * die Datei keine Felder mehr hat. Ein neues Dokument oeffnet dagegen einen
   * eigenen Tab und laeuft ueber `tabs-store.ts` (S6.1).
   */
  ladePfadNeu: (pfad: string) => Promise<void>
  setzeHinweis: (hinweis: string | null) => void
  geheZuSeite: (seite: number) => void
  springeZuSeite: (seite: number) => void
  /** Sprung an eine aufgeloeste Stelle: Seite, Position und optional Zoom. */
  springeZuZiel: (ziel: Zielposition) => void
  sprungErledigt: () => void
  stelleLesepositionHer: (seite: number, zoom: number) => void
  setzeZoom: (zoom: number) => void
  /**
   * Wie viele Seiten nebeneinander stehen: 1 (untereinander) oder 2
   * (Zwei-Seiten-Ansicht). Eine Eigenschaft der Sitzung, nicht des Dokuments.
   */
  spalten: 1 | 2
  setzeSpalten: (spalten: 1 | 2) => void
  zoomeStufe: (richtung: 1 | -1) => void
  setzePassung: (passung: Passung, zoom: number) => void
  /**
   * Passung, mit der jedes neu geoeffnete Dokument beginnt (S5.2a, Aufgabe 5).
   * Kommt aus den Einstellungen; gilt nicht fuer das gerade offene Dokument,
   * dessen Ansicht die Nutzerin schon veraendert haben kann.
   */
  standardPassung: Passung
  setzeStandardPassung: (passung: Passung) => void
  drehe: (richtung: 1 | -1) => void
  merkeSeitenGroesse: (index: number, groesse: SeitenGroesse) => void
  /** Ohne Argument umschalten, mit Argument gezielt setzen. */
  schalteSidebar: (sichtbar?: boolean) => void
}

/** Die Ansicht, die ein Neuladen nach einer Mutation wiederherstellt. */
export interface Ansicht {
  seite: number
  zoom: number
  rotation: number
  passung: Passung
}

const LEER = {
  ladeZustand: 'leer' as LadeZustand,
  fehler: null,
  pfad: null,
  name: null,
  seitenzahl: 0,
  aktuelleSeite: 1,
  dokument: null,
  zoom: 1,
  rotation: 0,
  passung: STANDARD_ANSICHT.passung,
  seitenGroessen: [] as SeitenGroesse[],
  sprungZiel: null as number | null,
  sprungAnteil: null as number | null,
  hinweis: null as string | null,
  fehlerArt: null as FehlerArt | null,
  istXfa: false,
  eingeschraenkteRechte: [] as string[],
  passwortFrage: null as { erneut: boolean } | null,
  verschluesselt: false
}

export const useDokument = create<DokumentZustand>((set, get) => ({
  ...LEER,
  sidebarSichtbar: true,
  // Bewusst nicht Teil von `LEER`: der Zaehler muss ueber Dokumentwechsel
  // hinweg steigen, sonst waere er kein Wechselsignal mehr.
  ladeNummer: 0,
  ladeArt: 'wechsel' as const,
  standardPassung: STANDARD_ANSICHT.passung,
  spalten: 1,

  setzeSpalten: (spalten) => {
    set({ spalten })
  },

  schalteSidebar: (sichtbar) => {
    set({ sidebarSichtbar: sichtbar ?? !get().sidebarSichtbar })
  },

  setzeStandardPassung: (passung) => {
    set({ standardPassung: passung })
  },

  uebernimm: async (geoeffnet, ansicht) => {
    if (geoeffnet === null) return
    // Das alte Proxy haelt den Worker-Speicher des vorigen Dokuments. Nach
    // einer Mutation ist das dieselbe Datei in alter Fassung - ohne
    // `destroy` wuechse der Speicher mit jeder Mutation um ein Dokument
    // (S4.0). Laufende Zeichenvorgaenge enden mit einer Abbruchausnahme, die
    // Seite und Miniatur ohnehin abfangen.
    const vorher = get().dokument
    // Die gemerkte Stelle gehoerte zum vorigen Dokument (S6.1b).
    vergissLesestelle()
    set({
      ...LEER,
      ladeZustand: 'laedt',
      name: geoeffnet.name,
      pfad: geoeffnet.pfad,
      ladeNummer: get().ladeNummer + 1,
      ladeArt: ansicht === undefined ? 'wechsel' : 'mutation',
      // Ein Wechsel beginnt mit der eingestellten Passung; beim Neuladen nach
      // einer Mutation stellt `ansicht` sie unten ohnehin wieder her.
      passung: get().standardPassung,
      // Die Drehung nur beim Neuladen behalten; ein Wechsel beginnt aufrecht.
      ...(ansicht === undefined ? {} : { rotation: ansicht.rotation })
    })
    if (vorher !== null) {
      // pdf.js gibt ueber die Ladeaufgabe frei, nicht ueber das Proxy. Seit
      // S6.1 gehoert der Worker nicht mehr der Aufgabe (`stelleWorkerBereit`),
      // die Freigabe beendet ihn also nicht; gewartet wird trotzdem, damit
      // der Speicher des alten Dokuments frei ist, bevor das neue ihn braucht.
      // Ein Proxy, das einem anderen Tab gehoert, steht hier nie: der
      // Tab-Store nimmt es vorher mit `gibDokumentAb` heraus.
      try {
        await vorher.loadingTask.destroy()
      } catch (fehler) {
        console.error('Altes Dokument liess sich nicht freigeben:', fehler)
      }
    }
    let abgebrochen = false
    try {
      const dokument = await ladeDokument(geoeffnet.bytes, async (erneut) => {
        const passwort = await new Promise<string | null>((aufloesen) => {
          passwortAufloeser = aufloesen
          set({ passwortFrage: { erneut } })
        })
        if (passwort === null) abgebrochen = true
        // Ein geliefertes Passwort heisst: dieses Dokument ist verschluesselt.
        // Die Schreibpfade bleiben deshalb gesperrt (S2.3a, Aufgabe 4).
        else set({ verschluesselt: true })
        return passwort
      })
      const ersteSeite = await dokument.getPage(1)
      const sicht = ersteSeite.getViewport({ scale: 1 })
      const groesse: SeitenGroesse = { breite: sicht.width, hoehe: sicht.height }
      set({
        ladeZustand: 'bereit',
        dokument,
        seitenzahl: dokument.numPages,
        aktuelleSeite: 1,
        istXfa: await erkenneXfa(dokument),
        seitenGroessen: Array.from({ length: dokument.numPages }, () => groesse)
      })
      if (ansicht !== undefined) {
        // Ansicht wiederherstellen (S4.0, Aufgabe 2): Seite als Sprungziel,
        // damit die Dokumentansicht dorthin scrollt, Zoom und Passung wie
        // vorher. Die Passung gewinnt: bei "Breite" waere ein fester Zoom
        // nach dem Neuladen falsch, sobald das Fenster anders breit ist.
        const seite = Math.min(Math.max(1, ansicht.seite), dokument.numPages)
        set({
          aktuelleSeite: seite,
          sprungZiel: seite,
          sprungAnteil: null,
          zoom: begrenzeZoom(ansicht.zoom),
          passung: ansicht.passung
        })
      }
      // Bewusst nachgetragen und nicht im selben Zug: die Berechtigungen
      // betreffen nur eine Hinweiszeile, und die erste Seite soll auf nichts
      // warten, was sie nicht braucht (Budget aus S1.2).
      void leseEinschraenkungen(dokument).then((rechte) => {
        if (get().dokument === dokument) set({ eingeschraenkteRechte: rechte })
      })
    } catch (fehler) {
      // Ein vom Nutzer abgebrochenes Oeffnen ist kein Fehler. Ohne diese
      // Unterscheidung stuende nach dem Abbrechen eine Fehlermeldung im
      // Fenster, die niemand verursacht hat.
      if (abgebrochen) {
        set({ ...LEER, hinweis: t('dokument.oeffnenAbgebrochen') })
        return
      }
      const gedeutet = deuteFehler(fehler, geoeffnet.name)
      console.error('Dokument konnte nicht geladen werden:', gedeutet.detail)
      set({
        ladeZustand: 'fehler',
        fehler: gedeutet.nutzertext,
        fehlerArt: gedeutet.art,
        dokument: null,
        seitenzahl: 0,
        seitenGroessen: []
      })
    } finally {
      passwortAufloeser = null
      set({ passwortFrage: null })
    }
  },

  uebernimmZiel: (pfad, name) => {
    // Nur Pfad und Name. `ladeNummer` bleibt, wie sie ist: es ist dasselbe
    // Dokument, und alles daran Haengende soll stehen bleiben.
    set({ pfad, name })
  },

  beantwortePasswort: (passwort) => {
    const aufloesen = passwortAufloeser
    passwortAufloeser = null
    set({ passwortFrage: null })
    aufloesen?.(passwort)
  },

  ladePfadNeu: async (pfad) => {
    const ergebnis = await window.api.dokumentOeffnePfad(pfad)
    if (!ergebnis.ok) {
      // Wer die Rueckfrage des Main selbst abgelehnt hat, braucht keine Meldung.
      if (ergebnis.abgebrochen === true) return
      // Als Meldung, nicht als Fehlerzustand: ein abgelehnter Drop darf das
      // gerade offene Dokument nicht wegnehmen.
      set({ hinweis: ergebnis.grund })
      return
    }
    set({ hinweis: null })
    await get().uebernimm(ergebnis.dokument)
  },

  setzeHinweis: (hinweis) => {
    set({ hinweis })
  },

  geheZuSeite: (seite) => {
    const { seitenzahl } = get()
    if (seitenzahl === 0) return
    set({ aktuelleSeite: Math.min(Math.max(1, seite), seitenzahl) })
  },

  springeZuSeite: (seite) => {
    const { seitenzahl } = get()
    if (seitenzahl === 0) return
    const ziel = Math.min(Math.max(1, seite), seitenzahl)
    set({ aktuelleSeite: ziel, sprungZiel: ziel, sprungAnteil: null })
  },

  springeZuZiel: (ziel) => {
    const { seitenzahl } = get()
    if (seitenzahl === 0) return
    const seite = Math.min(Math.max(1, ziel.seite), seitenzahl)
    // Den Zoom nur setzen, wenn das Ziel wirklich einen nennt. Sonst waere ein
    // Sprung in der Gliederung zugleich ein unerwarteter Zoomwechsel.
    const zoomTeil =
      ziel.zoom === null ? {} : { zoom: begrenzeZoom(ziel.zoom), passung: 'frei' as Passung }
    set({ aktuelleSeite: seite, sprungZiel: seite, sprungAnteil: ziel.anteilVonOben, ...zoomTeil })
  },

  sprungErledigt: () => {
    set({ sprungZiel: null, sprungAnteil: null })
  },

  stelleLesepositionHer: (seite, zoom) => {
    const { seitenzahl } = get()
    if (seitenzahl === 0) return
    const ziel = Math.min(Math.max(1, seite), seitenzahl)
    set({
      aktuelleSeite: ziel,
      sprungZiel: ziel,
      sprungAnteil: null,
      zoom: begrenzeZoom(zoom),
      passung: 'frei'
    })
  },

  setzeZoom: (zoom) => {
    set({ zoom: begrenzeZoom(zoom), passung: 'frei' })
  },

  zoomeStufe: (richtung) => {
    set({ zoom: naechsteStufe(get().zoom, richtung), passung: 'frei' })
  },

  setzePassung: (passung, zoom) => {
    set({ passung, zoom: begrenzeZoom(zoom) })
  },

  drehe: (richtung) => {
    set({ rotation: (((get().rotation + richtung * 90) % 360) + 360) % 360 })
  },

  merkeSeitenGroesse: (index, groesse) => {
    const { seitenGroessen } = get()
    const vorhanden = seitenGroessen[index]
    if (
      vorhanden === undefined ||
      (vorhanden.breite === groesse.breite && vorhanden.hoehe === groesse.hoehe)
    ) {
      return
    }
    const kopie = [...seitenGroessen]
    kopie[index] = groesse
    set({ seitenGroessen: kopie })
  }
}))

/**
 * Die Stelle innerhalb der aktuellen Seite, an der die Ansicht steht (S6.1b):
 * Anteil 0..1 der Seitenhoehe an der Oberkante des Sichtfensters.
 *
 * Bewusst kein Feld im Store: sie aendert sich mit jedem Scrollschritt, und
 * als Zustand liesse sie bei jedem Schritt alles neu rendern, was
 * `useDokument` liest. Gebraucht wird sie nur in dem einen Moment, in dem ein
 * Tab verlassen wird - dann liest `nimmDokumentAuf` sie hier ab. Ohne sie
 * kaeme man nach einem Tabwechsel an den Anfang der Seite zurueck statt an
 * die Zeile, an der man war.
 */
let lesestelle: { seite: number; anteil: number } | null = null

/** Die Dokumentansicht meldet hier ihren Scroll-Anker (1-basierte Seite). */
export function merkeLesestelle(seite: number, anteil: number): void {
  lesestelle = { seite, anteil }
}

function vergissLesestelle(): void {
  lesestelle = null
}

interface LesestelleImStand {
  /** Anteil innerhalb von `aktuelleSeite`; `null` heisst Seitenanfang. */
  anteil: number | null
}

/**
 * Was vom Dokument-Store zu einem Tab gehoert (S6.1): das Proxy, die Ansicht
 * und was beim Laden ueber die Datei gelernt wurde. Nicht dabei, weil es der
 * Sitzung gehoert und nicht dem Dokument: Sidebar, Standardpassung,
 * Ladenummer. Auch nicht der Hinweis - er gehoert zu dem Moment, in dem er
 * erschien, und nicht zum Tab.
 */
export type DokumentStand = LesestelleImStand &
  Pick<
    DokumentZustand,
    | 'ladeZustand'
    | 'fehler'
    | 'fehlerArt'
    | 'pfad'
    | 'name'
    | 'seitenzahl'
    | 'aktuelleSeite'
    | 'dokument'
    | 'zoom'
    | 'rotation'
    | 'passung'
    | 'seitenGroessen'
    | 'istXfa'
    | 'eingeschraenkteRechte'
    | 'verschluesselt'
  >

export function nimmDokumentAuf(): DokumentStand {
  const z = useDokument.getState()
  return {
    ladeZustand: z.ladeZustand,
    fehler: z.fehler,
    fehlerArt: z.fehlerArt,
    pfad: z.pfad,
    name: z.name,
    seitenzahl: z.seitenzahl,
    aktuelleSeite: z.aktuelleSeite,
    dokument: z.dokument,
    zoom: z.zoom,
    rotation: z.rotation,
    passung: z.passung,
    seitenGroessen: z.seitenGroessen,
    istXfa: z.istXfa,
    eingeschraenkteRechte: z.eingeschraenkteRechte,
    verschluesselt: z.verschluesselt,
    // Nur, wenn der Anker zur angezeigten Seite gehoert; sonst stammt er aus
    // einem Moment, in dem die Ansicht noch nicht nachgezogen hatte.
    anteil: lesestelle !== null && lesestelle.seite === z.aktuelleSeite ? lesestelle.anteil : null
  }
}

/**
 * Spielt den Stand eines Tabs ein; `null` ist der leere Zustand (letzter Tab
 * geschlossen). `ladeArt: 'tab'` haelt das Aufraeumen und die Leseposition
 * heraus, die neue Ladenummer laesst trotzdem alles neu zeichnen, was am
 * Laden haengt. Die Ansicht springt an die Seite, auf der der Tab verlassen
 * wurde.
 */
export function spieleDokumentEin(stand: DokumentStand | null): void {
  const { ladeNummer } = useDokument.getState()
  const { anteil = null, ...felder } = stand ?? {}
  const sprungZiel = stand === null || stand.seitenzahl === 0 ? null : stand.aktuelleSeite
  // Bis die Ansicht des Ziels scrollt, gilt die Stelle, an die sie springt.
  lesestelle = sprungZiel === null || anteil === null ? null : { seite: sprungZiel, anteil }
  useDokument.setState({
    ...LEER,
    ...felder,
    sprungZiel,
    // Die Stelle innerhalb der Seite, nicht nur die Seite (S6.1b).
    sprungAnteil: anteil,
    hinweis: null,
    passwortFrage: null,
    ladeNummer: ladeNummer + 1,
    ladeArt: 'tab'
  })
}

/**
 * Nimmt das Proxy aus dem Store, ohne es freizugeben: es gehoert ab jetzt der
 * Momentaufnahme seines Tabs. Ohne das gaebe `uebernimm` beim Oeffnen des
 * naechsten Tabs genau das Dokument frei, zu dem der Nutzer zurueckwill.
 */
export function gibDokumentAb(): void {
  useDokument.setState({ dokument: null })
}
