import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { beantworteRueckfragen, startApp, type GestarteteApp } from './launchApp'
import { waehleWerkzeug } from './werkzeug'

/**
 * Tabs bedienen (S6.1b): Leiste, Kuerzel, Fenstertitel und Sitzung.
 *
 * Das zweite Dokument kommt wie ein "Oeffnen mit" bei laufender Anwendung:
 * der Main schickt `dokumentAusSystem` auf dem Ereigniskanal, und der
 * Renderer holt die Datei ueber `dokumentOeffnePfad`. Den Dialog kann ein
 * E2E-Lauf nicht bedienen, und den Weg ueber eine zweite Instanz prueft
 * dateizuordnung.electron.spec.ts.
 *
 * Nicht hier: die Rueckfrage beim Schliessen eines Tabs mit Aenderungen. Sie
 * ist modal (wie die beim Schliessen des Fensters) und haelt den Lauf an;
 * geprueft wird sie in test/unit/tabs-store.test.ts mit attrappierter Bruecke.
 */

let gestartet: GestarteteApp | null = null

test.afterEach(async () => {
  await gestartet?.schliessen()
  gestartet = null
})

async function oeffneZusaetzlich(app: GestarteteApp, datei: string): Promise<void> {
  // Das Ereignis geht hier am Main vorbei (ohne `merkeSystempfad`, wie es das
  // echte "Oeffnen mit" tut); der Pfad ist dem Main also unbekannt und er fragt
  // nach. Der Dialog ist modal, also antwortet ein Ersatz.
  await beantworteRueckfragen(app, 'oeffnen')
  await app.app.evaluate(
    ({ BrowserWindow }, pfad) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('app:ereignis', {
        art: 'dokumentAusSystem',
        pfad
      })
    },
    resolve('test/fixtures/' + datei)
  )
  await expect(app.fenster.getByTestId('dokument-name')).toHaveText(datei, { timeout: 20000 })
}

function reiter(fenster: Page): ReturnType<Page['getByRole']> {
  return fenster.getByTestId('tableiste').getByRole('tab')
}

async function markiere(fenster: Page): Promise<void> {
  await waehleWerkzeug(fenster, 'markieren')
  await fenster.evaluate(() => {
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const treffer = spans.find((span) => span.textContent?.includes('Markierter Text'))
    if (treffer === undefined) throw new Error('Text nicht gefunden')
    const bereich = document.createRange()
    bereich.selectNodeContents(treffer)
    const auswahl = window.getSelection()
    auswahl?.removeAllRanges()
    auswahl?.addRange(bereich)
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}

function markierungen(fenster: Page): Promise<number> {
  return fenster
    .locator('[data-testid="annotationsebene-1"] [data-annotation-typ="Highlight"]')
    .count()
}

test('zwei Dokumente, zwei Tabs: die Anmerkung ueberlebt Klick und Strg+Tab', async () => {
  gestartet = await startApp([resolve('test/fixtures/annotated.pdf')])
  const { fenster } = gestartet
  await fenster.waitForSelector('[data-testid="annotationsebene-1"] [data-annotation-typ]', {
    timeout: 20000
  })
  const vorher = await markierungen(fenster)
  await markiere(fenster)
  await expect.poll(() => markierungen(fenster), { timeout: 10000 }).toBe(vorher + 1)
  await expect(fenster).toHaveTitle('annotated.pdf — paperlane')

  await oeffneZusaetzlich(gestartet, 'single-page.pdf')
  await expect(reiter(fenster)).toHaveCount(2)
  await expect(fenster.getByTestId('tab-2')).toHaveAttribute('aria-selected', 'true')
  await expect(fenster).toHaveTitle('single-page.pdf — paperlane')
  // Tab 1 traegt die ungespeicherte Markierung, auch wenn er nicht vorn liegt.
  await expect(fenster.getByTestId('tab-geaendert-1')).toBeVisible()
  await expect(fenster.getByTestId('tab-geaendert-2')).toHaveCount(0)

  // Per Klick zurueck: die Markierung ist noch da.
  await fenster.getByTestId('tab-1').click()
  await expect(fenster.getByTestId('dokument-name')).toHaveText(/^annotated\.pdf/)
  await expect(fenster.getByTestId('tab-1')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => markierungen(fenster), { timeout: 10000 }).toBe(vorher + 1)

  // Per Kuerzel hin und zurueck, beide Belegungen.
  await fenster.keyboard.press('Control+Tab')
  await expect(fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf')
  await fenster.keyboard.press('Control+Shift+Tab')
  await expect(fenster.getByTestId('dokument-name')).toHaveText(/^annotated\.pdf/)
  await fenster.keyboard.press('Control+PageDown')
  await expect(fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf')
  await fenster.keyboard.press('Control+PageUp')
  await expect(fenster.getByTestId('dokument-name')).toHaveText(/^annotated\.pdf/)
  await expect.poll(() => markierungen(fenster), { timeout: 10000 }).toBe(vorher + 1)
})

test('Strg+W schliesst nur den Tab; nach dem letzten bleibt das Fenster offen', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  const { app, fenster } = gestartet
  await expect(fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf', {
    timeout: 20000
  })
  await oeffneZusaetzlich(gestartet, 'outline.pdf')
  await expect(reiter(fenster)).toHaveCount(2)

  await fenster.keyboard.press('Control+w')
  await expect(reiter(fenster)).toHaveCount(1)
  await expect(fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf')

  // Der Schliessen-Knopf am Reiter tut dasselbe.
  await fenster.getByRole('button', { name: 'single-page.pdf schließen' }).click()
  await expect(fenster.getByTestId('tableiste')).toHaveCount(0)
  await expect(fenster.getByTestId('ansicht')).toContainText('Kein Dokument geöffnet')
  await expect(fenster).toHaveTitle('paperlane')
  // Das Fenster steht noch - Strg+W hat nicht mehr das Fenster geschlossen.
  expect(app.windows()).toHaveLength(1)
  const offen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  expect(offen).toBe(1)
})

test('Pfeiltasten bewegen den Fokus in der Leiste, Enter aktiviert', async () => {
  gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  const { fenster } = gestartet
  await expect(fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf', {
    timeout: 20000
  })
  await oeffneZusaetzlich(gestartet, 'outline.pdf')
  await oeffneZusaetzlich(gestartet, 'annotated.pdf')

  await fenster.getByTestId('tab-3').focus()
  await fenster.keyboard.press('ArrowLeft')
  await expect(fenster.getByTestId('tab-2')).toBeFocused()
  await fenster.keyboard.press('Home')
  await expect(fenster.getByTestId('tab-1')).toBeFocused()
  await fenster.keyboard.press('End')
  await expect(fenster.getByTestId('tab-3')).toBeFocused()
  await fenster.keyboard.press('ArrowRight')
  await expect(fenster.getByTestId('tab-1')).toBeFocused()
  // Nur der Fokus ist gewandert, aktiv ist noch der dritte.
  await expect(fenster.getByTestId('tab-3')).toHaveAttribute('aria-selected', 'true')
  await expect(fenster.getByTestId('tab-1')).toHaveAttribute('tabindex', '0')

  await fenster.keyboard.press('Enter')
  await expect(fenster.getByTestId('tab-1')).toHaveAttribute('aria-selected', 'true')
  await expect(fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf')
})

test('die Tabs ueberleben einen Neustart, der aktive bleibt vorn', async () => {
  const profil = mkdtempSync(join(tmpdir(), 'paperlane-tabs-'))

  const erste = await startApp(['--user-data-dir=' + profil, resolve('test/fixtures/outline.pdf')])
  gestartet = erste
  await expect(erste.fenster.getByTestId('dokument-name')).toHaveText('outline.pdf', {
    timeout: 20000
  })
  await oeffneZusaetzlich(erste, 'single-page.pdf')
  // Der erste Tab soll der aktive sein - nicht der zuletzt geoeffnete.
  await erste.fenster.getByTestId('tab-1').click()
  await expect(erste.fenster.getByTestId('dokument-name')).toHaveText('outline.pdf')
  // Gesichert wird verzoegert; gewartet wird auf die Einstellungsdatei selbst.
  await expect
    .poll(
      () =>
        erste.fenster.evaluate(async () => {
          const { sitzung } = await window.api.settingsGet()
          return (
            sitzung.tabs.map((pfad) => pfad.split(/[\\/]/).pop()).join(',') + '@' + sitzung.aktiv
          )
        }),
      { timeout: 10000 }
    )
    .toBe('outline.pdf,single-page.pdf@0')
  await erste.schliessen()
  gestartet = null

  const zweite = await startApp(['--user-data-dir=' + profil])
  gestartet = zweite
  await expect(reiter(zweite.fenster)).toHaveCount(2, { timeout: 20000 })
  await expect(zweite.fenster.getByTestId('tab-1')).toHaveText('outline.pdf')
  await expect(zweite.fenster.getByTestId('tab-2')).toHaveText('single-page.pdf')
  await expect(zweite.fenster.getByTestId('tab-1')).toHaveAttribute('aria-selected', 'true')
  await expect(zweite.fenster.getByTestId('dokument-name')).toHaveText('outline.pdf')
  await zweite.schliessen()
  gestartet = null

  // Ein Doppelklick bei geschlossener Anwendung: die Sitzung kommt zurueck,
  // die angeklickte Datei dazu - und sie liegt vorn.
  const dritte = await startApp([
    '--user-data-dir=' + profil,
    resolve('test/fixtures/annotated.pdf')
  ])
  gestartet = dritte
  await expect(reiter(dritte.fenster)).toHaveCount(3, { timeout: 20000 })
  await expect(dritte.fenster.getByTestId('tab-3')).toHaveText(/^annotated\.pdf/)
  await expect(dritte.fenster.getByTestId('tab-3')).toHaveAttribute('aria-selected', 'true')
  await expect(dritte.fenster.getByTestId('dokument-name')).toHaveText(/^annotated\.pdf/)
})
