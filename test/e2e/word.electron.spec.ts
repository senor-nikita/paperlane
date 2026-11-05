import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import mammoth from 'mammoth'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S6.7 - PDF nach Word durch die gebaute Anwendung: echtes pdf.js, echtes
 * Canvas fuer die Bilder, echter Main mit `docx`. Das Exit-Kriterium: die
 * Fixture mit Text, Ueberschriften und zwei Bildern ergibt eine `.docx` mit
 * vollstaendiger Textfolge und beiden Bildern. Zurueckgelesen wird mit
 * mammoth, einem zweiten, unabhaengigen Leser. Der Speichern-Dialog ist
 * modal und wird ersetzt (wie in S4.2b).
 */

let gestartet: GestarteteApp
let verzeichnis: string

test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-word-'))
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('exportiert word.pdf mit Ueberschriften, Absaetzen und beiden Bildern', async () => {
  const quelle = join(verzeichnis, 'bericht.pdf')
  copyFileSync(resolve('test/fixtures/word.pdf'), quelle)
  const ziel = join(verzeichnis, 'bericht.docx')

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, ziel)

  await fenster.keyboard.press('Control+Shift+J')
  await expect(fenster.getByTestId('word')).toBeVisible()
  await expect(fenster.getByTestId('word-grenzen')).toContainText('Tabellen')
  await expect(fenster.getByTestId('word-kein-text')).toHaveCount(0)
  await fenster.getByTestId('word-ausfuehren').click()

  await expect(fenster.getByTestId('hinweis')).toContainText(
    'Als Word-Dokument exportiert: bericht.docx',
    { timeout: 30000 }
  )
  await expect(fenster.getByTestId('word')).toHaveCount(0)

  const html = (await mammoth.convertToHtml({ path: ziel })).value
  expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(2)
  const text = html
    .replace(/<img [^>]*>/g, '[Bild]')
    .replace(/<\/(p|h\d)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
    .split('\n')
  expect(text).toEqual([
    'Bericht zur Messreihe',
    'Dieser Bericht fasst die Ergebnisse der ersten Messreihe zusammen. Die Werte wurden ' +
      'an drei Tagen erhoben und stimmen gut mit der Erwartung ueberein.',
    '[Bild]',
    'Methode',
    'Gemessen wurde mit einem geeichten Geraet. Jeder Wert ist der Mittelwert aus fuenf ' +
      'Einzelmessungen.',
    'Hinweis: Ausreisser wurden nicht entfernt.',
    'Ergebnis',
    'Die Abweichung liegt unter zwei Prozent.',
    '[Bild]',
    'Damit ist die Messreihe abgeschlossen.'
  ])
  expect(html).toContain('<h1><strong>Bericht zur Messreihe</strong></h1>')
  expect(html).toContain('<h2><strong>Methode</strong></h2>')
  expect(gestartet.meldungen().filter((m) => m.startsWith('error'))).toEqual([])
})

test('warnt vor dem Export, wenn das Dokument keine Textebene hat', async () => {
  const quelle = join(verzeichnis, 'scan.pdf')
  copyFileSync(resolve('test/fixtures/scanned.pdf'), quelle)

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await fenster.keyboard.press('Control+Shift+J')
  await expect(fenster.getByTestId('word-kein-text')).toContainText('keine Textebene')
  await fenster.getByTestId('word-abbrechen').click()
  await expect(fenster.getByTestId('word')).toHaveCount(0)
})
