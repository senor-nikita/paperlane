import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENTRY = 'out/main/index.js'

/**
 * Meldungen, die Electron oder Chromium von sich aus erzeugen und die nichts
 * ueber die Anwendung aussagen. Ohne diese Liste waere jeder Konsolen-Test von
 * Anfang an flaky. Die Liste ist bewusst kurz — jeder Eintrag muss begruendbar
 * sein.
 *
 * Electron-Sicherheitswarnungen stehen ausdruecklich NICHT auf der Liste.
 * Sie zu erlauben hiesse, eine aufgeweichte Haertung stillschweigend
 * durchgehen zu lassen — genau das, was der Smoke-Test aufdecken soll.
 */
const ERLAUBTE_MELDUNGEN = [/Autofill\.enable/, /Autofill\.setAddresses/, /Request Autofill\./]

export interface GestarteteApp {
  app: ElectronApplication
  fenster: Page
  /** Alle Konsolenmeldungen des Renderers, ohne die erlaubten. */
  meldungen: () => string[]
  schliessen: () => Promise<void>
}

/**
 * Beantwortet die Rueckfragen des Main-Prozesses und schreibt sie mit.
 *
 * Der Main fragt vor dem Lesen einer Datei nach, die er nicht selbst
 * herausgegeben hat (Drag & Drop, hier: ein Pfad ueber `dokumentOeffnePfad`).
 * Der Dialog ist modal und hielte den Lauf an; deshalb ersetzt dieser Helfer
 * `dialog.showMessageBox` im Main durch eine Antwort. `'oeffnen'` ist der erste
 * Knopf, `'abbrechen'` der zweite - dieselbe Reihenfolge wie im echten Dialog.
 * Mitgeschrieben wird der Text jeder Frage (`gestellteRueckfragen`), damit ein
 * Test pruefen kann, dass und was gefragt wurde.
 */
export async function beantworteRueckfragen(
  app: GestarteteApp,
  antwort: 'oeffnen' | 'abbrechen' = 'oeffnen'
): Promise<void> {
  await app.app.evaluate(
    ({ dialog }, knopf) => {
      const speicher = globalThis as unknown as { __paperlaneFragen?: string[] }
      speicher.__paperlaneFragen = []
      dialog.showMessageBox = (...argumente: unknown[]) => {
        // Mit Fenster: (fenster, optionen); ohne: (optionen).
        const optionen = (argumente.length > 1 ? argumente[1] : argumente[0]) as {
          message?: string
          detail?: string
        }
        speicher.__paperlaneFragen?.push((optionen.message ?? '') + '\n' + (optionen.detail ?? ''))
        return Promise.resolve({ response: knopf, checkboxChecked: false })
      }
    },
    antwort === 'oeffnen' ? 0 : 1
  )
}

/** Die seit `beantworteRueckfragen` gestellten Fragen: Nachricht und Einzelheiten. */
export async function gestellteRueckfragen(app: GestarteteApp): Promise<string[]> {
  return app.app.evaluate(() => {
    const speicher = globalThis as unknown as { __paperlaneFragen?: string[] }
    return [...(speicher.__paperlaneFragen ?? [])]
  })
}

/**
 * Startet die gebaute Anwendung.
 *
 * Jeder Start bekommt ein eigenes, frisches --user-data-dir. Ohne das schreiben
 * die Tests in das echte Benutzerprofil und beeinflussen sich gegenseitig: eine
 * gemerkte Leseposition aus einem frueheren Test laesst den naechsten mitten im
 * Dokument beginnen, und Seite 1 taucht dann nie auf. Wer ein bestimmtes
 * Verzeichnis braucht - etwa um einen Neustart zu pruefen - gibt es selbst mit.
 */
export async function startApp(args: string[] = []): Promise<GestarteteApp> {
  if (!existsSync(ENTRY)) {
    throw new Error(
      'Die Anwendung ist nicht gebaut. Zuerst: npm run build (Erwartet: ' + ENTRY + ')'
    )
  }

  const gesammelt: string[] = []
  const eigenesVerzeichnis = args.some((wert) => wert.startsWith('--user-data-dir='))
  // S6.8: ohne Angabe folgt die Oberflaeche der Systemsprache - auf dem
  // CI-Runner Englisch. Die Suite prueft deutsche Texte, also Deutsch fest;
  // wer eine andere Sprache prueft, gibt `--lang=` selbst mit. Chromiums
  // Schalter setzt `app.getLocale()`, genau wie eine Systemsprache.
  const eigeneSprache = args.some((wert) => wert.startsWith('--lang='))
  const sprache = eigeneSprache ? [] : ['--lang=de-DE']
  const alleArgumente = eigenesVerzeichnis
    ? ['.', ...sprache, ...args]
    : ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'paperlane-e2e-')), ...sprache, ...args]
  const app = await electron.launch({ args: alleArgumente })
  const fenster = await app.firstWindow()

  fenster.on('console', (nachricht) => {
    const text = nachricht.type() + ': ' + nachricht.text()
    if (!ERLAUBTE_MELDUNGEN.some((muster) => muster.test(text))) gesammelt.push(text)
  })
  fenster.on('pageerror', (fehler) => {
    gesammelt.push('pageerror: ' + fehler.message)
  })

  await fenster.waitForLoadState('domcontentloaded')

  return {
    app,
    fenster,
    meldungen: () => [...gesammelt],
    schliessen: async () => {
      // Seit S2.3a haelt der Main-Prozess das Fenster auf, wenn ungespeicherte
      // Anmerkungen offen sind, und fragt nach (Aufgabe 5). Der Dialog ist
      // modal — `app.close()` bliebe daran haengen, und zwar in jedem Test,
      // der etwas anlegt und nicht speichert. Fuer den Abbau wird deshalb
      // gemeldet, dass nichts offen ist.
      //
      // Das nimmt dem Lauf keine Aussage: die Warnung ist per E2E ohnehin
      // nicht pruefbar (derselbe Grund — sie ist modal). Geprueft wird sie in
      // test/unit/schliessen.test.ts, wo Reihenfolge und Vorbelegung
      // festliegen.
      await fenster
        .evaluate(() => window.api.dokumentGeaendert({ pfad: '', geaendert: false }))
        .catch(() => undefined)
      await app.close()
    }
  }
}
