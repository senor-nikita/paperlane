import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * S2.3a — der Schreibpfad in der gebauten Anwendung.
 *
 * Das Exit-Kriterium, das nur hier zu belegen ist: **Speichern ueber die
 * geoeffnete Originaldatei gelingt unter Windows beim ersten Versuch.** Genau
 * daran scheitern Betrachter, die ein Handle auf die Datei halten — das
 * Umbenennen der temporaeren Nachbardatei endet dann mit EPERM. ADR 0001,
 * Punkt 4 verlangt deshalb Handles nur je Lesevorgang; dieser Lauf prueft,
 * dass es so ist.
 *
 * Die Dialoge bleiben aussen vor: sie sind modal und hielten den Lauf an. Ihre
 * Reihenfolge prueft `test/unit/ipc-speichern.test.ts` am echten Handler.
 */
const TEMP_ENDUNG = '.paperlane-tmp'

let gestartet: GestarteteApp
let verzeichnis: string

test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-speichern-'))
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

/**
 * Eine eigene Kopie der Fixture, ueber die Befehlszeile geoeffnet.
 *
 * Der Weg ist nicht beliebig: ein Pfad aus der Befehlszeile kommt vom
 * Betriebssystem und traegt das Schreibrecht. Ein per Drag & Drop uebergebener
 * Pfad taete das nicht — dort ist "Speichern unter" der vorgesehene Weg.
 */
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

/** Wieviele Annotationen die Datei auf der Platte insgesamt traegt. */
async function annotationenInDatei(pfad: string): Promise<number> {
  const dokument = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
  let summe = 0
  for (let seite = 0; seite < dokument.getPageCount(); seite++) {
    summe += dokument.getPage(seite).node.Annots()?.size() ?? 0
  }
  return summe
}

/** Die Annotations-Dictionaries der ersten Seite einer gespeicherten Datei. */
async function ersteSeiteAusDatei(
  pfad: string
): Promise<{ dokument: PDFDocument; liste: PDFDict[] }> {
  const dokument = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
  const feld = dokument.getPage(0).node.Annots()
  const liste: PDFDict[] = []
  if (feld !== undefined) {
    for (let i = 0; i < feld.size(); i++) liste.push(feld.lookup(i, PDFDict))
  }
  return { dokument, liste }
}

test('speichert eine neue Anmerkung in die geoeffnete Originaldatei', async () => {
  const { fenster, pfad } = await oeffneKopie('bericht.pdf')
  const vorher = await annotationenInDatei(pfad)

  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  // Die Marke neben dem Dateinamen sagt, dass etwas offen ist.
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible({ timeout: 10000 })

  // Beim ersten Versuch: ein Klick, kein zweiter Anlauf.
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  // Was geschrieben wurde, ist ein gueltiges PDF mit einer Anmerkung mehr.
  expect(await annotationenInDatei(pfad)).toBe(vorher + 1)
  // Kein Rest vom atomaren Schreiben.
  expect(existsSync(pfad + TEMP_ENDUNG)).toBe(false)
  // Und nichts gilt mehr als offen.
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)
})

/**
 * S2.3b, durch die gebaute Anwendung hindurch: was paperlane schreibt, traegt
 * ein Erscheinungsbild.
 *
 * Die Streams selbst pruefen `test/unit/erscheinungsbild.test.ts` und
 * `test/unit/appearance-reparse.test.ts`, ihre Wirkung in einem fremden
 * Betrachter `test/e2e/appearance.chrome.spec.ts`. Hier geht es allein um die
 * Verdrahtung: der Weg von einem Klick im Fenster bis in die Datei.
 */
test('gibt einer gespeicherten Anmerkung ein Erscheinungsbild', async () => {
  const { fenster, pfad } = await oeffneKopie('erscheinung.pdf')
  const vorher = (await ersteSeiteAusDatei(pfad)).liste.length

  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 140, y: 220 } })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  const { dokument, liste } = await ersteSeiteAusDatei(pfad)
  expect(liste.length).toBe(vorher + 1)

  const neue = liste[liste.length - 1]
  const ap = neue?.lookup(PDFName.of('AP'), PDFDict)
  expect(ap, 'Ohne /AP waere die Notiz in fremden Betrachtern unsichtbar (R1)').toBeDefined()
  const strom = dokument.context.lookup(ap?.get(PDFName.of('N')), PDFStream)
  expect(strom.getContents().length).toBeGreaterThan(0)
})

/**
 * Gate Phase 2, H1 — durch beide Bibliotheken hindurch: pdf-lib schreibt,
 * pdf.js liest. Der Unit-Test belegt den Reparse mit pdf-lib; hier wird
 * die gespeicherte Datei in der Anwendung neu geoeffnet, und pdf.js muss die
 * Hex-Strings samt Umlauten und Klammern in denselben Text zurueckverwandeln.
 *
 * Vor dem Fix beendete die Klammer den Literal-String, und die Notiz kam ohne
 * Text oder gar nicht zurueck.
 */
test('bringt Klammern und Umlaute in einer Notiz unversehrt zurueck', async () => {
  const { fenster, pfad } = await oeffneKopie('sonderzeichen.pdf')
  const text = 'Klammer ) zu, Umlaute äöü, Apostroph ’, Backslash \\'

  // Die vorhandene Notiz oeffnen und ihren Text ersetzen. Der Zettel
  // uebernimmt beim Verlassen des Feldes.
  await fenster.locator('[data-testid^="greifflaeche-"]').first().click()
  const eingabe = fenster.locator('[data-testid^="annotation-notiz-eingabe-"]')
  await expect(eingabe).toHaveValue('Vorhandene Notiz')
  await eingabe.fill(text)
  await eingabe.press('Tab')
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible({ timeout: 10000 })

  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  // Neu oeffnen - jetzt liest pdf.js, was pdf-lib geschrieben hat.
  await gestartet.schliessen()
  gestartet = await startApp([pfad])
  const zweites = gestartet.fenster
  await zweites.waitForSelector('[data-testid="annotationsebene-1"] [data-annotation-typ]', {
    timeout: 20000
  })
  await zweites.locator('[data-testid^="greifflaeche-"]').first().click()
  await expect(zweites.locator('[data-testid^="annotation-notiz-eingabe-"]')).toHaveValue(text)
})

test('speichert ueber das Tastenkuerzel', async () => {
  const { fenster, pfad } = await oeffneKopie('kuerzel.pdf')
  const vorher = await annotationenInDatei(pfad)

  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 160, y: 240 } })
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible({ timeout: 10000 })

  await fenster.keyboard.press('Control+s')
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })
  expect(await annotationenInDatei(pfad)).toBe(vorher + 1)
})

test('schreibt eine geloeschte Anmerkung aus der Datei heraus', async () => {
  const { fenster, pfad } = await oeffneKopie('geloescht.pdf')
  const vorher = await annotationenInDatei(pfad)
  expect(vorher).toBeGreaterThan(0)

  // Ueber die Anmerkungsliste auswaehlen: Markierungen liegen ueber Text und
  // sind absichtlich nicht anklickbar (das naehme die Textauswahl aus S1.4).
  await fenster.getByTestId('reiter-anmerkungen').click()
  await fenster.locator('[data-testid="annotationsliste"] li button').first().click()
  await fenster.keyboard.press('Delete')

  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible({ timeout: 10000 })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  expect(await annotationenInDatei(pfad)).toBe(vorher - 1)
})

test('sagt, dass es nichts zu speichern gibt', async () => {
  const { fenster } = await oeffneKopie('unveraendert.pdf')

  await fenster.getByTestId('speichern-knopf').click()

  await expect(fenster.getByTestId('hinweis')).toContainText('nichts zu speichern', {
    timeout: 20000
  })
})

/**
 * Exit-Kriterium: der Schreibpfad ist bei einem mit Passwort geoeffneten
 * Dokument deaktiviert — und der Grund steht dabei. pdf-lib kann solche
 * Dokumente nicht entschluesseln; ein Neuschreiben ergaebe eine beschaedigte
 * Datei.
 */
test('sperrt den Schreibpfad bei einem passwortgeschuetzten Dokument', async () => {
  gestartet = await startApp([resolve('test/fixtures/encrypted.pdf')])
  const fenster = gestartet.fenster
  await expect(fenster.getByTestId('passwort-abfrage')).toBeVisible({ timeout: 20000 })
  await fenster.getByTestId('passwort-feld').fill('geheim')
  await fenster.getByTestId('passwort-ok').click()
  await expect(fenster.getByTestId('dokument-name')).toContainText('encrypted.pdf', {
    timeout: 20000
  })

  await expect(fenster.getByTestId('speichern-knopf')).toBeDisabled()
  await expect(fenster.getByTestId('speichern-unter-knopf')).toBeDisabled()
  await expect(fenster.getByTestId('verschluesselt-hinweis')).toContainText('nicht speichern')
})

test('speichert ohne Meldungen auf der Konsole', async () => {
  const { fenster } = await oeffneKopie('leise.pdf')
  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 100, y: 300 } })
  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })

  expect(gestartet.meldungen()).toEqual([])
})
