import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S6.4 — Bilder zu PDF durch die gebaute Anwendung.
 *
 * Wie bei `zusammenfuehren.electron.spec.ts`: die Dialoge des Main sind modal
 * und werden durch Attrappen ersetzt, die die Testpfade liefern. Die
 * EXIF-Auswertung und die Formatumwandlung laufen echt im Renderer
 * (`createImageBitmap`/Canvas) - das ist genau der Teil, der hier zaehlt.
 */

let gestartet: GestarteteApp
let verzeichnis: string

test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-bilder-'))
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('drei Bilder unterschiedlicher Formate ergeben ein dreiseitiges PDF in Reihenfolge', async () => {
  test.setTimeout(60000)
  const png = resolve('test/fixtures/bilder/bild-a.png')
  const jpg = resolve('test/fixtures/bilder/bild-b.jpg')
  const bmp = resolve('test/fixtures/bilder/bild-c.bmp')
  const ziel = join(verzeichnis, 'aus-bildern.pdf')

  gestartet = await startApp()
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="ansicht"]', { timeout: 20000 })

  await gestartet.app.evaluate(
    ({ dialog }, arg) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: arg.quellen })
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: arg.ziel })
    },
    { quellen: [png, jpg, bmp], ziel }
  )

  await fenster.keyboard.press('Control+Shift+I')
  await expect(fenster.getByTestId('bilder-zu-pdf')).toBeVisible()
  await expect(fenster.getByTestId('bilder-zu-pdf-eintrag-1')).toBeVisible({ timeout: 20000 })
  await expect(fenster.getByTestId('bilder-zu-pdf-eintrag-2')).toBeVisible()
  await expect(fenster.getByTestId('bilder-zu-pdf-eintrag-3')).toBeVisible()
  // Alle drei muessen die Normalisierung (EXIF/Canvas) durchlaufen haben.
  for (const n of [1, 2, 3]) {
    await expect(fenster.getByTestId('bilder-zu-pdf-eintrag-' + String(n))).toContainText(
      'bereit',
      { timeout: 20000 }
    )
  }

  await fenster.getByTestId('bilder-zu-pdf-ausfuehren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Als PDF erstellt', {
    timeout: 30000
  })
  await expect(fenster.getByTestId('bilder-zu-pdf')).toHaveCount(0)
  // Das Ergebnis ist geoeffnet (S6.1-Tab).
  await expect(fenster.getByTestId('dokument-name')).toHaveText('aus-bildern.pdf', {
    timeout: 20000
  })

  const doc = await PDFDocument.load(new Uint8Array(readFileSync(ziel)))
  expect(doc.getPageCount()).toBe(3)
  // "Wie das Bild" (Standard): die Seiten unterscheiden sich in der Groesse -
  // Beleg, dass alle drei Formate tatsaechlich eingebettet wurden, nicht nur
  // eines wiederholt.
  const groessen = doc.getPages().map((s) => s.getSize())
  expect(new Set(groessen.map((g) => g.width + 'x' + g.height)).size).toBe(3)
})

test('ein hochkant fotografiertes JPEG (EXIF-Drehung) steht im Ergebnis aufrecht', async () => {
  test.setTimeout(60000)
  // Orientation 6 ("rotate 90° CW" beim Anzeigen): das rohe Bild ist breiter
  // als hoch (32x16, R17-Fixture), nach der Drehung muss es hoeher als breit
  // sein - genau das behauptet R17.
  const quelle = resolve('test/fixtures/bilder/exif/orientation-6.jpg')
  const ziel = join(verzeichnis, 'hochkant.pdf')

  gestartet = await startApp()
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="ansicht"]', { timeout: 20000 })
  await gestartet.app.evaluate(
    ({ dialog }, pfade) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [pfade.quelle] })
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfade.ziel })
    },
    { quelle, ziel }
  )

  await fenster.keyboard.press('Control+Shift+I')
  await expect(fenster.getByTestId('bilder-zu-pdf-eintrag-1')).toContainText('bereit', {
    timeout: 20000
  })
  await fenster.getByTestId('bilder-zu-pdf-ausfuehren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Als PDF erstellt', {
    timeout: 30000
  })

  const doc = await PDFDocument.load(new Uint8Array(readFileSync(ziel)))
  const { width, height } = doc.getPage(0).getSize()
  expect(height).toBeGreaterThan(width)
})

/**
 * R17, Fixtures fuer alle acht Orientierungen: 5-8 drehen beim Anzeigen um
 * 90°/270° und vertauschen damit Breite und Hoehe, 1-4 nicht. Das ist die
 * beobachtbare Wirkung von `imageOrientation: 'from-image'` und laesst sich
 * ohne Pixelvergleich am Seitenverhaeltnis der erzeugten PDF-Seiten pruefen.
 */
test('alle acht EXIF-Orientierungen: Seitenverhaeltnis stimmt mit der erwarteten Drehung ueberein', async () => {
  test.setTimeout(60000)
  const pfade = Array.from({ length: 8 }, (_, i) =>
    resolve('test/fixtures/bilder/exif/orientation-' + String(i + 1) + '.jpg')
  )
  const ziel = join(verzeichnis, 'orientierungen.pdf')

  gestartet = await startApp()
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="ansicht"]', { timeout: 20000 })
  await gestartet.app.evaluate(
    ({ dialog }, arg) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: arg.pfade })
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: arg.ziel })
    },
    { pfade, ziel }
  )

  await fenster.keyboard.press('Control+Shift+I')
  for (let n = 1; n <= 8; n++) {
    await expect(fenster.getByTestId('bilder-zu-pdf-eintrag-' + String(n))).toContainText(
      'bereit',
      { timeout: 20000 }
    )
  }
  await fenster.getByTestId('bilder-zu-pdf-ausfuehren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Als PDF erstellt', {
    timeout: 30000
  })

  const doc = await PDFDocument.load(new Uint8Array(readFileSync(ziel)))
  expect(doc.getPageCount()).toBe(8)
  for (let i = 0; i < 8; i++) {
    const orientation = i + 1
    const { width, height } = doc.getPage(i).getSize()
    const vertauscht = orientation >= 5
    if (vertauscht) {
      expect(height, 'Orientation ' + String(orientation)).toBeGreaterThan(width)
    } else {
      expect(width, 'Orientation ' + String(orientation)).toBeGreaterThan(height)
    }
  }
})
