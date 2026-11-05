import { parentPort, workerData, type MessagePort } from 'node:worker_threads'
import { TEXT_AUFTRAG, type TextAntwort, type TextAuftrag } from './isoliert'
import { TextAbgelehnt } from './pdfobjekte'
import { ersetzeTextDirekt } from './textersetzen'
import { setzeSprache } from '../../shared/i18n'

/**
 * Einstieg des Text-Workers (Gate Phase 6, H1/H2): fuehrt genau einen
 * `textErsetzen`-Auftrag aus und meldet Bytes oder Grund zurueck. Grenzen
 * und Zeitlimit setzt der Main (`isoliert.ts`); gebaut wird die Datei ueber
 * den `?nodeWorker`-Import in `index.ts` (electron-vite).
 */

function istAuftrag(d: unknown): d is TextAuftrag {
  if (typeof d !== 'object' || d === null) return false
  const a = d as Record<string, unknown>
  return (
    a['art'] === TEXT_AUFTRAG &&
    a['bytes'] instanceof Uint8Array &&
    (a['sprache'] === 'de' || a['sprache'] === 'en')
  )
}

async function arbeite(port: MessagePort, auftrag: TextAuftrag): Promise<void> {
  // Eigene Modulinstanz: ohne das sprachen die Meldungen immer Deutsch.
  setzeSprache(auftrag.sprache)
  let antwort: TextAntwort
  try {
    const e = await ersetzeTextDirekt(auftrag.bytes, auftrag.mutation)
    // Nur ein Puffer, der genau diesen Bytes gehoert, wird uebertragen.
    const eigen =
      e.bytes.byteOffset === 0 && e.bytes.byteLength === e.bytes.buffer.byteLength
        ? e.bytes
        : e.bytes.slice()
    port.postMessage({ ok: true, bytes: eigen, bericht: e.bericht } satisfies TextAntwort, [
      eigen.buffer as ArrayBuffer
    ])
    return
  } catch (fehler) {
    antwort = {
      ok: false,
      abgelehnt: fehler instanceof TextAbgelehnt,
      grund: fehler instanceof Error ? fehler.message : String(fehler)
    }
  }
  port.postMessage(antwort)
}

if (parentPort !== null && istAuftrag(workerData)) void arbeite(parentPort, workerData)
