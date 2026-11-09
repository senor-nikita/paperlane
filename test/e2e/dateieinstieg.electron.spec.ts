import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { beantworteRueckfragen, gestellteRueckfragen, startApp } from './launchApp'

/**
 * Zuletzt geoeffnet, Drag & Drop und "Oeffnen mit" (S1.3e).
 *
 * Der Drop selbst laesst sich hier nicht ausloesen: `webUtils.getPathForFile`
 * braucht eine echte Datei aus dem Betriebssystem, und ein in JavaScript
 * gebautes File-Objekt traegt keinen Pfad. Geprueft wird deshalb der Weg
 * dahinter — dieselbe IPC-Strecke, die der Drop benutzt — und die Oberflaeche
 * dazu in test/unit/App.test.tsx.
 */

/**
 * Seit S6.1b kaeme das Dokument beim Neustart als Tab der Sitzung zurueck,
 * und die Startseite mit der Liste bliebe verdeckt. Die Tests hier pruefen
 * die Liste, nicht die Sitzung (tabs.electron.spec.ts) - deshalb wird der Tab
 * vor dem Beenden geschlossen, wie es ein Nutzer taete, der mit leerer
 * Anwendung neu anfangen will.
 */
async function schliesseTab(fenster: Page): Promise<void> {
  await fenster.getByTestId('tab-schliessen-1').click()
  await expect(fenster.getByTestId('tableiste')).toHaveCount(0)
}

// Exit-Kriterium: die Liste ueberlebt einen Neustart.
test('zuletzt geoeffnete Dokumente ueberleben einen Neustart', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-recent-'))
  const argumente = ['--user-data-dir=' + datenverzeichnis]
  const dokument = resolve('test/fixtures/single-page.pdf')

  const erste = await startApp([...argumente, dokument])
  try {
    await erste.fenster.waitForSelector('[data-testid="seiten-eingabe"]', { timeout: 20000 })
    await schliesseTab(erste.fenster)
  } finally {
    await erste.schliessen()
  }

  const zweite = await startApp(argumente)
  try {
    // Ohne Startdokument zeigt die Anwendung den leeren Zustand samt Liste.
    await expect(zweite.fenster.getByTestId('zuletzt-single-page.pdf')).toBeVisible({
      timeout: 20000
    })
  } finally {
    await zweite.schliessen()
  }
})

test('ein Eintrag der Liste oeffnet das Dokument wieder', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-recent-'))
  const argumente = ['--user-data-dir=' + datenverzeichnis]

  const erste = await startApp([...argumente, resolve('test/fixtures/single-page.pdf')])
  try {
    await erste.fenster.waitForSelector('[data-testid="seiten-eingabe"]', { timeout: 20000 })
    await schliesseTab(erste.fenster)
  } finally {
    await erste.schliessen()
  }

  const zweite = await startApp(argumente)
  try {
    await zweite.fenster.getByTestId('zuletzt-single-page.pdf').click()
    await expect(zweite.fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf', {
      timeout: 20000
    })
  } finally {
    await zweite.schliessen()
  }
})

// Ein Pfad, der nicht mehr existiert, verschwindet nicht kommentarlos, sondern
// bleibt sichtbar und ausgegraut.
test('ein verschwundenes Dokument bleibt ausgegraut stehen', async () => {
  const datenverzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-recent-'))
  const argumente = ['--user-data-dir=' + datenverzeichnis]
  const fluechtig = join(mkdtempSync(join(tmpdir(), 'paperlane-doc-')), 'fluechtig.pdf')
  writeFileSync(fluechtig, '%PDF-1.7\n')

  const erste = await startApp(argumente)
  try {
    // Der Pfad kommt wie ein Drop vom Renderer: der Main fragt nach.
    await beantworteRueckfragen(erste, 'oeffnen')
    const ergebnis = await erste.fenster.evaluate(
      (pfad) => window.api.dokumentOeffnePfad(pfad),
      fluechtig
    )
    expect(ergebnis.ok).toBe(true)
  } finally {
    await erste.schliessen()
  }

  const { rmSync } = await import('node:fs')
  rmSync(fluechtig)

  const zweite = await startApp(argumente)
  try {
    const knopf = zweite.fenster.getByTestId('zuletzt-fluechtig.pdf')
    await expect(knopf).toBeVisible({ timeout: 20000 })
    await expect(knopf).toBeDisabled()
    await expect(knopf).toContainText('nicht gefunden')
  } finally {
    await zweite.schliessen()
  }
})

/**
 * Ein Pfad, den nur der Renderer nennt (Drop), wird erst nach einer Rueckfrage
 * des Main gelesen: ein uebernommener Renderer soll nicht jede PDF der Platte
 * anfordern koennen. Der echte Dialog ist modal; hier antwortet ein Ersatz
 * (`beantworteRueckfragen`) und schreibt die Fragen mit.
 */
test('eine unbekannte Datei wird erst nach Rueckfrage gelesen', async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-frage-'))
  const fremd = join(verzeichnis, 'fremd.pdf')
  writeFileSync(fremd, '%PDF-1.7\n')

  const gestartet = await startApp()
  try {
    const oeffne = (): Promise<{ ok: boolean; abgebrochen?: boolean }> =>
      gestartet.fenster.evaluate((pfad) => window.api.dokumentOeffnePfad(pfad), fremd)

    // Abgelehnt: nichts wird gelesen, und es ist eine Entscheidung, kein Fehler.
    await beantworteRueckfragen(gestartet, 'abbrechen')
    const abgelehnt = await oeffne()
    expect(abgelehnt).toMatchObject({ ok: false, abgebrochen: true })
    const fragen = await gestellteRueckfragen(gestartet)
    expect(fragen).toHaveLength(1)
    expect(fragen[0]).toContain('fremd.pdf')

    // Bestaetigt: jetzt wird gelesen.
    await beantworteRueckfragen(gestartet, 'oeffnen')
    expect((await oeffne()).ok).toBe(true)
    expect(await gestellteRueckfragen(gestartet)).toHaveLength(1)

    // Danach kennt der Main die Datei: keine zweite Frage.
    expect((await oeffne()).ok).toBe(true)
    expect(await gestellteRueckfragen(gestartet)).toHaveLength(1)
  } finally {
    await gestartet.schliessen()
  }
})

test('ein Netzwerkpfad fragt mit Warnung nach und wird bei Ablehnung nicht gelesen', async () => {
  const gestartet = await startApp()
  try {
    await beantworteRueckfragen(gestartet, 'abbrechen')
    for (const pfad of [
      '\\\\server.invalid\\freigabe\\a.pdf',
      '/\\server.invalid\\freigabe\\b.pdf'
    ]) {
      const ergebnis = await gestartet.fenster.evaluate(
        (wert) => window.api.dokumentOeffnePfad(wert),
        pfad
      )
      expect(ergebnis).toMatchObject({ ok: false, abgebrochen: true })
    }
    const fragen = await gestellteRueckfragen(gestartet)
    expect(fragen).toHaveLength(2)
    expect(fragen[0]).toContain('anderen Rechner')
  } finally {
    await gestartet.schliessen()
  }
})

test('ein Geraetepfad wird ohne Rueckfrage abgelehnt', async () => {
  const gestartet = await startApp()
  try {
    await beantworteRueckfragen(gestartet, 'oeffnen')
    const ergebnis = await gestartet.fenster.evaluate(
      (pfad) => window.api.dokumentOeffnePfad(pfad),
      '\\\\.\\pipe\\x.pdf'
    )
    expect(ergebnis.ok).toBe(false)
    expect(await gestellteRueckfragen(gestartet)).toHaveLength(0)
  } finally {
    await gestartet.schliessen()
  }
})

/**
 * Text mit der Maus zu markieren und zu ziehen ist ein Drag ohne Dateien. Das
 * Fenster darf ihn weder annehmen noch "Es wurde keine Datei uebergeben."
 * melden (so war es, sobald jemand im Dokument Text ziehen wollte). Ein Drag
 * mit einer Datei wird weiter angenommen. Die Ereignisse tragen echte
 * `DataTransfer`-Objekte von Chromium; ein Datei-Drag aus dem Betriebssystem
 * liesse sich nicht ausloesen, wohl aber ein `File` im `DataTransfer`.
 */
test('ein Drag ohne Dateien meldet nichts, ein Datei-Drag wird angenommen', async () => {
  const gestartet = await startApp()
  try {
    const ergebnis = await gestartet.fenster.evaluate(() => {
      const ziel = document.querySelector('[data-testid="fenster"]')
      if (ziel === null) throw new Error('Kein Fenster gefunden')
      const sende = (art: string, daten: DataTransfer): boolean => {
        const ereignis = new DragEvent(art, {
          dataTransfer: daten,
          bubbles: true,
          cancelable: true
        })
        ziel.dispatchEvent(ereignis)
        return ereignis.defaultPrevented
      }
      const text = new DataTransfer()
      text.setData('text/plain', 'markierter Text')
      const datei = new DataTransfer()
      datei.items.add(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
      return {
        textUeber: sende('dragover', text),
        textAblage: sende('drop', text),
        dateiUeber: sende('dragover', datei)
      }
    })
    expect(ergebnis).toEqual({ textUeber: false, textAblage: false, dateiUeber: true })
    await expect(gestartet.fenster.getByTestId('hinweis')).toHaveCount(0)
  } finally {
    await gestartet.schliessen()
  }
})

/**
 * Exit-Kriterium: eine Nicht-PDF-Datei erzeugt eine Meldung statt eines
 * Fehlers. Geprueft wird die echte IPC-Strecke bis in den Main-Prozess.
 */
test('eine Nicht-PDF-Datei wird mit Begruendung abgelehnt', async () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-drop-'))
  const notiz = join(verzeichnis, 'notiz.txt')
  writeFileSync(notiz, 'kein PDF')

  const gestartet = await startApp()
  try {
    const ergebnis = await gestartet.fenster.evaluate(
      (pfad) => window.api.dokumentOeffnePfad(pfad),
      notiz
    )
    expect(ergebnis.ok).toBe(false)
    if (ergebnis.ok) return
    expect(ergebnis.grund).toMatch(/Nur PDF/)
    expect(ergebnis.grund).toContain('notiz.txt')
  } finally {
    await gestartet.schliessen()
  }
})

// Exit-Kriterium: der Start mit einem Dateipfad oeffnet die Datei. Das gilt
// seit S1.1; hier zaehlt, dass die Argumentfilterung aus S0.2 dabei greift.
test('der Start mit einem Dateipfad oeffnet die Datei', async () => {
  const gestartet = await startApp([resolve('test/fixtures/single-page.pdf')])
  try {
    await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf', {
      timeout: 20000
    })
  } finally {
    await gestartet.schliessen()
  }
})
