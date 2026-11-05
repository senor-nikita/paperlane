import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, PdfRechteck } from '../../../shared/annotations'
import { useAnnotationen } from '../annotations-store'
import { erstelleAnnotation, veraendereAnnotation } from '../annotationsbefehle'
import { istMarkupWerkzeug, useBearbeitung } from '../bearbeitung-store'
import { useFormular } from '../formular-store'
import { findeAnnotationUnter, rechteckeFuer, zeichne } from './annotationen'
import { auswahlrechtecke, glaette, quadPointsAusRechtecken } from './eingabe'
import {
  erzeugeFreihand,
  erzeugeFreitext,
  erzeugeMarkup,
  erzeugeNotiz,
  erzeugeSignatur,
  erzeugeStempel,
  passeEin,
  signaturRechteck,
  skaliere,
  verschiebe
} from './erzeugen'
import { Freitextfeld } from './Freitextfeld'
import {
  bildschirmZuPdf,
  huelle,
  pdfZuBildschirm,
  type Bildschirmrechteck,
  type Matrix,
  type Punkt
} from './koordinaten'
import { useSeitenmatrix } from './seitenmatrix'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/**
 * Annotationen erstellen und bearbeiten (S2.2).
 *
 * Liegt ueber der Anzeigeebene und nimmt nur dort Zeigereignisse an, wo sie
 * gebraucht werden. Das ist keine Feinheit, sondern die Bedingung dafuer, dass
 * die Textauswahl aus S1.4 weiter funktioniert:
 *
 * - Markup-Werkzeuge arbeiten **aus** der Textauswahl heraus. Ihre Flaeche
 *   laesst Zeigereignisse durch; gelesen wird beim Loslassen der Maustaste.
 * - Notiz, Stempel und Freihand brauchen eine Flaeche und bekommen sie.
 * - Das Auswahlwerkzeug fasst nur die Anmerkungen selbst an — und auch nur
 *   die gegenstaendlichen (Notiz, Stempel, Freihand, Rechteck, Ellipse).
 *   Markierungen liegen ueber Text; haetten sie eine Klickflaeche, waere der
 *   Text darunter nicht mehr mit der Maus auszuwaehlen. Sie werden durch einen
 *   Klick ohne Textauswahl gewaehlt (siehe `markups`) oder ueber die
 *   Anmerkungsliste in der Seitenleiste.
 */

interface BearbeitungsebeneProps {
  /** Nullbasierter Seitenindex. */
  index: number
}

/** Kantenlaenge eines Anfassers in CSS-Pixeln. */
const GRIFF = 10

/** Kleinste Kantenlaenge, auf die sich eine Annotation ziehen laesst. */
const MIN_KANTE = 8

type MarkupWerkzeug = 'markieren' | 'unterstreichen' | 'durchstreichen'

/** Welcher PDF-Subtyp aus welchem Werkzeug entsteht. */
const MARKUP_TYP: Record<MarkupWerkzeug, 'Highlight' | 'Underline' | 'StrikeOut'> = {
  markieren: 'Highlight',
  unterstreichen: 'Underline',
  durchstreichen: 'StrikeOut'
}

type Ecke = 'linksOben' | 'rechtsOben' | 'linksUnten' | 'rechtsUnten'

const ECKEN: readonly Ecke[] = ['linksOben', 'rechtsOben', 'linksUnten', 'rechtsUnten']

/**
 * Breite des Randes um eine `/FreeText`, an dem sie sich verschieben laesst
 * (S6.11). Das Innere gehoert dem Text; ohne diesen Rand gaebe es bei offenem
 * Eingabekasten keine Stelle mehr, an der man sie greifen kann.
 */
const FREITEXT_RAND = 6

/** Ab so vielen CSS-Pixeln Bewegung ist ein Klick ein Ziehen. */
const ZIEH_SCHWELLE = 3

type Ziehen =
  | {
      art: 'verschieben'
      original: Annotation
      start: Punkt
      /** Bildschirmpunkt beim Druecken - fuer die Unterscheidung Klick/Ziehen. */
      startBildschirm: Punkt
      bewegt: boolean
    }
  | { art: 'groesse'; original: Annotation; ecke: Ecke; flaeche: Bildschirmrechteck }

/** Anmerkungen, die im Auswahlwerkzeug eine Klickflaeche bekommen. */
function istGegenstaendlich(annotation: Annotation): boolean {
  return ['Text', 'Stamp', 'Ink', 'Square', 'Circle', 'FreeText'].includes(annotation.typ)
}

/**
 * Markierungen: sie liegen ueber Text und haben deshalb keine Klickflaeche
 * (siehe oben). Sie werden ausgewaehlt, indem man in die Markierung klickt,
 * ohne Text zu markieren.
 */
function istTextMarkup(annotation: Annotation): boolean {
  return ['Highlight', 'Underline', 'StrikeOut'].includes(annotation.typ)
}

/**
 * Das Rechteck, das entsteht, wenn eine Ecke an den Zeiger wandert.
 *
 * Gerechnet wird in Bildschirmkoordinaten und nicht in PDF-Punkten: welche
 * PDF-Ecke oben links liegt, haengt von der Drehung ab, und der Nutzer zieht
 * an dem, was er sieht.
 */
function neueFlaeche(flaeche: Bildschirmrechteck, ecke: Ecke, punkt: Punkt): Bildschirmrechteck {
  const rechts = flaeche.links + flaeche.breite
  const unten = flaeche.oben + flaeche.hoehe
  const x1 = ecke === 'linksOben' || ecke === 'linksUnten' ? punkt.x : flaeche.links
  const x2 = ecke === 'rechtsOben' || ecke === 'rechtsUnten' ? punkt.x : rechts
  const y1 = ecke === 'linksOben' || ecke === 'rechtsOben' ? punkt.y : flaeche.oben
  const y2 = ecke === 'linksUnten' || ecke === 'rechtsUnten' ? punkt.y : unten
  return {
    links: Math.min(x1, x2),
    oben: Math.min(y1, y2),
    breite: Math.max(MIN_KANTE, Math.abs(x2 - x1)),
    hoehe: Math.max(MIN_KANTE, Math.abs(y2 - y1))
  }
}

/** Ein Bildschirmrechteck zurueck in PDF-Koordinaten, sortiert. */
function alsPdfRechteck(flaeche: Bildschirmrechteck, matrix: Matrix): PdfRechteck | null {
  const a = bildschirmZuPdf({ x: flaeche.links, y: flaeche.oben }, matrix)
  const b = bildschirmZuPdf(
    { x: flaeche.links + flaeche.breite, y: flaeche.oben + flaeche.hoehe },
    matrix
  )
  if (a === null || b === null) return null
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]
}

/** Liegt der Punkt im Rechteck (PDF-Koordinaten, Reihenfolge der Ecken egal)? */
function liegtIn(punkt: Punkt, rect: PdfRechteck): boolean {
  return (
    punkt.x >= Math.min(rect[0], rect[2]) &&
    punkt.x <= Math.max(rect[0], rect[2]) &&
    punkt.y >= Math.min(rect[1], rect[3]) &&
    punkt.y <= Math.max(rect[1], rect[3])
  )
}

export function Bearbeitungsebene({ index }: BearbeitungsebeneProps): React.JSX.Element {
  useT()
  const seite = index + 1
  const matrix = useSeitenmatrix(index)
  const eintraege = useAnnotationen((zustand) => zustand.proSeite[seite])
  const werkzeug = useBearbeitung((zustand) => zustand.werkzeug)
  const farbe = useBearbeitung((zustand) => zustand.farbe)
  const strichstaerke = useBearbeitung((zustand) => zustand.strichstaerke)
  const autor = useBearbeitung((zustand) => zustand.autor)
  const stempel = useBearbeitung((zustand) => zustand.stempel)
  const signaturBild = useBearbeitung((zustand) => zustand.signaturBild)
  const felder = useFormular((zustand) => zustand.proSeite[seite])
  const ausgewaehlt = useBearbeitung((zustand) => zustand.ausgewaehlt)
  const waehle = useBearbeitung((zustand) => zustand.waehle)
  const setzeWerkzeug = useBearbeitung((zustand) => zustand.setzeWerkzeug)
  const anwendenAuf = useBearbeitung((zustand) => zustand.anwendenAuf)
  const angewendet = useBearbeitung((zustand) => zustand.angewendet)

  const behaelterRef = useRef<HTMLDivElement>(null)
  const ziehenRef = useRef<Ziehen | null>(null)
  const [zug, setZug] = useState<Punkt[] | null>(null)
  /**
   * Welche `/FreeText` gerade den Eingabekasten zeigt (S6.5, Aufgabe 1; seit
   * S6.11 im Store, weil die Anzeige es auch wissen muss).
   *
   * Getrennt von `ausgewaehlt`: ausgewaehlt heisst nur "Rahmen und Anfasser
   * sichtbar". Ein Klick ohne Ziehen, ein Doppelklick oder das Erzeugen
   * selbst oeffnet den Kasten. Verschieben bleibt ueber den Rand
   * (`FREITEXT_RAND`) moeglich, auch waehrend er offen ist.
   */
  const bearbeitetId = useBearbeitung((zustand) => zustand.freitextOffen)
  const setBearbeitetId = useBearbeitung((zustand) => zustand.oeffneFreitext)

  const vorgaben = useMemo(() => ({ autor, farbe, strichstaerke }), [autor, farbe, strichstaerke])

  /** Bildschirmpunkt eines Zeigerereignisses, bezogen auf die Seitenecke. */
  const bildschirmpunkt = useCallback((clientX: number, clientY: number): Punkt | null => {
    const behaelter = behaelterRef.current
    if (behaelter === null) return null
    const rahmen = behaelter.getBoundingClientRect()
    return { x: clientX - rahmen.left, y: clientY - rahmen.top }
  }, [])

  const pdfPunkt = useCallback(
    (clientX: number, clientY: number): Punkt | null => {
      const auf = bildschirmpunkt(clientX, clientY)
      if (auf === null || matrix === null) return null
      return bildschirmZuPdf(auf, matrix)
    },
    [bildschirmpunkt, matrix]
  )

  /**
   * Text-Markup entsteht beim Loslassen der Maustaste aus der bestehenden
   * Auswahl (Aufgabe 2).
   *
   * Jede Seite hoert selbst zu und nimmt nur die Zeilen, die ueber ihr liegen.
   * Eine Auswahl ueber einen Seitenumbruch hinweg ergibt so zwei Annotationen
   * — je eine auf ihrer Seite — und nicht eine, die an der falschen haengt.
   */
  const markiereAuswahl = useCallback(
    (art: MarkupWerkzeug): boolean => {
      const behaelter = behaelterRef.current
      if (behaelter === null || matrix === null) return false
      const auswahl = window.getSelection()
      if (auswahl === null || auswahl.isCollapsed || auswahl.rangeCount === 0) return false
      const rechtecke = auswahlrechtecke(auswahl.getRangeAt(0), behaelter)
      if (rechtecke.length === 0) return false
      const quadPoints = quadPointsAusRechtecken(rechtecke, matrix)
      if (quadPoints === null) return false
      const neu = erzeugeMarkup(MARKUP_TYP[art], seite, quadPoints, vorgaben)
      if (neu === null) return false
      erstelleAnnotation(neu)
      return true
    },
    [matrix, seite, vorgaben]
  )

  useEffect(() => {
    if (!istMarkupWerkzeug(werkzeug) || matrix === null) return undefined
    const art = werkzeug as MarkupWerkzeug
    const beiLoslassen = (): void => {
      if (!markiereAuswahl(art)) return
      // Die Auswahl aufheben: sonst entstuende beim naechsten Klick dieselbe
      // Markierung ein zweites Mal.
      window.getSelection()?.removeAllRanges()
    }
    window.addEventListener('mouseup', beiLoslassen)
    return () => {
      window.removeEventListener('mouseup', beiLoslassen)
    }
  }, [werkzeug, matrix, markiereAuswahl])

  /**
   * Markup aus dem Kontextmenue oder ueber das Kuerzel: es wirkt sofort auf
   * die bestehende Auswahl, ohne dass das Werkzeug gewechselt werden muss.
   *
   * Jede Seite wendet es auf ihren Anteil an; die Auswahl wird erst danach
   * aufgehoben, damit eine Auswahl ueber einen Seitenumbruch hinweg auf beiden
   * Seiten ankommt.
   */
  useEffect(() => {
    if (anwendenAuf === null || matrix === null) return
    markiereAuswahl(anwendenAuf)
    const zeitgeber = setTimeout(() => {
      window.getSelection()?.removeAllRanges()
      angewendet()
    }, 0)
    return () => {
      clearTimeout(zeitgeber)
    }
  }, [anwendenAuf, matrix, markiereAuswahl, angewendet])

  /** Notiz und Stempel entstehen mit einem Klick (Aufgaben 3 und 5). */
  const beiKlickAufFlaeche = (ereignis: React.MouseEvent): void => {
    const punkt = pdfPunkt(ereignis.clientX, ereignis.clientY)
    if (punkt === null) return
    // Wie beim Freitext: setzen, auswaehlen, der Zettel geht auf und das
    // Textfeld hat den Fokus - "Notiz setzen, direkt schreiben". Ohne das
    // stand nur ein leeres Kaestchen da, und wer nicht wusste, dass erst das
    // Auswahlwerkzeug den Zettel oeffnet, kam an den Text nicht heran.
    if (werkzeug === 'notiz') {
      const neu = erzeugeNotiz(seite, punkt, vorgaben)
      erstelleAnnotation(neu)
      setzeWerkzeug('auswahl')
      waehle(neu.id)
      return
    }
    if (werkzeug === 'text') {
      const neu = erzeugeFreitext(seite, punkt, vorgaben)
      erstelleAnnotation(neu)
      // Sofort auswaehlen, damit der Eingabekasten (Freitextfeld.tsx) direkt
      // erscheint und den Fokus bekommt — "Klick setzt ein Textfeld, direkt
      // tippen" (Aufgabe 1). `setzeWerkzeug` zuerst: es setzt die Auswahl
      // selbst auf `null` zurueck, `waehle` danach ist deshalb die, die zaehlt.
      setzeWerkzeug('auswahl')
      waehle(neu.id)
      setBearbeitetId(neu.id)
      return
    }
    if (werkzeug === 'stempel') {
      erstelleAnnotation(erzeugeStempel(seite, punkt, t(`stempel.${stempel}`), vorgaben))
      return
    }
    if (werkzeug === 'signatur' && signaturBild !== null) {
      // In ein Signaturfeld, wenn der Klick eines trifft — dann fuellt das
      // Bild das Feld. Sonst frei an der Stelle, wie ein Stempel. Das Feld
      // selbst bleibt unangetastet: das Bild ist eine Anmerkung darueber,
      // keine Signatur im Sinne des Formulars (S3.2, D14).
      const verhaeltnis = signaturBild.breite / signaturBild.hoehe
      const feld = (felder ?? []).find(
        (eintrag) =>
          eintrag.art === 'signatur' && !eintrag.versteckt && liegtIn(punkt, eintrag.rect)
      )
      const rect =
        feld === undefined ? signaturRechteck(punkt, verhaeltnis) : passeEin(feld.rect, verhaeltnis)
      erstelleAnnotation(erzeugeSignatur(seite, rect, signaturBild.url, vorgaben))
    }
  }

  /** Freihand: Punkte sammeln, beim Loslassen glaetten und ablegen (Aufgabe 4). */
  const beiZeigerAb = (ereignis: React.PointerEvent): void => {
    if (werkzeug !== 'freihand') return
    const punkt = pdfPunkt(ereignis.clientX, ereignis.clientY)
    if (punkt === null) return
    ereignis.currentTarget.setPointerCapture(ereignis.pointerId)
    setZug([punkt])
  }

  const beiZeigerBewegung = (ereignis: React.PointerEvent): void => {
    if (zug === null) return
    const punkt = pdfPunkt(ereignis.clientX, ereignis.clientY)
    if (punkt === null) return
    setZug([...zug, punkt])
  }

  const beiZeigerAuf = (): void => {
    if (zug === null) return
    const neu = erzeugeFreihand(seite, glaette(zug), vorgaben)
    setZug(null)
    if (neu !== null) erstelleAnnotation(neu)
  }

  /** Verschieben und Groesse aendern (Aufgabe 6). */
  const beginneVerschieben = (ereignis: React.PointerEvent, annotation: Annotation): void => {
    const punkt = pdfPunkt(ereignis.clientX, ereignis.clientY)
    if (punkt === null) return
    ereignis.stopPropagation()
    // Der Klick auf den Rand nimmt dem offenen Eingabekasten nicht den Fokus
    // weg - sonst schloesse er sich mitten im Verschieben.
    ereignis.preventDefault()
    ereignis.currentTarget.setPointerCapture(ereignis.pointerId)
    waehle(annotation.id)
    ziehenRef.current = {
      art: 'verschieben',
      original: annotation,
      start: punkt,
      startBildschirm: { x: ereignis.clientX, y: ereignis.clientY },
      bewegt: false
    }
  }

  const beginneGroesse = (
    ereignis: React.PointerEvent,
    annotation: Annotation,
    ecke: Ecke,
    flaeche: Bildschirmrechteck
  ): void => {
    ereignis.stopPropagation()
    ereignis.currentTarget.setPointerCapture(ereignis.pointerId)
    ziehenRef.current = { art: 'groesse', original: annotation, ecke, flaeche }
  }

  const beiZiehen = (ereignis: React.PointerEvent): void => {
    const ziehen = ziehenRef.current
    if (ziehen === null || matrix === null) return
    const { ersetze } = useAnnotationen.getState()

    if (ziehen.art === 'verschieben') {
      if (
        !ziehen.bewegt &&
        Math.hypot(
          ereignis.clientX - ziehen.startBildschirm.x,
          ereignis.clientY - ziehen.startBildschirm.y
        ) < ZIEH_SCHWELLE
      )
        return
      ziehen.bewegt = true
      const punkt = pdfPunkt(ereignis.clientX, ereignis.clientY)
      if (punkt === null) return
      ersetze(verschiebe(ziehen.original, punkt.x - ziehen.start.x, punkt.y - ziehen.start.y))
      return
    }

    const auf = bildschirmpunkt(ereignis.clientX, ereignis.clientY)
    if (auf === null) return
    const ziel = alsPdfRechteck(neueFlaeche(ziehen.flaeche, ziehen.ecke, auf), matrix)
    if (ziel === null) return
    const veraendert = skaliere(ziehen.original, ziel)
    if (veraendert !== null) ersetze(veraendert)
  }

  /**
   * Erst beim Loslassen entsteht ein Historienschritt. Waehrend des Ziehens
   * laeuft die Vorschau ueber `ersetze` an der Historie vorbei — sonst
   * stuenden hundert Zwischenschritte darin, und Strg+Z bewegte die Annotation
   * pixelweise zurueck.
   */
  const beendeZiehen = (): void => {
    const ziehen = ziehenRef.current
    ziehenRef.current = null
    if (ziehen === null) return
    // Ein Klick ohne Ziehen auf einen Freitext oeffnet den Eingabekasten:
    // hineinklicken und weiterschreiben, wie man es von jedem Textfeld kennt.
    if (ziehen.art === 'verschieben' && !ziehen.bewegt && ziehen.original.typ === 'FreeText') {
      setBearbeitetId(ziehen.original.id)
      return
    }
    const jetzt = useAnnotationen.getState().finde(ziehen.original.id)
    if (jetzt === null || jetzt === ziehen.original) return
    veraendereAnnotation(ziehen.original, jetzt)
  }

  /**
   * Markierungen auswaehlen: ein Klick in die Markierung, ohne Text zu
   * markieren. Eine Klickflaeche haben sie nicht (sie nehme dem Text darunter
   * die Maus); stattdessen hoert jede Seite auf Klicks und prueft, ob einer in
   * einer ihrer Markierungen landete. Ein Ziehen oder Doppelklick markiert
   * Text - dann ist die Auswahl nicht leer, und es passiert nichts. Anmerkungen,
   * Verweise, Felder und Bedienelemente behalten Vorrang.
   *
   * Dann stehen Farbe, Deckkraft und Loeschen der Werkzeugleiste zur Verfuegung,
   * und Entf loescht die Markierung (`annotationLoeschen`). Die Leiste geht
   * dafuer auf: sonst waere die Auswahl ein unsichtbarer Zustand.
   */
  const markups = useMemo(
    () =>
      (eintraege ?? []).filter((annotation) => !annotation.versteckt && istTextMarkup(annotation)),
    [eintraege]
  )
  useEffect(() => {
    if (werkzeug !== 'auswahl' || matrix === null || markups.length === 0) return undefined
    const beiKlick = (ereignis: MouseEvent): void => {
      const behaelter = behaelterRef.current
      const ziel = ereignis.target
      if (behaelter === null || !(ziel instanceof Element)) return
      // Linke Taste mit Zeiger: ein Tastendruck auf einen Knopf hat `detail` 0.
      if (ereignis.button !== 0 || ereignis.detail === 0) return
      if (behaelter.parentElement?.contains(ziel) !== true) return
      if (
        ziel.closest(
          '[data-testid^="greifflaeche-"], [data-testid^="griff-"], [data-testid^="freitextfeld-"], ' +
            '[data-testid^="annotation-"], [data-testid^="formularfeld"], textarea, input, select, button, a'
        ) !== null
      )
        return
      const auswahl = window.getSelection()
      if (auswahl !== null && !auswahl.isCollapsed) return
      const punkt = bildschirmpunkt(ereignis.clientX, ereignis.clientY)
      if (punkt === null) return
      // Dasselbe Hit-Testing wie bei Verweisen: die genauen Zeilenrechtecke,
      // die obere Markierung gewinnt, und eine Unterstreichung bekommt Rand.
      const treffer = findeAnnotationUnter(punkt, zeichne(markups, matrix))
      if (treffer === null) return
      waehle(treffer.id)
      useBearbeitung.setState({ leisteOffen: true })
    }
    window.addEventListener('click', beiKlick)
    return () => {
      window.removeEventListener('click', beiKlick)
    }
  }, [werkzeug, matrix, markups, bildschirmpunkt, waehle])

  const gegenstaendliche = useMemo(() => {
    if (matrix === null || eintraege === undefined || werkzeug !== 'auswahl') return []
    return eintraege
      .filter((annotation) => !annotation.versteckt && istGegenstaendlich(annotation))
      .map((annotation) => ({ annotation, flaeche: huelle(rechteckeFuer(annotation, matrix)) }))
      .filter(
        (eintrag): eintrag is { annotation: Annotation; flaeche: Bildschirmrechteck } =>
          eintrag.flaeche !== null
      )
  }, [eintraege, matrix, werkzeug])

  const gewaehlte = useMemo(() => {
    // Nur im Auswahlwerkzeug: im Zeichenmodus haette der Rahmen keine Aufgabe
    // und laege bloss im Weg.
    if (
      werkzeug !== 'auswahl' ||
      ausgewaehlt === null ||
      matrix === null ||
      eintraege === undefined
    )
      return null
    const annotation = eintraege.find((eintrag) => eintrag.id === ausgewaehlt)
    if (annotation === undefined) return null
    const flaeche = huelle(rechteckeFuer(annotation, matrix))
    return flaeche === null ? null : { annotation, flaeche }
  }, [ausgewaehlt, eintraege, matrix, werkzeug])

  /**
   * Ein Klick neben die Auswahl auf die Seite hebt sie auf (S6.12) - der
   * Rahmen, der Freitext-Kasten und der Notizzettel gehen damit zu. Nur die
   * Seite, die die Auswahl traegt, hoert zu; Klicks in Leisten und Seitenleiste
   * zaehlen nicht, dort aendert man ja gerade die ausgewaehlte Anmerkung.
   * Erfasst in der Capture-Phase, weil Textebene und Canvas keine eigenen
   * Handler haben.
   */
  const hatAuswahl = gewaehlte !== null
  useEffect(() => {
    if (!hatAuswahl) return undefined
    const beiZeigerAb = (ereignis: PointerEvent): void => {
      const ziel = ereignis.target
      if (!(ziel instanceof Element)) return
      if (ziel.closest('[data-testid="seitenflaeche"]') === null) return
      if (
        ziel.closest(
          '[data-testid^="greifflaeche-"], [data-testid^="griff-"], [data-testid^="freitextfeld-"], ' +
            '[data-testid^="annotation-notizzettel-"], [data-testid^="annotation-notiz-"]'
        ) !== null
      )
        return
      setBearbeitetId(null)
      waehle(null)
    }
    document.addEventListener('pointerdown', beiZeigerAb, true)
    return () => {
      document.removeEventListener('pointerdown', beiZeigerAb, true)
    }
  }, [hatAuswahl, setBearbeitetId, waehle])

  const zeichnend =
    werkzeug === 'notiz' ||
    werkzeug === 'stempel' ||
    werkzeug === 'freihand' ||
    werkzeug === 'text' ||
    // Ohne Bild gibt es nichts zu setzen — dann bleibt die Textauswahl frei.
    (werkzeug === 'signatur' && signaturBild !== null)

  return (
    <div
      ref={behaelterRef}
      data-testid={'bearbeitungsebene-' + String(seite)}
      data-werkzeug={werkzeug}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {/* Die Zeichenflaeche gibt es nur fuer die Werkzeuge, die sie brauchen.
          Staende sie immer da, waere die Textauswahl aus S1.4 tot. */}
      {zeichnend && (
        <div
          data-testid={'zeichenflaeche-' + String(seite)}
          onClick={beiKlickAufFlaeche}
          onPointerDown={beiZeigerAb}
          onPointerMove={beiZeigerBewegung}
          onPointerUp={beiZeigerAuf}
          onPointerCancel={beiZeigerAuf}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'auto',
            cursor: werkzeug === 'freihand' ? 'crosshair' : 'copy'
          }}
        />
      )}

      {/* Der Zug, waehrend er entsteht. Er liegt noch in keiner Annotation:
          erst beim Loslassen wird eine daraus, und erst dann laesst er sich
          rueckgaengig machen. */}
      {zug !== null && matrix !== null && zug.length > 1 && (
        <svg
          data-testid={'freihand-vorschau-' + String(seite)}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <polyline
            points={zug
              .map((punkt) => {
                const auf = pdfZuBildschirm(punkt, matrix)
                return String(auf.x) + ',' + String(auf.y)
              })
              .join(' ')}
            fill="none"
            stroke={farbe}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {gegenstaendliche.map(({ annotation, flaeche }) => {
        const freitext = annotation.typ === 'FreeText'
        // Freitext: die Greifflaeche ragt um den Rand ueber den Text hinaus.
        // Der Eingabekasten liegt spaeter im DOM und damit darueber; frei
        // bleibt der Rand - dort zeigt der Cursor "verschieben".
        const rand = freitext ? FREITEXT_RAND : 0
        return (
          <div
            key={annotation.id}
            data-testid={'greifflaeche-' + annotation.id}
            role="button"
            tabIndex={0}
            aria-label={t('auswahl.anmerkung')}
            onPointerDown={(ereignis) => {
              beginneVerschieben(ereignis, annotation)
            }}
            onPointerMove={beiZiehen}
            onPointerUp={beendeZiehen}
            onPointerCancel={beendeZiehen}
            onDoubleClick={() => {
              // Doppelklick oeffnet bei FreeText den Eingabekasten (S6.5,
              // Aufgabe 1) - bei allen anderen Typen tut er nichts, es gibt
              // dort keinen Text zum Tippen.
              if (annotation.typ !== 'FreeText') return
              waehle(annotation.id)
              setBearbeitetId(annotation.id)
            }}
            onKeyDown={(ereignis) => {
              if (ereignis.key !== 'Enter' && ereignis.key !== ' ') return
              waehle(annotation.id)
              if (freitext) setBearbeitetId(annotation.id)
            }}
            style={{
              position: 'absolute',
              left: String(flaeche.links - rand) + 'px',
              top: String(flaeche.oben - rand) + 'px',
              width: String(Math.max(1, flaeche.breite) + 2 * rand) + 'px',
              height: String(Math.max(1, flaeche.hoehe) + 2 * rand) + 'px',
              pointerEvents: 'auto',
              cursor: 'move'
            }}
          />
        )
      })}

      {gewaehlte !== null &&
        gewaehlte.annotation.typ === 'FreeText' &&
        matrix !== null &&
        bearbeitetId === gewaehlte.annotation.id && (
          <Freitextfeld
            annotation={gewaehlte.annotation}
            flaeche={gewaehlte.flaeche}
            matrix={matrix}
            onFertig={() => {
              setBearbeitetId(null)
            }}
          />
        )}

      {gewaehlte !== null && (
        <div
          data-testid={'auswahlrahmen-' + gewaehlte.annotation.id}
          style={{
            position: 'absolute',
            left: String(gewaehlte.flaeche.links) + 'px',
            top: String(gewaehlte.flaeche.oben) + 'px',
            width: String(Math.max(1, gewaehlte.flaeche.breite)) + 'px',
            height: String(Math.max(1, gewaehlte.flaeche.hoehe)) + 'px',
            border: '1px dashed #2f6feb',
            pointerEvents: 'none'
          }}
        >
          {/* Anfasser nur fuer Anmerkungen, die sich in der Groesse aendern
              lassen; eine Markierung folgt dem Text und hat keine Ecken. */}
          {(istGegenstaendlich(gewaehlte.annotation) ? ECKEN : []).map((ecke) => (
            <div
              key={ecke}
              data-testid={'griff-' + ecke + '-' + gewaehlte.annotation.id}
              onPointerDown={(ereignis) => {
                beginneGroesse(ereignis, gewaehlte.annotation, ecke, gewaehlte.flaeche)
              }}
              onPointerMove={beiZiehen}
              onPointerUp={beendeZiehen}
              onPointerCancel={beendeZiehen}
              style={{
                position: 'absolute',
                width: String(GRIFF) + 'px',
                height: String(GRIFF) + 'px',
                background: '#ffffff',
                border: '1px solid #2f6feb',
                pointerEvents: 'auto',
                cursor:
                  ecke === 'linksOben' || ecke === 'rechtsUnten' ? 'nwse-resize' : 'nesw-resize',
                left: ecke.startsWith('links') ? String(-GRIFF / 2) + 'px' : undefined,
                right: ecke.startsWith('rechts') ? String(-GRIFF / 2) + 'px' : undefined,
                top: ecke.endsWith('Oben') ? String(-GRIFF / 2) + 'px' : undefined,
                bottom: ecke.endsWith('Unten') ? String(-GRIFF / 2) + 'px' : undefined
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
