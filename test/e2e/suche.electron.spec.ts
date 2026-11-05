import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('findet alle Vorkommen im ganzen Dokument', async () => {
  // large-500.pdf traegt den Suchbegriff auf jeder zehnten Seite, also
  // genau 50 Mal.
  gestartet = await startApp([resolve('test/fixtures/large-500.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="such-eingabe"]', { timeout: 20000 })
  await gestartet.fenster.getByTestId('such-eingabe').fill('Wasserzeichen')
  await gestartet.fenster.getByTestId('such-eingabe').press('Enter')
  await expect(gestartet.fenster.getByTestId('treffer-anzeige')).toHaveText('1 von 50', {
    timeout: 30000
  })
})

test('springt zum naechsten Treffer und markiert ihn', async () => {
  gestartet = await startApp([resolve('test/fixtures/large-500.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="such-eingabe"]', { timeout: 20000 })
  await gestartet.fenster.getByTestId('such-eingabe').fill('Wasserzeichen')
  await gestartet.fenster.getByTestId('such-eingabe').press('Enter')
  await expect(gestartet.fenster.getByTestId('treffer-anzeige')).toHaveText('1 von 50', {
    timeout: 30000
  })

  // Der erste Treffer liegt auf Seite 10.
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).toHaveValue('10', {
    timeout: 15000
  })
  await expect(gestartet.fenster.getByTestId('treffer-aktiv').first()).toBeVisible({
    timeout: 15000
  })

  await gestartet.fenster.getByRole('button', { name: 'nächster' }).click()
  await expect(gestartet.fenster.getByTestId('treffer-anzeige')).toHaveText('2 von 50')
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).toHaveValue('20', {
    timeout: 15000
  })
})

test('die Textebene erlaubt Auswahl', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="textebene-1"] span', { timeout: 20000 })
  const text = await gestartet.fenster.evaluate(() => {
    const ebene = document.querySelector('[data-testid="textebene-1"]')
    return ebene?.textContent ?? ''
  })
  expect(text).toContain('Wasserzeichen')
})

test('meldet ein Dokument ohne durchsuchbaren Text', async () => {
  // scanned.pdf ist ein reines Bild. Ein stiller Nulltreffer waere hier
  // irrefuehrend - der Text ist nicht abwesend, er ist nur nicht als Text da.
  gestartet = await startApp([resolve('test/fixtures/scanned.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="such-eingabe"]', { timeout: 20000 })
  await gestartet.fenster.getByTestId('such-eingabe').fill('irgendwas')
  await gestartet.fenster.getByTestId('such-eingabe').press('Enter')
  await expect(gestartet.fenster.getByTestId('kein-text-hinweis')).toBeVisible({ timeout: 20000 })
})
