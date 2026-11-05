import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { SCHEMA_VERSION } from '../../src/shared/settings'
import { startApp } from './launchApp'

/**
 * Die Anwendung wird mit einem eigenen --user-data-dir gestartet. Ohne das
 * wuerden die Tests die echten Einstellungen des Benutzers ueberschreiben.
 */
test('Einstellungen ueberleben einen Neustart', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-'))
  const argumente = ['--user-data-dir=' + datenverzeichnis]

  const erste = await startApp(argumente)
  try {
    const vorher = await erste.fenster.evaluate(() => window.api.settingsGet())
    expect(vorher.schemaVersion).toBe(SCHEMA_VERSION)
    expect(vorher.autorName.length).toBeGreaterThan(0)

    const geaendert = await erste.fenster.evaluate(() =>
      window.api.settingsSet({ autorName: 'Testperson' })
    )
    expect(geaendert.autorName).toBe('Testperson')
  } finally {
    await erste.schliessen()
  }

  const zweite = await startApp(argumente)
  try {
    const nachher = await zweite.fenster.evaluate(() => window.api.settingsGet())
    expect(nachher.autorName).toBe('Testperson')
  } finally {
    await zweite.schliessen()
  }
})

test('eine Aenderung mit unbekanntem Schluessel wird abgelehnt', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-e2e-'))
  const gestartet = await startApp(['--user-data-dir=' + datenverzeichnis])
  try {
    const meldung = await gestartet.fenster.evaluate(async () => {
      try {
        await (window.api.settingsSet as (p: unknown) => Promise<unknown>)({ istAdmin: true })
        return 'ANGENOMMEN'
      } catch (fehler) {
        return String(fehler)
      }
    })
    expect(meldung).not.toBe('ANGENOMMEN')
    expect(meldung).toContain('istAdmin')

    // Die Ablehnung darf die Bruecke nicht beschaedigen.
    const danach = await gestartet.fenster.evaluate(() => window.api.settingsGet())
    expect(danach.schemaVersion).toBe(SCHEMA_VERSION)
  } finally {
    await gestartet.schliessen()
  }
})
