import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { ziehe } from './ziehen'

/**
 * S6.2 — Seitenuebersicht und Seiten extrahieren, durch die gebaute Anwendung.
 *
 * `large-500.pdf` traegt auf jeder Seite den Text "Seite N von 500"; pdf-lib
 * kopiert die Inhaltsstroeme unveraendert. `seitenIn` dekodiert sie und liest
 * die Nummer - so laesst sich ohne pdf.js pruefen, welche Seite wo steht.
 *
 * Der Speichern-Dialog ist modal und fuer Playwright unerreichbar; eine
 * Attrappe im Main liefert das Ziel.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-uebersicht-'))
})

async function oeffneKopie(name: string): Promise<Page> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/large-500.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.fenster.waitForSelector('[data-testid="miniatur-1"]', { timeout: 20000 })
  return gestartet.fenster
}

async function speichereNach(ziel: string): Promise<void> {
  await gestartet.app.evaluate(({ dialog }, pfad) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: pfad })
  }, ziel)
}

/** Die Nummer "Seite N von 500" jeder Seite der Datei, in Seitenreihenfolge. */
async function seitenIn(pfad: string): Promise<number[]> {
  const doc = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
  return doc.getPages().map((seite) => {
    const inhalt = seite.node.Contents()
    const stroeme =
      inhalt instanceof PDFArray ? inhalt.asArray().map((ref) => doc.context.lookup(ref)) : [inhalt]
    const roh = stroeme
      .map((strom) =>
        strom instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(strom).decode()).toString('latin1')
          : ''
      )
      .join('')
    // pdf-lib schreibt Text der Standardschriften als Hex-String: <536569...> Tj
    const text = roh.replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex: string) =>
      Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('latin1')
    )
    const treffer = /Seite (\d+) von 500/.exec(text)
    return treffer === null ? -1 : Number(treffer[1])
  })
}

test('extrahiert einen Bereich und eine einzelne Seite, auf Wunsch mit Entfernen', async () => {
  test.setTimeout(120000)
  const fenster = await oeffneKopie('gross.pdf')

  await fenster.keyboard.press('Control+Shift+O')
  await expect(fenster.getByTestId('seitenuebersicht')).toBeVisible()
  await expect(fenster.getByTestId('kachel-1')).toBeVisible()

  // Das Raster ist virtualisiert: das Ende liegt nicht im DOM, bis man hinspringt.
  await expect(fenster.getByTestId('kachel-500')).toHaveCount(0)
  await fenster.getByTestId('uebersicht-raster').press('End')
  await expect(fenster.getByTestId('kachel-500')).toBeVisible({ timeout: 10000 })
  await fenster.getByTestId('uebersicht-raster').press('Home')

  const bereich = join(verzeichnis, 'bereich.pdf')
  await speichereNach(bereich)
  await fenster.getByTestId('uebersicht-bereich').fill('1-3')
  await fenster.getByTestId('uebersicht-extrahieren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('3 Seiten extrahiert', {
    timeout: 30000
  })
  expect(await seitenIn(bereich)).toEqual([1, 2, 3])
  // Ohne Haken bleibt das Dokument, wie es war.
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 500')

  const einzeln = join(verzeichnis, 'einzeln.pdf')
  await speichereNach(einzeln)
  await fenster.getByTestId('uebersicht-bereich').fill('4')
  await fenster.getByTestId('uebersicht-entfernen').check()
  await fenster.getByTestId('uebersicht-extrahieren').click()
  await expect(fenster.getByTestId('seiten-anzeige')).toHaveText('von 499', { timeout: 30000 })
  expect(await seitenIn(einzeln)).toEqual([4])
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()
})

test('ordnet im Raster per Ziehen und per Tastatur um, Rueckgaengig stellt her', async () => {
  test.setTimeout(120000)
  const fenster = await oeffneKopie('ordnen.pdf')

  await fenster.getByTestId('seitenuebersicht-oeffnen').click()
  await expect(fenster.getByTestId('kachel-3')).toBeVisible()

  // Seite 3 links neben Seite 1 ziehen (linkes Viertel = davor).
  await ziehe(fenster, fenster.getByTestId('kachel-3'), fenster.getByTestId('kachel-1'), 0.25, true)
  await expect(fenster.getByTestId('hinweis')).toContainText('Seiten neu anordnen', {
    timeout: 20000
  })
  // Die verschobene Seite bleibt gewaehlt und steht jetzt vorn.
  await expect(fenster.getByTestId('kachel-1')).toHaveAttribute('aria-selected', 'true', {
    timeout: 20000
  })
  await expect(fenster.getByTestId('rueckgaengig')).toBeEnabled({ timeout: 20000 })

  // Strg+Pfeil rechts schiebt sie eine Stelle weiter.
  await fenster.getByTestId('uebersicht-raster').focus()
  await fenster.keyboard.press('Control+ArrowRight')
  await expect(fenster.getByTestId('kachel-2')).toHaveAttribute('aria-selected', 'true', {
    timeout: 20000
  })
  await expect(fenster.getByTestId('rueckgaengig')).toBeEnabled({ timeout: 20000 })

  // Reihenfolge jetzt 1, 3, 2 - geprueft am Extrakt der ersten drei Seiten.
  const pruefung = join(verzeichnis, 'reihenfolge.pdf')
  await speichereNach(pruefung)
  await fenster.getByTestId('uebersicht-bereich').fill('1-3')
  await fenster.getByTestId('uebersicht-extrahieren').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('extrahiert', { timeout: 30000 })
  expect(await seitenIn(pruefung)).toEqual([1, 3, 2])

  // Zweimal Rueckgaengig: zurueck zum Ausgangszustand, nichts mehr zu speichern.
  await fenster.getByTestId('uebersicht-schliessen').click()
  await expect(fenster.getByTestId('seitenuebersicht')).toHaveCount(0)
  await fenster.keyboard.press('Control+Z')
  await expect(fenster.getByTestId('rueckgaengig')).toBeEnabled({ timeout: 20000 })
  await fenster.keyboard.press('Control+Z')
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0, { timeout: 20000 })
})
