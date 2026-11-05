import { defineConfig } from '@playwright/test'

/**
 * Zwei Projekte mit unterschiedlichem Zweck:
 *
 * - `electron` startet die gebaute Anwendung. Alle Tests, die das Produkt selbst
 *   pruefen, laufen hier.
 * - `chrome` benutzt einen echten Google Chrome. Das ist keine Bequemlichkeit:
 *   Playwrights gebuendeltes Chromium enthaelt **keinen PDF-Viewer**. Die
 *   Fremdviewer-Gegenprobe aus S2.3b — die einzige Gegenmassnahme zu R1 — waere
 *   damit nicht baubar. Fehlt Chrome, ueberspringt der Test sichtbar, statt
 *   still durchzugehen.
 *
 * Screenshot-Vergleiche: pdf.js-Ausgabe ist nicht pixelidentisch ueber
 * Betriebssysteme, Treiber und Schriftfallbacks. Ohne Toleranz und
 * plattformbenannte Baselines waeren die Vergleiche in CI flaechendeckend rot —
 * und wuerden dann abgeschaltet, also genau das entwerten, was sie sichern.
 */
export default defineConfig({
  testDir: 'test',
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2
    }
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  projects: [
    {
      name: 'electron',
      testMatch: /.*\.electron\.spec\.ts/
    },
    {
      name: 'perf',
      testMatch: /.*.perf.spec.ts/
    },
    {
      name: 'chrome',
      testMatch: /.*\.chrome\.spec\.ts/,
      use: { channel: 'chrome' }
    }
  ]
})
