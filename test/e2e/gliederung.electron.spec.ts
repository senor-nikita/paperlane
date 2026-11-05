import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffneGliederung(): Promise<void> {
  gestartet = await startApp([resolve('test/fixtures/outline.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="reiter-gliederung"]', { timeout: 20000 })
  await gestartet.fenster.getByTestId('reiter-gliederung').click()
}

test('zeigt die Gliederung des Dokuments als Baum', async () => {
  await oeffneGliederung()
  await expect(gestartet.fenster.getByTestId('gliederung-eintrag-0')).toHaveText('Kapitel 1')
  await expect(gestartet.fenster.getByTestId('gliederung-eintrag-1')).toHaveText('Kapitel 2')
  // Der erste Zweig ist offen, sein Unterpunkt also sichtbar.
  await expect(gestartet.fenster.getByTestId('gliederung-eintrag-0.0')).toHaveText('Abschnitt 1.1')
})

test('klappt einen Zweig zu und wieder auf', async () => {
  await oeffneGliederung()
  await gestartet.fenster.getByTestId('gliederung-klappe-0').click()
  await expect(gestartet.fenster.getByTestId('gliederung-eintrag-0.0')).toBeHidden()
  await gestartet.fenster.getByTestId('gliederung-klappe-0').click()
  await expect(gestartet.fenster.getByTestId('gliederung-eintrag-0.1')).toHaveText('Abschnitt 1.2')
})

/**
 * Exit-Kriterium des Schritts: der Sprung landet auf der richtigen Seite und
 * an der richtigen Stelle. "Kapitel 2" nennt ein FitR-Rechteck auf Seite vier.
 */
test('springt ueber ein FitR-Ziel auf die richtige Seite', async () => {
  await oeffneGliederung()
  await gestartet.fenster.getByTestId('gliederung-eintrag-1').click()
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).toHaveValue('4', {
    timeout: 15000
  })
})

// "Abschnitt 1.2" verweist nicht direkt, sondern ueber einen benannten Eintrag
// in der Namenstabelle auf Seite drei.
test('springt ueber ein benanntes Ziel auf die richtige Seite', async () => {
  await oeffneGliederung()
  await gestartet.fenster.getByTestId('gliederung-eintrag-0.1').click()
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).toHaveValue('3', {
    timeout: 15000
  })
})

// Das Ziel nennt eine Stelle mitten auf der Seite; ein Sprung auf den
// Seitenanfang waere nur die halbe Miete.
test('landet an der Stelle, die das Ziel nennt, nicht am Seitenanfang', async () => {
  await oeffneGliederung()
  await gestartet.fenster.getByTestId('gliederung-eintrag-0.1').click()
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).toHaveValue('3', {
    timeout: 15000
  })
  const versatz = await gestartet.fenster.evaluate(() => {
    const behaelter = document.querySelector('[data-testid="ansicht"]')
    const seite = document.querySelector('[data-testid="seite-3"]')
    if (!(behaelter instanceof HTMLElement) || !(seite instanceof HTMLElement)) return null
    return behaelter.scrollTop - seite.offsetTop
  })
  expect(versatz).not.toBeNull()
  // XYZ mit oben = 400 auf einer 842 Punkt hohen Seite: gut die Haelfte hinein.
  expect(versatz ?? 0).toBeGreaterThan(0)
})

// Aufgabe 3: fehlt die Gliederung, wird der Bereich ausgeblendet statt leer
// angezeigt.
test('blendet den Bereich aus, wenn das Dokument keine Gliederung hat', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="miniaturen"]', { timeout: 20000 })
  await expect(gestartet.fenster.getByTestId('reiter-gliederung')).toHaveCount(0)
  // Die uebrigen Reiter bleiben: seit S2.1 gibt es den Bereich "Anmerkungen"
  // in jedem Dokument, und mit ihm eine Leiste, in der die Miniaturen stehen.
  await expect(gestartet.fenster.getByTestId('reiter-miniaturen')).toHaveCount(1)
  await expect(gestartet.fenster.getByTestId('reiter-anmerkungen')).toHaveCount(1)
})
