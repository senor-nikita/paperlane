import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { degrees, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * Das Aussehen einer digitalen Unterschrift (Befund vom 2026-11-10): ein mit
 * einem anderen Programm signiertes Formular zeigte hier eine leere Flaeche,
 * dort aber die Unterschrift. Die Hauptansicht zeichnet mit `annotationMode:
 * DISABLE`; das Aussehen eines Unterschriftsfeldes holt `unterschriften.ts` in
 * einem zweiten Durchgang nach.
 *
 * Das Dokument hier ist selbst gebaut: eine Seite von 300 x 200 Punkten und ein
 * Unterschriftsfeld (`/FT /Sig`) im Rechteck [50 100 150 150], dessen Aussehen
 * (`/AP /N`) ein blaues Rechteck von 100 x 50 Punkten ist. Eine echte Signatur
 * mit Zertifikat braucht die Anzeige nicht - das Aussehen ist ein Bild im
 * Dokument, mehr zeichnet paperlane nicht.
 */

const SEITE = { breite: 300, hoehe: 200 }
const FELD = [50, 100, 150, 150] as const

async function baueSignierteDatei(drehung: 0 | 90): Promise<string> {
  const dokument = await PDFDocument.create()
  const seite = dokument.addPage([SEITE.breite, SEITE.hoehe])
  if (drehung !== 0) seite.setRotation(degrees(drehung))
  const kontext = dokument.context

  const aussehen = kontext.stream('0 0 1 rg 0 0 100 50 re f', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 100, 50]
  })
  const widget = kontext.register(
    kontext.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of('Unterschrift1'),
      Rect: [...FELD],
      F: 4,
      P: seite.ref,
      AP: { N: kontext.register(aussehen) }
    })
  )
  seite.node.set(PDFName.of('Annots'), kontext.obj([widget]))
  dokument.catalog.set(PDFName.of('AcroForm'), kontext.obj({ Fields: [widget], SigFlags: 3 }))

  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-unterschrift-'))
  const pfad = join(verzeichnis, 'signiert.pdf')
  writeFileSync(pfad, await dokument.save())
  return pfad
}

/** Umgrenzung der blauen Pixel der Seite in Punkten (links oben), oder null. */
async function blaueFlaeche(
  fenster: Page,
  seitenbreite: number
): Promise<{ links: number; oben: number; rechts: number; unten: number } | null> {
  return fenster.evaluate((breite) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="seiten-canvas-1"]')
    const kontext = canvas?.getContext('2d')
    if (canvas === null || kontext === null || kontext === undefined) return null
    const massstab = canvas.width / breite
    const daten = kontext.getImageData(0, 0, canvas.width, canvas.height).data
    let links = canvas.width
    let oben = canvas.height
    let rechts = -1
    let unten = -1
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4
        if ((daten[i] ?? 255) < 60 && (daten[i + 1] ?? 255) < 60 && (daten[i + 2] ?? 0) > 200) {
          if (x < links) links = x
          if (x > rechts) rechts = x
          if (y < oben) oben = y
          if (y > unten) unten = y
        }
      }
    }
    if (rechts < 0) return null
    return {
      links: links / massstab,
      oben: oben / massstab,
      rechts: (rechts + 1) / massstab,
      unten: (unten + 1) / massstab
    }
  }, seitenbreite)
}

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('ein Unterschriftsfeld zeigt das Aussehen der Unterschrift', async () => {
  const pfad = await baueSignierteDatei(0)
  gestartet = await startApp([pfad])
  const { fenster } = gestartet
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })

  // Das Aussehen kommt in einem zweiten Durchgang nach der Seite.
  await expect
    .poll(async () => (await blaueFlaeche(fenster, SEITE.breite)) !== null, { timeout: 20000 })
    .toBe(true)
  const flaeche = await blaueFlaeche(fenster, SEITE.breite)

  // PDF-Rechteck [50 100 150 150] bei einer Seitenhoehe von 200: links oben
  // gemessen x 50..150 und y 50..100. Eine halbe Einheit Spielraum fuer die
  // Rundung auf Pixel. Und nur dieses Rechteck: der Rest der Seite bleibt weiss.
  expect(flaeche?.links).toBeCloseTo(50, 0)
  expect(flaeche?.rechts).toBeCloseTo(150, 0)
  expect(flaeche?.oben).toBeCloseTo(50, 0)
  expect(flaeche?.unten).toBeCloseTo(100, 0)
  await expect(fenster.getByTestId('seite-kaputt-1')).toHaveCount(0)
})

test('das Aussehen folgt der Drehung der Seite', async () => {
  const pfad = await baueSignierteDatei(90)
  gestartet = await startApp([pfad])
  const { fenster } = gestartet
  await fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })

  // Die um 90 Grad gedrehte Seite ist 200 breit und 300 hoch; das Feld liegt
  // dann bei x 100..150 und y 50..150.
  await expect
    .poll(async () => (await blaueFlaeche(fenster, SEITE.hoehe)) !== null, { timeout: 20000 })
    .toBe(true)
  const flaeche = await blaueFlaeche(fenster, SEITE.hoehe)
  expect(flaeche?.links).toBeCloseTo(100, 0)
  expect(flaeche?.rechts).toBeCloseTo(150, 0)
  expect(flaeche?.oben).toBeCloseTo(50, 0)
  expect(flaeche?.unten).toBeCloseTo(150, 0)
})
