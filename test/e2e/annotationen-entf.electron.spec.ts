import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * Entf loescht Textfelder und Notizen - auch dann, wenn ihr Eingabefeld den
 * Fokus hat (frisch gesetzt oder angeklickt). Die Regel selbst steht in
 * `test/unit/entf.test.ts`; hier geht es um die Verdrahtung in der gebauten
 * Anwendung und darum, dass Strg+Z das Loeschen zuruecknimmt.
 */
let gestartet: GestarteteApp
let verzeichnis: string

test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-entf-'))
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffne(name: string): Promise<Page> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/single-page.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', {
    timeout: 20000
  })
  return gestartet.fenster
}

const KASTEN = '[data-testid^="freitextfeld-"]'
const GREIFFLAECHE = '[data-testid^="greifflaeche-"]'
const ZETTEL = '[data-testid^="annotation-notizzettel-"]'

test('Entf loescht ein frisch gesetztes, leeres Textfeld', async () => {
  const fenster = await oeffne('textfeld-leer.pdf')
  await waehleWerkzeug(fenster, 'text')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  await expect(fenster.locator(KASTEN)).toHaveCount(1)

  await fenster.keyboard.press('Delete')

  await expect(fenster.locator(KASTEN)).toHaveCount(0)
  await expect(fenster.locator(GREIFFLAECHE)).toHaveCount(0)
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)
})

test('Entf loescht ein angeklicktes Textfeld mit Text und Strg+Z holt es zurueck', async () => {
  const fenster = await oeffne('textfeld-text.pdf')
  await waehleWerkzeug(fenster, 'text')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  await fenster.locator(KASTEN).fill('Hallo')
  await waehleWerkzeug(fenster, 'auswahl')
  await fenster.locator(GREIFFLAECHE).first().click()
  await expect(fenster.locator(KASTEN)).toHaveCount(1)

  await fenster.keyboard.press('Delete')
  await expect(fenster.locator(GREIFFLAECHE)).toHaveCount(0)

  // Das Loeschen steht in der Historie.
  await fenster.locator('body').click({ position: { x: 5, y: 5 } })
  await fenster.keyboard.press('Control+Z')
  await expect(fenster.locator(GREIFFLAECHE)).toHaveCount(1)
})

test('Entf mitten im Text loescht nur ein Zeichen', async () => {
  const fenster = await oeffne('textfeld-mitte.pdf')
  await waehleWerkzeug(fenster, 'text')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  const kasten = fenster.locator(KASTEN)
  await kasten.fill('Hallo')
  // Einfuegemarke an den Anfang: Entf loescht das "H".
  await kasten.press('Home')
  await kasten.press('Delete')

  await expect(kasten).toHaveValue('allo')
  await expect(fenster.locator(GREIFFLAECHE)).toHaveCount(1)
})

test('Entf loescht eine frisch gesetzte Notiz', async () => {
  const fenster = await oeffne('notiz-leer.pdf')
  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  await expect(fenster.locator(ZETTEL)).toHaveCount(1)

  await fenster.keyboard.press('Delete')

  await expect(fenster.locator(ZETTEL)).toHaveCount(0)
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)
})

test('Entf loescht eine Notiz mit Text, wenn die Einfuegemarke am Ende steht', async () => {
  const fenster = await oeffne('notiz-text.pdf')
  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  const eingabe = fenster.locator('[data-testid^="annotation-notiz-eingabe-"]')
  await eingabe.fill('Merke')

  await fenster.keyboard.press('Delete')

  await expect(fenster.locator(ZETTEL)).toHaveCount(0)
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)
})
