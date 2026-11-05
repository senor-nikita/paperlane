import { useEffect, useRef, useState } from 'react'
import type { Annotation } from '../../../shared/annotations'
import {
  STANDARD_AUSRICHTUNG,
  STANDARD_SCHRIFTFAMILIE,
  STANDARD_SCHRIFTGROESSE
} from '../../../shared/freitext'
import { useAnnotationen } from '../annotations-store'
import { useBearbeitung } from '../bearbeitung-store'
import { loescheAnnotation, veraendereAnnotation } from '../annotationsbefehle'
import { loeschtDieAnnotation } from './entf'
import type { Bildschirmrechteck, Matrix } from './koordinaten'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/**
 * Der Eingabekasten fuer die ausgewaehlte `/FreeText`-Annotation (S6.5,
 * Aufgabe 1: "direkt tippen").
 *
 * Liegt genau ueber der Greifflaeche aus Bearbeitungsebene.tsx und ist selbst
 * die einzige Stelle, an der `inhalt` waehrend des Tippens veraendert wird.
 * Waehrend der Fokus dort ist, laeuft die Aenderung ueber `ersetze` (keine
 * Historie je Tastendruck — dasselbe Muster wie beim Ziehen); erst beim
 * Verlassen des Feldes entsteht ein einzelner Historienschritt, sonst machte
 * Strg+Z einen Text Zeichen fuer Zeichen rueckgaengig.
 */

const FAMILIE_CSS: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace'
}

/**
 * Schrift, Groesse, Stil, Ausrichtung und Farbe einer `/FreeText` als CSS.
 *
 * Eingabekasten und Anzeige (Annotationsebene.tsx) teilen sich das: der Text
 * soll beim Verlassen des Feldes genau dort stehen bleiben, wo er beim Tippen
 * stand, und nicht um ein paar Pixel springen.
 */
export function freitextStil(annotation: Annotation, matrix: Matrix): React.CSSProperties {
  const masstab = Math.hypot(matrix[0], matrix[1])
  const groesse = annotation.schriftGroesse ?? STANDARD_SCHRIFTGROESSE
  const familie = annotation.schriftFamilie ?? STANDARD_SCHRIFTFAMILIE
  const ausrichtung = annotation.ausrichtung ?? STANDARD_AUSRICHTUNG
  const farbe = annotation.farbe
  return {
    padding: '2px',
    margin: 0,
    fontFamily: FAMILIE_CSS[familie] ?? FAMILIE_CSS['Helvetica'],
    fontSize: String(groesse * masstab) + 'px',
    fontWeight: annotation.schriftFett === true ? 700 : 400,
    fontStyle: annotation.schriftKursiv === true ? 'italic' : 'normal',
    textAlign: ausrichtung === 'mitte' ? 'center' : ausrichtung === 'rechts' ? 'right' : 'left',
    color: farbe === null ? '#000000' : 'rgb(' + farbe.r + ',' + farbe.g + ',' + farbe.b + ')',
    lineHeight: 1.18,
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word'
  }
}

interface FreitextfeldProps {
  annotation: Annotation
  flaeche: Bildschirmrechteck
  matrix: Matrix
  /** Ruft die Aufrufstelle beim Verlassen des Feldes — schliesst den Kasten. */
  onFertig: () => void
}

export function Freitextfeld({
  annotation,
  flaeche,
  matrix,
  onFertig
}: FreitextfeldProps): React.JSX.Element {
  useT()
  const [inhalt, setInhalt] = useState(annotation.inhalt)
  const feldRef = useRef<HTMLTextAreaElement>(null)
  const urspruenglich = useRef(annotation)

  // Ein Wechsel der Auswahl (andere Annotation) beginnt eine neue Sitzung:
  // ihr eigener Ausgangsstand fuer das Rueckgaengigmachen, ihr eigener Text.
  // Bewusst nur `annotation.id` in den Abhaengigkeiten: `annotation` selbst
  // aendert sich bei jedem Tastendruck (die Live-Vorschau schreibt ueber
  // `ersetze` in denselben Store) - mit voller Abhaengigkeit setzte dieser
  // Effekt `inhalt` mitten im Tippen auf den (dann schon veralteten) Stand
  // zurueck.
  useEffect(() => {
    setInhalt(annotation.inhalt)
    urspruenglich.current = annotation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation.id])

  // Der Kasten oeffnet sich nur auf Absicht (Erzeugen, Klick, Doppelklick,
  // Enter) - dann bekommt er auch den Cursor, ans Ende des Textes. Vor S6.11
  // nur bei leeren Feldern; ein Klick in vorhandenen Text oeffnete dann einen
  // Kasten ohne Fokus, und der erste Klick daneben schloss ihn nie.
  /**
   * Den Historienschritt anlegen, falls sich der Text geaendert hat. Beim
   * Verlassen des Feldes und beim Abbau (S6.12): ein Klick neben das Feld hebt
   * die Auswahl auf und baut den Kasten ab, bevor er sein `blur` bekommt.
   */
  const uebernimm = useRef(() => {
    const jetzt = useAnnotationen.getState().finde(urspruenglich.current.id)
    if (jetzt === null || jetzt.inhalt === urspruenglich.current.inhalt) return
    veraendereAnnotation(urspruenglich.current, jetzt)
    urspruenglich.current = jetzt
  })

  useEffect(() => {
    const beiAbbau = uebernimm.current
    return beiAbbau
  }, [])

  useEffect(() => {
    const feld = feldRef.current
    if (feld === null) return
    feld.focus()
    feld.setSelectionRange(feld.value.length, feld.value.length)
  }, [annotation.id])

  return (
    <textarea
      ref={feldRef}
      data-testid={'freitextfeld-' + annotation.id}
      aria-label={t('freitext.inhalt')}
      value={inhalt}
      onChange={(ereignis) => {
        const neu = ereignis.target.value
        setInhalt(neu)
        // Live-Vorschau ohne Historienschritt (wie beim Ziehen in
        // Bearbeitungsebene.tsx): erst onBlur entsteht ein Schritt.
        useAnnotationen.getState().ersetze({ ...annotation, inhalt: neu })
      }}
      onBlur={() => {
        uebernimm.current()
        onFertig()
      }}
      onKeyDown={(ereignis) => {
        // Entf ohne Zeichen zum Loeschen nimmt die ganze Anmerkung weg.
        if (loeschtDieAnnotation(ereignis)) {
          ereignis.preventDefault()
          ereignis.stopPropagation()
          const jetzt = useAnnotationen.getState().finde(annotation.id)
          if (jetzt !== null) loescheAnnotation(jetzt)
          return
        }
        // Escape schliesst den Kasten. `stopPropagation`, damit es nicht
        // zusaetzlich beim zentralen Kuerzel (tastatur.ts) ankommt.
        if (ereignis.key === 'Escape') {
          ereignis.stopPropagation()
          feldRef.current?.blur()
          // Seit S6.12 auch die Auswahl aufheben: Escape heisst "fertig",
          // und ein stehengebliebener Rahmen sah nach "noch aktiv" aus.
          useBearbeitung.getState().waehle(null)
        }
      }}
      onPointerDown={(ereignis) => {
        // Nicht an die Greifflaeche darunter durchreichen - sonst begaenne ein
        // Klick ins Feld sofort ein Verschieben statt eine Textauswahl.
        ereignis.stopPropagation()
      }}
      style={{
        position: 'absolute',
        left: String(flaeche.links) + 'px',
        top: String(flaeche.oben) + 'px',
        width: String(Math.max(1, flaeche.breite)) + 'px',
        height: String(Math.max(1, flaeche.hoehe)) + 'px',
        ...freitextStil(annotation, matrix),
        pointerEvents: 'auto',
        resize: 'none',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        cursor: 'text'
      }}
    />
  )
}
