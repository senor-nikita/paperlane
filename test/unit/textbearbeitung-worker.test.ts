// @vitest-environment node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { PDFDocument, PDFName } from 'pdf-lib'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setzeTextWorker, wendeMutationAnMitBericht } from '../../src/main/mutation'
import {
  fuehreTextIsoliertAus,
  type TextWorkerStarter
} from '../../src/main/textbearbeitung/isoliert'
import { TextAbgelehnt } from '../../src/main/textbearbeitung/pdfobjekte'
import type { TextErsetzen } from '../../src/main/textbearbeitung/textersetzen'
import { findeZeile, pdfjsZeilen } from '../helpers/pdfjs-zeilen'

/**
 * Gate Phase 6 (H1/H2): "Text aendern" laeuft in einem Worker mit Heap- und
 * Zeitgrenze. Ein haengender oder ueberlaufender Worker wird zur sauberen
 * Ablehnung, der aufrufende Thread (in der Anwendung: der Main-Prozess)
 * laeuft weiter, und die Eingabebytes bleiben unberuehrt.
 */

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs')
}, 60000)

const attrappe: TextWorkerStarter = (optionen: WorkerOptions) =>
  new Worker(new URL('../helpers/text-worker-attrappe.ts', import.meta.url), optionen)

const zeile = {
  winkel: 0,
  dx: 1,
  dy: 0,
  grundlinie: 700,
  von: 100,
  bis: 110,
  groesse: 12,
  text: 'x'
}
const auftrag = (text: string): TextErsetzen => ({ art: 'textErsetzen', seite: 1, zeile, text })

describe('Grenzen des Text-Workers (Attrappe)', () => {
  it('liefert Bytes und Bericht aus dem Worker, die Eingabe bleibt unberuehrt', async () => {
    const eingabe = Uint8Array.of(1, 2, 3, 4)
    const e = await fuehreTextIsoliertAus(attrappe, eingabe, auftrag('normal'))
    expect([...e.bytes]).toEqual([4, 3, 2, 1])
    expect(e.bericht).toEqual({ schrift: 'original' })
    expect([...eingabe]).toEqual([1, 2, 3, 4])
  })

  it('Zeitlimit: haengender Worker wird beendet, Ablehnung mit Meldung', async () => {
    const t = performance.now()
    const lauf = fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('endlos'), {
      zeitMs: 500,
      heapMb: 256
    })
    // Der aufrufende Thread bleibt frei, waehrend der Worker haengt.
    let tick = false
    await new Promise<void>((r) => setTimeout(r, 50))
    tick = true
    await expect(lauf).rejects.toThrow(TextAbgelehnt)
    await expect(lauf).rejects.toThrow(/abgebrochen/)
    expect(tick).toBe(true)
    expect(performance.now() - t).toBeLessThan(5000)
  }, 20000)

  it('Heap-Limit: Ueberlauf im Worker wird zur Ablehnung, nicht zum Absturz', async () => {
    const lauf = fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('speicher'), {
      zeitMs: 15000,
      heapMb: 32
    })
    await expect(lauf).rejects.toThrow(TextAbgelehnt)
    await expect(lauf).rejects.toThrow(/Speicher/)
    // Und danach geht es normal weiter.
    const e = await fuehreTextIsoliertAus(attrappe, Uint8Array.of(7, 8), auftrag('normal'))
    expect([...e.bytes]).toEqual([8, 7])
  }, 30000)

  it('Ablehnung, Fehler, Absturz, stilles Ende und kaputte Antwort', async () => {
    await expect(
      fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('ablehnen'))
    ).rejects.toThrow(TextAbgelehnt)
    const fehler = fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('fehler'))
    await expect(fehler).rejects.toThrow('Interner Fehler der Attrappe')
    await expect(fehler).rejects.not.toBeInstanceOf(TextAbgelehnt)
    await expect(
      fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('absturz'))
    ).rejects.toThrow(/fehlgeschlagen: Attrappe abgestuerzt/)
    await expect(
      fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('still'))
    ).rejects.toThrow(/unerwartet beendet/)
    await expect(
      fuehreTextIsoliertAus(attrappe, Uint8Array.of(1), auftrag('unsinn'))
    ).rejects.toThrow(/keine gültige Antwort/)
  }, 30000)

  it('ein Starter, der wirft, wird zur Ablehnung des Auftrags', async () => {
    const kaputt: TextWorkerStarter = () => {
      throw new Error('kein Worker')
    }
    await expect(fuehreTextIsoliertAus(kaputt, Uint8Array.of(1), auftrag('x'))).rejects.toThrow(
      'kein Worker'
    )
  })
})

describe('Der echte Text-Worker (textworker.ts)', () => {
  let echt: TextWorkerStarter

  beforeAll(async () => {
    // Wie electron-vite fuer `?nodeWorker`: der Worker als eigenes ES-Modul,
    // Abhaengigkeiten extern. Das Ziel liegt unter node_modules, damit
    // `pdf-lib` von dort aufgeloest wird.
    const ziel = resolve('node_modules/.cache/paperlane-textworker')
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: resolve('src/main/textbearbeitung/textworker.ts'),
        outDir: ziel,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { format: 'es', entryFileNames: 'textworker.mjs' } }
      }
    })
    const datei = pathToFileURL(resolve(ziel, 'textworker.mjs'))
    echt = (optionen) => new Worker(datei, optionen)
    setzeTextWorker(echt)
  }, 120000)

  afterAll(() => {
    setzeTextWorker(undefined)
  })

  async function dokument(inhalt: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const ctx = doc.context
    const font = ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' })
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: ctx.register(font) } }))
    page.node.set(
      PDFName.of('Contents'),
      ctx.register(ctx.flateStream(new TextEncoder().encode(inhalt)))
    )
    return doc.save()
  }

  it('ersetzt eine Zeile ueber wendeMutationAnMitBericht im Worker', async () => {
    const bytes = await dokument('BT /F1 12 Tf 100 700 Td (Hallo) Tj ET')
    const z = findeZeile(await pdfjsZeilen(bytes), 'Hallo')
    const e = await wendeMutationAnMitBericht(bytes, {
      art: 'textErsetzen',
      seite: 1,
      zeile: z,
      text: 'Welt'
    })
    expect(e.bericht).toEqual({ schrift: 'original' })
    expect((await pdfjsZeilen(e.bytes)).map((x) => x.text)).toEqual(['Welt'])
  }, 60000)

  it('reicht TextAbgelehnt aus dem Parser mit Grund durch', async () => {
    const bytes = await dokument('BT /F1 12 Tf 100 700 Td (Hallo) Tj ET')
    const z = { ...findeZeile(await pdfjsZeilen(bytes), 'Hallo'), grundlinie: 100 }
    const lauf = wendeMutationAnMitBericht(bytes, {
      art: 'textErsetzen',
      seite: 1,
      zeile: z,
      text: 'x'
    })
    await expect(lauf).rejects.toThrow(TextAbgelehnt)
    await expect(lauf).rejects.toThrow(/steht nicht im Seiteninhalt/)
  }, 60000)

  it('Seite ausserhalb des Dokuments: dieselbe Meldung wie bisher', async () => {
    const bytes = await dokument('q Q')
    await expect(
      wendeMutationAnMitBericht(bytes, { art: 'textErsetzen', seite: 2, zeile, text: 'x' })
    ).rejects.toThrow('Seite 2 gibt es nicht; das Dokument hat 1.')
  }, 60000)
})
