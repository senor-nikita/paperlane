import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * S6.5 — Text hinzufuegen, die Exit-Kriterien durch die gebaute Anwendung.
 *
 * Zwei Aussagen, beide ueber echtes pdf.js/Electron statt einer Nachbildung:
 *
 * 1. Text mit Umlauten und `€` bleibt nach Speichern und erneutem Oeffnen
 *    bearbeitbar (Werkzeug "Text" direkt bedient).
 * 2. Nach dem Flachlegen findet die eingebaute Textsuche den Text — die
 *    Fixture dafuer entsteht ueber den echten Schreibpfad (`wendeAenderungenAn`
 *    electron-frei), **nicht** ueber den Flachlegen-Knopf: der loest einen
 *    nativen, modalen Bestaetigungsdialog aus, der den Playwright-Lauf
 *    anhielte (derselbe Grund, aus dem `formulare.electron.spec.ts` ihn nie
 *    durchklickt). `test/unit/freitext-flachlegen.test.ts` und
 *    `appearance.chrome.spec.ts` pruefen denselben Schreibpfad bereits ohne
 *    UI; hier geht es um die Verdrahtung: was er erzeugt, findet die
 *    eingebaute Suche wirklich.
 *
 * Die Fremdviewer-Gegenprobe (im Chrome sichtbar) und die BBox=/Rect-Treue auf
 * gedrehten Seiten laufen bereits generisch fuer jeden Typ aus GEMALTE_TYPEN
 * in `appearance.chrome.spec.ts` bzw. `appearance-reparse.test.ts` mit -
 * `FreeText` ist seit dieser Aenderung Teil dieser Liste.
 */

let gestartet: GestarteteApp
let verzeichnis: string

test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-freitext-'))
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffneKopie(name: string): Promise<{ fenster: Page; pfad: string }> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/single-page.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  return { fenster: gestartet.fenster, pfad }
}

const TEXT_MIT_SONDERZEICHEN = 'Größe: 10€ äöüÄÖÜß'

test('setzt Text mit Umlauten und Euro, speichert und bleibt nach dem Oeffnen bearbeitbar', async () => {
  const { fenster, pfad } = await oeffneKopie('freitext.pdf')

  await waehleWerkzeug(fenster, 'text')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })

  // Direkt tippen (Aufgabe 1): der Kasten ist nach dem Klick schon offen.
  const kastenSelector = '[data-testid^="freitextfeld-"]'
  await fenster.locator(kastenSelector).fill(TEXT_MIT_SONDERZEICHEN)
  await expect(fenster.locator(kastenSelector)).toHaveValue(TEXT_MIT_SONDERZEICHEN)
  // Verlassen: Klick auf die Werkzeugleiste committet die Aenderung (blur).
  await waehleWerkzeug(fenster, 'auswahl')

  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible({ timeout: 10000 })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  // Neu oeffnen wie nach einem Neustart.
  await gestartet.schliessen()
  gestartet = await startApp([pfad])
  const zweites = gestartet.fenster
  await zweites.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await zweites.waitForSelector('[data-testid="annotationsebene-1"] [data-annotation-typ]', {
    timeout: 20000
  })

  // Bearbeitbar: auswaehlen (Klick auf die Greifflaeche) und der Kasten
  // zeigt denselben Text - Doppelklick oeffnet ihn wie in Bearbeitungsebene.tsx.
  const greifflaeche = zweites.locator('[data-testid^="greifflaeche-"]')
  await expect(greifflaeche).toHaveCount(1, { timeout: 10000 })
  await greifflaeche.dblclick()
  await expect(zweites.locator(kastenSelector)).toHaveValue(TEXT_MIT_SONDERZEICHEN, {
    timeout: 10000
  })
})

test('Text bleibt nach dem Verlassen sichtbar und laesst sich am Rand verschieben (S6.11)', async () => {
  const { fenster } = await oeffneKopie('freitext-sichtbar.pdf')

  await waehleWerkzeug(fenster, 'text')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  const kasten = fenster.locator('[data-testid^="freitextfeld-"]')
  await kasten.fill('Bleibt stehen')
  // Daneben klicken: der Kasten schliesst sich, der Text muss bleiben.
  const seite = await fenster.locator('[data-testid="annotationsebene-1"]').boundingBox()
  if (seite === null) throw new Error('keine Seite')
  await fenster.mouse.click(seite.x + 400, seite.y + 500)
  await expect(kasten).toHaveCount(0)
  const anzeige = fenster.locator('[data-testid^="freitext-anzeige-"]')
  await expect(anzeige).toHaveText('Bleibt stehen')
  await expect(anzeige).toBeVisible()

  // Am Rand greifen (Cursor "verschieben") und ziehen.
  const greifflaeche = fenster.locator('[data-testid^="greifflaeche-"]')
  await expect(greifflaeche).toHaveCSS('cursor', 'move')
  const vorher = await anzeige.boundingBox()
  const rahmen = await greifflaeche.boundingBox()
  if (vorher === null || rahmen === null) throw new Error('keine Geometrie')
  await fenster.mouse.move(rahmen.x + 2, rahmen.y + 2)
  await fenster.mouse.down()
  await fenster.mouse.move(rahmen.x + 62, rahmen.y + 42, { steps: 5 })
  await fenster.mouse.up()
  const nachher = await anzeige.boundingBox()
  if (nachher === null) throw new Error('keine Geometrie')
  expect(nachher.x - vorher.x).toBeGreaterThan(50)
  expect(nachher.y - vorher.y).toBeGreaterThan(30)

  // Einfacher Klick ins Innere oeffnet den Kasten wieder, mit dem Text darin.
  const mitte = await anzeige.boundingBox()
  if (mitte === null) throw new Error('keine Geometrie')
  await fenster.mouse.click(mitte.x + mitte.width / 2, mitte.y + mitte.height / 2)
  await expect(kasten).toHaveValue('Bleibt stehen')
  await expect(kasten).toBeFocused()
})

test('findet flachgelegten Text im ganzen Dokument ueber die eingebaute Suche', async () => {
  const quelle = new Uint8Array(
    await (await import('node:fs/promises')).readFile(resolve('test/fixtures/single-page.pdf'))
  )
  const einzigartig = 'Flachgelegtersuchbegriff42'
  const annotation: Annotation = {
    id: 'neu-1',
    seite: 1,
    typ: 'FreeText',
    subtyp: 'FreeText',
    rect: [80, 600, 400, 660],
    quadPoints: null,
    striche: null,
    farbe: { r: 0, g: 0, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: einzigartig,
    erstellt: 'D:20260101120000Z',
    geaendert: 'D:20260101120000Z',
    versteckt: false,
    ziel: null,
    roh: null,
    schriftFamilie: 'Helvetica',
    schriftGroesse: 16,
    ausrichtung: 'links'
  }
  const aenderungen: Aenderungen = { neue: [annotation], geaendert: [], geloescht: [] }

  const { wendeAenderungenAn } = await import('../../src/main/schreibpfad')
  const bytes = await wendeAenderungenAn(quelle, aenderungen, { flachlegen: true })
  const pfad = join(verzeichnis, 'flachgelegt.pdf')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(pfad, bytes)

  // Beleg, dass die Annotation wirklich weg ist und nicht bloss unsichtbar.
  const dokument = await PDFDocument.load(bytes)
  expect(dokument.getPage(0).node.Annots()?.size() ?? 0).toBe(0)

  gestartet = await startApp([pfad])
  const fenster = gestartet.fenster
  await fenster.waitForSelector('[data-testid="such-eingabe"]', { timeout: 20000 })
  await fenster.getByTestId('such-eingabe').fill(einzigartig)
  await fenster.getByTestId('such-eingabe').press('Enter')
  await expect(fenster.getByTestId('treffer-anzeige')).toHaveText('1 von 1', { timeout: 20000 })
})
