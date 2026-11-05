import type { Aenderungen } from './aenderungen'
import type { Mutation, TextBericht } from './mutation'
import type { Bereich } from './bereiche'
import type { DruckOptionen, Druckphase, Druckziel } from './druck'
import type { Feldwert } from './formulare'
import type { Sprache } from './i18n'
import type { Settings, SettingsPatch } from './settings'
import { KUERZEL, type Befehl } from './tastatur'

/**
 * Der IPC-Contract. Einzige Quelle fuer Kanalnamen und Nutzlasttypen; Main und
 * Preload sind beide dagegen typisiert. Ein neuer Kanal wird hier ergaenzt und
 * erzwingt dadurch seine Implementierung auf beiden Seiten.
 *
 * Bewusst nur Anfrage/Antwort ueber `handle`/`invoke` — kein `send`/`on`, damit
 * es keinen Kanal ohne definierte Antwort gibt.
 *
 * **Eine begruendete Ausnahme:** `EREIGNIS_KANAL` laeuft einseitig vom Main zum
 * Renderer, weil ein Menueklick im Main entsteht (ADR 0002). Er ist der einzige
 * solche Kanal und traegt genau einen Nutzlasttyp; ein zweiter darf nicht
 * entstehen, ohne dass ADR 0002 fortgeschrieben wird.
 */
/**
 * Ein geoeffnetes Dokument, wie es der Main-Prozess an den Renderer gibt.
 *
 * Die Bytes reisen vollstaendig mit (ADR 0001, Variante A). Gemessen war das
 * bei 64,8 MB fast doppelt so schnell wie ein Range-Transport und kommt ohne
 * hunderte IPC-Rundreisen aus.
 */
export interface GeoeffnetesDokument {
  pfad: string
  name: string
  bytes: Uint8Array
}

/**
 * Ergebnis eines Oeffnens ueber einen Pfad.
 *
 * Bewusst kein blosses `null` im Fehlerfall: eine fallengelassene Textdatei
 * soll eine Meldung ergeben, die den Grund nennt, und nicht ein stilles
 * Nichts (S1.3e, Exit-Kriterium).
 */
export type OeffnenErgebnis =
  | { ok: true; dokument: GeoeffnetesDokument }
  /**
   * `abgebrochen`: der Nutzer hat die Rueckfrage zu einer fremden Datei
   * abgelehnt (Drag & Drop). Das ist eine Entscheidung und kein Fehler - der
   * Renderer zeigt dazu keinen Hinweis.
   */
  | { ok: false; grund: string; abgebrochen?: true }

/** Ein Eintrag der Liste "zuletzt geoeffnet". */
export interface ZuletztEintrag {
  pfad: string
  name: string
  /** Ob die Datei noch da ist. Fehlende werden ausgegraut, nicht verschluckt. */
  existiert: boolean
}

/**
 * Ausgang eines externen Verweises (S2.1).
 *
 * Drei Faelle und nicht zwei: ein vom Nutzer abgebrochener Dialog ist etwas
 * anderes als ein abgelehntes Schema. Nur der zweite Fall gehoert als Meldung
 * ins Fenster — wer selbst "Abbrechen" drueckt, braucht keine Erklaerung.
 */
export type ExternesZielErgebnis =
  { art: 'geoeffnet' } | { art: 'abgebrochen' } | { art: 'abgelehnt'; grund: string }

/**
 * Ausgang des Ladens eines Signaturbilds (S3.2).
 *
 * Dieselbe Dreiteilung wie beim externen Verweis: abgebrochen ist keine
 * Meldung wert, abgelehnt schon. `url` ist eine Data-URL (PNG oder JPEG) —
 * der Renderer zeigt sie an, der Main bettet sie beim Speichern ein.
 */
export type BildErgebnis =
  { art: 'geladen'; url: string } | { art: 'abgebrochen' } | { art: 'abgelehnt'; grund: string }

/**
 * Eine Dokument-Mutation (S4.0). Der Auftrag traegt die **ungespeicherten**
 * Anmerkungen und Formularwerte mit, damit sie vor der Reserialisierung
 * eingespielt werden und den Neuaufbau ueberleben (Aufgabe 3).
 */
export interface MutationsAuftrag {
  quelle: string
  mutation: Mutation
  aenderungen: Aenderungen
  formularwerte: Record<string, Feldwert>
}

export type MutationsErgebnis =
  | {
      art: 'angewendet'
      /** Die neuen Bytes unter demselben Pfad - der Renderer laedt sie neu. */
      dokument: GeoeffnetesDokument
      /** Dauer der Reserialisierung im Main, fuer Protokoll und Budget. */
      dauerMs: number
      /**
       * Die Staende der Arbeitskopie vor und nach der Mutation (S4.1). Die
       * Historie des Renderers merkt sich nur diese Nummern; Rueckgaengig
       * heisst `dokumentStandHerstellen(vorher)`, Wiederholen `(nachher)`.
       */
      stand: { vorher: number; nachher: number }
      /** Nur bei `textErsetzen` (S6.6b): Original- oder Ersatzschrift. */
      bericht?: TextBericht
    }
  | { art: 'abgelehnt'; grund: string }

/** Einen gemerkten Stand der Arbeitskopie wieder zum aktuellen machen (S4.1). */
export interface StandAuftrag {
  quelle: string
  stand: number
}

export type StandErgebnis =
  | {
      art: 'hergestellt'
      dokument: GeoeffnetesDokument
      /** Der Stand ist genau das, was auf der Platte steht: nichts zu speichern. */
      sauber: boolean
    }
  | { art: 'abgelehnt'; grund: string }

/**
 * Zusammenfuehren und Teilen (S4.2a).
 *
 * Die Quellen waehlt der Nutzer im Dialog des Main; der Renderer bekommt
 * Pfad, Name und Seitenzahl, ordnet und schickt die Pfade zurueck. Der Main
 * liest nur, was er selbst herausgegeben hat (Invariante 11), und fragt fuer
 * das Ergebnis nach dem Ziel.
 */
export interface Dokumentquelle {
  pfad: string
  name: string
  seiten: number
}

export interface ZusammenfuehrAuftrag {
  quellen: string[]
}

export type ZusammenfuehrErgebnis =
  | {
      art: 'gespeichert'
      pfad: string
      name: string
      seiten: number
      /** Feldnamen, die wegen Kollision umbenannt wurden. */
      umbenannt: { von: string; nach: string }[]
    }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

export interface TeilAuftrag {
  quelle: string
  /** Bereiche einsbasiert und inklusive; `'einzelseiten'` fuer eine Datei je Seite. */
  bereiche: Bereich[] | 'einzelseiten'
}

export type TeilErgebnis =
  | { art: 'gespeichert'; verzeichnis: string; dateien: string[] }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

/**
 * PNG-Export (S4.2b) in zwei Schritten, weil die Bilder im Renderer
 * entstehen (Canvas-Renderpfad), die Pfade aber im Main (Invariante 11):
 *
 * 1. `pngZieleWaehlen` - der Main fragt nach dem Ziel (eine Seite: Speichern-
 *    Dialog; mehrere: Ordner), leitet die Dateinamen ab, gibt jeden einzeln
 *    zum Schreiben frei und gibt sie zurueck. Wer hier abbricht, hat noch
 *    kein Bild gerendert.
 * 2. `pngSchreiben` je Bild - der Renderer reicht Pfad und PNG-Bytes zurueck;
 *    der Main prueft den Pfad gegen die Freigabe und den Inhalt gegen den
 *    PNG-Kopf, dann schreibt er atomar.
 */
export interface PngZielAuftrag {
  quelle: string
  /** Einsbasierte Seitennummern, aufsteigend. */
  seiten: number[]
}

export type PngZielErgebnis =
  | { art: 'freigegeben'; ziele: { seite: number; pfad: string }[] }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

export interface PngSchreibAuftrag {
  pfad: string
  bytes: Uint8Array
}

export type PngSchreibErgebnis =
  { art: 'geschrieben'; pfad: string } | { art: 'abgelehnt'; grund: string }

/**
 * Drucken (S4.3, ADR 0003). Der Main baut aus dem Dokument - Arbeitskopie
 * plus ungespeicherte Anmerkungen und Formularwerte, wie bei der Mutation -
 * eine Druckvorlage und druckt sie im versteckten Fenster; `datei` fragt
 * vorher nach dem Ziel. Der Fortschritt kommt ueber den Ereigniskanal.
 */
export interface DruckAuftrag {
  quelle: string
  optionen: DruckOptionen
  ziel: Druckziel
  aenderungen: Aenderungen
  formularwerte: Record<string, Feldwert>
}

export type DruckAntwort =
  | { art: 'gedruckt' }
  | { art: 'gespeichert'; pfad: string; name: string; seiten: number }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

/**
 * Seiten extrahieren (S6.2, Aufgabe 3): die gewaehlten Seiten als neue Datei.
 * Wie beim Drucken reisen die ungespeicherten Anmerkungen und Formularwerte
 * mit, damit die neue Datei zeigt, was der Nutzer sieht. Der Main fragt nach
 * dem Ziel ("Speichern unter"), prueft es gegen Invariante 11 und schreibt
 * atomar. Das offene Dokument bleibt unveraendert; "danach entfernen" ist
 * eine gewoehnliche `seitenLoeschen`-Mutation des Renderers.
 */
export interface ExtrahierAuftrag {
  quelle: string
  /** Einsbasiert, in der gewuenschten Reihenfolge, ohne Doppelte. */
  seiten: number[]
  aenderungen: Aenderungen
  formularwerte: Record<string, Feldwert>
}

export type ExtrahierErgebnis =
  | { art: 'gespeichert'; pfad: string; name: string; seiten: number }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

/**
 * Bilder zu PDF (S6.4, D18) in zwei Schritten:
 *
 * 1. `bilderWaehlen` - `null` oeffnet den Dialog (Mehrfachauswahl), eine
 *    Pfadliste kommt aus Drag & Drop (`pfadVonDatei`). Der Main liest jede
 *    Datei genau einmal, prueft Kopf und Groesse und gibt die Bytes zurueck -
 *    wie beim Signaturbild **ohne** Eintrag in die Lesefreigaben.
 * 2. `bilderZuPdf` - der Renderer hat jedes Bild auf PNG oder JPEG
 *    normalisiert (WebP/GIF/BMP ueber Canvas, EXIF-Ausrichtung angewendet)
 *    und schickt die Seiten in der gewaehlten Reihenfolge. Der Main setzt das
 *    PDF mit pdf-lib, fragt nach dem Ziel und schreibt atomar; der Renderer
 *    oeffnet das Ergebnis danach als Tab ueber `dokumentOeffnePfad`.
 */
export type BildFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp'

export interface Bildquelle {
  name: string
  format: BildFormat
  bytes: Uint8Array
}

export type BilderWahlErgebnis =
  | { art: 'gewaehlt'; bilder: Bildquelle[]; abgelehnt: { name: string; grund: string }[] }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

export interface BildSeite {
  /** Bereits normalisiert und aufrecht (EXIF angewendet). */
  format: 'png' | 'jpeg'
  bytes: Uint8Array
  breitePx: number
  hoehePx: number
}

export interface BildPdfAuftrag {
  seiten: BildSeite[]
  /** `'bild'`: Seite so gross wie das Bild (96 dpi); sonst Papierformat. */
  seitengroesse: 'bild' | 'a4' | 'letter'
  ausrichtung: 'hoch' | 'quer' | 'auto'
  /** Rand um das Bild in Millimetern, nur bei Papierformat wirksam. */
  randMm: number
  /** Vorschlag fuer den Dateinamen im Speichern-Dialog, ohne Endung. */
  vorschlag: string
}

export type BildPdfErgebnis =
  | { art: 'gespeichert'; pfad: string; name: string; seiten: number }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

/**
 * PDF nach Word (S6.7, D19). Der Renderer zieht Text und Bilder mit pdf.js
 * heraus und gruppiert sie zu Absaetzen; der Main baut daraus die `.docx`,
 * fragt nach dem Ziel und schreibt atomar. Das Layout ist bewusst grob.
 */
export interface WordLauf {
  text: string
  fett: boolean
  kursiv: boolean
  groessePt: number
}

export type WordBlock =
  /** `ebene` 0 = Fliesstext, 1-3 = Ueberschrift. */
  | { art: 'absatz'; ebene: 0 | 1 | 2 | 3; laeufe: WordLauf[] }
  | { art: 'bild'; png: Uint8Array; breitePt: number; hoehePt: number }

export interface WordSeite {
  breitePt: number
  hoehePt: number
  bloecke: WordBlock[]
}

export interface WordAuftrag {
  quelle: string
  seiten: WordSeite[]
  /** Nach jeder PDF-Seite ein Seitenumbruch. */
  seitenumbruch: boolean
}

export const IPC = {
  ping: 'app:ping',
  settingsGet: 'app:settings:get',
  settingsSet: 'app:settings:set',
  spracheGet: 'app:sprache:get',
  dokumentOeffnen: 'app:dokument:oeffnen',
  dokumentBeimStart: 'app:dokument:beim-start',
  dokumentOeffnePfad: 'app:dokument:oeffne-pfad',
  zuletztGeoeffnet: 'app:dokument:zuletzt',
  externOeffnen: 'app:extern:oeffnen',
  dokumentSpeichern: 'app:dokument:speichern',
  dokumentGeaendert: 'app:dokument:geaendert',
  formularFdfExportieren: 'app:formular:fdf',
  bildLaden: 'app:bild:laden',
  dokumentMutieren: 'app:dokument:mutieren',
  dokumentStandHerstellen: 'app:dokument:stand',
  dokumenteWaehlen: 'app:dokumente:waehlen',
  dokumenteZusammenfuehren: 'app:dokumente:zusammenfuehren',
  dokumentTeilen: 'app:dokument:teilen',
  pngZieleWaehlen: 'app:png:ziele',
  pngSchreiben: 'app:png:schreiben',
  dokumentDrucken: 'app:dokument:drucken',
  druckAbbrechen: 'app:dokument:druck-abbrechen',
  dokumentSchliessen: 'app:dokument:schliessen',
  tabSchliessenFragen: 'app:tab:schliessen-fragen',
  seitenExtrahieren: 'app:seiten:extrahieren',
  bilderWaehlen: 'app:bilder:waehlen',
  bilderZuPdf: 'app:bilder:pdf',
  wordExportieren: 'app:word:exportieren'
} as const

/**
 * Aenderungsstand eines Dokuments (S6.1, Tabs). Seit mehrere Dokumente offen
 * sein koennen, meldet der Renderer den Stand je Pfad. Ein leerer Pfad heisst
 * "alle": `{ pfad: '', geaendert: false }` setzt jeden Stand zurueck (Abbau
 * in den E2E-Tests, letzter Tab geschlossen).
 */
export interface AenderungsMeldung {
  pfad: string
  geaendert: boolean
}

/**
 * FDF-Export (S3.2, Aufgabe 3): alle Feldwerte des Dokuments, ueberlagert von
 * den noch ungespeicherten Aenderungen des Renderers. Der Main liest die Datei
 * neu und fragt nach dem Zielort; das Ergebnis hat dieselbe Form wie beim
 * Speichern.
 */
export interface FdfAuftrag {
  quelle: string
  formularwerte: Record<string, Feldwert>
}

/**
 * Was gespeichert werden soll (S2.3a).
 *
 * Bewusst **nur die Aenderungen** und nicht der ganze Bestand: der
 * Main-Prozess liest die Originaldatei neu (ADR 0001, Punkt 3) und fasst nur
 * an, was hier steht. Eine Seite, die der Leser nie gesehen hat, kennt der
 * Renderer nicht — und ihre Anmerkungen bleiben deshalb unberuehrt.
 */
export interface SpeicherAuftrag {
  /** Der Pfad des geoeffneten Dokuments; er wird neu gelesen. */
  quelle: string
  /** `null` heisst "Speichern unter": der Main fragt nach dem Ziel. */
  ziel: string | null
  /**
   * Mit Passwort geoeffnet. pdf-lib kann verschluesselte Dokumente nicht
   * entschluesseln; alle Schreibpfade sind dann gesperrt (S2.3a, Aufgabe 4).
   */
  verschluesselt: boolean
  aenderungen: Aenderungen
  /**
   * Geaenderte Formularwerte je Feldname (S3.2). Nur die geaenderten: was
   * unveraendert ist, bleibt im Dokument stehen, wie es war.
   */
  formularwerte: Record<string, Feldwert>
  /**
   * Formular flachlegen (S3.2, Aufgabe 2): Felder werden zu festem
   * Seiteninhalt, die Datei ist danach kein Formular mehr. Der Main fragt
   * mit einer nicht abschaltbaren Warnung nach, bevor er es tut.
   */
  flachlegen: boolean
}

export type SpeicherErgebnis =
  /**
   * Der Name kommt mit, weil nach "Speichern unter" das offene Dokument unter
   * einem neuen Namen weiterlebt. Ihn im Renderer aus dem Pfad zu schneiden
   * hiesse, dort Pfadtrenner zu raten — `basename` gibt es nur im Main.
   */
  | { art: 'gespeichert'; pfad: string; name: string }
  | { art: 'abgebrochen' }
  | { art: 'abgelehnt'; grund: string }

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface IpcContract {
  [IPC.ping]: { request: void; response: string }
  [IPC.settingsGet]: { request: void; response: Settings }
  [IPC.settingsSet]: { request: SettingsPatch; response: Settings }
  /**
   * Die aufgeloeste Sprache der Oberflaeche (S6.8): Einstellung, bei `auto`
   * die Systemsprache des Main. Der Renderer fragt sie beim Start und nach
   * jeder Aenderung der Einstellung ab.
   */
  [IPC.spracheGet]: { request: void; response: Sprache }
  /** Oeffnet den Dateidialog. `null`, wenn abgebrochen wurde. */
  [IPC.dokumentOeffnen]: { request: void; response: GeoeffnetesDokument | null }
  /**
   * Liefert das ueber die Befehlszeile uebergebene Dokument, falls vorhanden.
   * Der Renderer fragt es einmal beim Start ab.
   */
  [IPC.dokumentBeimStart]: { request: void; response: GeoeffnetesDokument | null }
  /**
   * Oeffnet einen Pfad, den der Renderer nennt — aus Drag & Drop oder aus der
   * Liste der zuletzt geoeffneten Dokumente. Der Main-Prozess prueft ihn; der
   * Renderer ist eine Sandbox fuer fremde Dokumente und nicht vertrauenswuerdig.
   */
  [IPC.dokumentOeffnePfad]: { request: string; response: OeffnenErgebnis }
  [IPC.zuletztGeoeffnet]: { request: void; response: ZuletztEintrag[] }
  /**
   * Oeffnet einen Verweis aus einem Dokument im Standardprogramm des Systems
   * (S2.1, Aufgabe 3).
   *
   * Die Navigation im Fenster bleibt gesperrt (S0.2); das hier ist der einzige
   * Weg nach draussen. Der Main prueft das Schema gegen eine Allowlist und
   * fragt vorher nach — beides gehoert dorthin, nicht in den Renderer, der
   * eine Sandbox fuer fremde Dokumente ist.
   */
  [IPC.externOeffnen]: { request: string; response: ExternesZielErgebnis }
  /**
   * Speichert das Dokument (S2.3a). Der Main prueft den Zielpfad gegen
   * Invariante 11, warnt bei Signaturen und schreibt atomar.
   */
  [IPC.dokumentSpeichern]: { request: SpeicherAuftrag; response: SpeicherErgebnis }
  /**
   * Meldet dem Main, ob ungespeicherte Aenderungen vorliegen.
   *
   * Der Main braucht die Antwort **synchron**, wenn das Fenster geschlossen
   * wird; ein Nachfragen zu diesem Zeitpunkt kaeme zu spaet. Deshalb haelt er
   * eine Kopie des Standes, die der Renderer bei jeder Aenderung nachfuehrt.
   */
  [IPC.dokumentGeaendert]: { request: AenderungsMeldung; response: void }
  /**
   * Ein Tab wird geschlossen (S6.1): der Main beendet die Dateiwache fuer
   * diesen Pfad, verwirft seine Arbeitskopie und seinen Aenderungsstand.
   */
  [IPC.dokumentSchliessen]: { request: string; response: void }
  /**
   * Rueckfrage vor dem Schliessen eines Tabs mit ungespeicherten Aenderungen
   * (S6.1). Anfrage ist der Dokumentname, Antwort `true` = verwerfen und
   * schliessen, `false` = abbrechen. Modal im Main, vorbelegt ist Abbrechen.
   */
  [IPC.tabSchliessenFragen]: { request: string; response: boolean }
  [IPC.formularFdfExportieren]: { request: FdfAuftrag; response: SpeicherErgebnis }
  /**
   * Laedt ein Bild fuer die grafische Signatur (S3.2, Aufgabe 4).
   *
   * Der Main oeffnet den Dialog, liest die Datei und prueft Kopf und Groesse
   * — der Renderer bekommt nur eine Data-URL, nie einen Pfad. Das Bild ist
   * ein Bild, keine kryptografische Signatur.
   */
  [IPC.bildLaden]: { request: void; response: BildErgebnis }
  /**
   * Wendet eine Mutation an (S4.0): der Main serialisiert die Arbeitskopie
   * mit pdf-lib neu und gibt die Bytes zurueck; der Renderer laedt sie und
   * verwirft alles, was er ueber das alte Dokument wusste.
   */
  [IPC.dokumentMutieren]: { request: MutationsAuftrag; response: MutationsErgebnis }
  /**
   * Rueckgaengig/Wiederholen einer Mutation (S4.1): kein zweites
   * Serialisieren, sondern der gemerkte Stand. Stand 0 ist die Datei.
   */
  [IPC.dokumentStandHerstellen]: { request: StandAuftrag; response: StandErgebnis }
  /** Mehrere PDFs im Dialog waehlen (S4.2a); `null` bei Abbruch. */
  [IPC.dokumenteWaehlen]: { request: void; response: Dokumentquelle[] | null }
  [IPC.dokumenteZusammenfuehren]: { request: ZusammenfuehrAuftrag; response: ZusammenfuehrErgebnis }
  [IPC.dokumentTeilen]: { request: TeilAuftrag; response: TeilErgebnis }
  /** PNG-Export (S4.2b): erst die Ziele, dann je Bild die Bytes. */
  [IPC.pngZieleWaehlen]: { request: PngZielAuftrag; response: PngZielErgebnis }
  [IPC.pngSchreiben]: { request: PngSchreibAuftrag; response: PngSchreibErgebnis }
  /** Drucken (S4.3): ein Auftrag, ein Ergebnis; Abbrechen laeuft daneben. */
  [IPC.dokumentDrucken]: { request: DruckAuftrag; response: DruckAntwort }
  [IPC.druckAbbrechen]: { request: void; response: boolean }
  /** Seiten als neue Datei (S6.2). */
  [IPC.seitenExtrahieren]: { request: ExtrahierAuftrag; response: ExtrahierErgebnis }
  /** Bilder lesen (S6.4): `null` = Dialog, sonst Pfade aus Drag & Drop. */
  [IPC.bilderWaehlen]: { request: string[] | null; response: BilderWahlErgebnis }
  [IPC.bilderZuPdf]: { request: BildPdfAuftrag; response: BildPdfErgebnis }
  /** PDF nach Word (S6.7); Ergebnis wie beim Speichern. */
  [IPC.wordExportieren]: { request: WordAuftrag; response: SpeicherErgebnis }
}

/**
 * Einseitiger Kanal Main → Renderer (ADR 0002). Er traegt alles, was im
 * Main-Prozess entsteht und den Renderer angeht: Menue- und
 * Kontextmenueklicks sowie Dokumente, die das Betriebssystem uebergibt.
 */
export const EREIGNIS_KANAL = 'app:ereignis'

/**
 * Was ueber den Kanal kommen darf. Bewusst eng — kein freier Befehlsstrom vom
 * Main in den Renderer:
 *
 * - `befehl`: einer der ohnehin bekannten Befehle aus der Kuerzel-Map.
 * - `sucheNachAuswahl`: der im Kontextmenue markierte Text.
 * - `dokumentAusSystem`: ein Pfad aus "Oeffnen mit" oder einer zweiten
 *   Instanz. Bewusst nur der Pfad und nicht die Bytes: der Renderer holt das
 *   Dokument ueber `dokumentOeffnePfad`, wo es ohnehin geprueft wird.
 */
export type AnwendungsEreignis =
  | { art: 'befehl'; befehl: Befehl }
  | { art: 'sucheNachAuswahl'; text: string }
  | { art: 'dokumentAusSystem'; pfad: string }
  /** Der Druck ist einen Schritt weiter (S4.3, Aufgabe 3). */
  | { art: 'druckFortschritt'; phase: Druckphase }
  /**
   * Die geoeffnete Datei wurde ausserhalb der Anwendung geloescht oder
   * ersetzt (S1.5, Fall 4). Seit S6.1 mit Pfad: es koennen mehrere Dokumente
   * offen sein, und der Hinweis gehoert zum richtigen Tab.
   */
  | { art: 'dokumentVerschwunden'; pfad: string }

/**
 * Prueft eine ueber den Kanal eingetroffene Nutzlast.
 *
 * Der Renderer vertraut dem Main zwar, aber der Kanal ist der einzige Weg, auf
 * dem etwas ungeprueft in die Befehlsausfuehrung geraten koennte. Muster wie
 * `pruefePatch` in settings.ts: abgelehnt und protokolliert, nicht geschluckt.
 */
export function pruefeEreignis(eingabe: unknown): AnwendungsEreignis | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const wert = eingabe as Partial<Record<'art' | 'befehl' | 'text' | 'pfad' | 'phase', unknown>>
  if (wert.art === 'befehl') {
    const passt = KUERZEL.some((kuerzel) => kuerzel.befehl === wert.befehl)
    return passt ? { art: 'befehl', befehl: wert.befehl as Befehl } : null
  }
  if (wert.art === 'sucheNachAuswahl') {
    return typeof wert.text === 'string' ? { art: 'sucheNachAuswahl', text: wert.text } : null
  }
  if (wert.art === 'dokumentVerschwunden') {
    return typeof wert.pfad === 'string' ? { art: 'dokumentVerschwunden', pfad: wert.pfad } : null
  }
  if (wert.art === 'druckFortschritt') {
    return wert.phase === 'vorlage' || wert.phase === 'laden' || wert.phase === 'drucken'
      ? { art: 'druckFortschritt', phase: wert.phase }
      : null
  }
  if (wert.art === 'dokumentAusSystem') {
    return typeof wert.pfad === 'string' && wert.pfad.length > 0
      ? { art: 'dokumentAusSystem', pfad: wert.pfad }
      : null
  }
  return null
}

/**
 * Die Methoden, die das Preload unter `window.api` freigibt. Aus dem Contract
 * abgeleitet: Kanaele ohne Nutzlast werden zu parameterlosen Methoden.
 *
 * `beiEreignis` faellt aus dieser Ableitung heraus, weil es kein
 * Anfrage/Antwort-Paar ist. Es gibt eine Abmeldefunktion zurueck — ohne die
 * sammelte sich bei jedem Neuaufbau der Oberflaeche ein weiterer Zuhoerer an,
 * und ein Menueklick loeste den Befehl mehrfach aus.
 */
export type PreloadApi = {
  [M in keyof typeof IPC]: IpcContract[(typeof IPC)[M]]['request'] extends void
    ? () => Promise<IpcContract[(typeof IPC)[M]]['response']>
    : (
        request: IpcContract[(typeof IPC)[M]]['request']
      ) => Promise<IpcContract[(typeof IPC)[M]]['response']>
} & {
  beiEreignis: (rueckruf: (befehl: AnwendungsEreignis) => void) => () => void
  /**
   * Der Pfad einer per Drag & Drop uebergebenen Datei.
   *
   * `File.path` gibt es seit Electron 32 nicht mehr; der Pfad kommt nur noch
   * ueber `webUtils.getPathForFile` im Preload. Leere Zeichenkette, wenn die
   * Ablage keinen Dateipfad trug — etwa bei einem aus dem Browser gezogenen
   * Bild.
   */
  pfadVonDatei: (datei: File) => string
}
