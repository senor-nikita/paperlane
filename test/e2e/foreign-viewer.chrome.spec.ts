import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { degrees, PDFDocument } from 'pdf-lib'
import { wendeMutationAn, wendeMutationAnMitBericht } from '../../src/main/mutation'
import { fuehreZusammen, teile } from '../../src/main/zusammenfuehren'
import { findeZeile, pdfjsZeilen } from '../helpers/pdfjs-zeilen'
import { cidDokument } from '../helpers/textfixtures'

/**
 * Prueft den Testkorpus gegen einen echten Google Chrome.
 *
 * Warum echter Chrome und nicht Playwrights Chromium: das gebuendelte Chromium
 * enthaelt **keinen PDF-Viewer**. Ohne diesen Test waere die
 * Fremdviewer-Gegenprobe aus S2.3b — die einzige Gegenmassnahme zu R1 — nicht
 * baubar.
 *
 * Warum keine DOM-Pruefungen: Chromes PDF-Viewer laeuft in einem
 * Extension-Frame, dessen Oberflaeche im Shadow-DOM liegt. `innerText` ist
 * leer, der Frame gibt nichts preis. Empirisch in S0.3 festgestellt.
 *
 * Warum keine gepflegten Baselines: verglichen werden die Faelle
 * **untereinander**, nicht gegen ein hinterlegtes Bild. Das belegt genau das
 * Gewuenschte — Chrome behandelt ein intaktes, ein beschaedigtes und ein
 * verschluesseltes Dokument unterschiedlich — ohne Baseline-Pflege und ohne
 * Plattformabhaengigkeit.
 *
 * Der Browser wird bewusst selbst verwaltet statt ueber die `page`-Fixture:
 * nur so laesst sich sauber ueberspringen, wenn Chrome fehlt. Mit der Fixture
 * wuerde der Start scheitern, bevor die Testfunktion ueberhaupt laeuft.
 */

const PDF_VIEWER_FRAME = /chrome-extension:\/\/[a-z]+\/index\.html/

let browser: Browser | null = null
let grund = ''

test.beforeAll(async () => {
  try {
    browser = await chromium.launch({ channel: 'chrome' })
  } catch (error) {
    browser = null
    grund =
      'Kein echter Google Chrome gefunden. Playwrights gebuendeltes Chromium hat ' +
      'keinen PDF-Viewer, die Fremdviewer-Pruefung ist damit nicht durchfuehrbar. ' +
      'Abhilfe: Chrome installieren oder "npx playwright install chrome". ' +
      'Ursache: ' +
      String(error).split('\n')[0]
    // Zusaetzlich laut, damit es in einem langen Protokoll nicht untergeht.
    console.warn('')
    console.warn('  UEBERSPRUNGEN: ' + grund)
    console.warn('')
  }
})

test.afterAll(async () => {
  if (browser !== null) await browser.close()
})

async function neueSeite(): Promise<Page> {
  if (browser === null) throw new Error('Kein Browser')
  return browser.newPage({ viewport: { width: 900, height: 700 } })
}

/**
 * Ein Bild der Seite, sobald sie **stillsteht**.
 *
 * Nicht nach fester Wartezeit: Chromes PDF-Viewer blendet Werkzeugleiste und
 * Rollbalken zeitversetzt ein, und auf einem langsamen Runner kam der
 * Screenshot mitten hinein - dieselbe Datei ergab zweimal verschiedene Bilder,
 * und die Kontrollprobe wurde rot. Fotografiert wird deshalb, bis zwei
 * Aufnahmen im Abstand einer halben Sekunde uebereinstimmen.
 */
async function stabilesBild(page: Page): Promise<string> {
  const hash = async (): Promise<string> =>
    createHash('sha256')
      .update(await page.screenshot())
      .digest('hex')
  await page.waitForTimeout(1500)
  let letztes = await hash()
  for (let versuch = 0; versuch < 25; versuch++) {
    await page.waitForTimeout(500)
    const jetzt = await hash()
    if (jetzt === letztes) return jetzt
    letztes = jetzt
  }
  return letztes
}

async function oeffneUndFotografiere(
  page: Page,
  name: string
): Promise<{ status: number; hatViewer: boolean; bild: string }> {
  const url = pathToFileURL(resolve('test/fixtures', name)).toString()
  const antwort = await page.goto(url, { waitUntil: 'load' })
  const bild = await stabilesBild(page)
  const hatViewer = page.frames().some((frame) => PDF_VIEWER_FRAME.test(frame.url()))
  return { status: antwort?.status() ?? 0, hatViewer, bild }
}

const REGULAER = [
  'single-page.pdf',
  'large-500.pdf',
  'scanned.pdf',
  'acroform.pdf',
  'annotated.pdf'
]

for (const name of REGULAER) {
  test('Chrome oeffnet ' + name + ' und uebergibt es dem PDF-Viewer', async () => {
    test.skip(browser === null, grund)
    const page = await neueSeite()
    try {
      const ergebnis = await oeffneUndFotografiere(page, name)
      expect(ergebnis.status).toBe(200)
      expect(ergebnis.hatViewer).toBe(true)
    } finally {
      await page.close()
    }
  })
}

/**
 * S4.2a: was diese Anwendung aus zwei Fixtures macht, muss ein fremder
 * Betrachter oeffnen - und als etwas anderes zeigen als die Quellen. Ueber die
 * **echten** Funktionen aus `zusammenfuehren.ts` (electron-frei).
 */
test('Chrome oeffnet Zusammengefuehrtes und Geteiltes', async () => {
  test.skip(browser === null, grund)
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-chrome-zusammen-'))
  const annotiert = new Uint8Array(await readFile(resolve('test/fixtures/annotated.pdf')))
  const formular = new Uint8Array(await readFile(resolve('test/fixtures/acroform.pdf')))
  const zusammen = join(verzeichnis, 'zusammen.pdf')
  writeFileSync(zusammen, (await fuehreZusammen([formular, annotiert, formular])).bytes)
  const [teil] = await teile(annotiert, [[2, 2]])
  const geteilt = join(verzeichnis, 'geteilt.pdf')
  writeFileSync(geteilt, teil ?? new Uint8Array())

  const page = await neueSeite()
  try {
    const foto = async (pfad: string): Promise<{ hatViewer: boolean; bild: string }> => {
      await page.goto(pathToFileURL(pfad).toString(), { waitUntil: 'load' })
      const bild = await stabilesBild(page)
      return { hatViewer: page.frames().some((f) => PDF_VIEWER_FRAME.test(f.url())), bild }
    }
    const quelle = await oeffneUndFotografiere(page, 'acroform.pdf')
    const z = await foto(zusammen)
    const g = await foto(geteilt)
    expect(z.hatViewer).toBe(true)
    expect(g.hatViewer).toBe(true)
    // Vier Seiten statt einer: Chrome zeigt Rollbalken und Seitenzaehler
    // anders - das Bild unterscheidet sich von der einseitigen Quelle.
    expect(z.bild).not.toBe(quelle.bild)
    expect(g.bild).not.toBe(z.bild)
  } finally {
    await page.close()
  }
})

test('Chrome unterscheidet intakt, beschaedigt und verschluesselt', async () => {
  test.skip(browser === null, grund)
  const page = await neueSeite()
  try {
    // Erwartete Eigenschaften, keine Fehlschlaege: corrupt.pdf SOLL abgelehnt
    // werden, encrypted.pdf SOLL ein Passwort verlangen.
    const intakt = await oeffneUndFotografiere(page, 'single-page.pdf')
    const beschaedigt = await oeffneUndFotografiere(page, 'corrupt.pdf')
    const verschluesselt = await oeffneUndFotografiere(page, 'encrypted.pdf')

    expect(beschaedigt.bild).not.toBe(intakt.bild)
    expect(verschluesselt.bild).not.toBe(intakt.bild)
    expect(verschluesselt.bild).not.toBe(beschaedigt.bild)
  } finally {
    await page.close()
  }
})

test('dasselbe Dokument zweimal geoeffnet ergibt dasselbe Bild', async () => {
  test.skip(browser === null, grund)
  const page = await neueSeite()
  try {
    // Belegt, dass der Vergleich oben aussagekraeftig ist und nicht blosses
    // Rendering-Rauschen misst.
    const ersteSicht = await oeffneUndFotografiere(page, 'single-page.pdf')
    const zweiteSicht = await oeffneUndFotografiere(page, 'single-page.pdf')
    expect(zweiteSicht.bild).toBe(ersteSicht.bild)
  } finally {
    await page.close()
  }
})

/**
 * S6.3 (D17): ein Zuschnitt auf einer gedrehten Seite, ueber die **echte**
 * Mutation aus `main/mutation.ts`. Chrome muss ihn zeigen - das Bild weicht
 * vom Original ab -, und "Zuschnitt aufheben" muss genau das Bild des
 * Originals zurueckbringen, obwohl die Bytes verschieden sind (CropBox
 * ausdruecklich gleich der MediaBox gesetzt).
 */
test('Chrome zeigt Zuschnitt und aufgehobenen Zuschnitt einer gedrehten Seite', async () => {
  test.skip(browser === null, grund)
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-chrome-zuschnitt-'))
  const doc = await PDFDocument.create()
  const seite = doc.addPage([600, 800])
  seite.drawRectangle({ x: 40, y: 40, width: 520, height: 720, borderWidth: 6 })
  seite.drawText('Zuschnitt', { x: 200, y: 400, size: 32 })
  seite.setRotation(degrees(90))
  const original = await doc.save()
  const zugeschnitten = await wendeMutationAn(original, {
    art: 'seitenZuschneiden',
    zuschnitte: [{ seite: 1, rahmen: [150, 300, 450, 500] }]
  })
  const aufgehoben = await wendeMutationAn(zugeschnitten, {
    art: 'seitenZuschneiden',
    zuschnitte: [{ seite: 1, rahmen: null }]
  })
  const page = await neueSeite()
  try {
    const bilder: Record<string, string> = {}
    for (const [name, bytes] of Object.entries({ original, zugeschnitten, aufgehoben })) {
      // Gleicher Dateiname in eigenen Ordnern: Chromes Leiste zeigt den
      // Namen, und ein anderer Name allein aenderte schon das Bild.
      const pfad = join(verzeichnis, name, 'dokument.pdf')
      mkdirSync(join(verzeichnis, name))
      writeFileSync(pfad, bytes)
      await page.goto(pathToFileURL(pfad).toString(), { waitUntil: 'load' })
      bilder[name] = await stabilesBild(page)
      expect(page.frames().some((f) => PDF_VIEWER_FRAME.test(f.url()))).toBe(true)
    }
    expect(bilder['zugeschnitten']).not.toBe(bilder['original'])
    expect(bilder['aufgehoben']).toBe(bilder['original'])
  } finally {
    await page.close()
  }
})

/**
 * S6.6b (ADR 0005, Punkt 6): Text ersetzt und geloescht ueber die **echte**
 * Mutation aus `main/mutation.ts` - in der Originalschrift (word.pdf) und in
 * der Ersatzschrift (CID-Teilmenge ohne den neuen Glyph). PDFium muss jedes
 * Ergebnis oeffnen und anders zeigen als das Original; der alte Text wieder
 * eingesetzt ergibt genau das Bild des Originals.
 */
test('Chrome zeigt ersetzten und geloeschten Text (Original- und Ersatzschrift)', async () => {
  test.skip(browser === null, grund)
  test.setTimeout(120000)
  const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-chrome-text-'))
  const ersetze = async (bytes: Uint8Array, alt: string, neu: string): Promise<Uint8Array> => {
    const zeile = findeZeile(await pdfjsZeilen(bytes), alt)
    const e = await wendeMutationAnMitBericht(bytes, {
      art: 'textErsetzen',
      seite: 1,
      zeile,
      text: neu
    })
    return e.bytes
  }
  const word = new Uint8Array(await readFile(resolve('test/fixtures/word.pdf')))
  const cid = await cidDokument()
  const ersetzt = await ersetze(word, 'Methode', 'Verfahren')
  const faelle: Record<string, Uint8Array> = {
    wordOriginal: word,
    wordErsetzt: ersetzt,
    wordGeloescht: await ersetze(word, 'Methode', ''),
    wordZurueck: await ersetze(ersetzt, 'Verfahren', 'Methode'),
    cidOriginal: cid,
    cidErsatz: await ersetze(cid, 'Rechnung 2026', 'Rechnung 2027')
  }
  const page = await neueSeite()
  try {
    const bilder: Record<string, string> = {}
    for (const [name, bytes] of Object.entries(faelle)) {
      const pfad = join(verzeichnis, name, 'dokument.pdf')
      mkdirSync(join(verzeichnis, name))
      writeFileSync(pfad, bytes)
      await page.goto(pathToFileURL(pfad).toString(), { waitUntil: 'load' })
      bilder[name] = await stabilesBild(page)
      expect(
        page.frames().some((f) => PDF_VIEWER_FRAME.test(f.url())),
        name
      ).toBe(true)
    }
    expect(bilder['wordErsetzt']).not.toBe(bilder['wordOriginal'])
    expect(bilder['wordGeloescht']).not.toBe(bilder['wordOriginal'])
    expect(bilder['wordGeloescht']).not.toBe(bilder['wordErsetzt'])
    expect(bilder['cidErsatz']).not.toBe(bilder['cidOriginal'])
    expect(bilder['wordZurueck']).toBe(bilder['wordOriginal'])
  } finally {
    await page.close()
  }
})
