import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp } from './launchApp'

/**
 * Der eigentliche Nachweis von S1.1: pdf.js laedt im Produktionsbuild und
 * zeichnet eine Seite.
 *
 * Der Worker ist dabei der kritische Punkt (Risiko R2) — ihn per URL statt
 * ueber Vites `?worker`-Import einzubinden funktioniert im Dev-Server und
 * bricht genau hier. Deshalb laeuft dieser Test ausschliesslich gegen `out/`.
 *
 * Das Dokument kommt ueber die Befehlszeile. Der Dateidialog ist ein
 * Betriebssystemfenster und von Playwright nicht bedienbar; ein Testkanal
 * waere eine Hintertuer in der Prozessgrenze. Der argv-Weg ist dagegen eine
 * echte Funktion (Vorgriff auf S1.3e).
 */
function fixture(name: string): string {
  return resolve('test/fixtures', name)
}

test('oeffnet ein einseitiges Dokument und zeichnet es', async () => {
  const gestartet = await startApp([fixture('single-page.pdf')])
  try {
    await expect(gestartet.fenster.getByTestId('dokument-name')).toHaveText('single-page.pdf')
    await expect(gestartet.fenster.getByTestId('seiten-anzeige')).toHaveText('von 1')

    const canvas = gestartet.fenster.getByTestId('seiten-canvas-1')
    await expect(canvas).toBeVisible()
    const groesse = await canvas.evaluate((element) => ({
      breite: (element as HTMLCanvasElement).width,
      hoehe: (element as HTMLCanvasElement).height
    }))
    expect(groesse.breite).toBeGreaterThan(100)
    expect(groesse.hoehe).toBeGreaterThan(100)

    // Ein leeres Canvas waere kein Beweis. Geprueft wird, dass ueberhaupt
    // Farbe gesetzt wurde: eine gerenderte Seite ist weiss mit schwarzem Text,
    // ein nie beschriebenes Canvas ist durchsichtig.
    const gezeichnet = await canvas.evaluate((element) => {
      const c = element as HTMLCanvasElement
      const daten = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data
      if (daten === undefined) return false
      for (let i = 3; i < daten.length; i += 4) if (daten[i] !== 0) return true
      return false
    })
    expect(gezeichnet).toBe(true)
  } finally {
    await gestartet.schliessen()
  }
})

test('meldet die Seitenzahl eines grossen Dokuments', async () => {
  const gestartet = await startApp([fixture('large-500.pdf')])
  try {
    await expect(gestartet.fenster.getByTestId('seiten-anzeige')).toHaveText('von 500')
  } finally {
    await gestartet.schliessen()
  }
})

test('meldet ein beschaedigtes Dokument, statt leer zu bleiben', async () => {
  // Die ausfuehrliche Behandlung folgt in S1.5. Hier zaehlt nur, dass der
  // Fehler sichtbar wird.
  const gestartet = await startApp([fixture('corrupt.pdf')])
  try {
    await expect(gestartet.fenster.getByTestId('fehlermeldung')).toBeVisible()
  } finally {
    await gestartet.schliessen()
  }
})
