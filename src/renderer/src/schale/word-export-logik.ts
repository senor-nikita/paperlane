import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { useHistorie } from '../historie'
import { useMutation } from '../mutation-store'
import { beendeVorgang, beginneVorgang } from '../vorgaenge'
import { baueWordSeiten, type RohSeite } from '../word-export'
import { extrahiereSeite } from '../word-extraktion'
import { useDokumentwerkzeuge } from './dokumentwerkzeuge-logik'
import { t } from '../../../shared/i18n'

/**
 * PDF nach Word (S6.7) - der Ablauf im Renderer: Seite fuer Seite lesen,
 * Fortschritt melden, auf Abbruch hoeren, am Ende den Auftrag an den Main.
 *
 * Abgebrochen werden kann, solange gelesen wird - das ist bei langen
 * Dokumenten der teure Teil. Den Speichern-Dialog des Main bricht der Nutzer
 * dort selbst ab.
 */

let laufenderAbbruch: { abgebrochen: boolean } | null = null

export interface WordOptionen {
  seitenumbruch: boolean
}

export async function exportiereWord(optionen: WordOptionen): Promise<void> {
  const api = bruecke()
  const werkzeuge = useDokumentwerkzeuge.getState()
  const { dokument, pfad, setzeHinweis } = useDokument.getState()
  if (api === undefined || dokument === null || pfad === null || werkzeuge.laeuft) return
  // Review L2: eine laufende Mutation (oder Rueckgaengig/Wiederholen) haelt
  // das alte pdf.js-Proxy gerade fest oder gibt es gleich frei - endet sie
  // waehrend des seitenweisen Lesens, bricht `uebernimm` das Proxy ab und der
  // Export scheitert mit einer allgemeinen Fehlermeldung statt eines klaren
  // Hinweises. Erst danach exportieren.
  if (useMutation.getState().laeuft !== null || useHistorie.getState().beschaeftigt) return
  const abbruch = { abgebrochen: false }
  laufenderAbbruch = abbruch
  werkzeuge.setzeLaeuft(true)
  // Das Dokument des aktiven Tabs wird ueber viele Seiten gelesen; ein
  // Tabwechsel dazwischen schluege den Hinweis dem falschen Tab zu (S6.1).
  beginneVorgang('word')
  try {
    const gesamt = dokument.numPages
    const roh: RohSeite[] = []
    for (let nummer = 1; nummer <= gesamt; nummer++) {
      if (abbruch.abgebrochen) break
      useDokumentwerkzeuge.getState().setzeFortschritt({ fertig: nummer - 1, gesamt })
      const seite = await dokument.getPage(nummer)
      roh.push(await extrahiereSeite(seite))
    }
    if (abbruch.abgebrochen) {
      setzeHinweis(t('word.abgebrochen'))
      return
    }
    useDokumentwerkzeuge.getState().setzeFortschritt({ fertig: gesamt, gesamt })
    const seiten = baueWordSeiten(roh)
    const ergebnis = await api.wordExportieren({
      quelle: pfad,
      seiten,
      seitenumbruch: optionen.seitenumbruch
    })
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    useDokumentwerkzeuge.getState().schliesse()
    setzeHinweis(t('word.fertig', { name: ergebnis.name }))
  } catch (fehler) {
    console.error('Export nach Word fehlgeschlagen:', fehler)
    setzeHinweis(t('word.fehler'))
  } finally {
    const stand = useDokumentwerkzeuge.getState()
    stand.setzeFortschritt(null)
    stand.setzeLaeuft(false)
    beendeVorgang('word')
    if (laufenderAbbruch === abbruch) laufenderAbbruch = null
  }
}

/** Bricht das Lesen ab; die Seite, die gerade gelesen wird, laeuft noch zu Ende. */
export function brichWordExportAb(): void {
  if (laufenderAbbruch !== null) laufenderAbbruch.abgebrochen = true
}
