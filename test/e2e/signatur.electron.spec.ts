import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * S3.2, Aufgabe 4 — die grafische Signatur, durch die gebaute Anwendung.
 *
 * Zeichnen mit echten Zeigerbewegungen (jsdom hat keine Leinwand, deshalb
 * geht das nur hier), setzen per Klick, speichern, und dann mit pdf-lib
 * nachsehen: ein Stempel mit einem `/AP`, dessen Ressourcen ein Bild-XObject
 * tragen. Das ist die Form, die ein fremder Betrachter braucht.
 *
 * Und der Satz, der in der Oberflaeche stehen muss: ein Bild, keine
 * kryptografische Signatur.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-signatur-'))
})

async function oeffneKopie(name: string): Promise<{ fenster: Page; pfad: string }> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/annotated.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.fenster.waitForSelector(
    '[data-testid="annotationsebene-1"] [data-annotation-typ]'
  )
  return { fenster: gestartet.fenster, pfad }
}

/** Zeichnet einen Zickzack auf die Leinwand des Signaturfelds. */
async function zeichneUnterschrift(fenster: Page): Promise<void> {
  const leinwand = fenster.getByTestId('signatur-zeichenflaeche')
  const rahmen = await leinwand.boundingBox()
  if (rahmen === null) throw new Error('Leinwand ohne Masse')
  await fenster.mouse.move(rahmen.x + 30, rahmen.y + 90)
  await fenster.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await fenster.mouse.move(rahmen.x + 30 + i * 25, rahmen.y + 90 - (i % 2) * 50)
  }
  await fenster.mouse.up()
}

test('zeichnet, setzt und speichert eine Signatur als Bildstempel', async () => {
  const { fenster, pfad } = await oeffneKopie('signiert.pdf')

  // Das Werkzeug ohne Bild oeffnet das Feld von selbst — mit dem Hinweis.
  await waehleWerkzeug(fenster, 'signatur')
  await expect(fenster.getByTestId('signaturfeld')).toBeVisible()
  await expect(fenster.getByTestId('signatur-hinweis')).toContainText(
    'keine kryptografische Signatur'
  )
  await expect(fenster.getByTestId('signatur-uebernehmen')).toBeDisabled()

  await zeichneUnterschrift(fenster)
  await expect(fenster.getByTestId('signatur-uebernehmen')).toBeEnabled()
  await fenster.getByTestId('signatur-uebernehmen').click()
  await expect(fenster.getByTestId('signaturfeld')).toHaveCount(0)
  await expect(fenster.getByTestId('werkzeug-signatur-vorschau')).toBeVisible()

  // Setzen: ein Klick auf die Seite.
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 150, y: 500 } })
  const gesetzt = fenster.locator('[data-annotation-typ="Stamp"] img')
  await expect(gesetzt).toHaveCount(1)
  await expect(gesetzt).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()

  // Das Bild hat das Seitenverhaeltnis der Zeichnung: breiter als hoch.
  const masse = await gesetzt.boundingBox()
  expect(masse).not.toBeNull()
  expect((masse?.width ?? 0) > (masse?.height ?? 0)).toBe(true)

  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  // Reparse: der Stempel traegt ein /AP mit einem Bild-XObject.
  const dokument = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
  const annots = dokument.getPage(0).node.Annots()
  expect(annots).toBeDefined()
  let gefunden = 0
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const dict = annots?.lookup(i, PDFDict)
    if (dict === undefined || String(dict.get(PDFName.of('Subtype'))) !== '/Stamp') continue
    const inhalt = dict.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)?.decodeText()
    if (inhalt === undefined || !inhalt.includes('Signatur')) continue
    gefunden++
    const ap = dict.lookup(PDFName.of('AP'), PDFDict)
    const strom = dokument.context.lookup(ap.get(PDFName.of('N')), PDFStream)
    const xobjekte = strom.dict
      .lookup(PDFName.of('Resources'), PDFDict)
      .lookup(PDFName.of('XObject'), PDFDict)
    const bild = dokument.context.lookup(xobjekte.get(PDFName.of('Im0')), PDFStream)
    expect(String(bild.dict.get(PDFName.of('Subtype')))).toBe('/Image')
    expect(Number(String(bild.dict.get(PDFName.of('Width'))))).toBeGreaterThan(0)
    expect(Buffer.from(strom.getContents()).toString('latin1')).toContain('/Im0 Do')
  }
  expect(gefunden).toBe(1)
})

test('setzt dasselbe Bild mehrfach, ohne neu zu zeichnen', async () => {
  const { fenster } = await oeffneKopie('doppelt.pdf')
  await waehleWerkzeug(fenster, 'signatur')
  await zeichneUnterschrift(fenster)
  await fenster.getByTestId('signatur-uebernehmen').click()

  const flaeche = fenster.locator('[data-testid="zeichenflaeche-1"]')
  await flaeche.click({ position: { x: 100, y: 300 } })
  await flaeche.click({ position: { x: 300, y: 600 } })
  await expect(fenster.locator('[data-annotation-typ="Stamp"] img')).toHaveCount(2)
})

test('laesst Abbrechen das Werkzeug ohne Bild und die Textauswahl frei', async () => {
  const { fenster } = await oeffneKopie('abgebrochen.pdf')
  await waehleWerkzeug(fenster, 'signatur')
  await fenster.getByTestId('signatur-abbrechen').click()
  await expect(fenster.getByTestId('signaturfeld')).toHaveCount(0)
  // Ohne Bild keine Zeichenflaeche: die Textauswahl aus S1.4 bleibt erreichbar.
  await expect(fenster.locator('[data-testid="zeichenflaeche-1"]')).toHaveCount(0)
  await expect(fenster.getByTestId('werkzeug-signatur-stand')).toContainText('Noch kein')
})
