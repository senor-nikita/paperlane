import { useEffect, useMemo } from 'react'
import type { Annotation, AnnotationsTyp } from '../../../shared/annotations'
import { anteilVonOben, beschriftung, istDarstellbar } from '../../../shared/annotations'
import { alleAnnotationen, useAnnotationen } from '../annotations-store'
import { useBearbeitung } from '../bearbeitung-store'
import { useDokument } from '../dokument-store'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/**
 * Die Anmerkungen des Dokuments als Liste (S2.1, Aufgabe 7).
 *
 * Gelesen wird erst, wenn dieser Bereich geoeffnet wird. Beim Oeffnen des
 * Dokuments alle Seiten zu durchsuchen waere ein Angriff auf das Budget "erste
 * Seite unter zwei Sekunden" — fuer eine Liste, die viele Leser nie
 * aufschlagen.
 */

const BEZEICHNUNG: Record<AnnotationsTyp, string> = {
  Highlight: 'Markierung',
  Underline: 'Unterstreichung',
  StrikeOut: 'Durchstreichung',
  Text: 'Notiz',
  FreeText: 'Text',
  Ink: 'Freihand',
  Stamp: 'Stempel',
  Square: 'Rechteck',
  Circle: 'Ellipse',
  Link: 'Verweis',
  Unbekannt: 'Unbekannt'
}

function stand(
  fehler: string | null,
  laeuft: boolean,
  anzahl: number,
  vollstaendig: boolean
): string {
  if (fehler !== null) return fehler
  if (laeuft) return t('liste.liest')
  if (anzahl > 0) return t('liste.anzahl', { anzahl })
  return vollstaendig ? t('liste.keine') : t('liste.nochNichts')
}

export function Annotationsliste(): React.JSX.Element {
  useT()
  const dokument = useDokument((zustand) => zustand.dokument)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const seitenGroessen = useDokument((zustand) => zustand.seitenGroessen)
  const springeZuZiel = useDokument((zustand) => zustand.springeZuZiel)
  const waehle = useBearbeitung((zustand) => zustand.waehle)

  const proSeite = useAnnotationen((zustand) => zustand.proSeite)
  const laeuft = useAnnotationen((zustand) => zustand.laeuft)
  const vollstaendig = useAnnotationen((zustand) => zustand.vollstaendig)
  const fehler = useAnnotationen((zustand) => zustand.fehler)
  const ladeAlles = useAnnotationen((zustand) => zustand.ladeAlles)

  useEffect(() => {
    if (dokument === null || seitenzahl === 0) return
    void ladeAlles(dokument, seitenzahl)
  }, [dokument, seitenzahl, ladeAlles])

  const eintraege = useMemo(
    () => alleAnnotationen(proSeite).filter((annotation) => istDarstellbar(annotation.typ)),
    [proSeite]
  )

  const springe = (annotation: Annotation): void => {
    // Ohne Anteil landete der Sprung am Seitenanfang, und eine Anmerkung am
    // Seitenende waere nach dem Klick nicht zu sehen.
    const hoehe = seitenGroessen[annotation.seite - 1]?.hoehe ?? 0
    springeZuZiel({
      seite: annotation.seite,
      anteilVonOben: anteilVonOben(annotation.rect, hoehe),
      zoom: null
    })
    // Zugleich auswaehlen (S2.2): fuer Markierungen ist das der einzige Weg.
    // Auf der Seite selbst haben sie bewusst keine Klickflaeche, weil sonst
    // der Text darunter nicht mehr auszuwaehlen waere.
    waehle(annotation.id)
    // Aus der Liste gewaehlt heisst: bearbeiten. Loeschen, Farbe und Staerke
    // stehen in der Werkzeugleiste, also geht sie auf (S6.9). Bewusst nur hier
    // und nicht beim Klick auf der Seite: dort verschoebe die aufgehende
    // Leiste die Seite unter dem Zeiger, und ein Doppelklick ginge daneben.
    if (!useBearbeitung.getState().leisteOffen) useBearbeitung.getState().schalteLeiste()
  }

  return (
    <div data-testid="annotationsliste" style={{ flex: 1, overflow: 'auto', padding: '0.25rem' }}>
      {/* Der Stand wird angesagt, ohne dass der Fokus wandert: der Leser hat
          gerade den Reiter gewechselt und soll dort bleiben. */}
      <p
        role="status"
        data-testid="annotationsliste-stand"
        style={{ margin: '0.25rem', fontSize: '11px', color: '#555' }}
      >
        {stand(fehler, laeuft, eintraege.length, vollstaendig)}
      </p>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {eintraege.map((annotation) => (
          <li key={annotation.id}>
            <button
              type="button"
              data-testid={'annotationsliste-' + annotation.id}
              title={beschriftung(annotation)}
              onClick={() => {
                springe(annotation)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderBottom: '1px solid var(--linie)',
                background: 'none',
                cursor: 'pointer',
                padding: '0.3rem 0.25rem',
                fontSize: '12px',
                color: '#1a1a1a'
              }}
            >
              <span style={{ color: '#555' }}>
                S. {annotation.seite} · {BEZEICHNUNG[annotation.typ]}
              </span>
              <br />
              <span
                style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {beschriftung(annotation)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
