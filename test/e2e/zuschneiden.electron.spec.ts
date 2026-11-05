import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { degrees, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * S6.3 — Seiten zuschneiden durch die gebaute Anwendung.
 *
 * Der schwierigste Fall in einem Durchgang: eine Seite mit `/Rotate 90` und
 * einer schon vorhandenen CropBox, deren Ursprung nicht bei 0,0 liegt. Der
 * Rahmen wird aufgezogen und dann in mm eingetippt, damit das Ergebnis
 * vorhersagbar ist. Geprueft wird - nicht angenommen -, dass der eigene
 * Viewer, der PNG-Export (S4.2b) und die Druckvorlage (S4.3) den Zuschnitt
 * zeigen, und dass Rueckgaengig die urspruengliche Box byte-genau
 * wiederherstellt.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-zuschneiden-'))
})

const MEDIA = [0, 0, 600, 800]
const CROP = [50, 40, 550, 760]
/** Eingetippte Raender in mm, in Bildschirmrichtung. */
const MM = { links: 10, oben: 20, rechts: 30, unten: 40 }
const pt = (mm: number): number => (mm * 72) / 25.4

/**
 * Bei `/Rotate 90` liegt die PDF-Unterkante links und die linke PDF-Kante
 * oben (von Hand hergeleitet, siehe `zuschnitt-rechnung.test.ts`).
 */
const ERWARTET = [
  CROP[0]! + pt(MM.oben),
  CROP[1]! + pt(MM.links),
  CROP[2]! - pt(MM.unten),
  CROP[3]! - pt(MM.rechts)
]
const SICHTBAR_BREITE = CROP[3]! - CROP[1]! - pt(MM.links) - pt(MM.rechts)
const SICHTBAR_HOEHE = CROP[2]! - CROP[0]! - pt(MM.oben) - pt(MM.unten)

async function baueQuelle(pfad: string): Promise<string> {
  const doc = await PDFDocument.create()
  const schrift = await doc.embedFont(StandardFonts.Helvetica)
  const seite = doc.addPage([MEDIA[2]!, MEDIA[3]!])
  seite.drawText('Zuschnitt', { x: 200, y: 400, size: 24, font: schrift })
  seite.setCropBox(CROP[0]!, CROP[1]!, CROP[2]! - CROP[0]!, CROP[3]! - CROP[1]!)
  seite.setRotation(degrees(90))
  writeFileSync(pfad, await doc.save())
  return (await PDFDocument.load(readFileSync(pfad)))
    .getPage(0)
    .node.get(PDFName.of('CropBox'))!
    .toString()
}

function pngMasse(pfad: string): { breite: number; hoehe: number } {
  const bytes = readFileSync(pfad)
  return { breite: bytes.readUInt32BE(16), hoehe: bytes.readUInt32BE(20) }
}

async function seitenverhaeltnis(fenster: Page): Promise<number> {
  const kasten = await fenster.getByTestId('seiten-canvas-1').boundingBox()
  if (kasten === null) throw new Error('kein Canvas')
  return kasten.width / kasten.height
}

async function kasten(pfad: string, name: 'CropBox' | 'MediaBox'): Promise<number[]> {
  const seite = (await PDFDocument.load(readFileSync(pfad))).getPage(0)
  const box = name === 'CropBox' ? seite.getCropBox() : seite.getMediaBox()
  return [box.x, box.y, box.x + box.width, box.y + box.height]
}

test('schneidet eine gedrehte Seite mit versetzter CropBox zu; PNG, Druck und Undo stimmen', async () => {
  test.setTimeout(180000)
  const quelle = join(verzeichnis, 'gedreht.pdf')
  const urspruenglich = await baueQuelle(quelle)
  expect(urspruenglich).toBe('[ 50 40 550 760 ]')

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  await expect(fenster.getByTestId('seiten-canvas-1')).toBeVisible()
  // Vorher: gedreht zeigt die Seite 720 x 500 Punkte (CropBox, nicht MediaBox).
  await expect.poll(() => seitenverhaeltnis(fenster)).toBeCloseTo(720 / 500, 2)

  // Werkzeug ueber das Kuerzel, Hinweis sichtbar.
  await fenster.keyboard.press('Control+Shift+B')
  await expect(fenster.getByTestId('zuschneiden')).toBeVisible()
  await expect(fenster.getByTestId('werkzeug-zuschneiden')).toHaveAttribute('aria-pressed', 'true')
  await expect(fenster.getByTestId('zuschnitt-hinweis')).toHaveText(
    'Ausgeblendete Bereiche bleiben in der Datei enthalten.'
  )

  // Rahmen aufziehen ...
  const flaeche = await fenster.getByTestId('zuschnittflaeche-1').boundingBox()
  if (flaeche === null) throw new Error('keine Zuschnittflaeche')
  await fenster.mouse.move(flaeche.x + 40, flaeche.y + 40)
  await fenster.mouse.down()
  await fenster.mouse.move(flaeche.x + 120, flaeche.y + 100, { steps: 5 })
  await fenster.mouse.move(flaeche.x + 200, flaeche.y + 160, { steps: 5 })
  await fenster.mouse.up()
  await expect(fenster.getByTestId('zuschnittrahmen-1')).toBeVisible()
  await expect(fenster.getByTestId('zuschnitt-stand')).toContainText('Rahmen auf Seite 1')

  // ... und in mm genau festlegen.
  for (const [rand, wert] of Object.entries(MM)) {
    await fenster.getByTestId('zuschnitt-' + rand).fill(String(wert))
  }
  await expect(fenster.getByTestId('zuschnitt-stand')).toHaveText(
    'Rahmen auf Seite 1: ' +
      String(Math.round(((SICHTBAR_BREITE * 25.4) / 72) * 10) / 10).replace('.', ',') +
      ' × ' +
      String(Math.round(((SICHTBAR_HOEHE * 25.4) / 72) * 10) / 10).replace('.', ',') +
      ' mm'
  )
  await fenster.getByTestId('zuschnitt-anwenden').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Seite 1 zuschneiden: angewendet', {
    timeout: 30000
  })
  await expect(fenster.getByTestId('zuschnittrahmen-1')).toHaveCount(0)

  // Der eigene Viewer zeigt genau den Zuschnitt.
  await expect
    .poll(() => seitenverhaeltnis(fenster))
    .toBeCloseTo(SICHTBAR_BREITE / SICHTBAR_HOEHE, 1)

  // PNG-Export bei 72 DPI: ein Pixel je Punkt der sichtbaren Flaeche.
  await fenster.keyboard.press('Escape')
  const bild = join(verzeichnis, 'gedreht-S1.png')
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, bild)
  await fenster.keyboard.press('Control+Shift+P')
  await fenster.getByTestId('png-dpi').fill('72')
  await expect(fenster.getByTestId('png-masse')).toHaveText(
    String(Math.floor(SICHTBAR_BREITE)) + ' × ' + String(Math.floor(SICHTBAR_HOEHE)) + ' Pixel'
  )
  await fenster.getByTestId('png-ausfuehren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Bild geschrieben', { timeout: 30000 })
  expect(pngMasse(bild)).toEqual({
    breite: Math.floor(SICHTBAR_BREITE),
    hoehe: Math.floor(SICHTBAR_HOEHE)
  })

  // Druck: der Chromium-Betrachter bekommt die Druckvorlage als Datei
  // (ADR 0003). `print` wird ersetzt und liest genau diese Datei, solange es
  // sie gibt - so wird geprueft, was PDFium wirklich zu sehen bekommt.
  await gestartet.app.evaluate(({ BrowserWindow }) => {
    const haupt = BrowserWindow.getAllWindows()[0]
    if (haupt === undefined) throw new Error('kein Fenster')
    const proto = Object.getPrototypeOf(haupt.webContents) as {
      print: (optionen: unknown, rueckruf: (ok: boolean, grund: string) => void) => void
    }
    const fs = process.getBuiltinModule('node:fs')
    const url = process.getBuiltinModule('node:url')
    const global = globalThis as { __vorlagen?: string[] }
    global.__vorlagen = []
    proto.print = function (this: { getURL: () => string }, _optionen, rueckruf): void {
      const pfad = url.fileURLToPath(this.getURL())
      global.__vorlagen?.push(fs.readFileSync(pfad).toString('base64'))
      rueckruf(true, '')
    }
  })
  const vorlage = async (nummer: number): Promise<PDFDocument> => {
    const alle = await gestartet.app.evaluate(
      () => (globalThis as { __vorlagen?: string[] }).__vorlagen ?? []
    )
    const base64 = alle[nummer]
    if (base64 === undefined) throw new Error('keine Druckvorlage ' + String(nummer))
    return PDFDocument.load(Buffer.from(base64, 'base64'))
  }

  // Ohne "An Seite anpassen": die CropBox steht in der Vorlage, wie gerechnet.
  await fenster.keyboard.press('Control+P')
  await fenster.getByTestId('drucken-anpassen').uncheck()
  await fenster.getByTestId('drucken-drucker').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Druckauftrag übergeben', {
    timeout: 60000
  })
  const genau = (await vorlage(0)).getPage(0)
  const box = genau.getCropBox()
  const ist = [box.x, box.y, box.x + box.width, box.y + box.height]
  ERWARTET.forEach((wert, i) => {
    expect(ist[i]).toBeCloseTo(wert, 2)
  })
  expect(genau.getRotation().angle).toBe(90)

  // Mit der Standardeinstellung "An Seite anpassen" - vor S6.3 setzte sie
  // die CropBox auf das ganze Blatt und der Zuschnitt war im Druck weg.
  await fenster.keyboard.press('Control+P')
  await fenster.getByTestId('drucken-anpassen').check()
  await fenster.getByTestId('drucken-drucker').click()
  await expect
    .poll(
      async () =>
        (await gestartet.app.evaluate(() => (globalThis as { __vorlagen?: string[] }).__vorlagen))
          ?.length
    )
    .toBe(2)
  const blatt = (await vorlage(1)).getPage(0).getCropBox()
  expect(blatt.width).toBeCloseTo(SICHTBAR_HOEHE, 2)
  expect(blatt.height).toBeCloseTo(SICHTBAR_BREITE, 2)

  // Rueckgaengig: die Ansicht zeigt wieder die alte Box ...
  await fenster.keyboard.press('Control+Z')
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0, { timeout: 30000 })
  await expect.poll(() => seitenverhaeltnis(fenster)).toBeCloseTo(720 / 500, 2)

  // ... und in der Datei steht sie byte-genau wie vorher. Eine Notiz sorgt
  // dafuer, dass gespeichert wird - aus dem wiederhergestellten Stand.
  await waehleWerkzeug(fenster, 'notiz')
  await fenster.waitForSelector('[data-testid="zeichenflaeche-1"]', { timeout: 20000 })
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 100, y: 100 } })
  await expect(fenster.locator('[data-annotation-typ="Text"]')).toHaveCount(1)
  await gestartet.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
  })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 30000 })
  const gespeichert = (await PDFDocument.load(readFileSync(quelle))).getPage(0)
  expect(gespeichert.node.get(PDFName.of('CropBox'))!.toString()).toBe(urspruenglich)
  expect(gespeichert.getRotation().angle).toBe(90)
  expect(gespeichert.node.Annots()?.size()).toBe(1)
})

test('hebt einen Zuschnitt auf und speichert die MediaBox als CropBox', async () => {
  test.setTimeout(90000)
  const quelle = join(verzeichnis, 'aufheben.pdf')
  await baueQuelle(quelle)
  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  await waehleWerkzeug(fenster, 'zuschneiden')
  await fenster.getByTestId('zuschnitt-aufheben').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Zuschnitt aufheben (Seite 1)', {
    timeout: 30000
  })
  // Jetzt ist die ganze MediaBox sichtbar: gedreht 800 x 600.
  await expect.poll(() => seitenverhaeltnis(fenster)).toBeCloseTo(800 / 600, 2)
  await gestartet.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
  })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 30000 })
  expect(await kasten(quelle, 'CropBox')).toEqual(MEDIA)
})
