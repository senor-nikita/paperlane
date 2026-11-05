import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S4.2b — PNG-Export durch die gebaute Anwendung, mit echtem Canvas.
 *
 * Die beiden Exit-Kriterien des Schritts: 300 DPI ergeben die erwartete
 * Pixelgroesse, und eine Aufloesung ueber dem Canvas-Limit schlaegt nicht
 * still fehl, sondern liefert ein begrenztes Bild samt Meldung. Die Dialoge
 * des Main sind modal und werden durch Attrappen ersetzt (wie in S4.2a).
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-png-'))
})

/** Breite und Hoehe aus dem IHDR-Chunk, der in jedem PNG an Byte 16 beginnt. */
function pngMasse(pfad: string): { breite: number; hoehe: number } {
  const bytes = readFileSync(pfad)
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return { breite: bytes.readUInt32BE(16), hoehe: bytes.readUInt32BE(20) }
}

test('exportiert die aktuelle Seite bei 300 DPI in der erwarteten Pixelgroesse', async () => {
  const quelle = join(verzeichnis, 'seite.pdf')
  copyFileSync(resolve('test/fixtures/annotated.pdf'), quelle)
  const ziel = join(verzeichnis, 'seite-S1.png')
  const { width, height } = (await PDFDocument.load(new Uint8Array(readFileSync(quelle))))
    .getPage(0)
    .getSize()

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, ziel)

  await fenster.keyboard.press('Control+Shift+P')
  await expect(fenster.getByTestId('png')).toBeVisible()
  await fenster.getByTestId('png-dpi').fill('300')
  await expect(fenster.getByTestId('png-masse')).toHaveText(
    String(Math.floor((width * 300) / 72)) +
      ' × ' +
      String(Math.floor((height * 300) / 72)) +
      ' Pixel'
  )
  await fenster.getByTestId('png-ausfuehren').click()

  await expect(fenster.getByTestId('hinweis')).toContainText('Bild geschrieben: seite-S1.png', {
    timeout: 30000
  })
  await expect(fenster.getByTestId('png')).toHaveCount(0)
  expect(pngMasse(ziel)).toEqual({
    breite: Math.floor((width * 300) / 72),
    hoehe: Math.floor((height * 300) / 72)
  })
})

test('begrenzt eine Aufloesung ueber dem Canvas-Limit und sagt es', async () => {
  // Eine 200 Zoll breite, einen Zoll hohe Seite: bei 300 DPI waere das
  // Bild 60000 Pixel breit. Das Limit von 16384 Pixeln greift schon bei
  // 81 DPI - und das Bild bleibt klein genug fuer jeden Testrechner.
  const quelle = join(verzeichnis, 'breit.pdf')
  const doc = await PDFDocument.create()
  const seite = doc.addPage([14400, 72])
  seite.drawRectangle({ x: 0, y: 0, width: 7200, height: 72 })
  writeFileSync(quelle, await doc.save())
  const ziel = join(verzeichnis, 'breit-S1.png')

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, ziel)

  await fenster.keyboard.press('Control+Shift+P')
  await fenster.getByTestId('png-dpi').fill('300')
  await expect(fenster.getByTestId('png-masse')).toContainText('Höchstens 81 DPI')
  await fenster.getByTestId('png-ausfuehren').click()

  await expect(fenster.getByTestId('hinweis')).toContainText(
    'Die Auflösung wurde auf 81 DPI begrenzt',
    { timeout: 30000 }
  )
  const masse = pngMasse(ziel)
  expect(masse.breite).toBeLessThanOrEqual(16384)
  expect(masse).toEqual({ breite: Math.floor((14400 * 81) / 72), hoehe: 81 })
})

test('exportiert Bereiche als Dateien in einen gewaehlten Ordner', async () => {
  const quelle = join(verzeichnis, 'bereich.pdf')
  const ordner = join(verzeichnis, 'bilder')
  copyFileSync(resolve('test/fixtures/annotated.pdf'), quelle)

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [pfad] })
  }, ordner)

  await fenster.keyboard.press('Control+Shift+P')
  await fenster.getByTestId('png-bereiche').check()
  await fenster.getByTestId('png-bereiche-eingabe').fill('1-2')
  await expect(fenster.getByTestId('png-bereiche-hinweis')).toHaveText('2 Bilder: 1-2')
  await fenster.getByTestId('png-dpi').fill('72')
  await fenster.getByTestId('png-ausfuehren').click()

  await expect(fenster.getByTestId('hinweis')).toContainText('2 Bilder geschrieben nach', {
    timeout: 30000
  })
  for (const name of ['bereich-S1.png', 'bereich-S2.png']) {
    const pfad = join(ordner, name)
    expect(existsSync(pfad)).toBe(true)
    expect(pngMasse(pfad).breite).toBeGreaterThan(100)
  }
})
