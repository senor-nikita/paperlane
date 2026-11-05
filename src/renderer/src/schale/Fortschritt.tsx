import { useEffect, useState } from 'react'
import { beschreibeMutation } from '../../../shared/mutation'
import { useMutation } from '../mutation-store'

/**
 * Die Fortschrittsanzeige fuer Mutationen (S4.0, Aufgabe 5).
 *
 * Erst ab einer Schwellendauer: eine Seite in einem kleinen Dokument zu
 * loeschen dauert unter 100 ms, und ein Balken, der dafuer aufblitzt, waere
 * nur Unruhe. Bei einem grossen Dokument (die Messung in
 * `test/perf/mutation.perf.spec.ts` liegt bei rund einer Sekunde) sieht der
 * Leser dagegen, dass etwas geschieht - und der Knopf ist solange gesperrt.
 *
 * Kein Prozentwert: pdf-lib meldet keinen Fortschritt, und ein erfundener
 * Balken waere eine Luege.
 */

/** Ab dieser Dauer erscheint die Anzeige. */
export const SCHWELLE_MS = 300

export function Fortschritt(): React.JSX.Element | null {
  const laeuft = useMutation((zustand) => zustand.laeuft)
  const [sichtbar, setSichtbar] = useState(false)

  useEffect(() => {
    if (laeuft === null) {
      setSichtbar(false)
      return undefined
    }
    const zeitgeber = setTimeout(() => {
      setSichtbar(true)
    }, SCHWELLE_MS)
    return () => {
      clearTimeout(zeitgeber)
    }
  }, [laeuft])

  if (laeuft === null || !sichtbar) return null
  return (
    <p
      data-testid="mutation-fortschritt"
      role="status"
      aria-live="polite"
      style={{
        margin: 0,
        padding: '0.5rem 0.75rem',
        background: '#e8f0fe',
        borderBottom: '1px solid #c5d5f5',
        fontSize: '0.9em'
      }}
    >
      {beschreibeMutation(laeuft)} … das Dokument wird neu aufgebaut.
    </p>
  )
}
