import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * Markierungen lassen sich durch einen Klick auswaehlen - Farbe, Deckkraft und
 * Loeschen (auch mit Entf) stehen dann zur Verfuegung. Eine Klickflaeche haben
 * sie weiterhin nicht: der Text darunter bleibt mit der Maus auswaehlbar.
 */
let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffneAnnotiert(): Promise<Page> {
  gestartet = await startApp([resolve('test/fixtures/annotated.pdf')])
  await gestartet.fenster.waitForSelector(
    '[data-testid="annotationsebene-1"] [data-annotation-typ="Highlight"]',
    { timeout: 20000 }
  )
  return gestartet.fenster
}

const MARKIERUNG = '[data-testid="annotationsebene-1"] [data-annotation-typ="Highlight"]'

/** Die Mitte des ersten gemalten Streifens der Markierung, in Fensterkoordinaten. */
async function streifenMitte(fenster: Page): Promise<{ x: number; y: number }> {
  const mitte = await fenster.evaluate((selektor) => {
    const flaeche = document.querySelector(selektor)
    if (!(flaeche instanceof HTMLElement)) return null
    const kandidaten = [...flaeche.querySelectorAll('*'), flaeche]
    for (const element of kandidaten) {
      const r = element.getBoundingClientRect()
      if (r.width > 4 && r.height > 4) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
    }
    return null
  }, MARKIERUNG)
  if (mitte === null) throw new Error('Markierung nicht gefunden')
  return mitte
}

test('ein Klick in die Markierung waehlt sie aus und oeffnet die Werkzeugleiste', async () => {
  const fenster = await oeffneAnnotiert()
  await expect(fenster.locator('[data-testid^="auswahlrahmen-"]')).toHaveCount(0)

  const { x, y } = await streifenMitte(fenster)
  await fenster.mouse.click(x, y)

  await expect(fenster.locator('[data-testid^="auswahlrahmen-"]')).toHaveCount(1)
  await expect(fenster.getByTestId('werkzeugleiste')).toBeVisible()
  await expect(fenster.getByTestId('werkzeug-opazitaet')).toBeVisible()
  // Eine Markierung hat keine Eckanfasser.
  await expect(fenster.locator('[data-testid^="griff-"]')).toHaveCount(0)
})

test('die Deckkraft einer ausgewaehlten Markierung laesst sich aendern', async () => {
  const fenster = await oeffneAnnotiert()
  const { x, y } = await streifenMitte(fenster)
  await fenster.mouse.click(x, y)
  await expect(fenster.getByTestId('werkzeug-opazitaet')).toBeVisible()
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)

  await fenster.getByTestId('werkzeug-opazitaet').fill('0.4')

  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()
})

test('Entf loescht die ausgewaehlte Markierung, Strg+Z holt sie zurueck', async () => {
  const fenster = await oeffneAnnotiert()
  const { x, y } = await streifenMitte(fenster)
  await fenster.mouse.click(x, y)
  await expect(fenster.locator('[data-testid^="auswahlrahmen-"]')).toHaveCount(1)

  await fenster.keyboard.press('Delete')

  await expect(fenster.locator(MARKIERUNG)).toHaveCount(0)
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()

  await fenster.keyboard.press('Control+Z')
  await expect(fenster.locator(MARKIERUNG)).toHaveCount(1)
})

test('ein Klick neben die Markierung waehlt nichts aus', async () => {
  const fenster = await oeffneAnnotiert()
  const { x, y } = await streifenMitte(fenster)
  // Weit rechts der Markierung, aber auf der Seite.
  await fenster.mouse.click(x + 300, y + 200)

  await expect(fenster.locator('[data-testid^="auswahlrahmen-"]')).toHaveCount(0)
})
