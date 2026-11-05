import { useDokument } from '../dokument-store'
import { useT } from '../sprache'

/**
 * Sagt den Seitenwechsel an (S5.2a, Aufgabe 3).
 *
 * Die Seitenzahl steht sichtbar in der Kopfleiste, aber in einem Eingabefeld
 * und einer Textzeile - beides meldet sich nicht von selbst. Wer die Seite
 * ueber die Tastatur, die Miniaturen oder schlicht durch Scrollen wechselt,
 * erfuehre sonst nirgends, wo er gelandet ist.
 *
 * Eigene Komponente und nicht ein `aria-live` an der vorhandenen Anzeige: die
 * Live-Region muss im DOM stehen, **bevor** sich ihr Text aendert, sonst sagt
 * der Screenreader nichts. Die Anzeige in der Kopfleiste erscheint erst mit
 * einem Dokument; diese Zeile steht immer.
 *
 * `polite` und nicht `assertive`: ein Seitenwechsel ist kein Notfall und soll
 * nicht mitten in einen vorgelesenen Satz hineinreden.
 */
export function Seitenansage(): React.JSX.Element {
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const t = useT()

  return (
    <p
      className="nur-fuer-screenreader"
      data-testid="seitenansage"
      role="status"
      aria-live="polite"
    >
      {seitenzahl === 0 ? '' : t('ansage.seite', { seite: aktuelleSeite, anzahl: seitenzahl })}
    </p>
  )
}
