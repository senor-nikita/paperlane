import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

/**
 * Der Kern von S1.3b. Ein eigenes Anwendungsmenue verdraengt Electrons
 * Standardmenue; ohne die Rollen `copy` und `selectAll` waere Strg+C auf der
 * Textauswahl tot und die Volltextsuche aus S1.4 damit wirkungslos.
 */
test('das Bearbeiten-Menue behaelt Kopieren und Alles auswaehlen', async () => {
  gestartet = await startApp()
  const rollen = await gestartet.app.evaluate(({ Menu }) => {
    const menue = Menu.getApplicationMenu()
    const bearbeiten = menue?.items.find((eintrag) => eintrag.label === 'Bearbeiten')
    // Electron gibt Rollen kleingeschrieben zurueck ("selectall").
    return bearbeiten?.submenu?.items.map((eintrag) => (eintrag.role ?? '').toLowerCase()) ?? []
  })
  expect(rollen).toContain('copy')
  expect(rollen).toContain('selectall')
})

test('setzt ueberhaupt ein eigenes Anwendungsmenue', async () => {
  gestartet = await startApp()
  const beschriftungen = await gestartet.app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((eintrag) => eintrag.label)
  )
  expect(beschriftungen).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Hilfe'])
})

/**
 * Exit-Kriterium: Text auswaehlen, Strg+C, Inhalt der Zwischenablage entspricht
 * der Auswahl.
 *
 * Der Test fasst die echte Zwischenablage des Rechners an — anders ist
 * Kopieren nicht pruefbar. Gelesen wird sie aus dem Main-Prozess; ueber die
 * Browser-Schnittstelle braeuchte es Berechtigungen, die in Electron nicht
 * verlaesslich gesetzt sind.
 */
test('kopiert die Textauswahl mit Strg+C in die Zwischenablage', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="textebene-1"] span', { timeout: 20000 })

  // Auf eine feste Zoomstufe stellen und warten, bis sie steht. Mit "an Breite
  // anpassen" rechnet die Ansicht den Zoom nach jeder Groessenaenderung neu -
  // seit die Sidebar Platz wegnimmt, faellt eine solche Neuberechnung mitten in
  // diesen Test, und mit dem neu aufgebauten Textlayer waere die Auswahl weg.
  await gestartet.fenster.keyboard.press('Control+0')
  await expect(gestartet.fenster.getByTestId('zoom-anzeige')).toHaveValue('100 %')

  // Vorher leeren, sonst koennte ein alter Inhalt den Test bestehen lassen.
  await gestartet.app.evaluate(({ clipboard }) => {
    void clipboard.writeText('')
  })

  const auswahl = await gestartet.fenster.evaluate(() => {
    const span = document.querySelector('[data-testid="textebene-1"] span')
    if (span === null) return ''
    const bereich = document.createRange()
    bereich.selectNodeContents(span)
    const markierung = window.getSelection()
    markierung?.removeAllRanges()
    markierung?.addRange(bereich)
    return markierung?.toString() ?? ''
  })
  expect(auswahl.trim().length).toBeGreaterThan(0)

  // Das Fenster muss das aktive sein: mit eigenem Anwendungsmenue laeuft Strg+C
  // ueber den Accelerator der `copy`-Rolle, und der greift nur im fokussierten
  // Fenster. Kurz zuvor beendete Instanzen aus anderen Tests koennen den Fokus
  // noch halten - deshalb hier ausdruecklich holen und den Tastendruck im Poll
  // wiederholen, statt einmal zu druecken und zu hoffen.
  await gestartet.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.focus()
  })

  await expect
    .poll(
      async () => {
        await gestartet.fenster.keyboard.press('Control+c')
        return gestartet.app.evaluate(({ clipboard }) => clipboard.readText())
      },
      { timeout: 15000 }
    )
    .toBe(auswahl)
})

/**
 * Wuerde das Menue seine Accelerators beim System registrieren, wirkte ein
 * Tastendruck zweimal: einmal ueber den Menueeintrag, einmal ueber die
 * Behandlung im Fenster. Genau das schliesst ADR 0002 aus.
 */
test('zoomt bei einem Tastendruck genau eine Stufe', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="zoom-anzeige"]', { timeout: 20000 })

  // Beim Oeffnen passt sich das Dokument der Fensterbreite an; der Anfangswert
  // haengt damit an der Fenstergroesse. Erst auf 100 % stellen, dann messen.
  await gestartet.fenster.keyboard.press('Control+0')
  await expect(gestartet.fenster.getByTestId('zoom-anzeige')).toHaveValue('100 %')

  // NumpadAdd liefert das Zeichen "+" ohne Umschalttaste - unabhaengig vom
  // Tastaturlayout des Rechners.
  await gestartet.fenster.keyboard.press('Control+NumpadAdd')
  await expect(gestartet.fenster.getByTestId('zoom-anzeige')).toHaveValue('125 %')
})

test('springt mit Strg+F in das Suchfeld', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="such-eingabe"]', { timeout: 20000 })
  await gestartet.fenster.keyboard.press('Control+f')
  const testid = await gestartet.fenster.evaluate(() =>
    document.activeElement?.getAttribute('data-testid')
  )
  expect(testid).toBe('such-eingabe')
})
