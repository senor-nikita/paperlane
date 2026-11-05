import { useEffect, useMemo, useState } from 'react'
import { useDokument } from '../dokument-store'
import { effektiveDrehung } from './drehung'
import { baueTransformation, type Matrix } from './koordinaten'

/**
 * Die Abbildung PDF → Bildschirm fuer eine Seite.
 *
 * Anzeige- und Bearbeitungsebene brauchen dieselbe Matrix. Haette jede ihren
 * eigenen Effekt, laege eine gezeichnete Markierung irgendwann um einen
 * Renderdurchlauf versetzt zu der Stelle, an der sie entstanden ist — genau
 * die Art Fehler, die Risiko R6 meint.
 *
 * `null`, solange die Seitenmasse nicht vorliegen oder das Dokument keine
 * brauchbare MediaBox nennt.
 */
export function useSeitenmatrix(index: number): Matrix | null {
  const dokument = useDokument((zustand) => zustand.dokument)
  const zoom = useDokument((zustand) => zustand.zoom)
  const rotation = useDokument((zustand) => zustand.rotation)
  const [ansicht, setAnsicht] = useState<{ view: readonly number[]; rotate: number } | null>(null)

  useEffect(() => {
    if (dokument === null) {
      setAnsicht(null)
      return undefined
    }
    let abgebrochen = false
    dokument
      .getPage(index + 1)
      .then((seite) => {
        // Ohne brauchbare MediaBox gibt es keine Bezugsgroesse - dann bleibt
        // die Ebene leer, statt an einer erfundenen Stelle zu zeichnen.
        // Die Seitendrehung gehoert zur Matrix: das Canvas wird mit ihr
        // gezeichnet (`drehung.ts`), also muss die Ebene sie genauso kennen.
        if (!abgebrochen)
          setAnsicht(Array.isArray(seite.view) ? { view: seite.view, rotate: seite.rotate } : null)
      })
      .catch((fehler: unknown) => {
        console.error('Seitenmasse fuer die Annotationsebene fehlen:', fehler)
      })
    return () => {
      abgebrochen = true
    }
  }, [dokument, index])

  return useMemo(
    () =>
      ansicht === null
        ? null
        : baueTransformation(ansicht.view, zoom, effektiveDrehung(ansicht.rotate, rotation)),
    [ansicht, zoom, rotation]
  )
}
