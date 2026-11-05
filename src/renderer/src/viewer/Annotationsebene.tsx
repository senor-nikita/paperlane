import { useCallback, useEffect, useMemo, useRef } from 'react'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'
import { Sinnbild } from '../schale/Symbol'
import type { Annotation, Farbe } from '../../../shared/annotations'
import { istDarstellbar } from '../../../shared/annotations'
import { useAnnotationen } from '../annotations-store'
import { useBearbeitung } from '../bearbeitung-store'
import { loescheAnnotation, veraendereAnnotation } from '../annotationsbefehle'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { findeAnnotationUnter, zeichne, type GezeichneteAnnotation } from './annotationen'
import { huelle, punktlisteZuBildschirm, type Bildschirmrechteck, type Matrix } from './koordinaten'
import { loeschtDieAnnotation } from './entf'
import { aendere } from './erzeugen'
import { freitextStil } from './Freitextfeld'
import { useSeitenmatrix } from './seitenmatrix'
import { loeseZielAuf } from './ziel'
import './annotationsebene.css'

/**
 * Die Anzeige vorhandener Annotationen (S2.1).
 *
 * Sie zeigt nur, was im Dokument steht — Erstellen und Aendern ist S2.2,
 * Speichern S2.3a. Gezeichnet wird ausschliesslich hier: pdf.js malt seit
 * dieser Stufe keine Annotationen mehr in die Canvas
 * (`PDFJS_RENDER_HAERTUNG`), sonst laege ueber jeder Markierung eine zweite.
 *
 * Die Ebene liegt ueber der Textebene und laesst Zeigereignisse durch. Nur
 * Verweise und Notizzettel fangen sie ab; waere es die ganze Flaeche, liesse
 * sich markierter Text nicht mehr auswaehlen.
 */

interface AnnotationsebeneProps {
  /** Nullbasierter Seitenindex. */
  index: number
}

/** Nur diese beiden reagieren auf Klicks — alles Uebrige ist reine Darstellung. */
function istInteraktiv(annotation: Annotation): boolean {
  return annotation.typ === 'Link' || annotation.typ === 'Text'
}

/** Relative Helligkeit nach WCAG unter 0,18: helle Schrift darauf. */
function istDunkel(farbe: Farbe | null): boolean {
  if (farbe === null) return false
  const kanal = (wert: number): number => {
    const c = wert / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * kanal(farbe.r) + 0.7152 * kanal(farbe.g) + 0.0722 * kanal(farbe.b) < 0.18
}

function alsCss(farbe: Farbe | null, ausweich: string, deckkraft = 1): string {
  if (farbe === null) return ausweich
  const kanaele = [farbe.r, farbe.g, farbe.b].map((wert) => String(Math.round(wert))).join(',')
  return 'rgba(' + kanaele + ',' + String(deckkraft) + ')'
}

/** Ein Rechteck relativ zur Huelle seiner Annotation. */
function versetzt(rechteck: Bildschirmrechteck, flaeche: Bildschirmrechteck): React.CSSProperties {
  return {
    position: 'absolute',
    left: String(rechteck.links - flaeche.links) + 'px',
    top: String(rechteck.oben - flaeche.oben) + 'px',
    width: String(rechteck.breite) + 'px',
    height: String(rechteck.hoehe) + 'px'
  }
}

/** Strichstaerke einer Linie, mit dem Zoom mitwachsend, aber nie unsichtbar. */
function strichstaerke(hoehe: number): number {
  return Math.max(1, hoehe * 0.08)
}

export function Annotationsebene({ index }: AnnotationsebeneProps): React.JSX.Element {
  useT()
  const dokument = useDokument((zustand) => zustand.dokument)
  const springeZuZiel = useDokument((zustand) => zustand.springeZuZiel)
  const setzeHinweis = useDokument((zustand) => zustand.setzeHinweis)
  const eintraege = useAnnotationen((zustand) => zustand.proSeite[index + 1])
  const ladeSeite = useAnnotationen((zustand) => zustand.ladeSeite)

  const behaelterRef = useRef<HTMLDivElement>(null)
  const matrix = useSeitenmatrix(index)
  /**
   * Der Notizzettel haengt an der Auswahl (S2.2) und nicht an einem eigenen
   * Zustand: sonst gaebe es zwei Begriffe von "offen" nebeneinander, und ein
   * Klick auf die Greifflaeche der Bearbeitungsebene liesse den Zettel zu,
   * obwohl die Notiz gerade ausgewaehlt wurde.
   */
  const ausgewaehlt = useBearbeitung((zustand) => zustand.ausgewaehlt)
  const waehle = useBearbeitung((zustand) => zustand.waehle)

  useEffect(() => {
    if (dokument === null) return
    void ladeSeite(dokument, index + 1)
  }, [dokument, index, ladeSeite])

  const gezeichnete = useMemo<GezeichneteAnnotation[]>(() => {
    if (matrix === null || eintraege === undefined) return []
    const sichtbar = eintraege.filter(
      (annotation) => !annotation.versteckt && istDarstellbar(annotation.typ)
    )
    return zeichne(sichtbar, matrix)
  }, [matrix, eintraege])

  // Fuer das Hit-Testing zaehlen nur die anklickbaren: ein Klick, der auf einer
  // Markierung landet, hat kein Ziel.
  const interaktive = useMemo(
    () => gezeichnete.filter((eintrag) => istInteraktiv(eintrag.annotation)),
    [gezeichnete]
  )

  const folge = useCallback(
    (annotation: Annotation): void => {
      if (annotation.typ === 'Text') {
        waehle(useBearbeitung.getState().ausgewaehlt === annotation.id ? null : annotation.id)
        return
      }
      const ziel = annotation.ziel
      if (ziel === null || dokument === null) return

      if (ziel.art === 'intern') {
        // Dieselbe Aufloesung wie die Gliederung (S1.3d). Eine zweite Fassung
        // behandelte FitR garantiert anders.
        loeseZielAuf(dokument, ziel.ziel)
          .then((position) => {
            if (position === null) {
              console.error('Verweis ohne aufloesbares Ziel:', ziel.ziel)
              setzeHinweis(t('verweis.ohneZiel'))
              return
            }
            springeZuZiel(position)
          })
          .catch((fehler: unknown) => {
            console.error('Verweisziel konnte nicht aufgeloest werden:', fehler)
          })
        return
      }

      const api = bruecke()
      if (api === undefined) {
        console.error('Bruecke fehlt: externer Verweis nicht moeglich.')
        return
      }
      // Geprueft und bestaetigt wird im Main-Prozess. Der Renderer erfaehrt nur
      // das Ergebnis - und meldet es, wenn das Ziel abgelehnt wurde.
      api
        .externOeffnen(ziel.url)
        .then((ergebnis) => {
          if (ergebnis.art === 'abgelehnt') setzeHinweis(ergebnis.grund)
        })
        .catch((fehler: unknown) => {
          console.error('Externer Verweis fehlgeschlagen:', fehler)
        })
    },
    [dokument, springeZuZiel, setzeHinweis, waehle]
  )

  /**
   * Welche Annotation wurde getroffen?
   *
   * Die anklickbare Flaeche ist die Huelle; bei mehrzeiligen oder
   * ueberlappenden Verweisen liegt darin auch, was nicht gemeint war. Deshalb
   * entscheidet das Hit-Testing ueber die genauen Rechtecke. Bei
   * Tastaturbedienung gibt es keine Zeigerposition (`detail === 0`) — dann
   * gilt die Annotation, deren Schaltflaeche den Fokus hatte.
   */
  const beiKlick = useCallback(
    (ereignis: React.MouseEvent, eigene: Annotation): void => {
      const behaelter = behaelterRef.current
      if (ereignis.detail === 0 || behaelter === null) {
        folge(eigene)
        return
      }
      const rahmen = behaelter.getBoundingClientRect()
      const getroffen = findeAnnotationUnter(
        { x: ereignis.clientX - rahmen.left, y: ereignis.clientY - rahmen.top },
        interaktive
      )
      folge(getroffen ?? eigene)
    },
    [folge, interaktive]
  )

  const schliesseNotiz = useCallback(() => {
    waehle(null)
  }, [waehle])

  return (
    <div
      ref={behaelterRef}
      className="annotationsebene"
      data-testid={'annotationsebene-' + String(index + 1)}
    >
      {matrix !== null &&
        gezeichnete.map((eintrag) => (
          <Marke
            key={eintrag.annotation.id}
            eintrag={eintrag}
            matrix={matrix}
            // Nur Notizen haben einen Zettel. Vor S6.12 ging er bei jeder
            // ausgewaehlten Anmerkung auf - auch unter einem Freitext.
            notizOffen={eintrag.annotation.typ === 'Text' && ausgewaehlt === eintrag.annotation.id}
            aufKlick={beiKlick}
            aufSchliessen={schliesseNotiz}
          />
        ))}
    </div>
  )
}

interface MarkeProps {
  eintrag: GezeichneteAnnotation
  matrix: Matrix
  notizOffen: boolean
  aufKlick: (ereignis: React.MouseEvent, annotation: Annotation) => void
  aufSchliessen: () => void
}

/**
 * Eine einzelne Annotation.
 *
 * Der aeussere Kasten liegt auf der Huelle aller ihrer Rechtecke und traegt die
 * Kennung — genau einmal je Annotation. Genau darauf prueft das
 * Exit-Kriterium des Schritts: keine Annotation erscheint zweimal.
 */
function Marke({
  eintrag,
  matrix,
  notizOffen,
  aufKlick,
  aufSchliessen
}: MarkeProps): React.JSX.Element | null {
  const { annotation, rechtecke } = eintrag
  const flaeche = huelle(rechtecke)
  if (flaeche === null) return null

  return (
    <div
      className="annotation-flaeche"
      data-testid={'annotation-' + annotation.id}
      data-annotation-typ={annotation.typ}
      data-annotation-seite={String(annotation.seite)}
      style={{
        left: String(flaeche.links) + 'px',
        top: String(flaeche.oben) + 'px',
        width: String(Math.max(1, flaeche.breite)) + 'px',
        height: String(Math.max(1, flaeche.hoehe)) + 'px'
      }}
    >
      <Inhalt
        annotation={annotation}
        rechtecke={rechtecke}
        flaeche={flaeche}
        matrix={matrix}
        aufKlick={aufKlick}
      />
      {notizOffen && <Notizzettel annotation={annotation} aufSchliessen={aufSchliessen} />}
    </div>
  )
}

interface InhaltProps {
  annotation: Annotation
  rechtecke: Bildschirmrechteck[]
  flaeche: Bildschirmrechteck
  matrix: Matrix
  aufKlick: (ereignis: React.MouseEvent, annotation: Annotation) => void
}

function Inhalt({
  annotation,
  rechtecke,
  flaeche,
  matrix,
  aufKlick
}: InhaltProps): React.JSX.Element | null {
  switch (annotation.typ) {
    case 'Highlight':
      return (
        <>
          {rechtecke.map((rechteck, nummer) => (
            <div
              key={nummer}
              style={{
                ...versetzt(rechteck, flaeche),
                background: alsCss(annotation.farbe, '#ffff00', annotation.opazitaet),
                // Multiplizieren statt Ueberdecken: sonst verschwindet der Text
                // unter der Markierung, statt durch sie hindurchzuscheinen.
                mixBlendMode: 'multiply'
              }}
            />
          ))}
        </>
      )

    case 'Underline':
    case 'StrikeOut':
      return (
        <>
          {rechtecke.map((rechteck, nummer) => {
            const staerke = strichstaerke(rechteck.hoehe)
            const versatz =
              annotation.typ === 'Underline'
                ? rechteck.hoehe - staerke
                : (rechteck.hoehe - staerke) / 2
            return (
              <div
                key={nummer}
                style={{
                  ...versetzt(rechteck, flaeche),
                  top: String(rechteck.oben - flaeche.oben + versatz) + 'px',
                  height: String(staerke) + 'px',
                  background: alsCss(annotation.farbe, '#1a1a1a', annotation.opazitaet)
                }}
              />
            )
          })}
        </>
      )

    case 'Square':
    case 'Circle':
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '1px solid ' + alsCss(annotation.farbe, '#1a1a1a', annotation.opazitaet),
            borderRadius: annotation.typ === 'Circle' ? '50%' : undefined
          }}
        />
      )

    case 'Ink':
      return <Freihand annotation={annotation} flaeche={flaeche} matrix={matrix} />

    case 'Stamp':
      if (annotation.bild !== undefined) {
        // Die grafische Signatur (S3.2): das Bild fuellt das Rechteck, so wie
        // der Appearance-Stream es mit `cm` auf /Rect skaliert. Kein Rahmen:
        // eine Unterschrift mit gestricheltem Kasten saehe nach Formular aus.
        return (
          <img
            src={annotation.bild}
            alt={annotation.inhalt.trim().length > 0 ? annotation.inhalt : 'Signaturbild'}
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: annotation.opazitaet,
              display: 'block'
            }}
          />
        )
      }
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px dashed ' + alsCss(annotation.farbe, '#6a6a6a', annotation.opazitaet),
            color: alsCss(annotation.farbe, '#6a6a6a', 1),
            fontSize: '11px',
            overflow: 'hidden'
          }}
        >
          {/* Bewusst dieselbe Bildsprache wie der Appearance-Stream aus S2.3b
              (gestrichelter Rahmen, mittiger Text in der Farbe): was hier
              steht, soll in einem fremden Betrachter wiederzuerkennen sein.
              Gezeichnet wird hier trotzdem mit DOM-Mitteln — den Strom aus dem
              Dokument zu rendern hiesse, pdf.js' Annotationsebene zu benutzen,
              und die ist seit S2.1 abgeschaltet (Invariante 6). */}
          {annotation.inhalt.trim().length > 0 ? annotation.inhalt : t('werkzeug.stempel')}
        </div>
      )

    case 'Text':
      return (
        <button
          type="button"
          className="annotation-notiz"
          data-testid={'annotation-notiz-' + annotation.id}
          aria-label={
            annotation.autor.length > 0
              ? t('notiz.anzeigenVon', { autor: annotation.autor })
              : t('notiz.anzeigen')
          }
          onClick={(ereignis) => {
            aufKlick(ereignis, annotation)
          }}
          style={{
            background: alsCss(annotation.farbe, '#ffd400', 1),
            border: '1px solid rgba(0,0,0,0.35)',
            borderRadius: '3px',
            fontSize: '11px',
            lineHeight: 1,
            // Das Symbol muss auf jeder Notizfarbe lesbar sein - auf Schwarz
            // war es bisher ein schwarzes Kaestchen ohne erkennbaren Inhalt.
            color: istDunkel(annotation.farbe) ? '#ffffff' : '#1a1a1a'
          }}
        >
          <Sinnbild name="notiz" groesse="75%" />
        </button>
      )

    case 'FreeText':
      return <Freitextanzeige annotation={annotation} matrix={matrix} />

    case 'Link':
      return (
        <button
          type="button"
          className="annotation-link"
          data-testid={'annotation-link-' + annotation.id}
          aria-label={
            annotation.ziel?.art === 'extern'
              ? t('verweis.extern', { url: annotation.ziel.url })
              : t('verweis.intern')
          }
          onClick={(ereignis) => {
            aufKlick(ereignis, annotation)
          }}
        />
      )

    default:
      return null
  }
}

/**
 * Der Text einer `/FreeText` (S6.11).
 *
 * Bis hierher fehlte dieser Fall ganz: der Text war nur im Eingabekasten zu
 * sehen und verschwand mit dem Verlassen des Feldes - gespeichert war er,
 * aber die Anzeige kannte den Typ nicht. Solange der Kasten offen ist, bleibt
 * die Anzeige unsichtbar; sonst stuende der Text doppelt da.
 */
function Freitextanzeige({
  annotation,
  matrix
}: {
  annotation: Annotation
  matrix: Matrix
}): React.JSX.Element {
  const offen = useBearbeitung((zustand) => zustand.freitextOffen === annotation.id)
  return (
    <div
      data-testid={'freitext-anzeige-' + annotation.id}
      style={{
        ...freitextStil(annotation, matrix),
        position: 'absolute',
        inset: 0,
        opacity: annotation.opazitaet,
        visibility: offen ? 'hidden' : 'visible'
      }}
    >
      {annotation.inhalt}
    </div>
  )
}

/**
 * Freihandzuege als SVG-Pfade.
 *
 * SVG und nicht ein zweites Canvas: die Zuege muessen sich bei jedem Zoom neu
 * aufbauen, und ein Vektorpfad tut das ohne eigene Renderschleife. Die Punkte
 * stehen im Dokument in PDF-Koordinaten und laufen deshalb durch dieselbe
 * Transformation wie alles Uebrige.
 */
function Freihand({
  annotation,
  flaeche,
  matrix
}: {
  annotation: Annotation
  flaeche: Bildschirmrechteck
  matrix: Matrix
}): React.JSX.Element | null {
  const zuege = annotation.striche
  if (zuege === null) return null
  return (
    <svg
      width={Math.max(1, flaeche.breite)}
      height={Math.max(1, flaeche.hoehe)}
      style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      aria-hidden="true"
    >
      {zuege.map((zug, nummer) => (
        <polyline
          key={nummer}
          points={punktlisteZuBildschirm(zug, matrix)
            .map((punkt) => String(punkt.x - flaeche.links) + ',' + String(punkt.y - flaeche.oben))
            .join(' ')}
          fill="none"
          stroke={alsCss(annotation.farbe, '#1a1a1a', annotation.opazitaet)}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

function Notizzettel({
  annotation,
  aufSchliessen
}: {
  annotation: Annotation
  aufSchliessen: () => void
}): React.JSX.Element {
  const eingabeRef = useRef<HTMLTextAreaElement>(null)
  const annotationRef = useRef(annotation)
  annotationRef.current = annotation

  /**
   * Den Text uebernehmen, falls er sich geaendert hat. Laeuft beim Verlassen
   * des Feldes und beim Schliessen des Zettels (S6.12): Escape oder ein Klick
   * daneben bauen den Zettel ab, bevor das Feld sein `blur` bekommt - ohne
   * diesen Weg ginge der getippte Text verloren.
   */
  const uebernimm = useCallback((feld: HTMLTextAreaElement | null): void => {
    if (feld === null) return
    const vorher = useAnnotationen.getState().finde(annotationRef.current.id)
    // Geloescht, waehrend der Zettel offen war: nichts wiederbeleben.
    if (vorher === null || feld.value === vorher.inhalt) return
    veraendereAnnotation(vorher, aendere(vorher, { inhalt: feld.value }))
  }, [])

  // Das Feld beim Einbau festhalten: beim Abbau hat React die Ref schon auf
  // `null` gesetzt, bevor diese Aufraeumfunktion laeuft.
  useEffect(() => {
    const feld = eingabeRef.current
    return () => {
      uebernimm(feld)
    }
  }, [uebernimm])

  return (
    <div
      className="annotation-notizzettel"
      data-testid={'annotation-notizzettel-' + annotation.id}
      // Der Zettel geht auf, ohne dass der Fokus wandert; ohne Live-Region
      // bekaeme ein Screenreader-Nutzer davon nichts mit.
      role="status"
      style={{ left: 0, top: '100%' }}
    >
      <div className="annotation-notizzettel-kopf">
        <span>{annotation.autor.length > 0 ? annotation.autor : t('notiz.ohneAutor')}</span>
        <button
          type="button"
          className="annotation-notizzettel-schliessen"
          data-testid={'annotation-notiz-schliessen-' + annotation.id}
          aria-label={t('notiz.schliessen')}
          onClick={aufSchliessen}
        >
          ✕
        </button>
      </div>
      {/* Bearbeitbar seit S2.2 (Aufgabe 3). Uebernommen wird beim Verlassen
          des Feldes und nicht bei jedem Tastendruck: sonst stuende je
          Buchstabe ein Schritt in der Historie, und Strg+Z loeschte den Text
          Zeichen fuer Zeichen. */}
      <textarea
        className="annotation-notizzettel-eingabe"
        data-testid={'annotation-notiz-eingabe-' + annotation.id}
        aria-label={t('notiz.inhalt')}
        defaultValue={annotation.inhalt}
        placeholder={t('notiz.leer')}
        // Eine frisch gesetzte Notiz ist leer: dann direkt hineinschreiben.
        // Eine vorhandene oeffnet ohne Fokuswechsel (siehe oben).
        autoFocus={annotation.inhalt.length === 0}
        rows={4}
        ref={eingabeRef}
        onBlur={(ereignis) => {
          uebernimm(ereignis.target)
        }}
        onKeyDown={(ereignis) => {
          // Entf ohne Zeichen zum Loeschen nimmt die ganze Notiz weg.
          if (loeschtDieAnnotation(ereignis)) {
            ereignis.preventDefault()
            ereignis.stopPropagation()
            const jetzt = useAnnotationen.getState().finde(annotationRef.current.id)
            if (jetzt !== null) loescheAnnotation(jetzt)
            return
          }
          // Escape schliesst den Zettel. Die zentralen Kuerzel greifen in
          // Eingabefeldern nicht, deshalb hier selbst.
          if (ereignis.key !== 'Escape') return
          ereignis.stopPropagation()
          aufSchliessen()
        }}
      />
    </div>
  )
}
