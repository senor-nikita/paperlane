import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * Oberflaechensprache (S6.8). Exit-Kriterien: ein englisches System startet
 * englisch, ein deutsches deutsch; das Umschalten in den Einstellungen wirkt
 * sofort auf Oberflaeche und Menue; eine Stichprobe von Ablaeufen laeuft auf
 * Englisch.
 *
 * Die Systemsprache kommt ueber Chromiums `--lang`: derselbe Weg, auf dem
 * `app.getLocale()` sonst die Sprache des Betriebssystems liefert.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function menue(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((eintrag) => eintrag.label)
  )
}

async function sprache(fenster: Page): Promise<string> {
  return fenster.evaluate(() => document.documentElement.lang)
}

test('ein englisches System startet englisch', async () => {
  gestartet = await startApp(['--lang=en-US'])
  const { app, fenster } = gestartet
  await expect(fenster.getByRole('button', { name: 'Open File' })).toBeVisible()
  await expect(fenster.getByTestId('ansicht')).toContainText('No document open.')
  expect(await sprache(fenster)).toBe('en')
  expect(await menue(app)).toEqual(['File', 'Edit', 'View', 'Help'])
})

test('ein deutsches System startet deutsch', async () => {
  gestartet = await startApp(['--lang=de-AT'])
  const { app, fenster } = gestartet
  await expect(fenster.getByRole('button', { name: 'Datei öffnen' })).toBeVisible()
  expect(await sprache(fenster)).toBe('de')
  expect(await menue(app)).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Hilfe'])
})

test('die Wahl in den Einstellungen wirkt sofort und bleibt ueber einen Neustart', async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-sprache-'))
  gestartet = await startApp(['--lang=de-DE', '--user-data-dir=' + verzeichnis])
  const { app, fenster } = gestartet
  await expect(fenster.getByRole('button', { name: 'Datei öffnen' })).toBeVisible()

  await fenster.keyboard.press('Control+,')
  await fenster.getByTestId('einstellungen-sprache').selectOption('en')
  await fenster.getByTestId('einstellungen-speichern').click()

  await expect(fenster.getByRole('button', { name: 'Open File' })).toBeVisible()
  await expect(fenster.getByTestId('hinweis')).toContainText('Settings saved.')
  expect(await sprache(fenster)).toBe('en')
  await expect.poll(() => menue(app)).toEqual(['File', 'Edit', 'View', 'Help'])
  await gestartet.schliessen()

  // Eine ausdrueckliche Wahl schlaegt die Systemsprache.
  gestartet = await startApp(['--lang=de-DE', '--user-data-dir=' + verzeichnis])
  await expect(gestartet.fenster.getByRole('button', { name: 'Open File' })).toBeVisible()
  expect(await menue(gestartet.app)).toEqual(['File', 'Edit', 'View', 'Help'])
})

test('Stichprobe auf Englisch: Blaettern, Suche und Tastenkuerzel', async () => {
  gestartet = await startApp(['--lang=en-US', resolve('test/fixtures/large-500.pdf')])
  const { fenster } = gestartet
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('of 500', { timeout: 20000 })

  await fenster.getByTestId('such-eingabe').fill('Wasserzeichen')
  await fenster.getByTestId('such-eingabe').press('Enter')
  await expect(fenster.getByTestId('treffer-anzeige')).toHaveText('1 of 50', { timeout: 30000 })
  await fenster.getByRole('button', { name: 'next match' }).click()
  await expect(fenster.getByTestId('treffer-anzeige')).toHaveText('2 of 50')

  await fenster.keyboard.press('F1')
  const oeffnen = fenster.getByTestId('kuerzel-oeffnen')
  await expect(oeffnen).toContainText('Open Document')
  await expect(oeffnen).toContainText('Ctrl + O')
  await expect(fenster.getByTestId('kuerzel-seiteLoeschen')).toContainText('Ctrl + Shift + Del')
})

test('Stichprobe auf Englisch: Fehlermeldung und Passwortabfrage', async () => {
  gestartet = await startApp(['--lang=en-US', resolve('test/fixtures/corrupt.pdf')])
  const meldung = gestartet.fenster.getByTestId('fehlermeldung')
  await expect(meldung).toContainText('The document could not be opened', { timeout: 20000 })
  await expect(meldung).toContainText('choose another document')
  await gestartet.schliessen()

  gestartet = await startApp(['--lang=en-US', resolve('test/fixtures/encrypted.pdf')])
  const abfrage = gestartet.fenster.getByTestId('passwort-abfrage')
  await expect(abfrage).toContainText('This document is password-protected.', { timeout: 20000 })
  await gestartet.fenster.getByTestId('passwort-feld').fill('falsch')
  await gestartet.fenster.getByTestId('passwort-ok').click()
  await expect(abfrage).toContainText('The password was wrong.', { timeout: 20000 })
})

test('Stichprobe auf Englisch: Seitenwerkzeuge und Hinweis', async () => {
  gestartet = await startApp(['--lang=en-US', resolve('test/fixtures/single-page.pdf')])
  const { fenster } = gestartet
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  await expect(fenster.getByTestId('seitenwerkzeuge-stand')).toHaveText('current page')
  // Die einzige Seite laesst sich nicht loeschen - der Grund steht englisch da.
  await fenster.keyboard.press('Control+Shift+Delete')
  await expect(fenster.getByTestId('hinweis')).toContainText('The last page cannot be deleted.')
})
