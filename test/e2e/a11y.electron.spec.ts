import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { beantworteRueckfragen, startApp, type GestarteteApp } from './launchApp'

/**
 * axe ueber den wichtigsten Ansichten (S5.2a, Aufgabe 6; Exit-Kriterium:
 * keine kritischen Verstoesse).
 *
 * Geprueft werden WCAG 2.x A und AA. Angeschlagen wird bei `critical` und
 * `serious`; `moderate` und `minor` erscheinen im Protokoll, brechen den
 * Lauf aber nicht - sie sind Hinweise, keine Sperren. Was bewusst
 * ausgenommen ist, steht mit Grund in `AUSGENOMMEN`.
 *
 * Die Textebene bleibt drin: sie ist echter DOM-Text mit `color:
 * transparent`; die sichtbare Fassung traegt die Canvas-Grafik darunter.
 */

/** Regeln, die hier nicht gelten - jede mit Grund. Derzeit keine. */
const AUSGENOMMEN: string[] = []

const BLOCKIEREND = new Set(['critical', 'serious'])

async function pruefe(fenster: Page, bereich: string): Promise<void> {
  const ergebnis = await new AxeBuilder({ page: fenster })
    // Ohne Legacy-Modus oeffnet axe fuer die Auswertung eine leere Seite im
    // Kontext - unter Electron gibt es keine ("Target.createTarget: Not
    // supported"). Der Legacy-Modus wertet im Fenster selbst aus; die
    // Anwendung hat keine iframes, der Unterschied traegt hier nichts.
    .setLegacyMode(true)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(AUSGENOMMEN)
    .analyze()

  // Ein leeres Ergebnis waere kein Erfolg, sondern ein axe, das nichts sah.
  expect(ergebnis.passes.length, '[axe ' + bereich + '] keine geprueften Regeln').toBeGreaterThan(
    10
  )
  const blockierend = ergebnis.violations.filter((v) => BLOCKIEREND.has(v.impact ?? ''))
  const hinweise = ergebnis.violations.filter((v) => !BLOCKIEREND.has(v.impact ?? ''))
  if (hinweise.length > 0) {
    console.log(
      '[axe ' +
        bereich +
        '] Hinweise: ' +
        hinweise.map((v) => v.id + ' (' + String(v.nodes.length) + ')').join(', ')
    )
  }
  const bericht = blockierend
    .map(
      (v) =>
        v.id +
        ' [' +
        String(v.impact) +
        ']: ' +
        v.help +
        '\n  ' +
        v.nodes
          .slice(0, 5)
          .map((n) => n.target.join(' '))
          .join('\n  ')
    )
    .join('\n')
  expect(blockierend, '[axe ' + bereich + ']\n' + bericht).toEqual([])
}

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

// S6.8: jede Ansicht in beiden Sprachen. Andere Texte heissen andere Laengen,
// andere Beschriftungen und ein anderes `lang` - jedes davon kann einen
// Befund ausloesen, den die andere Sprache nicht hat.
for (const locale of ['de-DE', 'en-US']) {
  test.describe(locale, () => {
    test('Startseite ohne Dokument', async () => {
      gestartet = await startApp(['--lang=' + locale])
      await gestartet.fenster.waitForSelector('[data-testid="ansicht"]')
      await pruefe(gestartet.fenster, 'Startseite ' + locale)
    })

    test('Dokument mit Seitenleiste, Textebene und Miniaturen', async () => {
      gestartet = await startApp(['--lang=' + locale, resolve('test/fixtures/single-page.pdf')])
      await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
      await gestartet.fenster.waitForSelector('[data-testid="textebene-1"] span')
      await pruefe(gestartet.fenster, 'Dokument ' + locale)
    })

    test('Anmerkungsliste und Werkzeugleiste', async () => {
      gestartet = await startApp(['--lang=' + locale, resolve('test/fixtures/annotated.pdf')])
      await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
      await gestartet.fenster.getByTestId('reiter-anmerkungen').click()
      await pruefe(gestartet.fenster, 'Anmerkungen ' + locale)
    })

    test('Formularfelder', async () => {
      gestartet = await startApp(['--lang=' + locale, resolve('test/fixtures/acroform.pdf')])
      await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
      await gestartet.fenster.waitForSelector(
        '[data-testid="formularebene-1"] :is(input, select, textarea)'
      )
      await pruefe(gestartet.fenster, 'Formular ' + locale)
    })

    // S6.1b: die Tab-Leiste mit mehreren Reitern.
    test('Tab-Leiste mit mehreren Dokumenten', async () => {
      gestartet = await startApp(['--lang=' + locale, resolve('test/fixtures/single-page.pdf')])
      const { app, fenster } = gestartet
      await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
      // Das Ereignis geht am Main vorbei (kein `merkeSystempfad`): er kennt den
      // Pfad nicht und fragt nach. Der Dialog ist modal, also antwortet ein Ersatz.
      await beantworteRueckfragen(gestartet, 'oeffnen')
      await app.evaluate(({ BrowserWindow }, pfad) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('app:ereignis', {
          art: 'dokumentAusSystem',
          pfad
        })
      }, resolve('test/fixtures/annotated.pdf'))
      await expect(fenster.getByTestId('tab-2')).toHaveAttribute('aria-selected', 'true', {
        timeout: 20000
      })
      await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
      await expect(
        fenster.getByRole('tablist', {
          name: locale === 'de-DE' ? 'Offene Dokumente' : 'Open documents'
        })
      ).toBeVisible()
      await pruefe(fenster, 'Tab-Leiste ' + locale)
    })

    test('Eingeblendete Felder: Einstellungen, Kuerzel, Drucken', async () => {
      gestartet = await startApp(['--lang=' + locale, resolve('test/fixtures/single-page.pdf')])
      const { fenster } = gestartet
      await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })

      await fenster.keyboard.press('Control+,')
      await fenster.waitForSelector('[data-testid="einstellungen"]')
      await pruefe(fenster, 'Einstellungen ' + locale)
      await fenster.keyboard.press('Escape')

      await fenster.keyboard.press('F1')
      await fenster.waitForSelector('[data-testid="kuerzeluebersicht"]')
      await pruefe(fenster, 'Kuerzeluebersicht ' + locale)
      await fenster.keyboard.press('Escape')

      await fenster.keyboard.press('Control+p')
      await fenster.waitForSelector('[data-testid="drucken"]')
      await pruefe(fenster, 'Drucken ' + locale)
    })
  })
}
