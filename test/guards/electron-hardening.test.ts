import { describe, expect, it } from 'vitest'
import { createDruckWebPreferences, createWebPreferences } from '../../src/main/window-options'

/**
 * Invariante 5. Dieser Test friert die Haertung ein: jede Aufweichung im
 * Fenster-Code macht ihn rot.
 *
 * Er prueft die reine Funktion, nicht die laufende Anwendung. Die
 * Laufzeit-Assertion (`window.require` und `process` sind im Renderer
 * undefined) kommt mit dem E2E-Harness in S0.3 dazu — Playwright ist in S0.2
 * noch nicht installiert.
 */
describe('Haertung der webPreferences', () => {
  const prefs = createWebPreferences('/pfad/zum/preload.cjs')

  it.each([
    ['sandbox', true],
    ['contextIsolation', true],
    ['nodeIntegration', false],
    ['nodeIntegrationInWorker', false],
    ['nodeIntegrationInSubFrames', false],
    ['webSecurity', true],
    ['allowRunningInsecureContent', false],
    ['experimentalFeatures', false],
    ['webviewTag', false]
  ])('%s ist %s', (key, expected) => {
    expect(prefs[key as keyof typeof prefs]).toBe(expected)
  })

  it('reicht den Preload-Pfad durch', () => {
    expect(prefs.preload).toBe('/pfad/zum/preload.cjs')
  })

  it('laesst im Hauptfenster kein Plugin zu', () => {
    expect(prefs.plugins).toBeUndefined()
  })
})

/**
 * Das Druckfenster (S4.3, ADR 0003) ist die einzige Stelle mit einem Plugin -
 * dem Chromium-PDF-Betrachter. Alles andere bleibt so hart wie im
 * Hauptfenster, und ein Preload gibt es nicht: das Fenster hat keine Bruecke.
 */
describe('Haertung des Druckfensters', () => {
  const prefs = createDruckWebPreferences()

  it.each([
    ['plugins', true],
    ['sandbox', true],
    ['contextIsolation', true],
    ['nodeIntegration', false],
    ['nodeIntegrationInWorker', false],
    ['nodeIntegrationInSubFrames', false],
    ['webSecurity', true],
    ['allowRunningInsecureContent', false],
    ['experimentalFeatures', false],
    ['webviewTag', false]
  ])('%s ist %s', (key, expected) => {
    expect(prefs[key as keyof typeof prefs]).toBe(expected)
  })

  it('hat kein Preload', () => {
    expect(prefs.preload).toBeUndefined()
  })
})
