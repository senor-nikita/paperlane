import type { Worker, WorkerOptions } from 'node:worker_threads'
import type { TextBericht } from '../../shared/mutation'
import { TextAbgelehnt } from './pdfobjekte'
import type { TextErgebnis, TextErsetzen } from './textersetzen'
import { aktiveSprache, t, type Sprache } from '../../shared/i18n'

/**
 * `textErsetzen` in einem eigenen Worker-Thread (Gate Phase 6, H1/H2).
 *
 * Der Parser der Textbearbeitung liest fremde Dokumente. Seine Einzelbudgets
 * (Glyphen, Formaufrufe, Operanden, Bytes, CMaps) halten die bekannten Wege
 * auf - der Worker ist die zweite Linie fuer die unbekannten: ein
 * V8-Speicherueberlauf im Main-Thread ist kein fangbarer Fehler, sondern
 * beendet den Prozess mit allen ungespeicherten Tabs; eine Endlosschleife
 * friert jedes Fenster ein. Im Worker trifft beides nur den Worker:
 *
 * - `resourceLimits` begrenzt seinen Heap - ein Ueberlauf wird zum
 *   `error`-Ereignis `ERR_WORKER_OUT_OF_MEMORY`, der Main laeuft weiter;
 * - nach `zeitMs` beendet `terminate()` ihn hart, auch mitten in einer
 *   synchronen Schleife.
 *
 * Beides wird zur Ablehnung mit klarer Meldung; das Dokument bleibt
 * unveraendert, denn der Main uebernimmt nur Bytes aus einer vollstaendigen
 * Antwort.
 */

/** Erzeugt den Worker; in der Anwendung der `?nodeWorker`-Import (index.ts). */
export type TextWorkerStarter = (optionen: WorkerOptions) => Worker

export interface TextGrenzen {
  zeitMs: number
  heapMb: number
}

export const STANDARD_TEXTGRENZEN: TextGrenzen = { zeitMs: 20_000, heapMb: 2048 }

/** Kennung im `workerData`, damit der Worker nur echte Auftraege annimmt. */
export const TEXT_AUFTRAG = 'paperlane-textErsetzen'

export interface TextAuftrag {
  art: typeof TEXT_AUFTRAG
  bytes: Uint8Array
  mutation: TextErsetzen
  /**
   * Sprache der Meldungen (S6.8). Der Worker hat eine eigene Instanz der
   * Uebersetzungsschicht und kennt die Wahl des Main sonst nicht.
   */
  sprache: Sprache
}

export type TextAntwort =
  | { ok: true; bytes: Uint8Array; bericht: TextBericht }
  | { ok: false; abgelehnt: boolean; grund: string }

function istAntwort(m: unknown): m is TextAntwort {
  if (typeof m !== 'object' || m === null) return false
  const a = m as Record<string, unknown>
  if (a['ok'] === true) {
    const b = a['bericht'] as Record<string, unknown> | null | undefined
    return a['bytes'] instanceof Uint8Array && typeof b === 'object' && b !== null
  }
  return a['ok'] === false && typeof a['grund'] === 'string'
}

export function fuehreTextIsoliertAus(
  starter: TextWorkerStarter,
  bytes: Uint8Array,
  mutation: TextErsetzen,
  grenzen: TextGrenzen = STANDARD_TEXTGRENZEN
): Promise<TextErgebnis> {
  return new Promise<TextErgebnis>((resolve, reject) => {
    // Eine eigene Kopie wandert in den Worker: die Eingabe ist oft die
    // Arbeitskopie eines Tabs und muss unveraendert bleiben (Rueckgaengig).
    const kopie = bytes.slice()
    const auftrag: TextAuftrag = {
      art: TEXT_AUFTRAG,
      bytes: kopie,
      mutation,
      sprache: aktiveSprache()
    }
    let worker: Worker
    try {
      worker = starter({
        workerData: auftrag,
        transferList: [kopie.buffer],
        resourceLimits: { maxOldGenerationSizeMb: grenzen.heapMb }
      })
    } catch (fehler) {
      reject(fehler instanceof Error ? fehler : new Error(String(fehler)))
      return
    }
    let erledigt = false
    const ende = (abschluss: () => void): void => {
      if (erledigt) return
      erledigt = true
      clearTimeout(uhr)
      abschluss()
      // Auch nach einer Antwort: der Worker hat seine Arbeit getan.
      void worker.terminate().catch(() => undefined)
    }
    const uhr = setTimeout(() => {
      ende(() => {
        reject(
          new TextAbgelehnt(
            t('text.zeitUeberschritten', { sekunden: Math.round(grenzen.zeitMs / 1000) })
          )
        )
      })
    }, grenzen.zeitMs)

    worker.once('message', (m: unknown) => {
      ende(() => {
        if (!istAntwort(m)) {
          reject(new Error(t('text.keineAntwort')))
        } else if (m.ok) {
          resolve({ bytes: m.bytes, bericht: m.bericht })
        } else {
          reject(m.abgelehnt ? new TextAbgelehnt(m.grund) : new Error(m.grund))
        }
      })
    })
    worker.once('error', (fehler: Error & { code?: string }) => {
      ende(() => {
        reject(
          fehler.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new TextAbgelehnt(t('text.speicher'))
            : new Error(t('text.fehlgeschlagen', { fehler: fehler.message }))
        )
      })
    })
    worker.once('exit', (code: number) => {
      ende(() => {
        reject(new Error(t('text.beendet', { code })))
      })
    })
  })
}
