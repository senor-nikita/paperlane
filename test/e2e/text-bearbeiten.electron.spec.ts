import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { cidDokument } from '../helpers/textfixtures'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * S6.6b — vorhandenen Text aendern und loeschen, durch die gebaute Anwendung.
 *
 * Drei Wege: eine Zeile in der Originalschrift ersetzen (word.pdf,
 * Standard-14), eine Zeile, deren neues Zeichen in der eingebetteten
 * Teilmenge fehlt (Ersatzschrift, sichtbar gemeldet), und eine Zeile loeschen.
 * Geprueft wird - nicht angenommen -, dass die Suche den neuen Text findet,
 * dass Rueckgaengig den Seiteninhalt byte-genau zurueckbringt und dass
 * geloeschter Text nach dem Speichern nicht mehr in der Datei steht.
 */

let gestartet: GestarteteApp
let verzeichnis: string

test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-text-'))
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffne(pfad: string): Promise<Page> {
  gestartet = await startApp([pfad])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  await gestartet.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
  })
  return fenster
}

/** Klickt die Zeile an und tippt den neuen Text. */
async function bearbeiteZeile(fenster: Page, alt: string, neu: string | null): Promise<void> {
  await fenster.getByRole('button', { name: 'Zeile bearbeiten: ' + alt, exact: true }).click()
  const feld = fenster.getByTestId('textzeile-eingabe')
  await expect(feld).toBeFocused()
  await expect(feld).toHaveValue(alt)
  if (neu === null) {
    await feld.press('Delete')
    return
  }
  await feld.fill(neu)
  await feld.press('Enter')
}

/** Der dekodierte Seiteninhalt von Seite 1 - fuer den Byte-Vergleich. */
async function seiteninhalt(pfad: string): Promise<Buffer> {
  const doc = await PDFDocument.load(readFileSync(pfad))
  const c = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Contents')))
  const teile = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c]
  return Buffer.concat(
    teile.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()))
  )
}

/** Hex so, wie pdf-lib Text in den Stream schreibt (Grossbuchstaben). */
function hex(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase()
}

async function alleStroeme(pfad: string): Promise<string> {
  const doc = await PDFDocument.load(readFileSync(pfad))
  const teile: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        teile.push(Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'))
      } catch {
        teile.push(Buffer.from(obj.contents).toString('latin1'))
      }
    }
  }
  return teile.join('\n')
}

async function suche(fenster: Page, begriff: string, erwartet: string): Promise<void> {
  await fenster.keyboard.press('Control+F')
  await fenster.getByTestId('such-eingabe').fill(begriff)
  await fenster.getByTestId('such-eingabe').press('Enter')
  await expect(fenster.getByTestId('treffer-anzeige')).toHaveText(erwartet, { timeout: 20000 })
}

test('ersetzt eine Zeile in der Originalschrift; Suche findet sie, Rueckgaengig stellt byte-genau her', async () => {
  test.setTimeout(120000)
  const pfad = join(verzeichnis, 'bericht.pdf')
  copyFileSync(resolve('test/fixtures/word.pdf'), pfad)
  const inhaltVorher = await seiteninhalt(pfad)
  const fenster = await oeffne(pfad)

  // Werkzeug ueber das Kuerzel, Hinweis in der Leiste.
  await fenster.keyboard.press('Control+Shift+L')
  await expect(fenster.getByTestId('werkzeug-textBearbeiten')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(fenster.getByTestId('textbearbeitung-hinweis')).toBeVisible()

  await bearbeiteZeile(fenster, 'Methode', 'Verfahren')
  await expect(fenster.getByTestId('hinweis')).toContainText(
    'Zeile ersetzen (Seite 1): angewendet – Originalschrift benutzt',
    { timeout: 30000 }
  )
  await expect(fenster.getByTestId('textebene-1')).toContainText('Verfahren')
  await expect(fenster.getByTestId('textebene-1')).not.toContainText('Methode')
  await suche(fenster, 'Verfahren', '1 von 1')
  await fenster.keyboard.press('Escape')

  // Rueckgaengig: die alte Zeile ist zurueck ...
  await fenster.getByTestId('rueckgaengig').click()
  await expect(fenster.getByTestId('textebene-1')).toContainText('Methode', { timeout: 30000 })
  await expect(fenster.getByTestId('textebene-1')).not.toContainText('Verfahren')
  // ... Wiederholen bringt die neue, und noch einmal Rueckgaengig die alte.
  await fenster.getByTestId('wiederholen').click()
  await expect(fenster.getByTestId('textebene-1')).toContainText('Verfahren', { timeout: 30000 })
  await fenster.getByTestId('rueckgaengig').click()
  await expect(fenster.getByTestId('textebene-1')).toContainText('Methode', { timeout: 30000 })

  // ... und der Seiteninhalt ist byte-genau der alte. Eine Notiz sorgt dafuer,
  // dass gespeichert wird - aus dem wiederhergestellten Stand.
  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 100, y: 100 } })
  await expect(fenster.locator('[data-annotation-typ="Text"]')).toHaveCount(1)
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 30000 })
  expect((await seiteninhalt(pfad)).equals(inhaltVorher)).toBe(true)
})

test('fehlender Glyph: Ersatzschrift wird gemeldet und im Rueckgaengig-Eintrag markiert', async () => {
  test.setTimeout(120000)
  const pfad = join(verzeichnis, 'rechnung.pdf')
  writeFileSync(pfad, await cidDokument())
  const fenster = await oeffne(pfad)
  await waehleWerkzeug(fenster, 'textBearbeiten')

  // Die 7 steckt nicht in der eingebetteten Teilmenge.
  await bearbeiteZeile(fenster, 'Rechnung 2026', 'Rechnung 2027')
  await expect(fenster.getByTestId('hinweis')).toContainText('Ersatzschrift Helvetica benutzt', {
    timeout: 30000
  })
  await expect(fenster.getByTestId('hinweis')).toContainText('Originalschrift reicht nicht')
  await expect(fenster.getByTestId('rueckgaengig')).toHaveAttribute(
    'title',
    'Rückgängig: Zeile ersetzen (Seite 1) (Ersatzschrift)'
  )
  await expect(fenster.getByTestId('textebene-1')).toContainText('Rechnung 2027')

  // Mit vorhandenen Zeichen bleibt es bei der Originalschrift.
  await bearbeiteZeile(fenster, 'Bleibt unveraendert', 'Bleibt verändert')
  // Auf den Hinweis genau dieser Aenderung warten ("Ersatzschrift" allein stand
  // schon im vorigen): die Textbearbeitung laeuft im Worker (Gate Phase 6) und
  // braucht einen Moment laenger als frueher im Main-Thread.
  await expect(fenster.getByTestId('hinweis')).toContainText('nicht zuordenbar: ä', {
    timeout: 30000
  })
  await bearbeiteZeile(fenster, 'Betrag 1.250,00 EUR', 'Betrag 1.520,00 EUR')
  await expect(fenster.getByTestId('hinweis')).toContainText('Originalschrift benutzt', {
    timeout: 30000
  })
  await suche(fenster, '2027', '1 von 1')
})

test('loescht eine Zeile mit Entf; nach dem Speichern steht der Text nicht mehr in der Datei', async () => {
  test.setTimeout(120000)
  const pfad = join(verzeichnis, 'loeschen.pdf')
  copyFileSync(resolve('test/fixtures/word.pdf'), pfad)
  expect(await alleStroeme(pfad)).toContain(hex('Ausreisser'))
  const fenster = await oeffne(pfad)
  await waehleWerkzeug(fenster, 'textBearbeiten')

  await bearbeiteZeile(fenster, 'Hinweis: Ausreisser wurden nicht entfernt.', null)
  await expect(fenster.getByTestId('hinweis')).toContainText(
    'Zeile löschen (Seite 1): angewendet – Text aus dem Seiteninhalt entfernt',
    { timeout: 30000 }
  )
  await expect(fenster.getByTestId('textebene-1')).not.toContainText('Ausreisser')
  await expect(fenster.getByTestId('textebene-1')).toContainText('Methode')

  // Esc bricht ab, ohne etwas zu aendern.
  await fenster.getByRole('button', { name: 'Zeile bearbeiten: Methode', exact: true }).click()
  await fenster.getByTestId('textzeile-eingabe').press('Escape')
  await expect(fenster.getByTestId('textzeile-eingabe')).toHaveCount(0)

  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 30000 })
  const stroeme = await alleStroeme(pfad)
  expect(stroeme.toUpperCase()).not.toContain(hex('Ausreisser'))
  expect(stroeme).not.toContain('Ausreisser')
  expect(stroeme).toContain(hex('Methode'))
})
