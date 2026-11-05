import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp } from './launchApp'

/**
 * Sitzungswiederherstellung. Die Anwendung laeuft mit eigenem
 * --user-data-dir, damit die Tests nicht die echten Einstellungen
 * ueberschreiben.
 */
test('Fenstergeometrie ueberlebt einen Neustart', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-sitzung-'))
  const argumente = ['--user-data-dir=' + datenverzeichnis]

  const erste = await startApp(argumente)
  try {
    await erste.app.evaluate(async ({ BrowserWindow }) => {
      const [fenster] = BrowserWindow.getAllWindows()
      fenster?.setBounds({ x: 120, y: 90, width: 900, height: 640 })
      // Kurz warten, damit Electron die Aenderung uebernimmt.
      await new Promise((fertig) => setTimeout(fertig, 300))
    })
  } finally {
    await erste.schliessen()
  }

  const zweite = await startApp(argumente)
  try {
    const masse = await zweite.app.evaluate(({ BrowserWindow }) => {
      const [fenster] = BrowserWindow.getAllWindows()
      return fenster?.getBounds() ?? null
    })
    expect(masse).not.toBeNull()
    expect(masse!.width).toBe(900)
    expect(masse!.height).toBe(640)
  } finally {
    await zweite.schliessen()
  }
})

test('die zuletzt gelesene Seite wird wiederhergestellt', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-lesen-'))
  const argumente = ['--user-data-dir=' + datenverzeichnis, resolve('test/fixtures/large-500.pdf')]

  const erste = await startApp(argumente)
  try {
    await erste.fenster.waitForSelector('[data-testid="seiten-eingabe"]', { timeout: 20000 })
    const feld = erste.fenster.getByTestId('seiten-eingabe')
    await feld.fill('42')
    await feld.press('Enter')
    await expect(feld).toHaveValue('42')
    // Das Sichern laeuft verzoegert, damit nicht bei jedem Scrollschritt
    // geschrieben wird.
    await erste.fenster.waitForTimeout(2500)
  } finally {
    await erste.schliessen()
  }

  const zweite = await startApp(argumente)
  try {
    await zweite.fenster.waitForSelector('[data-testid="seiten-eingabe"]', { timeout: 20000 })
    await expect(zweite.fenster.getByTestId('seiten-eingabe')).toHaveValue('42', { timeout: 15000 })
  } finally {
    await zweite.schliessen()
  }
})
