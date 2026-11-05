import { sammleAenderungen } from '../../shared/aenderungen'
import { verschluesseltText } from '../../shared/errors'
import type { Feldwert } from '../../shared/formulare'
import { useAnnotationen } from './annotations-store'
import { bruecke } from './bruecke'
import { useDokument } from './dokument-store'
import { geaenderteFelder, useFormular } from './formular-store'
import { useHistorie } from './historie'
import { loescheSeiten } from './mutation'
import { useMutation } from './mutation-store'
import { beendeVorgang, beginneVorgang, laufenderVorgang } from './vorgaenge'
import { t } from '../../shared/i18n'

/**
 * Seiten extrahieren (S6.2, Aufgabe 3): die genannten Seiten als neue Datei,
 * so wie der Nutzer sie sieht - mit den ungespeicherten Anmerkungen und
 * Formularwerten, wie beim Drucken.
 *
 * `entfernen` loescht die Seiten danach aus dem offenen Dokument, als
 * gewoehnliche Mutation mit Rueckgaengig. Erst nach dem Schreiben: bricht der
 * Nutzer den Dialog ab, bleibt das Dokument unberuehrt.
 *
 * `true`, wenn die Datei geschrieben wurde.
 */
export async function extrahiereSeiten(
  seiten: readonly number[],
  entfernen: boolean
): Promise<boolean> {
  const api = bruecke()
  const { pfad, verschluesselt, seitenzahl, setzeHinweis } = useDokument.getState()
  if (api === undefined || pfad === null || seiten.length === 0) return false
  if (verschluesselt) {
    setzeHinweis(verschluesseltText())
    return false
  }
  if (laufenderVorgang() !== null) return false
  // Review M1: waehrend eine Mutation laeuft oder Rueckgaengig/Wiederholen
  // beschaeftigt ist, sind die Seitennummern des Renderers nicht verlaesslich
  // - der Main koennte inzwischen einen anderen Stand haben. Erst danach
  // extrahieren, sonst extrahiert/loescht der Nutzer die falschen Seiten.
  if (useMutation.getState().laeuft !== null || useHistorie.getState().beschaeftigt) return false
  if (entfernen && seiten.length >= seitenzahl) {
    setzeHinweis(t('extrahieren.alle'))
    return false
  }
  const { proSeite, urspruenglich } = useAnnotationen.getState()
  const formular = useFormular.getState()
  const formularwerte: Record<string, Feldwert> = {}
  for (const name of geaenderteFelder(formular.werte, formular.ursprung)) {
    const wert = formular.werte[name]
    if (wert !== undefined) formularwerte[name] = wert
  }

  beginneVorgang('extrahieren')
  let geschrieben = false
  let name = ''
  try {
    const antwort = await api.seitenExtrahieren({
      quelle: pfad,
      seiten: [...seiten],
      aenderungen: sammleAenderungen(proSeite, urspruenglich),
      formularwerte
    })
    if (antwort.art === 'abgebrochen') return false
    if (antwort.art === 'abgelehnt') {
      setzeHinweis(antwort.grund)
      return false
    }
    geschrieben = true
    name = antwort.name
    setzeHinweis(t('extrahieren.fertig', { anzahl: antwort.seiten, name: antwort.name }))
  } catch (fehler) {
    console.error('Extrahieren fehlgeschlagen:', fehler)
    setzeHinweis(t('extrahieren.fehler'))
    return false
  } finally {
    beendeVorgang('extrahieren')
  }
  if (geschrieben && entfernen) {
    const entfernt = await loescheSeiten([...seiten].sort((a, b) => a - b))
    // `loescheSeiten`/`fuehreMutationAus` lehnen still ab (z. B. begann
    // inzwischen eine andere Mutation); ohne diesen Hinweis saehe der Nutzer
    // nur "extrahiert" und wuesste nicht, dass die Seiten noch im Dokument sind.
    if (!entfernt) setzeHinweis(t('extrahieren.nichtEntfernt', { name }))
  }
  return geschrieben
}
