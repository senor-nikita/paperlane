import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **Invariante 11** (scharf ab S2.3a): jeder Schreibvorgang im Main-Prozess
 * validiert seinen Zielpfad gegen ein Ergebnis eines Nutzerdialogs.
 *
 * Dieser Guard friert die Regel ein. Er prueft nicht, ob das Speichern
 * funktioniert — das tun die E2E-Laeufe —, sondern dass ein Pfad ohne
 * Freigabe unter keinem Vorwand durchkommt: nicht ueber `..`, nicht ueber
 * einen UNC-Namen, nicht ueber eine Verknuepfung und nicht ueber die
 * Lesefreigabe, die ein Drag & Drop erzeugt.
 *
 * `speichern.ts` zieht `electron` wegen des Dialogs herein; hier wird nur der
 * Pfadteil geprueft, also genuegt eine leere Attrappe.
 */
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn()
  }
}))

const { pruefeSchreibziel } = await import('../../src/main/speichern')
const { gibSchreibfrei, kanonisch, oeffnePfadGeprueft, setzeFreigabenZurueck } =
  await import('../../src/main/dokument')

let verzeichnis: string
let freigegeben: string

beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-writepath-'))
  freigegeben = join(verzeichnis, 'bericht.pdf')
  writeFileSync(freigegeben, '%PDF-1.7\n')
})

beforeEach(() => {
  setzeFreigabenZurueck()
})

describe('Invariante 11 — ohne Dialogergebnis kein Schreiben', () => {
  it('lehnt einen Pfad ohne Freigabe ab', async () => {
    const ergebnis = await pruefeSchreibziel(freigegeben)
    expect(ergebnis.ok).toBe(false)
    if (ergebnis.ok) return
    expect(ergebnis.grund).toMatch(/keine Freigabe zum Schreiben/)
  })

  it('nimmt einen Pfad an, den der Dialog freigegeben hat', async () => {
    gibSchreibfrei(freigegeben)
    const ergebnis = await pruefeSchreibziel(freigegeben)
    expect(ergebnis.ok).toBe(true)
    if (!ergebnis.ok) return
    // Kanonisch, nicht nur aufgeloest: auf Runnern mit 8.3-Kurznamen im
    // Temp-Pfad unterscheiden sich beide Formen (siehe `kanonisch`).
    expect(ergebnis.pfad).toBe(kanonisch(freigegeben))
  })

  /**
   * Der Kern von Blocker 1 aus dem Phase-1-Gate. Bis S2.1 gab jeder gelesene
   * Pfad sich selbst frei — ein per Drag & Drop geoeffnetes Dokument waere
   * damit ueberschreibbar gewesen, ohne dass je ein Mensch den Ort benannt
   * hat.
   */
  it('macht aus einer Lesefreigabe keine Schreibfreigabe', async () => {
    const ergebnis = await oeffnePfadGeprueft(freigegeben)
    expect(ergebnis.ok).toBe(true)

    const geprueft = await pruefeSchreibziel(freigegeben)
    expect(geprueft.ok).toBe(false)
  })

  it('lehnt ab, was kein PDF ist', async () => {
    const fremd = join(verzeichnis, 'notiz.txt')
    gibSchreibfrei(fremd)
    const ergebnis = await pruefeSchreibziel(fremd)
    expect(ergebnis.ok).toBe(false)
    if (ergebnis.ok) return
    expect(ergebnis.grund).toMatch(/nur PDF-Dateien/)
  })

  it.each([[''], ['   '], [null], [undefined], [42], [{ pfad: 'x.pdf' }]])(
    'lehnt %o als Zielangabe ab',
    async (eingabe) => {
      const ergebnis = await pruefeSchreibziel(eingabe)
      expect(ergebnis.ok).toBe(false)
    }
  )
})

/**
 * `..` braucht keine eigene Regel: der Vergleich laeuft ueber den
 * aufgeloesten Pfad. Beide Richtungen werden geprueft, damit klar bleibt,
 * dass hier nicht auf Zeichenketten gemustert wird.
 */
describe('Invariante 11 — Pfade mit ..', () => {
  it('lehnt einen Umweg aus dem freigegebenen Verzeichnis heraus ab', async () => {
    gibSchreibfrei(freigegeben)
    const ausbruch = join(verzeichnis, '..', 'woanders.pdf')
    const ergebnis = await pruefeSchreibziel(ausbruch)
    expect(ergebnis.ok).toBe(false)
  })

  it('nimmt einen Umweg an, der wieder auf die freigegebene Datei zeigt', async () => {
    gibSchreibfrei(freigegeben)
    const umweg = join(verzeichnis, 'unterordner', '..', 'bericht.pdf')
    const ergebnis = await pruefeSchreibziel(umweg)
    expect(ergebnis.ok).toBe(true)
    if (!ergebnis.ok) return
    // Kanonisch, nicht nur aufgeloest: auf Runnern mit 8.3-Kurznamen im
    // Temp-Pfad unterscheiden sich beide Formen (siehe `kanonisch`).
    expect(ergebnis.pfad).toBe(kanonisch(freigegeben))
  })
})

describe('Invariante 11 — UNC-Pfade', () => {
  const unc = '\\\\dateiserver\\freigabe\\bericht.pdf'

  it('lehnt einen UNC-Pfad ohne Freigabe ab', async () => {
    // Auch dann, wenn eine gleichnamige lokale Datei freigegeben ist: der
    // Vergleich laeuft ueber den vollstaendigen Pfad, nicht ueber den Namen.
    gibSchreibfrei(freigegeben)
    const ergebnis = await pruefeSchreibziel(unc)
    expect(ergebnis.ok).toBe(false)
  })

  it('behandelt einen freigegebenen UNC-Pfad wie jeden anderen', async () => {
    gibSchreibfrei(unc)
    const ergebnis = await pruefeSchreibziel(unc, {
      // Es gibt keinen Dateiserver dieses Namens; das Aufloesen scheitert,
      // wie bei jeder noch nicht vorhandenen Datei.
      echterPfad: () => Promise.reject(new Error('ENOENT'))
    })
    expect(ergebnis.ok).toBe(true)
  })
})

/**
 * Verknuepfungen bekommen einen eigenen Schritt, weil die Freigabe dem Namen
 * gilt und nicht dem Ziel: ein freigegebener Pfad kann nachtraeglich durch
 * einen Symlink ersetzt worden sein, der woandershin zeigt.
 *
 * Die ersten Faelle spritzen das Ergebnis von `realpath` ein: unter Windows
 * braucht `symlink` erhoehte Rechte, und der Fall soll trotzdem im normalen
 * Lauf geprueft werden. Der letzte Fall legt seit S5.2b eine echte Junction an
 * — die braucht keine erhoehten Rechte und schliesst die Luecke zwischen
 * nachgestelltem und tatsaechlichem Dateisystem.
 */
describe('Invariante 11 — Verknuepfungen', () => {
  it('lehnt ab, wenn die Verknuepfung auf etwas Nichtfreigegebenes zeigt', async () => {
    gibSchreibfrei(freigegeben)
    const ergebnis = await pruefeSchreibziel(freigegeben, {
      echterPfad: () => Promise.resolve(join(verzeichnis, 'geheim.pdf'))
    })
    expect(ergebnis.ok).toBe(false)
    if (ergebnis.ok) return
    expect(ergebnis.grund).toMatch(/andere Datei/)
  })

  it('nimmt an, wenn auch das Ziel der Verknuepfung freigegeben ist', async () => {
    const ziel = join(verzeichnis, 'echt.pdf')
    gibSchreibfrei(freigegeben)
    gibSchreibfrei(ziel)
    const ergebnis = await pruefeSchreibziel(freigegeben, {
      echterPfad: () => Promise.resolve(ziel)
    })
    expect(ergebnis.ok).toBe(true)
  })

  /**
   * S5.2b: derselbe Angriff wie oben, aber mit einer **echten** Verknuepfung
   * statt einer eingespritzten. Die uebrigen Faelle dieser Datei stellen
   * `realpath` nach; hier legt der Test eine Junction im Dateisystem an.
   *
   * Der Ablauf ist der, den ein Angreifer nach der Freigabe faehrt: der Nutzer
   * waehlt `<temp>/echt/dokument.pdf` im Dialog, danach wird `echt` durch eine
   * Junction auf ein fremdes Verzeichnis ersetzt. Ohne die zweite Pruefung
   * (`realpath` nach der Freigabeliste) schriebe die Anwendung in die fremde
   * Datei, obwohl der Pfad unveraendert aussieht.
   *
   * Junctions brauchen keine Administratorrechte. Falls `mklink` dennoch
   * scheitert — etwa auf einem Dateisystem ohne Unterstuetzung —, endet der
   * Test mit einer Meldung statt mit einem falschen Gruen.
   */
  it('folgt keiner echten Junction aus der Freigabe heraus', async () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'paperlane-junction-'))
    const echt = join(wurzel, 'echt')
    const fremd = join(wurzel, 'fremd')
    mkdirSync(echt)
    mkdirSync(fremd)

    const freigegeben = join(echt, 'dokument.pdf')
    writeFileSync(freigegeben, 'A')
    writeFileSync(join(fremd, 'dokument.pdf'), 'B')
    gibSchreibfrei(kanonisch(freigegeben))
    expect((await pruefeSchreibziel(freigegeben)).ok).toBe(true)

    // Jetzt der Tausch: `echt` verschwindet und kommt als Junction auf `fremd`
    // zurueck. Der Pfad, den die Anwendung kennt, zeigt danach woanders hin.
    rmSync(freigegeben)
    rmSync(echt, { recursive: true })
    try {
      execSync('mklink /J "' + echt + '" "' + fremd + '"', { stdio: 'ignore', shell: 'cmd.exe' })
    } catch {
      throw new Error(
        'mklink /J fehlgeschlagen - dieser Test braucht ein Dateisystem mit Junctions. ' +
          'Lieber laut scheitern als den Angriff ungeprueft lassen.'
      )
    }

    const geprueft = await pruefeSchreibziel(freigegeben)
    expect(geprueft.ok).toBe(false)
    if (geprueft.ok) return
    expect(geprueft.grund.length).toBeGreaterThan(0)
  })

  it('nimmt an, wenn es die Datei noch nicht gibt', async () => {
    // Der Normalfall bei "Speichern unter": ohne Datei gibt es keine
    // Verknuepfung, die taeuschen koennte.
    const neu = join(verzeichnis, 'neu.pdf')
    gibSchreibfrei(neu)
    const ergebnis = await pruefeSchreibziel(neu, {
      echterPfad: () => Promise.reject(new Error('ENOENT'))
    })
    expect(ergebnis.ok).toBe(true)
  })
})

/**
 * Dieselbe Datei in zwei Schreibweisen ist dieselbe Datei.
 *
 * Auf GitHubs Windows-Runnern liefert `os.tmpdir()` den 8.3-Kurznamen
 * (`C:\Users\RUNNER~1\...`), `realpath` dagegen die Langform. Vor dem Fix
 * galt ein in Kurzform freigegebener Pfad bei der Pruefung als "andere
 * Datei" - jedes Speichern ueber eine bestehende Datei scheiterte in CI,
 * waehrend es lokal auf einem Rechner mit kurzem Benutzernamen nie auffiel.
 * Dieser Test erzeugt die Kurzform selbst, damit er auch dort greift.
 */
describe('Invariante 11 — Kurznamen und Langform', () => {
  /** Die 8.3-Kurzform eines vorhandenen Pfads, oder null ohne Windows. */
  function kurzform(pfad: string): string | null {
    if (process.platform !== 'win32') return null
    const roh = execSync('for %I in ("' + pfad + '") do @echo %~sI', {
      shell: 'cmd.exe',
      encoding: 'utf8'
    })
    const kurz = roh.trim()
    return kurz.length > 0 && kurz !== pfad ? kurz : null
  }

  it.skipIf(process.platform !== 'win32')(
    'erkennt eine in Kurzform freigegebene Datei in Langform wieder',
    async () => {
      // Ein Name, der laenger als acht Zeichen ist, hat garantiert eine
      // Kurzform - sofern das Dateisystem sie noch erzeugt (Standard: ja).
      const lang = join(verzeichnis, 'kurznamen-verzeichnis-mit-langem-namen')
      mkdirSync(lang, { recursive: true })
      const kurz = kurzform(lang)
      if (kurz === null) {
        console.warn('Kein 8.3-Kurzname verfuegbar - Test ohne Aussage.')
        return
      }
      const datei = join(lang, 'dokument.pdf')
      writeFileSync(datei, '%PDF-1.7\n')

      // Freigabe in Kurzform, wie sie ein Dialog auf einem CI-Runner liefert.
      gibSchreibfrei(join(kurz, 'dokument.pdf'))
      // Pruefung in Langform - und umgekehrt.
      expect((await pruefeSchreibziel(datei)).ok).toBe(true)
      expect((await pruefeSchreibziel(join(kurz, 'dokument.pdf'))).ok).toBe(true)
      expect(kanonisch(join(kurz, 'dokument.pdf'))).toBe(kanonisch(datei))
    }
  )

  /**
   * `realpath` auf einem UNC-Pfad spricht den Rechner im Netz an und wartet
   * auf ihn. `kanonisch` laeuft auf Zeichenketten aus dem Renderer; ein
   * fremdes Dokument darf den Main-Prozess nicht an einen nicht existierenden
   * Server haengen. Vor dem Fix dauerte genau das 5,5 Sekunden.
   */
  it('haengt bei einem UNC-Pfad nicht am Netz', () => {
    const start = Date.now()
    const pfad = '\\\\nirgendwo-' + String(Date.now()) + '\\freigabe\\dokument.pdf'
    expect(kanonisch(pfad)).toBe(pfad)
    expect(Date.now() - start).toBeLessThan(500)
  })
})
