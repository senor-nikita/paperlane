import type { BrowserWindow } from 'electron'
import { basename } from 'node:path'
import type { SpeicherErgebnis } from '../shared/ipc'
import { istLesefreigegeben, istSchreibfreigegeben } from './dokument'
import { fehlertext } from './fehlertext'
import type { Logger } from './logging/logger'
import { frageZielpfad, pruefeSchreibziel, speichereAtomar, type Zielart } from './speichern'
import { baueDocx, pruefeWordAuftrag } from './word'
import { t } from '../shared/i18n'

/**
 * PDF nach Word (S6.7) - der Ablauf im Main, mit Dialog. Der Kern (Pruefung,
 * DOCX bauen) liegt electron-frei in `word.ts`.
 *
 * Reihenfolge wie beim FDF-Export: erst ablehnen, was nicht gehen darf, dann
 * fragen, dann schreiben. Die Quelle muss ein Pfad sein, den der Main selbst
 * herausgegeben hat (Gate Phase 2, H2) - sie liefert nur den Namensvorschlag,
 * gelesen wird sie hier nicht. Das Ziel kommt ausschliesslich aus dem Dialog
 * (Invariante 11) und wird atomar geschrieben.
 *
 * Verschluesselte Dokumente sind **nicht** gesperrt, anders als Speichern,
 * Teilen und Drucken: jene schreiben das PDF mit pdf-lib neu, und pdf-lib kann
 * nicht entschluesseln (`verschluesseltText`). Hier liest nur pdf.js im
 * Renderer - mit dem Passwort, das der Nutzer beim Oeffnen eingegeben hat -
 * und pdf-lib kommt gar nicht vor.
 */
export const ZIEL_WORD: Zielart = {
  get titel() {
    return t('dialog.word')
  },
  get filter() {
    return { name: t('filter.word'), extensions: ['docx'] }
  }
}

export async function exportiereWord(
  fenster: BrowserWindow | null,
  eingabe: unknown,
  log: Logger
): Promise<SpeicherErgebnis> {
  const abgelehnt = (grund: string): SpeicherErgebnis => {
    log.warn('Word-Export abgelehnt', { grund })
    return { art: 'abgelehnt', grund }
  }
  const geprueft = pruefeWordAuftrag(eingabe)
  if (!geprueft.ok) return abgelehnt(geprueft.grund)
  const { auftrag } = geprueft
  if (!istLesefreigegeben(auftrag.quelle) && !istSchreibfreigegeben(auftrag.quelle)) {
    return abgelehnt(t('auftrag.quelle'))
  }

  const vorschlag = auftrag.quelle.replace(/\.pdf$/i, '') + '.docx'
  const ziel = await frageZielpfad(fenster, vorschlag, ZIEL_WORD)
  if (ziel === null) return { art: 'abgebrochen' }
  const zielpruefung = await pruefeSchreibziel(ziel, { endung: '.docx' })
  if (!zielpruefung.ok) return abgelehnt(zielpruefung.grund)

  try {
    const titel = basename(auftrag.quelle).replace(/\.pdf$/i, '')
    const bytes = await baueDocx(auftrag, { titel })
    await speichereAtomar(zielpruefung.pfad, bytes)
    log.info('Word-Dokument exportiert', {
      seiten: auftrag.seiten.length,
      bytes: bytes.byteLength
    })
    const ergebnis: SpeicherErgebnis = {
      art: 'gespeichert',
      pfad: zielpruefung.pfad,
      name: basename(zielpruefung.pfad)
    }
    return ergebnis
  } catch (fehler) {
    log.error('Word-Export fehlgeschlagen', { fehler })
    return abgelehnt(t('word.schreibFehler', { fehler: fehlertext(fehler) }))
  }
}
