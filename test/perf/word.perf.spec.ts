import { copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from '../e2e/launchApp'

/**
 * S6.7, Exit-Kriterium: `large-heavy.pdf` (300 Seiten, je ein Rauschbild
 * und zwei Zeilen Text, rund 65 MB) exportiert ohne Absturz innerhalb eines
 * Budgets. Gemessen wird Klick bis Hinweis - Lesen aller Seiten mit pdf.js,
 * 300 Bilder als PNG, Uebergabe an den Main, `.docx` bauen und schreiben.
 *
 * Das Budget ist aus der Messung im Schritt abgeleitet (siehe Plan,
 * Aenderungshistorie S6.7) mit reichlich Abstand fuer Akkubetrieb - wie beim
 * Mutationsbudget misst ein knappes Budget sonst die Steckdose.
 */
const SCHWER = resolve('test/fixtures/large-heavy.pdf')
const vorhanden = existsSync(SCHWER)

/** Gemessen im Schritt: 8,0 s am Netz (74 MB `.docx`); das Budget laesst 2,5-fach Luft. */
export const BUDGET_WORD_MS = 20_000

let gestartet: GestarteteApp

test.afterEach(async () => {
  if (vorhanden) await gestartet.schliessen()
})

test('large-heavy.pdf nach Word bleibt im Budget', async () => {
  test.skip(
    !vorhanden,
    'test/fixtures/large-heavy.pdf fehlt. Erzeugen mit: npm run fixtures (rund 65 MB, nicht eingecheckt).'
  )
  test.setTimeout(BUDGET_WORD_MS * 3)
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-perf-word-'))
  const kopie = join(verzeichnis, 'schwer.pdf')
  copyFileSync(SCHWER, kopie)
  const ziel = join(verzeichnis, 'schwer.docx')
  gestartet = await startApp([kopie])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 30000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, ziel)

  await fenster.keyboard.press('Control+Shift+J')
  const start = Date.now()
  await fenster.getByTestId('word-ausfuehren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Als Word-Dokument exportiert', {
    timeout: BUDGET_WORD_MS * 2
  })
  const dauer = Date.now() - start
  const groesse = statSync(ziel).size
  console.log(
    '  Word-Export large-heavy.pdf nach ' +
      String(dauer) +
      ' ms, ' +
      (groesse / 1024 / 1024).toFixed(1) +
      ' MB'
  )
  expect(dauer).toBeLessThan(BUDGET_WORD_MS)
  expect(gestartet.meldungen().filter((m) => m.startsWith('pageerror'))).toEqual([])
})
