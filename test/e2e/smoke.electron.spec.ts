import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

let gestartet: GestarteteApp

test.beforeEach(async () => {
  gestartet = await startApp()
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('startet aus dem Produktionsbuild und zeigt die Oberflaeche', async () => {
  await expect(gestartet.fenster.getByRole('button', { name: 'Datei öffnen' })).toBeVisible()
  expect(await gestartet.fenster.title()).toBe('paperlane')
})

test('meldet keine unerwarteten Konsolenausgaben', async () => {
  await gestartet.fenster.waitForTimeout(1500)
  expect(gestartet.meldungen()).toEqual([])
})
