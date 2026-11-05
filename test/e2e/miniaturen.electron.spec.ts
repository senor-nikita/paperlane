import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffneGrossesDokument(): Promise<void> {
  gestartet = await startApp([resolve('test/fixtures/large-500.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="miniatur-1"]', { timeout: 20000 })
}

/**
 * Exit-Kriterium des Schritts: der Sprung ueber eine Miniatur landet auf der
 * richtigen Seite.
 */
test('der Klick auf eine Miniatur springt zur richtigen Seite', async () => {
  await oeffneGrossesDokument()
  await gestartet.fenster.getByTestId('miniatur-4').click()
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).toHaveValue('4', {
    timeout: 15000
  })
})

/**
 * Dieselbe Regel wie in der Hauptansicht: bei 500 Seiten liegt nur eine
 * Handvoll Miniaturen im DOM. Ohne das kostete die Sidebar mehr als die
 * Ansicht, die sie begleitet.
 */
test('virtualisiert: nur wenige Miniaturen liegen im DOM', async () => {
  await oeffneGrossesDokument()
  const anzahl = await gestartet.fenster.evaluate(
    () => document.querySelectorAll('[data-testid^="miniatur-canvas-"]').length
  )
  expect(anzahl).toBeGreaterThan(0)
  expect(anzahl).toBeLessThanOrEqual(12)
})

// Ohne Mitfuehrung zeigt die Sidebar weiter den Anfang, waehrend die
// Hauptansicht laengst woanders steht - dann ist die Markierung wertlos.
test('die Sidebar fuehrt die aktuelle Seite mit', async () => {
  await oeffneGrossesDokument()
  await gestartet.fenster.getByTestId('seiten-eingabe').fill('300')
  await gestartet.fenster.getByTestId('seiten-eingabe').press('Enter')
  await expect(gestartet.fenster.getByTestId('miniatur-300')).toHaveAttribute(
    'aria-current',
    'page',
    { timeout: 20000 }
  )
})

test('F4 blendet die Miniaturen aus und wieder ein', async () => {
  await oeffneGrossesDokument()
  await gestartet.fenster.keyboard.press('F4')
  await expect(gestartet.fenster.getByTestId('miniaturen')).toBeHidden({ timeout: 10000 })
  await gestartet.fenster.keyboard.press('F4')
  await expect(gestartet.fenster.getByTestId('miniaturen')).toBeVisible({ timeout: 10000 })
})

test('das Ansicht-Menue kennt den Schalter fuer die Seitenleiste', async () => {
  await oeffneGrossesDokument()
  const eintrag = await gestartet.app.evaluate(({ Menu }) => {
    const ansicht = Menu.getApplicationMenu()?.items.find((e) => e.label === 'Ansicht')
    const schalter = ansicht?.submenu?.items.find((e) => /seitenleiste/i.test(e.label))
    return { label: schalter?.label ?? '', accelerator: schalter?.accelerator ?? '' }
  })
  expect(eintrag.label).toMatch(/Seitenleiste/i)
  expect(eintrag.accelerator).toBe('F4')
})

/**
 * Die Tastenbedienung der Auswahlliste (S5.2a, Aufgabe 1) - im Gate Phase 5
 * ohne jeden Test gefunden. Pfeile und Pos1/Ende bewegen die aktive Seite,
 * `aria-activedescendant` folgt, Umschalt erweitert die Auswahl.
 */
test('die Miniaturenliste laesst sich mit der Tastatur bedienen', async () => {
  await oeffneGrossesDokument()
  const liste = gestartet.fenster.getByTestId('miniaturen')
  const seite = gestartet.fenster.getByTestId('seiten-eingabe')
  await liste.focus()

  await liste.press('ArrowDown')
  await expect(seite).toHaveValue('2', { timeout: 15000 })
  await expect(liste).toHaveAttribute('aria-activedescendant', 'miniatur-option-2')

  await liste.press('Shift+ArrowDown')
  await expect(seite).toHaveValue('3', { timeout: 15000 })
  await expect(gestartet.fenster.getByTestId('miniatur-2')).toHaveAttribute('aria-selected', 'true')
  await expect(gestartet.fenster.getByTestId('miniatur-3')).toHaveAttribute('aria-selected', 'true')

  await liste.press('End')
  await expect(seite).toHaveValue('500', { timeout: 20000 })
  await liste.press('ArrowUp')
  await expect(seite).toHaveValue('499', { timeout: 20000 })
  await liste.press('Home')
  await expect(seite).toHaveValue('1', { timeout: 20000 })
  // Der Fokus bleibt in der Liste, obwohl die Miniaturen virtualisiert sind.
  await expect(liste).toBeFocused()
})
