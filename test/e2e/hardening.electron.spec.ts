import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * Die drei Laufzeit-Assertions, die in S0.2 nicht moeglich waren, weil
 * Playwright dort noch nicht installiert war. Sie gehoeren zu den
 * Exit-Kriterien von S0.3 (Planaenderung, protokolliert in Abschnitt 7).
 *
 * Der statische Teil derselben Invarianten liegt in test/guards/.
 */
let gestartet: GestarteteApp

test.beforeEach(async () => {
  gestartet = await startApp()
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('der Renderer hat keinen Zugriff auf Node (Invariante 5)', async () => {
  const typen = await gestartet.fenster.evaluate(() => {
    const global = window as unknown as Record<string, unknown>
    return {
      require: typeof global['require'],
      process: typeof global['process'],
      module: typeof global['module'],
      Buffer: typeof global['Buffer']
    }
  })
  expect(typen).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    Buffer: 'undefined'
  })
})

test('der IPC-Roundtrip laeuft gegen den Produktionsbuild', async () => {
  const antwort = await gestartet.fenster.evaluate(() => window.api.ping())
  expect(antwort).toBe('pong')
})

test('die Bruecke gibt nur die Contract-Methoden frei', async () => {
  const schluessel = await gestartet.fenster.evaluate(() => Object.keys(window.api).sort())
  // `beiEreignis` ist die eine bewusste Ausnahme vom Anfrage/Antwort-Muster:
  // ein Menueklick entsteht im Main-Prozess (ADR 0002). Ein zweiter solcher
  // Eintrag darf hier nicht auftauchen, ohne dass das ADR fortgeschrieben wird.
  // `pfadVonDatei` ist kein IPC, sondern die einzige Stelle, an der der Pfad
  // einer fallengelassenen Datei zu holen ist: `File.path` gibt es seit
  // Electron 32 nicht mehr.
  // `externOeffnen` (S2.1) ist der einzige Weg nach draussen: Navigation
  // bleibt gesperrt, das Schema prueft der Main gegen eine Allowlist und fragt
  // vorher nach.
  // `dokumentSpeichern` und `dokumentGeaendert` (S2.3a) sind der einzige Weg
  // zum Schreiben: der Main prueft den Zielpfad gegen ein Dialogergebnis
  // (Invariante 11), warnt bei Signaturen und schreibt atomar.
  expect(schluessel).toEqual([
    'beiEreignis',
    'bildLaden',
    'bilderWaehlen',
    'bilderZuPdf',
    'dokumentBeimStart',
    'dokumentDrucken',
    'dokumentGeaendert',
    'dokumentMutieren',
    'dokumentOeffnePfad',
    'dokumentOeffnen',
    'dokumentSchliessen',
    'dokumentSpeichern',
    'dokumentStandHerstellen',
    'dokumentTeilen',
    'dokumenteWaehlen',
    'dokumenteZusammenfuehren',
    'druckAbbrechen',
    'externOeffnen',
    'formularFdfExportieren',
    'pfadVonDatei',
    'ping',
    'pngSchreiben',
    'pngZieleWaehlen',
    'seitenExtrahieren',
    'settingsGet',
    'settingsSet',
    'spracheGet',
    'tabSchliessenFragen',
    'wordExportieren',
    'zuletztGeoeffnet'
  ])
})

test('die Oberflaeche kommt hoch und nutzt die Bruecke', async () => {
  // Die Werkzeugleiste erscheint erst, wenn React gemountet hat; beim Mounten
  // fragt die Anwendung ueber die Bruecke nach einem Startdokument. Ist sie
  // sichtbar, hat beides funktioniert.
  await expect(gestartet.fenster.getByRole('button', { name: 'Datei öffnen' })).toBeVisible()
  await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('kein Dokument')
})
