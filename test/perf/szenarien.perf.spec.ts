import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from '../e2e/launchApp'

/**
 * S5.1, Aufgabe 2: drei Szenarien, die S1.2 nicht kannte - viele
 * Annotationen, ein Formular mit vielen Feldern, Suche waehrend des
 * Scrollens. Fixtures per `npm run fixtures` (nicht eingecheckt, wie
 * `large-heavy.pdf`).
 */
const VIELE_ANNOTATIONEN = resolve('test/fixtures/many-annotations.pdf')
const VIELE_FELDER = resolve('test/fixtures/many-fields.pdf')
const GROSS_500 = resolve('test/fixtures/large-500.pdf')

/** Dasselbe Budget wie fuer die erste Seite von large-heavy.pdf. */
const BUDGET_ERSTE_SEITE_MS = 2000
/** Gemessen ~2050 ms; Puffer fuer Suche plus zehn Scrollschritte gleichzeitig. */
const BUDGET_SUCHE_SCROLL_MS = 3000

let gestartet: GestarteteApp | null = null

test.afterEach(async () => {
  if (gestartet !== null) await gestartet.schliessen()
  gestartet = null
})

/** Wie in rendering.perf.spec.ts: erst gebreitetes Canvas zaehlt als "sichtbar". */
async function wartetAufCanvas(fenster: GestarteteApp['fenster']): Promise<void> {
  await expect
    .poll(
      async () =>
        fenster.evaluate(() => {
          const c = document.querySelector('[data-testid="seiten-canvas-1"]')
          return c instanceof HTMLCanvasElement ? c.width : 0
        }),
      { timeout: 30000 }
    )
    .toBeGreaterThan(100)
}

test('viele Annotationen auf einer Seite bleiben im Budget der ersten Seite', async () => {
  // Der Elektron-Kaltstart gehoert nicht zum Budget (wie in rendering.perf.spec.ts):
  // erst nach `startApp` beginnt die Messung.
  gestartet = await startApp([VIELE_ANNOTATIONEN])
  const start = Date.now()
  await wartetAufCanvas(gestartet.fenster)
  await expect
    .poll(
      async () =>
        gestartet?.fenster.evaluate(
          () => document.querySelectorAll('[data-testid^="annotation-"]').length
        ),
      { timeout: 20000 }
    )
    .toBeGreaterThanOrEqual(10)
  const dauer = Date.now() - start
  console.log('  Seite mit 10 Annotationen sichtbar nach ' + String(dauer) + ' ms')
  expect(dauer).toBeLessThan(BUDGET_ERSTE_SEITE_MS)
})

test('ein Formular mit 300 Feldern bleibt im Budget der ersten Seite', async () => {
  gestartet = await startApp([VIELE_FELDER])
  const start = Date.now()
  await wartetAufCanvas(gestartet.fenster)
  await expect
    .poll(
      async () =>
        gestartet?.fenster.evaluate(
          () => document.querySelectorAll('input, select, textarea').length
        ),
      { timeout: 20000 }
    )
    .toBeGreaterThanOrEqual(300)
  const dauer = Date.now() - start
  console.log('  Seite mit 300 Feldern sichtbar nach ' + String(dauer) + ' ms')
  expect(dauer).toBeLessThan(BUDGET_ERSTE_SEITE_MS)
})

test('Suche ueber 500 Seiten waehrend des Scrollens bleibt fluessig', async () => {
  gestartet = await startApp([GROSS_500])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="such-eingabe"]', { timeout: 20000 })

  const start = Date.now()
  await fenster.getByTestId('such-eingabe').fill('Wasserzeichen')
  await fenster.getByTestId('such-eingabe').press('Enter')

  // Waehrend die Suche im Hintergrund laeuft (Worker, S1.4), scrollt die
  // Ansicht durch das ganze Dokument - beides gleichzeitig, wie im Szenario
  // gefordert. Virtualisierung darf dabei ihr Canvas-Budget nicht reissen.
  const behaelter = fenster.getByTestId('ansicht')
  for (let schritt = 0; schritt < 10; schritt++) {
    await behaelter.evaluate((el, anteil) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * anteil
    }, schritt / 9)
    await fenster.waitForTimeout(150)
    const canvasZahl = await fenster.evaluate(
      () => document.querySelectorAll('[data-testid="ansicht"] canvas').length
    )
    expect(canvasZahl).toBeLessThanOrEqual(8)
  }

  await expect(fenster.getByTestId('treffer-anzeige')).toHaveText('1 von 50', { timeout: 30000 })
  const dauer = Date.now() - start
  console.log('  Suche mit 50 Treffern samt Scrollen fertig nach ' + String(dauer) + ' ms')
  expect(dauer).toBeLessThan(BUDGET_SUCHE_SCROLL_MS)
})
