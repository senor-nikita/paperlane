import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { beantworteRueckfragen, startApp, type GestarteteApp } from './launchApp'

/**
 * Die sieben Faelle aus S1.5.
 *
 * Zwei davon sind hier nicht ausloesbar und stehen deshalb in Unit-Tests:
 *
 * - **Keine Leseberechtigung** (Fall 3) braucht eine Datei, die der laufende
 *   Benutzer nicht lesen darf. Unter Windows hiesse das, im Test ACLs zu
 *   setzen; die Zuordnung EACCES/EPERM auf "kein Zugriff" prueft
 *   test/unit/errors.test.ts.
 * - **Absturz des Renderers** (Fall 5) meldet sich ueber einen modalen Dialog,
 *   der einen Playwright-Lauf anhalten wuerde. Die Obergrenze der Render-Queue
 *   prueft test/unit/viewer-renderqueue.test.ts.
 */

let gestartet: GestarteteApp | null = null

test.afterEach(async () => {
  await gestartet?.schliessen()
  gestartet = null
})

function sammle(verzeichnis: string): string[] {
  try {
    return readdirSync(verzeichnis, { withFileTypes: true })
      .filter((eintrag) => eintrag.isFile())
      .map((eintrag) => join(verzeichnis, eintrag.name))
  } catch {
    // Ein fehlendes Verzeichnis bedeutet: dort wurde nichts geschrieben.
    return []
  }
}

// Fall 1: beschaedigt.
test('ein beschaedigtes Dokument meldet sich und laesst die Anwendung bedienbar', async () => {
  gestartet = await startApp([resolve('test/fixtures/corrupt.pdf')])
  const meldung = gestartet.fenster.getByTestId('fehlermeldung')
  await expect(meldung).toBeVisible({ timeout: 20000 })
  await expect(meldung).toContainText('corrupt.pdf')
  // Ein Ausweg gehoert dazu, nicht nur die Feststellung des Problems.
  await expect(meldung).toContainText('anderes Dokument')
  await expect(gestartet.fenster.getByRole('button', { name: 'Datei öffnen' })).toBeEnabled()
  expect(gestartet.meldungen().filter((eintrag) => eintrag.startsWith('pageerror'))).toEqual([])
})

// Fall 2: passwortgeschuetzt.
test('ein verschluesseltes Dokument fragt nach dem Passwort und oeffnet damit', async () => {
  gestartet = await startApp([resolve('test/fixtures/encrypted.pdf')])
  await expect(gestartet.fenster.getByTestId('passwort-abfrage')).toBeVisible({ timeout: 20000 })

  // Erst ein falsches: die Abfrage muss wiederkommen und das auch sagen.
  await gestartet.fenster.getByTestId('passwort-feld').fill('falsch')
  await gestartet.fenster.getByTestId('passwort-ok').click()
  await expect(gestartet.fenster.getByTestId('passwort-abfrage')).toContainText('war falsch', {
    timeout: 20000
  })

  await gestartet.fenster.getByTestId('passwort-feld').fill('geheim')
  await gestartet.fenster.getByTestId('passwort-ok').click()
  await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('encrypted.pdf', {
    timeout: 20000
  })
  await expect(gestartet.fenster.getByTestId('passwort-abfrage')).toHaveCount(0)
})

test('die Passwortabfrage laesst sich abbrechen', async () => {
  gestartet = await startApp([resolve('test/fixtures/encrypted.pdf')])
  await expect(gestartet.fenster.getByTestId('passwort-abfrage')).toBeVisible({ timeout: 20000 })
  await gestartet.fenster.getByTestId('passwort-abbrechen').click()
  await expect(gestartet.fenster.getByTestId('hinweis')).toContainText('abgebrochen', {
    timeout: 20000
  })
  // Kein Absturz, keine Fehlerseite: die Anwendung steht wieder am Anfang.
  await expect(gestartet.fenster.getByRole('button', { name: 'Datei öffnen' })).toBeEnabled()
})

/**
 * Exit-Kriterium: das Passwort steht in keiner persistierten Datei. Es geht an
 * pdf.js im Renderer und sonst nirgendwohin.
 */
test('das Passwort landet weder in den Einstellungen noch im Protokoll', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-pw-'))
  gestartet = await startApp([
    '--user-data-dir=' + datenverzeichnis,
    resolve('test/fixtures/encrypted.pdf')
  ])
  await expect(gestartet.fenster.getByTestId('passwort-abfrage')).toBeVisible({ timeout: 20000 })
  await gestartet.fenster.getByTestId('passwort-feld').fill('geheim')
  await gestartet.fenster.getByTestId('passwort-ok').click()
  await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('encrypted.pdf', {
    timeout: 20000
  })

  const protokollverzeichnis = await gestartet.app.evaluate(({ app }) => app.getPath('logs'))
  await gestartet.schliessen()
  gestartet = null

  const dateien = [
    ...sammle(datenverzeichnis),
    ...sammle(protokollverzeichnis).filter((pfad) => pfad.endsWith('.log'))
  ]
  expect(dateien.length).toBeGreaterThan(0)
  for (const pfad of dateien) {
    expect(readFileSync(pfad, 'latin1')).not.toContain('geheim')
  }
})

// Fall 4: waehrend des Betrachtens geloescht.
test('eine geloeschte Datei wird gemeldet, die Seiten bleiben lesbar', async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-weg-'))
  const kopie = join(verzeichnis, 'fluechtig.pdf')
  copyFileSync(resolve('test/fixtures/single-page.pdf'), kopie)

  gestartet = await startApp([kopie])
  await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
  rmSync(kopie)

  await expect(gestartet.fenster.getByTestId('hinweis')).toContainText('gelöscht oder ersetzt', {
    timeout: 20000
  })
  // Die bereits geladene Seite bleibt stehen.
  await expect(gestartet.fenster.getByTestId('seiten-canvas-1')).toBeVisible()
  await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('fluechtig.pdf')
})

// Fall 3, sichtbarer Teil: eine fehlende Datei nennt genau das.
test('eine fehlende Datei nennt den Grund', async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-fehlt-'))
  const nie = join(verzeichnis, 'gibtesnicht.pdf')
  gestartet = await startApp()
  // Der Pfad kommt vom Renderer, der Main kennt ihn nicht und fragt nach; der
  // Dialog ist modal und hielte den Lauf an.
  await beantworteRueckfragen(gestartet, 'oeffnen')
  const ergebnis = await gestartet.fenster.evaluate(
    (pfad) => window.api.dokumentOeffnePfad(pfad),
    nie
  )
  expect(ergebnis.ok).toBe(false)
  if (ergebnis.ok) return
  expect(ergebnis.grund).toMatch(/nicht gefunden/)
})

// Fall 7: XFA.
test('ein XFA-Formular wird erklaert statt leer angezeigt', async () => {
  gestartet = await startApp([resolve('test/fixtures/xfa.pdf')])
  await expect(gestartet.fenster.getByTestId('xfa-hinweis')).toBeVisible({ timeout: 20000 })
  await expect(gestartet.fenster.getByTestId('xfa-hinweis')).toContainText('XFA')
  // Der statische Inhalt wird trotzdem angezeigt.
  await expect(gestartet.fenster.getByTestId('seiten-canvas-1')).toBeVisible({ timeout: 20000 })
})

// Die Klammer um alle Faelle: nichts davon darf die Anwendung zum Absturz
// bringen oder ein weisses Fenster hinterlassen.
test('eine leere Datei zerlegt die Anwendung nicht', async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-leer-'))
  const leer = join(verzeichnis, 'leer.pdf')
  writeFileSync(leer, '')

  gestartet = await startApp([leer])
  await expect(gestartet.fenster.getByRole('button', { name: 'Datei öffnen' })).toBeEnabled({
    timeout: 20000
  })
  expect(gestartet.meldungen().filter((eintrag) => eintrag.startsWith('pageerror'))).toEqual([])
})
