import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * S4.0 — die Mutationspipeline durch die gebaute Anwendung.
 *
 * Die Exit-Kriterien des Schritts, jedes einzeln nachgesehen: eine Seite
 * loeschen laeuft durch; **alle Caches sind invalidiert** — kein veraltetes
 * Thumbnail (die letzte Miniatur verschwindet), kein veralteter Suchtreffer
 * (die Trefferzahl sinkt um die Vorkommen der geloeschten Seite); die Ansicht
 * bleibt auf der Seite, die an die Stelle der geloeschten rueckt; eine
 * ungespeicherte Anmerkung ueberlebt das Neuladen; und das Speichern schreibt
 * die Arbeitskopie mit einer Seite weniger.
 *
 * `large-500.pdf`: der Suchbegriff steht auf jeder zehnten Seite, also
 * genau 50 Mal - Seite 10 zu loeschen muss 49 uebrig lassen.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-mutation-'))
})

async function oeffneKopie(name: string): Promise<{ fenster: Page; pfad: string }> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/large-500.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  return { fenster: gestartet.fenster, pfad }
}

async function suche(fenster: Page, begriff: string): Promise<string> {
  await fenster.getByTestId('such-eingabe').fill('')
  await fenster.getByTestId('such-eingabe').fill(begriff)
  await fenster.getByTestId('such-eingabe').press('Enter')
  await expect(fenster.getByTestId('treffer-anzeige')).toHaveText(/von \d+/, { timeout: 30000 })
  return (await fenster.getByTestId('treffer-anzeige').textContent()) ?? ''
}

async function geheZuSeite(fenster: Page, seite: number): Promise<void> {
  await fenster.getByTestId('seiten-eingabe').fill(String(seite))
  await fenster.getByTestId('seiten-eingabe').press('Enter')
  await expect(fenster.getByTestId('seiten-eingabe')).toHaveValue(String(seite))
}

test('loescht eine Seite, invalidiert alle Caches und behaelt Anmerkung und Ansicht', async () => {
  // Zwei Suchlaeufe ueber 500 Seiten und ein Neuladen: mehr als die
  // ueblichen 30 Sekunden.
  test.setTimeout(180000)
  const { fenster, pfad } = await oeffneKopie('mutiert.pdf')
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 500')

  // Suchindex fuellen: 50 Treffer. Der erste Treffer scrollt zu Seite 10.
  expect(await suche(fenster, 'Wasserzeichen')).toMatch(/von 50$/)

  // Eine ungespeicherte Anmerkung auf Seite 1 (Aufgabe 3). Die Seite muss
  // im Sichtfenster sein, sonst hat sie keine Zeichenflaeche (Virtualisierung).
  await geheZuSeite(fenster, 1)
  await waehleWerkzeug(fenster, 'notiz')
  await fenster.waitForSelector('[data-testid="zeichenflaeche-1"]', { timeout: 20000 })
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 150, y: 300 } })
  await expect(fenster.locator('[data-annotation-typ="Text"]')).toHaveCount(1)
  await waehleWerkzeug(fenster, 'auswahl')

  // Miniaturen sind virtualisiert und folgen der aktuellen Seite: am Ende
  // des Dokuments gibt es die Miniatur 500.
  await geheZuSeite(fenster, 500)
  await expect(fenster.getByTestId('miniatur-500')).toHaveAttribute('aria-current', 'page', {
    timeout: 20000
  })

  // Auf Seite 10, dann loeschen.
  await geheZuSeite(fenster, 10)
  await fenster.getByTestId('seite-loeschen-knopf').click()

  // Die Pipeline ist durch, wenn die Seitenzahl gesunken ist.
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 499', { timeout: 30000 })
  await expect(fenster.getByTestId('hinweis')).toContainText('Noch nicht gespeichert')
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()

  // Ansicht: die Seite, die an die Stelle der alten rueckt, ist jetzt Seite 10.
  await expect(fenster.getByTestId('seiten-eingabe')).toHaveValue('10')
  await expect(fenster.getByTestId('seiten-canvas-10')).toBeVisible({ timeout: 20000 })

  // Kein veraltetes Thumbnail: am Ende steht jetzt Miniatur 499, 500 gibt
  // es nicht mehr - das Layout der Leiste ist fuer 499 Seiten neu gebaut.
  await geheZuSeite(fenster, 499)
  await expect(fenster.getByTestId('miniatur-499')).toHaveAttribute('aria-current', 'page', {
    timeout: 20000
  })
  await expect(fenster.getByTestId('miniatur-500')).toHaveCount(0)
  await geheZuSeite(fenster, 10)

  // Kein veralteter Suchtreffer: der Treffer von Seite 10 ist weg.
  expect(await suche(fenster, 'Wasserzeichen')).toMatch(/von 49$/)

  // Die Anmerkung hat das Neuladen ueberlebt - jetzt als Bestand des Dokuments.
  await geheZuSeite(fenster, 1)
  await expect(fenster.locator('[data-annotation-typ="Text"]')).toHaveCount(1, { timeout: 20000 })

  // Speichern schreibt die Arbeitskopie: eine Seite weniger, Anmerkung drin.
  // Seit S4.1 fragt der Main vor dem Ueberschreiben des Originals; der Dialog
  // ist modal, die Attrappe im Main antwortet mit "Original ueberschreiben".
  await gestartet.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
  })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 30000 })
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)
  const dokument = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
  expect(dokument.getPageCount()).toBe(499)
  expect(dokument.getPage(0).node.Annots()?.size()).toBe(1)
})

test('meldet die letzte Seite als nicht loeschbar', async () => {
  const pfad = join(verzeichnis, 'einseitig.pdf')
  copyFileSync(resolve('test/fixtures/single-page.pdf'), pfad)
  gestartet = await startApp([pfad])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  await expect(fenster.getByTestId('seite-loeschen-knopf')).toBeDisabled()
  // Ueber das Kuerzel kommt die Meldung, nicht ein leeres Dokument.
  await fenster.keyboard.press('Control+Shift+Delete')
  await expect(fenster.getByTestId('hinweis')).toContainText('letzte Seite')
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 1')
})
