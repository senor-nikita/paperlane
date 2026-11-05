import { useDokument } from './dokument-store'
import { fuehreMutationAus } from './mutation'
import { useSeitenauswahl } from './seitenauswahl-store'
import { useZuschnitt, type ZuschnittZiel } from './zuschnitt-store'
import { berechneZuschnitte } from './viewer/zuschnitt'
import { t } from '../../shared/i18n'

/**
 * Zuschneiden und Zuschnitt aufheben (S6.3) - der Weg vom Rahmen im
 * Bedienzustand zur Mutation `seitenZuschneiden`. Alles andere (Neuladen,
 * Ansicht, Undo in der gemeinsamen Historie) erledigt die Mutationspipeline.
 */

/** Die Seiten, auf die das Ziel wirkt, aufsteigend. */
export function zuschnittSeiten(ziel: ZuschnittZiel): number[] {
  const { aktuelleSeite, seitenzahl } = useDokument.getState()
  if (ziel === 'alle') return Array.from({ length: seitenzahl }, (_, i) => i + 1)
  if (ziel === 'auswahl') {
    const auswahl = useSeitenauswahl.getState().ausgewaehlt
    if (auswahl.size > 0) return [...auswahl].sort((a, b) => a - b)
  }
  // "Diese Seite": die mit dem Rahmen, sonst die aktuelle.
  return [useZuschnitt.getState().seite ?? aktuelleSeite]
}

/** Den aufgezogenen Rahmen auf die Zielseiten anwenden. */
export async function schneideZu(): Promise<boolean> {
  const { raender, ziel } = useZuschnitt.getState()
  const { dokument, rotation, setzeHinweis } = useDokument.getState()
  if (dokument === null) return false
  if (raender === null) {
    setzeHinweis(t('zuschnitt.erstRahmen'))
    return false
  }
  const ergebnis = await berechneZuschnitte(dokument, zuschnittSeiten(ziel), raender, rotation)
  if ('fehler' in ergebnis) {
    setzeHinweis(ergebnis.fehler)
    return false
  }
  const angewendet = await fuehreMutationAus({
    art: 'seitenZuschneiden',
    zuschnitte: ergebnis.zuschnitte
  })
  // Der Rahmen hat seinen Zweck erfuellt; die Seite zeigt jetzt den Zuschnitt.
  if (angewendet) useZuschnitt.getState().verwerfe()
  return angewendet
}

/** Die CropBox der Zielseiten wieder auf die MediaBox setzen. */
export async function hebeZuschnittAuf(): Promise<boolean> {
  const seiten = zuschnittSeiten(useZuschnitt.getState().ziel)
  const angewendet = await fuehreMutationAus({
    art: 'seitenZuschneiden',
    zuschnitte: seiten.map((seite) => ({ seite, rahmen: null }))
  })
  if (angewendet) useZuschnitt.getState().verwerfe()
  return angewendet
}
