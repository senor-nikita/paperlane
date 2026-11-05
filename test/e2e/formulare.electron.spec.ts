import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S3.1 — AcroForm-Felder anzeigen und ausfuellen.
 *
 * Die Exit-Kriterien des Schritts, durch die gebaute Anwendung hindurch:
 * alle vier Feldtypen aus `acroform.pdf` ausfuellbar, keine doppelte
 * Darstellung alter Werte, Tab-Reihenfolge korrekt, Pflichtfeldpruefung
 * greift. Die Rechenwege pruefen die Unit-Tests; hier geht es darum, dass
 * echte Eingabeelemente ueber einer echten Seite zusammenfinden.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

/**
 * Eine eigene Kopie der Fixture: die Tests ab S3.2 speichern hinein, und die
 * Fixture selbst darf sich nicht aendern (guard:fixtures prueft sie).
 */
let verzeichnis: string
test.beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-formulare-'))
})

async function oeffneKopie(name: string): Promise<{ fenster: Page; pfad: string }> {
  const pfad = join(verzeichnis, name)
  copyFileSync(resolve('test/fixtures/acroform.pdf'), pfad)
  gestartet = await startApp([pfad])
  await gestartet.fenster.waitForSelector('[data-testid="formularfeld-person.name"]', {
    timeout: 20000
  })
  return { fenster: gestartet.fenster, pfad }
}

async function oeffneFormular(): Promise<Page> {
  gestartet = await startApp([resolve('test/fixtures/acroform.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="formularfeld-person.name"]', {
    timeout: 20000
  })
  return gestartet.fenster
}

/** Wieviele dunkle Pixel die Canvas unter einem Feld traegt. */
async function dunklePixelUnter(fenster: Page, kennung: string): Promise<number> {
  return fenster.evaluate((id) => {
    const feld = document.querySelector<HTMLElement>('[data-testid="' + id + '"]')
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="seiten-canvas-1"]')
    if (feld === null || canvas === null) throw new Error('Feld oder Canvas fehlt')
    const kontext = canvas.getContext('2d')
    if (kontext === null) throw new Error('Kein 2D-Kontext')
    const faktor = canvas.width / canvas.offsetWidth
    // Etwas nach innen: der Rahmen des Feldes ist erlaubt, der Text nicht.
    const rand = 4
    const bild = kontext.getImageData(
      Math.round((feld.offsetLeft + rand) * faktor),
      Math.round((feld.offsetTop + rand) * faktor),
      Math.max(1, Math.round((feld.offsetWidth - rand * 2) * faktor)),
      Math.max(1, Math.round((feld.offsetHeight - rand * 2) * faktor))
    )
    let treffer = 0
    for (let i = 0; i < bild.data.length; i += 4) {
      if ((bild.data[i] ?? 255) < 100 && (bild.data[i + 1] ?? 255) < 100) treffer++
    }
    return treffer
  }, kennung)
}

test('zeigt alle Felder aus acroform.pdf an ihrer Stelle', async () => {
  const fenster = await oeffneFormular()
  for (const kennung of [
    'formularfeld-person.name',
    'formularfeld-zustimmung',
    'formularfeld-anrede-frau',
    'formularfeld-anrede-herr',
    'formularfeld-land',
    'formularfeld-person.email',
    'formularfeld-kennung',
    'formularfeld-notiz',
    'formularfeld-sprachen',
    'formularfeld-betrag',
    'formularfeld-sonstiges'
  ]) {
    await expect(fenster.getByTestId(kennung)).toBeVisible()
  }
  // Das Feld liegt ueber der Seite, nicht irgendwo: sein Kasten ueberdeckt
  // den Ort, den das Dokument nennt (72/700 auf einer 842 hohen Seite).
  const feld = await fenster.getByTestId('formularfeld-person.name').boundingBox()
  const seite = await fenster.getByTestId('seite-1').boundingBox()
  if (feld === null || seite === null) throw new Error('Kasten fehlt')
  // Auf anderthalb Pixel genau: Canvas und Ebene runden getrennt, und bei
  // "An Breite anpassen" ist der Zoom keine glatte Zahl.
  const zoom = seite.width / 595
  expect(Math.abs(feld.x - seite.x - 72 * zoom)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(feld.y - seite.y - (842 - 724) * zoom)).toBeLessThanOrEqual(1.5)
})

/**
 * Exit-Kriterium "keine doppelte Darstellung alter Werte": das Dokument
 * traegt fuer person.name den Wert "Erika Muster" samt Appearance-Stream.
 * Er erscheint im Eingabefeld - und nirgends sonst. Waere `annotationMode`
 * nicht auf DISABLE, staende er zusaetzlich eingebrannt in der Canvas.
 */
test('zeigt einen vorhandenen Wert genau einmal, nicht eingebrannt', async () => {
  const fenster = await oeffneFormular()
  await expect(fenster.getByTestId('formularfeld-person.name')).toHaveValue('Erika Muster')
  // Die Textebene kennt den Wert nicht: er steht nur im Appearance-Stream.
  await expect(fenster.getByTestId('textebene-1')).not.toContainText('Erika Muster')
  // Und die Canvas ist unter dem Feld leer.
  expect(await dunklePixelUnter(fenster, 'formularfeld-person.name')).toBe(0)
})

/** Exit-Kriterium: alle vier Feldtypen ausfuellbar. */
test('laesst sich in allen vier Feldtypen ausfuellen', async () => {
  const fenster = await oeffneFormular()

  await fenster.getByTestId('formularfeld-person.name').fill('Max Muster')
  await expect(fenster.getByTestId('formularfeld-person.name')).toHaveValue('Max Muster')

  await fenster.getByTestId('formularfeld-zustimmung').check()
  await expect(fenster.getByTestId('formularfeld-zustimmung')).toBeChecked()

  await fenster.getByTestId('formularfeld-anrede-herr').check()
  await expect(fenster.getByTestId('formularfeld-anrede-herr')).toBeChecked()
  await expect(fenster.getByTestId('formularfeld-anrede-frau')).not.toBeChecked()
  // Die Gruppe hat einen Wert: die andere Wahl loest die erste ab.
  await fenster.getByTestId('formularfeld-anrede-frau').check()
  await expect(fenster.getByTestId('formularfeld-anrede-herr')).not.toBeChecked()

  await fenster.getByTestId('formularfeld-land').selectOption('Schweiz')
  await expect(fenster.getByTestId('formularfeld-land')).toHaveValue('Schweiz')

  await fenster.getByTestId('formularfeld-sprachen').selectOption(['Deutsch', 'Englisch'])
  await expect(fenster.getByTestId('formularfeld-sprachen')).toHaveValues(['Deutsch', 'Englisch'])

  await fenster.getByTestId('formularfeld-notiz').fill('Zeile eins\nZeile zwei')
  await expect(fenster.getByTestId('formularfeld-notiz')).toHaveValue('Zeile eins\nZeile zwei')

  // Was ausgefuellt ist, gilt als offen - die Marke neben dem Dateinamen.
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()
})

/** Exit-Kriterium: die Pflichtfeldpruefung greift. */
test('markiert das leere Pflichtfeld und gibt Ruhe nach der Eingabe', async () => {
  const fenster = await oeffneFormular()
  const email = fenster.getByTestId('formularfeld-person.email')
  await expect(email).toHaveAttribute('aria-required', 'true')
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveAttribute('title', 'Pflichtfeld')
  await email.fill('erika@example.org')
  await expect(email).not.toHaveAttribute('aria-invalid', 'true')
})

test('haelt ein schreibgeschuetztes Feld lesbar und unveraenderbar', async () => {
  const fenster = await oeffneFormular()
  const kennung = fenster.getByTestId('formularfeld-kennung')
  await expect(kennung).toHaveValue('K-2026')
  await expect(kennung).toHaveAttribute('readonly', '')
  await kennung.click()
  await fenster.keyboard.type('xyz')
  await expect(kennung).toHaveValue('K-2026')
})

/** Exit-Kriterium: Tab-Reihenfolge nach der im Dokument definierten Reihenfolge. */
test('tabt in der Reihenfolge des Dokuments durch die Felder', async () => {
  const fenster = await oeffneFormular()
  await fenster.getByTestId('formularfeld-person.name').focus()

  const reihenfolge: string[] = []
  for (let i = 0; i < 10; i++) {
    reihenfolge.push(
      await fenster.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '?')
    )
    await fenster.keyboard.press('Tab')
  }
  // Eine Auswahlknopf-Gruppe betritt der Fokus einmal (beim ersten Knopf,
  // solange keiner gewaehlt ist); innerhalb der Gruppe bewegen Pfeiltasten.
  expect(reihenfolge).toEqual([
    'formularfeld-person.name',
    'formularfeld-zustimmung',
    'formularfeld-anrede-frau',
    'formularfeld-land',
    'formularfeld-person.email',
    'formularfeld-kennung',
    'formularfeld-notiz',
    'formularfeld-sprachen',
    'formularfeld-betrag',
    'formularfeld-sonstiges'
  ])
})

/** Aufgabe 3: sichtbarer Fokus - nicht nur der Browserrahmen. */
test('hebt das fokussierte Feld sichtbar hervor', async () => {
  const fenster = await oeffneFormular()
  await fenster.getByTestId('formularfeld-person.name').focus()
  await fenster.keyboard.press('Tab')
  const umriss = await fenster.evaluate(() => {
    const aktiv = document.activeElement
    return aktiv === null ? '' : getComputedStyle(aktiv).outlineWidth
  })
  expect(Number.parseFloat(umriss)).toBeGreaterThanOrEqual(2)
})

/**
 * Aufgabe 4: das Zahlformat kommt aus AFNumber_Format, ohne dass das Skript
 * laeuft; das freie Skript ergibt einen Hinweis und kein Urteil.
 */
test('prueft ein Zahlformat deklarativ und meldet fremde Skripte', async () => {
  const fenster = await oeffneFormular()
  const betrag = fenster.getByTestId('formularfeld-betrag')
  await betrag.fill('viel')
  await expect(betrag).toHaveAttribute('aria-invalid', 'true')
  await betrag.fill('12,50')
  await expect(betrag).not.toHaveAttribute('aria-invalid', 'true')

  await expect(fenster.getByTestId('formular-skripthinweis-sonstiges')).toBeVisible()
  const sonstiges = fenster.getByTestId('formularfeld-sonstiges')
  await sonstiges.fill('x')
  await expect(sonstiges).not.toHaveAttribute('aria-invalid', 'true')
})

/**
 * Tasten in einem Feld gehoeren dem Feld. Vor S3.1 sprang `Home` in einer
 * textarea zur ersten Seite und `Entf` loeschte die gewaehlte Anmerkung.
 */
test('laesst Kuerzel in einem mehrzeiligen Feld nicht durch', async () => {
  const fenster = await oeffneFormular()
  const notiz = fenster.getByTestId('formularfeld-notiz')
  await notiz.fill('abc')
  await notiz.focus()
  await fenster.keyboard.press('End')
  await fenster.keyboard.press('Home')
  await fenster.keyboard.press('Delete')
  // Entf am Anfang loescht das erste Zeichen - und sonst nichts.
  await expect(notiz).toHaveValue('bc')
  await expect(fenster.getByTestId('seiten-eingabe')).toHaveValue('1')
})

/**
 * S3.2, Exit-Kriterium: ausgefuelltes acroform.pdf behaelt seine Werte nach
 * Speichern und erneutem Oeffnen. Erst pdf-lib beim Reparse, dann die
 * Anwendung selbst nach einem Neustart - pdf.js liest, was pdf-lib schrieb.
 */
test('behaelt ausgefuellte Werte nach Speichern und Neuoeffnen', async () => {
  const { fenster, pfad } = await oeffneKopie('ausgefuellt.pdf')
  await fenster.getByTestId('formularfeld-person.name').fill('Max Muster')
  await fenster.getByTestId('formularfeld-zustimmung').check()
  await fenster.getByTestId('formularfeld-anrede-herr').check()
  await fenster.getByTestId('formularfeld-land').selectOption('Schweiz')
  await fenster.getByTestId('formularfeld-sprachen').selectOption(['Deutsch', 'Englisch'])
  await fenster.getByTestId('formularfeld-notiz').fill('Zeile eins\nZeile zwei')
  await expect(fenster.getByTestId('aenderungs-marke')).toBeVisible()

  await fenster.getByTestId('speichern-knopf').click()
  await expect(fenster.getByTestId('hinweis')).toContainText('Gespeichert', { timeout: 20000 })
  // Nichts gilt mehr als offen: die Werte stehen in der Datei.
  await expect(fenster.getByTestId('aenderungs-marke')).toHaveCount(0)

  // Reparse mit pdf-lib.
  const form = (await PDFDocument.load(new Uint8Array(readFileSync(pfad)))).getForm()
  expect(form.getTextField('person.name').getText()).toBe('Max Muster')
  expect(form.getCheckBox('zustimmung').isChecked()).toBe(true)
  expect(form.getRadioGroup('anrede').getSelected()).toBe('herr')
  expect(form.getDropdown('land').getSelected()).toEqual(['Schweiz'])
  expect(form.getOptionList('sprachen').getSelected()).toEqual(['Deutsch', 'Englisch'])

  // Und in der Anwendung nach einem Neustart.
  await gestartet.schliessen()
  gestartet = await startApp([pfad])
  const zweites = gestartet.fenster
  await zweites.waitForSelector('[data-testid="formularfeld-person.name"]', { timeout: 20000 })
  await expect(zweites.getByTestId('formularfeld-person.name')).toHaveValue('Max Muster')
  await expect(zweites.getByTestId('formularfeld-zustimmung')).toBeChecked()
  await expect(zweites.getByTestId('formularfeld-anrede-herr')).toBeChecked()
  await expect(zweites.getByTestId('formularfeld-land')).toHaveValue('Schweiz')
  await expect(zweites.getByTestId('formularfeld-sprachen')).toHaveValues(['Deutsch', 'Englisch'])
  await expect(zweites.getByTestId('formularfeld-notiz')).toHaveValue('Zeile eins\nZeile zwei')
  await expect(zweites.getByTestId('aenderungs-marke')).toHaveCount(0)
})

test('zeigt die Formularknoepfe nur bei einem Formular', async () => {
  const fenster = await oeffneFormular()
  await expect(fenster.getByTestId('flachlegen-knopf')).toBeVisible()
  await expect(fenster.getByTestId('fdf-knopf')).toBeVisible()
})

test('zeigt keine Meldungen auf der Konsole', async () => {
  const fenster = await oeffneFormular()
  await fenster.getByTestId('formularfeld-person.name').fill('x')
  await fenster.getByTestId('formularfeld-land').selectOption('Schweiz')
  expect(gestartet.meldungen()).toEqual([])
})
