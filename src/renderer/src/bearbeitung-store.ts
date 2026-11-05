import { create } from 'zustand'
import { STANDARD_ANNOTATIONEN } from '../../shared/settings'

/**
 * Was der Nutzer gerade tut: gewaehltes Werkzeug, Farbe, Strichstaerke und die
 * ausgewaehlte Annotation (S2.2).
 *
 * Getrennt vom Annotationsspeicher, weil hier nichts steht, was zum Dokument
 * gehoert. Ein Werkzeugwechsel darf keine Annotation anfassen, und ein
 * Dokumentwechsel soll das Werkzeug nicht zuruecksetzen — wer markiert, will
 * meist auch in der naechsten Datei markieren.
 */
export type Werkzeug =
  | 'auswahl'
  | 'markieren'
  | 'unterstreichen'
  | 'durchstreichen'
  | 'notiz'
  | 'freihand'
  | 'stempel'
  | 'signatur'
  /** Seiten zuschneiden (S6.3): Rahmen aufziehen, kein Anmerkungswerkzeug. */
  | 'zuschneiden'

  /** Freien Text setzen (S6.5) — nicht zu verwechseln mit 'notiz'. */
  | 'text'
  /**
   * Vorhandenen Text aendern (S6.6b): eine Zeile des Seiteninhalts anklicken,
   * ersetzen oder loeschen. Kein Anmerkungswerkzeug - es aendert das Dokument.
   */
  | 'textBearbeiten'

/**
 * Das Bild, das das Signaturwerkzeug setzt (S3.2, Aufgabe 4) — gezeichnet
 * oder geladen. Breite und Hoehe in Bildpunkten, damit die Platzierung das
 * Seitenverhaeltnis wahren kann, ohne das Bild erneut zu dekodieren.
 *
 * Ein Bild, keine kryptografische Signatur: es belegt nicht, wer
 * unterschrieben hat. Wer das braucht, braucht ein anderes Werkzeug.
 */
export interface SignaturBild {
  /** PNG- oder JPEG-Data-URL. */
  url: string
  breite: number
  hoehe: number
}

/** Selbst erstellt, keine fremden Vorlagen (S2.2, Aufgabe 5). */
export const STEMPEL_TEXTE = ['Geprueft', 'Entwurf', 'Vertraulich'] as const
export type StempelText = (typeof STEMPEL_TEXTE)[number]

/** Welche Werkzeuge aus einer Textauswahl heraus arbeiten. */
export const MARKUP_WERKZEUGE = ['markieren', 'unterstreichen', 'durchstreichen'] as const

export function istMarkupWerkzeug(werkzeug: Werkzeug): boolean {
  return (MARKUP_WERKZEUGE as readonly Werkzeug[]).includes(werkzeug)
}

export interface BearbeitungsZustand {
  werkzeug: Werkzeug
  farbe: string
  strichstaerke: number
  /** Autor neuer Annotationen; kommt aus den Einstellungen (S1.0). */
  autor: string
  stempel: StempelText
  /**
   * Das Signaturbild fuer die naechste Platzierung. Bleibt ueber Dokumente
   * hinweg erhalten — wer drei Vertraege unterschreibt, zeichnet nicht dreimal.
   */
  signaturBild: SignaturBild | null
  /** Kennung der ausgewaehlten Annotation, `null` wenn keine gewaehlt ist. */
  ausgewaehlt: string | null
  /**
   * Ein Markup, das **sofort** auf die bestehende Textauswahl anzuwenden ist
   * (Kontextmenue oder Kuerzel). Die Ebenen der Seiten lesen es, wenden es auf
   * ihren Anteil der Auswahl an und setzen es zurueck. Ohne diesen Umweg
   * muesste die Schale wissen, welche Seite welchen Teil der Auswahl traegt —
   * und genau das weiss nur die Seite selbst.
   */
  anwendenAuf: 'markieren' | 'unterstreichen' | 'durchstreichen' | null
  /**
   * Ob die Leiste mit den Bearbeitungswerkzeugen offen ist (S6.9). Lesen
   * braucht sie nicht; sie erscheint auf "Bearbeiten" oder sobald ein
   * Werkzeug gewaehlt wird (Kuerzel, Kontextmenue).
   */
  leisteOffen: boolean
  /**
   * Welche `/FreeText` gerade den Eingabekasten zeigt (S6.11). Im Store und
   * nicht in der Bearbeitungsebene, weil auch die Annotationsebene es wissen
   * muss: sie blendet die Anzeige des Textes so lange aus, sonst laege der
   * Text doppelt uebereinander.
   */
  freitextOffen: string | null

  schalteLeiste: () => void
  oeffneFreitext: (id: string | null) => void
  setzeWerkzeug: (werkzeug: Werkzeug) => void
  setzeFarbe: (farbe: string) => void
  setzeStrichstaerke: (staerke: number) => void
  setzeAutor: (autor: string) => void
  setzeStempel: (text: StempelText) => void
  setzeSignaturBild: (bild: SignaturBild | null) => void
  waehle: (id: string | null) => void
  wendeAn: (werkzeug: 'markieren' | 'unterstreichen' | 'durchstreichen') => void
  angewendet: () => void
}

export const useBearbeitung = create<BearbeitungsZustand>((set) => ({
  werkzeug: 'auswahl',
  farbe: STANDARD_ANNOTATIONEN.farbe,
  strichstaerke: STANDARD_ANNOTATIONEN.strichstaerke,
  autor: '',
  stempel: 'Geprueft',
  signaturBild: null,
  ausgewaehlt: null,
  anwendenAuf: null,
  leisteOffen: false,
  freitextOffen: null,

  schalteLeiste: () => {
    // Zu heisst: zurueck zum Lesen. Ein Werkzeug, dessen Leiste nicht zu
    // sehen ist, liesse den naechsten Klick unerwartet etwas zeichnen.
    set((zustand) =>
      zustand.leisteOffen
        ? { leisteOffen: false, werkzeug: 'auswahl', ausgewaehlt: null, freitextOffen: null }
        : { leisteOffen: true }
    )
  },
  oeffneFreitext: (freitextOffen) => {
    set({ freitextOffen })
  },
  setzeWerkzeug: (werkzeug) => {
    // Beim Werkzeugwechsel die Auswahl aufheben: der Rahmen um eine Annotation
    // waere sonst der einzige sichtbare Rest eines Modus, den es nicht mehr gibt.
    // Ein Werkzeug ausser der Auswahl oeffnet die Leiste (S6.9).
    set(
      werkzeug === 'auswahl'
        ? { werkzeug, ausgewaehlt: null, freitextOffen: null }
        : { werkzeug, ausgewaehlt: null, freitextOffen: null, leisteOffen: true }
    )
  },
  setzeFarbe: (farbe) => {
    set({ farbe })
  },
  setzeStrichstaerke: (strichstaerke) => {
    set({ strichstaerke })
  },
  setzeAutor: (autor) => {
    set({ autor })
  },
  setzeStempel: (stempel) => {
    set({ stempel })
  },
  setzeSignaturBild: (signaturBild) => {
    set({ signaturBild })
  },
  waehle: (ausgewaehlt) => {
    set({ ausgewaehlt })
  },
  wendeAn: (anwendenAuf) => {
    set({ anwendenAuf })
  },
  angewendet: () => {
    set({ anwendenAuf: null })
  }
}))
