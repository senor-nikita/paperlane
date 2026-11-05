import { parentPort, workerData } from 'node:worker_threads'

/**
 * Attrappe fuer den Text-Worker (Gate Phase 6): verhaelt sich je nach
 * `mutation.text` wie ein Worker, der haengt, den Heap sprengt, ablehnt,
 * abstuerzt, Unsinn meldet oder normal antwortet. So prueft
 * test/unit/textbearbeitung-worker.test.ts die Grenzen in `isoliert.ts`,
 * ohne ein Angriffsdokument zu brauchen, das den Parser heute noch durchbricht.
 *
 * Laeuft ohne Uebersetzung (Node entfernt die Typen selbst) - deshalb nur
 * loeschbare Typsyntax und keine Importe aus dem Projekt.
 */
const { bytes, mutation } = workerData as { bytes: Uint8Array; mutation: { text: string } }
const port = parentPort
if (port === null) throw new Error('nur als Worker')

switch (mutation.text) {
  case 'endlos':
    // absichtlich synchron: nur `terminate()` beendet das
    for (;;) {
      /* haengt */
    }
  case 'speicher': {
    const halde: { a: number[]; b: string }[] = []
    for (;;) halde.push({ a: [1, 2, 3, 4, 5, 6, 7, 8], b: String(halde.length) })
  }
  case 'ablehnen':
    port.postMessage({ ok: false, abgelehnt: true, grund: 'Nicht bearbeitbar: Attrappe.' })
    break
  case 'fehler':
    port.postMessage({ ok: false, abgelehnt: false, grund: 'Interner Fehler der Attrappe' })
    break
  case 'absturz':
    throw new Error('Attrappe abgestuerzt')
  case 'unsinn':
    port.postMessage({ ok: true, bytes: 'kein Feld' })
    break
  case 'still':
    process.exit(3)
    break
  default: {
    // Normal: die Bytes umgedreht zurueck - so ist sichtbar, dass sie aus dem
    // Worker kommen und die Eingabe unberuehrt blieb.
    const aus = Uint8Array.from(bytes).reverse()
    port.postMessage({ ok: true, bytes: aus, bericht: { schrift: 'original' } }, [aus.buffer])
  }
}
