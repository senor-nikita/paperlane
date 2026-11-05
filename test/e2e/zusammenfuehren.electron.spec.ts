import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S4.2a — Zusammenfuehren und Teilen durch die gebaute Anwendung.
 *
 * Die Dialoge des Main (Dateien, Ordner, Speichern unter) sind modal und fuer
 * Playwright unerreichbar; sie werden im Main-Prozess durch Attrappen
 * ersetzt, die die Testpfade liefern. Alles Uebrige - Freigaben, Kopieren,
 * Feldnamen, Schreiben, Neuoeffnen - laeuft echt.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-zusammen-'))
})

test('fuehrt zwei Dokumente in gewaehlter Reihenfolge zusammen und oeffnet das Ergebnis', async () => {
  test.setTimeout(90000)
  const a = join(verzeichnis, 'a-annotiert.pdf')
  const b = join(verzeichnis, 'b-formular.pdf')
  const ziel = join(verzeichnis, 'zusammen.pdf')
  copyFileSync(resolve('test/fixtures/annotated.pdf'), a)
  copyFileSync(resolve('test/fixtures/acroform.pdf'), b)

  gestartet = await startApp([a])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })

  // Der Dateidialog liefert b, der Speichern-Dialog das Ziel.
  await gestartet.app.evaluate(
    ({ dialog }, pfade) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [pfade.b] })
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfade.ziel })
    },
    { b, ziel }
  )

  await fenster.keyboard.press('Control+Shift+M')
  await expect(fenster.getByTestId('zusammenfuehren')).toBeVisible()
  await expect(fenster.getByTestId('zusammenfuehren-eintrag-1')).toContainText('a-annotiert.pdf')
  await expect(fenster.getByTestId('zusammenfuehren-eintrag-2')).toContainText('b-formular.pdf')

  // Reihenfolge tauschen: Formular zuerst.
  await fenster.getByTestId('zusammenfuehren-runter-1').click()
  await expect(fenster.getByTestId('zusammenfuehren-eintrag-1')).toContainText('b-formular.pdf')
  await fenster.getByTestId('zusammenfuehren-ausfuehren').click()

  await expect(fenster.getByTestId('hinweis')).toContainText('Zusammengeführt', {
    timeout: 30000
  })
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 3', { timeout: 20000 })
  await expect(fenster.getByTestId('zusammenfuehren')).toHaveCount(0)

  const doc = await PDFDocument.load(new Uint8Array(readFileSync(ziel)))
  expect(doc.getPageCount()).toBe(3)
  // Seite 1 ist das Formular (mit Feldern), Seite 2 traegt die Anmerkungen.
  expect(doc.getForm().getFields().length).toBeGreaterThan(0)
  expect(doc.getPage(1).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
  // Das Ergebnis ist geoeffnet und zeigt seine Formularfelder.
  await expect(fenster.getByTestId('formularfeld-person.name')).toBeVisible({ timeout: 20000 })
})

test('teilt das Dokument in Bereiche in einen gewaehlten Ordner', async () => {
  const quelle = join(verzeichnis, 'teilen.pdf')
  const ordner = join(verzeichnis, 'teile')
  copyFileSync(resolve('test/fixtures/annotated.pdf'), quelle)

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [pfad] })
  }, ordner)

  await fenster.keyboard.press('Control+Shift+T')
  await expect(fenster.getByTestId('teilen')).toBeVisible()
  await fenster.getByTestId('teilen-bereiche').check()
  await fenster.getByTestId('teilen-bereiche-eingabe').fill('2, 1-2')
  await expect(fenster.getByTestId('teilen-bereiche-hinweis')).toHaveText('2 Dateien: 2, 1-2')
  await fenster.getByTestId('teilen-ausfuehren').click()

  await expect(fenster.getByTestId('hinweis')).toContainText('2 Dateien geschrieben', {
    timeout: 30000
  })
  const eins = join(ordner, 'teilen-S2.pdf')
  const zwei = join(ordner, 'teilen-S1-S2.pdf')
  expect(existsSync(eins)).toBe(true)
  expect(existsSync(zwei)).toBe(true)
  expect((await PDFDocument.load(new Uint8Array(readFileSync(eins)))).getPageCount()).toBe(1)
  expect((await PDFDocument.load(new Uint8Array(readFileSync(zwei)))).getPageCount()).toBe(2)
})
