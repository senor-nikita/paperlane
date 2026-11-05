import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S4.3 — Drucken durch die gebaute Anwendung, ueber den gewaehlten Pfad
 * (ADR 0003: Druckvorlage + Chromium-PDF-Betrachter im versteckten Fenster).
 *
 * Das Exit-Kriterium des Schritts: der Druck von `large-500.pdf` erzeugt eine
 * Datei mit 500 Seiten, deren Seiten 1, 250 und 500 nicht-leeren Text tragen
 * - per pdf.js-Textextraktion geprueft. Der Speichern-Dialog ist modal und
 * wird im Main durch eine Attrappe ersetzt; der Druck selbst laeuft echt.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-druck-'))
})

async function seitentext(bytes: Uint8Array, seite: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const auftrag = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await auftrag.promise
  try {
    const inhalt = await (await doc.getPage(seite)).getTextContent()
    return inhalt.items
      .map((eintrag) => ('str' in eintrag ? eintrag.str : ''))
      .join(' ')
      .trim()
  } finally {
    await auftrag.destroy()
  }
}

test('druckt large-500.pdf als PDF-Datei: 500 Seiten mit Text', async () => {
  test.setTimeout(180000)
  const quelle = join(verzeichnis, 'gross.pdf')
  copyFileSync(resolve('test/fixtures/large-500.pdf'), quelle)
  const ziel = join(verzeichnis, 'gross-druck.pdf')

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, ziel)

  await fenster.keyboard.press('Control+P')
  await expect(fenster.getByTestId('drucken')).toBeVisible()
  const beginn = Date.now()
  await fenster.getByTestId('drucken-datei').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Als PDF gedruckt: gross-druck.pdf', {
    timeout: 120000
  })
  await expect(fenster.getByTestId('hinweis')).toContainText('500 Seiten')
  const dauer = Date.now() - beginn
  await expect(fenster.getByTestId('drucken')).toHaveCount(0)

  const bytes = new Uint8Array(readFileSync(ziel))
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(500)
  for (const seite of [1, 250, 500]) {
    const text = await seitentext(bytes, seite)
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('Seite ' + String(seite))
  }
  // Der Fensterprozess des Drucks ist wieder weg; der Speicher kehrt zurueck.
  const fensterZahl = await gestartet.app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
  )
  expect(fensterZahl).toBe(1)
  console.log('  Druck von 500 Seiten als PDF: ' + String(dauer) + ' ms')
})

test('uebergibt an den Drucker ueber das versteckte Fenster', async () => {
  test.setTimeout(90000)
  const quelle = join(verzeichnis, 'drucker.pdf')
  copyFileSync(resolve('test/fixtures/annotated.pdf'), quelle)

  gestartet = await startApp([quelle])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  // Der Systemdialog ist nicht erreichbar: `print` auf dem Prototyp aller
  // webContents antwortet sofort mit Erfolg und merkt sich, aus welchem
  // Fenster es kam.
  await gestartet.app.evaluate(({ BrowserWindow }) => {
    const haupt = BrowserWindow.getAllWindows()[0]
    if (haupt === undefined) throw new Error('kein Fenster')
    const proto = Object.getPrototypeOf(haupt.webContents) as {
      print: (optionen: unknown, rueckruf: (ok: boolean, grund: string) => void) => void
    }
    const global = globalThis as { __druckAufrufe?: string[] }
    global.__druckAufrufe = []
    proto.print = function (this: { getURL: () => string }, _optionen, rueckruf): void {
      global.__druckAufrufe?.push(this.getURL())
      rueckruf(true, '')
    }
  })

  await fenster.keyboard.press('Control+P')
  await fenster.getByTestId('drucken-aktuelle').check()
  await fenster.getByTestId('drucken-drucker').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Druckauftrag übergeben', {
    timeout: 60000
  })
  const aufrufe = await gestartet.app.evaluate(
    () => (globalThis as { __druckAufrufe?: string[] }).__druckAufrufe ?? []
  )
  // Genau ein Druck, und zwar aus dem Fenster mit der Vorlage - nicht aus
  // dem Hauptfenster (das wuerde das DOM drucken, S1.2).
  expect(aufrufe).toHaveLength(1)
  expect(aufrufe[0]).toMatch(/^file:.*paperlane-druck-[0-9a-f]{32}\.pdf$/)
})
