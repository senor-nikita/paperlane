import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * Angriffstest zu S5.2b, Aufgabe 3: eingebettetes PDF-JavaScript darf im
 * Anzeigepfad nicht ausgefuehrt werden.
 *
 * `js-embedded.pdf` (aus S0.3) traegt zwei Einstiegspunkte fuer dieselbe
 * Aktion: eine `/OpenAction` am Katalog und einen Eintrag im
 * `/JavaScript`-Namensbaum. Beide rufen
 * `app.alert("Dieses Skript haette nicht laufen duerfen.")`.
 *
 * Fuer den Druckpfad gibt es den Nachweis schon: `entferneSkripte` raeumt
 * beides weg, bevor die Vorlage an den Chromium-Betrachter geht
 * (test/unit/druck.test.ts, ADR 0003). Fuer den Anzeigepfad gab es bisher nur
 * die Konfiguration `enableScripting: false` und den statischen Guard
 * test/guards/pdfjs-haertung.test.ts — aber keinen Lauf, der die Fixture
 * tatsaechlich oeffnet. Diese Luecke schliesst diese Datei.
 *
 * **Was der Test beweist und was nicht.** Er belegt, dass das Oeffnen der
 * Fixture keine Skriptspur hinterlaesst: kein Dialogtext im Fenster, keine
 * Konsolenausgabe, kein `pageerror`, und die Seite wird trotzdem gezeichnet.
 * Er kann nicht beweisen, dass pdf.js das Skript "gesehen und verworfen" hat —
 * diese Aussage traegt der Guard ueber die Optionen. Der Konsolen-Teil ist
 * dabei der eigentliche Draht: wuerde jemand `enableScripting` einschalten,
 * suchte pdf.js eine Sandbox, die diese Anwendung nie einbindet, und meldete
 * das auf der Konsole. Stille ist hier also ein Ergebnis, kein Zufall.
 */
let gestartet: GestarteteApp | undefined

test.afterEach(async () => {
  await gestartet?.schliessen()
  gestartet = undefined
})

const SKRIPTTEXT = 'haette nicht laufen duerfen'

test('eingebettetes JavaScript laeuft beim Anzeigen nicht', async () => {
  gestartet = await startApp([resolve('test/fixtures/js-embedded.pdf')])

  // Das Dokument wird ueberhaupt angezeigt - sonst waere die Stille unten
  // wertlos, weil gar nichts passiert waere.
  await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('js-embedded.pdf', {
    timeout: 20000
  })
  await expect(gestartet.fenster.getByTestId('seiten-canvas-1')).toBeVisible({ timeout: 20000 })

  // Der Text aus dem Skript steht nirgends im Fenster. Ein ausgefuehrtes
  // `app.alert` haette ihn in eine Meldung oder einen Dialog gebracht.
  await expect(gestartet.fenster.getByText(SKRIPTTEXT, { exact: false })).toHaveCount(0)

  // Keine Konsolenausgabe und kein pageerror. `launchApp` filtert nur die
  // bekannten Electron-Eigenmeldungen heraus.
  expect(gestartet.meldungen()).toEqual([])

  // Auch der Text, den die Fixture sichtbar auf die Seite schreibt, ist nur
  // Zeichnung: die Textebene traegt ihn, ein Skript lief dafuer nicht.
  await expect(gestartet.fenster.getByTestId('textebene-1')).toBeVisible({ timeout: 20000 })
})
