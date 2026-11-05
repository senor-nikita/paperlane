import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from '../e2e/launchApp'

/**
 * Invariante 10: die Performance-Budgets.
 *
 * Gemessen wird gegen `large-heavy.pdf` — 300 Seiten mit eingebetteten Bildern
 * und Schriften, rund 65 MB. `large-500.pdf` waere untauglich: es ist nur ein
 * paar hundert Kilobyte gross und macht jedes Zeitbudget unfaelschbar gruen.
 *
 * Die Datei ist nicht eingecheckt. Fehlt sie, uebersprigt der Test sichtbar,
 * statt still zu bestehen.
 */
const SCHWER = resolve('test/fixtures/large-heavy.pdf')
const vorhanden = existsSync(SCHWER)

/** Erste sichtbare Seite. */
const BUDGET_ERSTE_SEITE_MS = 2000
/** Uebergabe der Bytes vom Main-Prozess an den Renderer (offener Punkt aus ADR 0001). */
const BUDGET_UEBERGABE_MS = 1500
/** Sichtbare Seiten plus Puffer beidseitig. Mehr waere keine Virtualisierung. */
const MAX_CANVAS = 8
/**
 * Dasselbe Budget fuer die Miniaturen aus S1.3c. Sie sind kleiner, aber es
 * passen mehr davon ins Sichtfenster.
 *
 * Bewusst als zweite Zahl statt als Anhebung von MAX_CANVAS: die beiden
 * Pipelines haben getrennte Budgets, und ein Ausreisser soll benennen koennen,
 * welche von beiden ihn verursacht.
 */
const MAX_MINIATUR_CANVAS = 12

let gestartet: GestarteteApp

test.beforeEach(async () => {
  test.skip(
    !vorhanden,
    'test/fixtures/large-heavy.pdf fehlt. Erzeugen mit: npm run fixtures (rund 65 MB, nicht eingecheckt).'
  )
  gestartet = await startApp([SCHWER])
})

test.afterEach(async () => {
  if (vorhanden) await gestartet.schliessen()
})

test('die erste Seite erscheint innerhalb des Budgets', async () => {
  const start = Date.now()
  await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 30000 })
  await expect
    .poll(
      async () =>
        gestartet.fenster.evaluate(() => {
          const c = document.querySelector('[data-testid="seiten-canvas-1"]')
          return c instanceof HTMLCanvasElement ? c.width : 0
        }),
      { timeout: 30000 }
    )
    .toBeGreaterThan(100)
  const dauer = Date.now() - start
  console.log('  erste Seite sichtbar nach ' + String(dauer) + ' ms')
  expect(dauer).toBeLessThan(BUDGET_ERSTE_SEITE_MS)
})

test('die Uebergabe der Bytes bleibt im Budget', async () => {
  // Der offene Punkt aus ADR 0001: die Messung in scripts/measure-transport.mjs
  // lief im selben Prozess und konnte die IPC-Uebergabe nicht erfassen.
  const dauer = await gestartet.fenster.evaluate(async () => {
    const start = performance.now()
    const geoeffnet = await window.api.dokumentBeimStart()
    const ende = performance.now()
    return { ms: ende - start, bytes: geoeffnet?.bytes.byteLength ?? 0 }
  })
  console.log(
    '  Uebergabe von ' +
      (dauer.bytes / 1024 / 1024).toFixed(1) +
      ' MB in ' +
      dauer.ms.toFixed(0) +
      ' ms'
  )
  expect(dauer.bytes).toBeGreaterThan(1_000_000)
  expect(dauer.ms).toBeLessThan(BUDGET_UEBERGABE_MS)
})

test('der Speicher waechst nicht mit der Seitenzahl', async () => {
  // Direkt gemessen statt ueber den Heap: die Aussage der Virtualisierung ist,
  // dass nur wenige Seiten gleichzeitig im DOM liegen. Eine Heap-Stichprobe
  // waere ungenauer und von der Speicherbereinigung abhaengig.
  await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 30000 })

  // Getrennt zaehlen: die Hauptansicht und die Miniaturen sind zwei
  // Renderpipelines mit eigenen Budgets (S1.3c).
  const zaehleCanvas = async (): Promise<number> =>
    gestartet.fenster.evaluate(
      () => document.querySelectorAll('[data-testid="ansicht"] canvas').length
    )
  const zaehleMiniaturen = async (): Promise<number> =>
    gestartet.fenster.evaluate(
      () => document.querySelectorAll('[data-testid="miniaturen"] canvas').length
    )

  const amAnfang = await zaehleCanvas()
  expect(amAnfang).toBeLessThanOrEqual(MAX_CANVAS)
  expect(await zaehleMiniaturen()).toBeLessThanOrEqual(MAX_MINIATUR_CANVAS)

  const springeZu = async (anteil: number): Promise<void> => {
    await gestartet.fenster.evaluate((ziel) => {
      const behaelter = document.querySelector('[data-testid="ansicht"]')
      if (behaelter instanceof HTMLElement) {
        behaelter.scrollTop = (behaelter.scrollHeight - behaelter.clientHeight) * ziel
      }
    }, anteil)
    await gestartet.fenster.waitForTimeout(700)
  }

  await springeZu(0.33)
  const inDerMitte = await zaehleCanvas()
  await springeZu(0.95)
  const amEnde = await zaehleCanvas()

  console.log(
    '  Canvas-Elemente: Anfang ' +
      String(amAnfang) +
      ', Mitte ' +
      String(inDerMitte) +
      ', Ende ' +
      String(amEnde)
  )
  expect(inDerMitte).toBeLessThanOrEqual(MAX_CANVAS)
  expect(amEnde).toBeLessThanOrEqual(MAX_CANVAS)

  // Auch die Sidebar bleibt beschraenkt: sie ist der Hauptansicht bis ans
  // Dokumentende gefolgt, ohne dabei Miniaturen anzusammeln.
  expect(await zaehleMiniaturen()).toBeLessThanOrEqual(MAX_MINIATUR_CANVAS)
})

test('ein Shading mit PostScript-Funktion wird gezeichnet', async () => {
  // Risiko R3: mit isEvalSupported false interpretiert pdf.js den
  // PostScript-Rechner, statt ihn zu kompilieren. Gemessen wird hier nur, dass
  // es ueberhaupt funktioniert und wie lange es dauert.
  await gestartet.schliessen()
  const shading = await startApp([resolve('test/fixtures/shading.pdf')])
  try {
    const start = Date.now()
    await shading.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
    await shading.fenster.waitForTimeout(500)
    console.log('  Shading gezeichnet nach ' + String(Date.now() - start) + ' ms')
    await expect(shading.fenster.getByTestId('seiten-anzeige')).toHaveText('von 1')
  } finally {
    await shading.schliessen()
    gestartet = await startApp([SCHWER])
  }
})
