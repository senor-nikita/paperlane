import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startApp } from './launchApp'

/**
 * Der Weg, den eine gesetzte Dateizuordnung nimmt (S5.3, Aufgabe 2).
 *
 * Ein Doppelklick auf eine PDF-Datei startet die Anwendung mit dem Pfad in der
 * `argv`. Laeuft schon eine Instanz, greift `requestSingleInstanceLock`: der
 * zweite Prozess endet sofort, und das laufende Fenster bekommt den Pfad ueber
 * `second-instance`. Fuer den Kaltstart gibt es den Test in
 * `dateieinstieg.electron.spec.ts`; hier geht es um den zweiten Start, den ein
 * Nutzer mit gesetzter Zuordnung viel haeufiger ausloest.
 *
 * Beide Prozesse brauchen dasselbe `--user-data-dir`, weil Electron die Sperre
 * am Benutzerdatenverzeichnis festmacht. Mit getrennten Verzeichnissen liefen
 * zwei unabhaengige Anwendungen, und der Test bewiese nichts.
 */
const require_ = createRequire(import.meta.url)
const ELECTRON = require_('electron') as unknown as string

test('ein zweiter Start mit Dateipfad reicht die Datei an das laufende Fenster', async () => {
  const profil = mkdtempSync(join(tmpdir(), 'paperlane-zuordnung-'))
  // Seit S6.1 mit einem schon offenen Dokument: die zweite Datei kommt in
  // einen eigenen Tab und ersetzt die erste nicht.
  const gestartet = await startApp([
    '--user-data-dir=' + profil,
    resolve('test/fixtures/outline.pdf')
  ])

  try {
    await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('outline.pdf', {
      timeout: 20000
    })
    const pfad = resolve('test/fixtures/single-page.pdf')

    const beendet = await new Promise<number | null>((fertig, fehlschlag) => {
      const zweite = spawn(ELECTRON, ['.', '--user-data-dir=' + profil, pfad], { stdio: 'ignore' })
      zweite.on('error', fehlschlag)
      zweite.on('exit', (code) => fertig(code))
    })

    // Der zweite Prozess darf nicht weiterlaufen - sonst gaebe es zwei Fenster
    // auf denselben Benutzerdaten.
    expect(beendet).toBe(0)

    await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf', {
      timeout: 20000
    })
    // Die erste Datei ist nicht ersetzt worden: zwei Reiter, der neue vorn.
    const leiste = gestartet.fenster.getByTestId('tableiste')
    await expect(leiste.getByRole('tab')).toHaveCount(2)
    await expect(gestartet.fenster.getByTestId('tab-1')).toHaveText('outline.pdf')
    await expect(gestartet.fenster.getByTestId('tab-2')).toHaveAttribute('aria-selected', 'true')
  } finally {
    await gestartet.schliessen()
  }
})
