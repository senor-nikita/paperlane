import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'
import { ziehe } from './ziehen'

/**
 * S4.1 — Seitenoperationen mit Undo/Redo, durch die gebaute Anwendung.
 *
 * `annotated.pdf` hat zwei Seiten; die Anmerkungen liegen alle auf Seite 1.
 * Damit laesst sich das Exit-Kriterium "Anmerkungen an den richtigen Seiten"
 * an einer Zahl festmachen: nach dem Tausch der Seiten muss die
 * Annotationsebene von Seite 2 sie tragen, die von Seite 1 keine.
 *
 * Undo ueber 20 gemischte Schritte: zehnmal (Notiz setzen, Seite drehen) -
 * Anmerkung und Mutation abwechselnd, wie der Plan es verlangt - und dann
 * zwanzigmal Rueckgaengig. Danach: zwei Seiten, nur die urspruenglichen
 * Anmerkungen, nichts zu speichern, die Datei byteidentisch.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-seiten-'))
})

async function oeffneKopie(name: string): Promise<{ fenster: Page; pfad: string }> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/annotated.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.fenster.waitForSelector(
    '[data-testid="annotationsebene-1"] [data-annotation-typ]'
  )
  await gestartet.fenster.waitForSelector('[data-testid="miniatur-2"]', { timeout: 20000 })
  return { fenster: gestartet.fenster, pfad }
}

/** Anmerkungen je Annotationsebene, wie der Renderer sie zeichnet. */
async function anmerkungenAuf(fenster: Page, seite: number): Promise<number> {
  return fenster
    .locator('[data-testid="annotationsebene-' + String(seite) + '"] [data-annotation-typ]')
    .count()
}

/** Wartet, bis das Neuladen durch ist und die Historie wieder frei ist. */
async function warteAufNeuladen(fenster: Page, seitenzahl: number): Promise<void> {
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von ' + String(seitenzahl), {
    timeout: 20000
  })
  await expect(fenster.getByTestId('rueckgaengig')).toBeEnabled({ timeout: 20000 })
}

test('ordnet per Ziehen neu an, dreht dauerhaft, und die Anmerkungen folgen ihrer Seite', async () => {
  test.setTimeout(120000)
  const { fenster, pfad } = await oeffneKopie('geordnet.pdf')
  const urspruenglich = await anmerkungenAuf(fenster, 1)
  expect(urspruenglich).toBeGreaterThan(0)
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 2')

  // Seite 2 vor Seite 1 ziehen (oberes Viertel der Zielminiatur = davor).
  await ziehe(fenster, fenster.getByTestId('miniatur-2'), fenster.getByTestId('miniatur-1'), 0.25)
  await expect(fenster.getByTestId('hinweis')).toContainText('Seiten neu anordnen', {
    timeout: 20000
  })
  await warteAufNeuladen(fenster, 2)

  // Die Anmerkungen sind mit ihrer Seite gewandert: jetzt Seite 2.
  await fenster.getByTestId('miniatur-2').click()
  await expect.poll(async () => anmerkungenAuf(fenster, 2), { timeout: 20000 }).toBe(urspruenglich)
  await fenster.getByTestId('miniatur-1').click()
  await expect.poll(async () => anmerkungenAuf(fenster, 1), { timeout: 20000 }).toBe(0)

  // Seite 1 (die frueher zweite) dauerhaft drehen.
  await fenster.getByTestId('seiten-drehen-rechts').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('um 90° drehen', { timeout: 20000 })
  await warteAufNeuladen(fenster, 2)
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()

  // Die Drehung muss im eigenen Viewer sichtbar sein (Befund vor S4.2b:
  // `getViewport({ rotation })` ersetzte `/Rotate`, die gedrehte Seite blieb
  // hochkant). Die Hochkantseite steht jetzt quer - und die Anmerkungen von
  // Seite 2 stehen weiterhin auf einer ungedrehten Seite.
  await expect
    .poll(
      async () =>
        fenster.getByTestId('seiten-canvas-1').evaluate((el) => {
          const canvas = el as HTMLCanvasElement
          return canvas.width > canvas.height && canvas.width > 0
        }),
      { timeout: 20000 }
    )
    .toBe(true)

  // Speichern: das Original wird nur auf Bestaetigung ueberschrieben (Aufgabe 4).
  // Der Dialog ist modal und fuer Playwright unerreichbar; die Attrappe im Main
  // antwortet mit "Original ueberschreiben".
  await gestartet.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
  })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 30000 })

  const dokument = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
  expect(dokument.getPageCount()).toBe(2)
  expect(dokument.getPage(0).getRotation().angle).toBe(90)
  expect(dokument.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
  expect(dokument.getPage(1).node.Annots()?.size() ?? 0).toBeGreaterThanOrEqual(urspruenglich)
})

test('stellt ueber 20 gemischte Schritte den Ausgangszustand exakt wieder her', async () => {
  test.setTimeout(240000)
  const { fenster, pfad } = await oeffneKopie('gemischt.pdf')
  const urspruenglich = await anmerkungenAuf(fenster, 1)
  const bytesVorher = readFileSync(pfad)

  // Zehnmal: Notiz setzen (Anmerkung), Seite 1 drehen (Mutation). Nach jedem
  // Neuladen ist die Notiz Bestand des Dokuments und zaehlt weiter mit.
  for (let i = 0; i < 10; i++) {
    await waehleWerkzeug(fenster, 'notiz')
    await fenster.waitForSelector('[data-testid="zeichenflaeche-1"]', { timeout: 20000 })
    await fenster
      .locator('[data-testid="zeichenflaeche-1"]')
      .click({ position: { x: 60 + i * 20, y: 400 } })
    await expect
      .poll(async () => anmerkungenAuf(fenster, 1), { timeout: 20000 })
      .toBe(urspruenglich + i + 1)
    await waehleWerkzeug(fenster, 'auswahl')
    await fenster.getByTestId('seiten-drehen-rechts').click()
    await expect(fenster.getByTestId('hinweis')).toContainText('drehen', { timeout: 20000 })
    await warteAufNeuladen(fenster, 2)
    await expect
      .poll(async () => anmerkungenAuf(fenster, 1), { timeout: 20000 })
      .toBe(urspruenglich + i + 1)
  }

  // Zwanzigmal Rueckgaengig; der Knopf ist gesperrt, solange die Historie
  // beschaeftigt ist, und Playwright wartet auf ihn.
  for (let i = 0; i < 20; i++) {
    await expect(fenster.getByTestId('rueckgaengig')).toBeEnabled({ timeout: 20000 })
    await fenster.getByTestId('rueckgaengig').click()
    await fenster.waitForTimeout(100)
  }
  await expect(fenster.getByTestId('rueckgaengig')).toBeDisabled({ timeout: 20000 })

  // Ausgangszustand: zwei Seiten, nur die urspruenglichen Anmerkungen,
  // nichts zu speichern, die Datei unveraendert.
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 2')
  await expect.poll(async () => anmerkungenAuf(fenster, 1), { timeout: 20000 }).toBe(urspruenglich)
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('nichts zu speichern', {
    timeout: 20000
  })
  expect(Buffer.compare(readFileSync(pfad), bytesVorher)).toBe(0)

  // Und wieder vor: alle 20 Schritte.
  for (let i = 0; i < 20; i++) {
    await expect(fenster.getByTestId('wiederholen')).toBeEnabled({ timeout: 20000 })
    await fenster.getByTestId('wiederholen').click()
    await fenster.waitForTimeout(100)
  }
  await expect(fenster.getByTestId('wiederholen')).toBeDisabled({ timeout: 20000 })
  await expect
    .poll(async () => anmerkungenAuf(fenster, 1), { timeout: 20000 })
    .toBe(urspruenglich + 10)
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()
})

test('loescht die Auswahl aus der Miniaturenleiste und laesst die letzte Seite stehen', async () => {
  const { fenster } = await oeffneKopie('auswahl.pdf')
  await fenster.getByTestId('miniatur-2').click()
  await expect(fenster.getByTestId('seitenwerkzeuge-stand')).toHaveText('1 gewählt')
  await fenster.getByTestId('seiten-loeschen').click()
  await warteAufNeuladen(fenster, 1)
  await expect(fenster.getByTestId('seitenwerkzeuge-stand')).toHaveText('aktuelle Seite')
  await expect(fenster.getByTestId('seiten-loeschen')).toBeDisabled()
  // Rueckgaengig bringt die Seite zurueck - danach ist nur noch Wiederholen moeglich.
  await fenster.getByTestId('rueckgaengig').click()
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 2', { timeout: 20000 })
  await expect(fenster.getByTestId('wiederholen')).toBeEnabled({ timeout: 20000 })
  await expect(fenster.getByTestId('rueckgaengig')).toBeDisabled()
})
