import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument, PDFName, StandardFonts, type PDFRef } from 'pdf-lib'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { erscheinungFuer, GEMALTE_TYPEN, type Schrift } from '../../src/main/erscheinungsbild'
import { wendeAenderungenAn } from '../../src/main/schreibpfad'
import type { Annotation, AnnotationsTyp } from '../../src/shared/annotations'
import { alsPngUrl, kleinesPng } from '../helpers/png'

/**
 * **Exit-Kriterium 3b von S2.3b** — die Gegenprobe, ohne die der Schritt nicht
 * erledigt ist.
 *
 * R1 in einem Satz: eine Annotation ohne brauchbaren Appearance-Stream zeigt
 * **diese** Anwendung wieder an, weil sie sie selbst zeichnet — ein fremder
 * Betrachter nicht. Jede Pruefung, die paperlane gegen paperlane haelt, kann
 * das nicht aufdecken. Also muss ein fremder Betrachter antworten.
 *
 * Warum echter Chrome: Playwrights gebuendeltes Chromium enthaelt **keinen**
 * PDF-Viewer (in S0.3 festgestellt). Fehlt Chrome, ueberspringt der Lauf
 * sichtbar, statt still durchzugehen.
 *
 * Warum keine gepflegten Baselines und keine DOM-Pruefungen: Chromes
 * PDF-Viewer liegt in einem Extension-Frame mit Shadow-DOM und gibt nichts
 * preis; ein hinterlegtes Bild waere ueber Betriebssysteme und Schriftfallbacks
 * hinweg nicht stabil. Verglichen wird deshalb **differenziell**: dieselbe
 * Seite einmal ohne und einmal mit der Anmerkung. Unterscheiden sich die
 * Bilder, hat Chrome etwas gezeichnet — und nur der Appearance-Stream kann es
 * gewesen sein.
 */

const PDF_VIEWER_FRAME = /chrome-extension:\/\/[a-z]+\/index\.html/

let browser: Browser | null = null
let grund = ''
let verzeichnis: string
let quelle: Uint8Array

test.beforeAll(async () => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-appearance-'))
  quelle = new Uint8Array(await readFile(resolve('test/fixtures/single-page.pdf')))
  try {
    browser = await chromium.launch({ channel: 'chrome' })
  } catch (error) {
    browser = null
    grund =
      'Kein echter Google Chrome gefunden. Playwrights gebuendeltes Chromium hat ' +
      'keinen PDF-Viewer, die Fremdviewer-Gegenprobe zu R1 ist damit nicht ' +
      'durchfuehrbar. Abhilfe: Chrome installieren oder ' +
      '"npx playwright install chrome". Ursache: ' +
      String(error).split('\n')[0]
    console.warn('')
    console.warn('  UEBERSPRUNGEN: ' + grund)
    console.warn('')
  }
})

test.afterAll(async () => {
  if (browser !== null) await browser.close()
})

/**
 * Eine Annotation, die gross genug ist, um in einem Seitenbild aufzufallen.
 *
 * Klein und blass waere der Test wertlos: er wuerde auch dann gruen, wenn
 * Chrome nur ein paar Pixel Rauschen zeigte.
 */
function annotation(typ: AnnotationsTyp, hoeheDerSeite: number): Annotation {
  const unten = hoeheDerSeite / 2 - 60
  const oben = unten + 120
  return {
    id: 'neu-1',
    seite: 1,
    typ,
    subtyp: typ,
    rect: [80, unten, 440, oben],
    quadPoints: [80, oben, 440, oben, 80, unten, 440, unten],
    striche: [[100, unten + 20, 260, oben - 20, 420, unten + 20]],
    farbe: { r: 255, g: 0, b: 0 },
    strichstaerke: 6,
    opazitaet: 1,
    autor: 'Gegenprobe',
    inhalt: 'Vertraulich',
    erstellt: 'D:20260101120000Z',
    geaendert: 'D:20260101120000Z',
    versteckt: false,
    ziel: null,
    roh: null
  }
}

/**
 * Baut ein Dokument mit genau diesen Annotationen.
 *
 * Ueber `erscheinungFuer`, weil die Typ-fuer-Typ-Pruefung unten dieselbe
 * Anmerkung einmal **ohne** `/AP` braucht — das schreibt der Speicherpfad
 * nie. Dass die uebrigen Felder des Dictionaries stimmen, belegt
 * `test/unit/appearance-reparse.test.ts` am echten Speicherpfad; die
 * Formularpruefung unten ruft ihn (seit S3.2 electron-frei in
 * `schreibpfad.ts`) direkt auf.
 */
async function baue(
  name: string,
  typen: readonly AnnotationsTyp[],
  mitErscheinung = true
): Promise<string> {
  const dokument = await PDFDocument.load(quelle)
  const seite = dokument.getPage(0)
  const { height } = seite.getSize()

  let schrift: Schrift | null = null
  let schriftRef: PDFRef | null = null
  // FreeText (S6.5) braucht dieselbe Schrift wie der Stempel: beide gehen
  // ueber brauchtSchrift() in erscheinungsbild.ts.
  if (typen.includes('Stamp') || typen.includes('FreeText')) {
    const eingebettet = await dokument.embedFont(StandardFonts.Helvetica)
    schriftRef = eingebettet.ref
    schrift = {
      breiteVon: (text, groesse) => eingebettet.widthOfTextAtSize(text, groesse),
      kodiere: (text) => eingebettet.encodeText(text).toString()
    }
  }

  if (seite.node.Annots() === undefined) {
    seite.node.set(PDFName.of('Annots'), dokument.context.obj([]))
  }

  for (const typ of typen) {
    const eintrag = annotation(typ, height)
    const ap = erscheinungFuer(eintrag, dokument.context, () =>
      schriftRef !== null && schrift !== null ? { ref: schriftRef, schrift } : null
    )
    if (ap === null) continue
    const dict = dokument.context.obj({
      Type: 'Annot',
      Subtype: eintrag.subtyp,
      Rect: [...eintrag.rect],
      // Bit 3 (Print). Ohne das laesst mancher Betrachter die Anmerkung
      // beim Zeichnen aus.
      F: 4
    })
    if (mitErscheinung) dict.set(PDFName.of('AP'), ap)
    seite.node.Annots()?.push(dokument.context.register(dict))
  }

  const pfad = join(verzeichnis, name)
  writeFileSync(pfad, await dokument.save())
  return pfad
}

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

async function fotografiere(
  page: Page,
  pfad: string
): Promise<{ hatViewer: boolean; bild: string }> {
  await page.goto(pathToFileURL(pfad).toString(), { waitUntil: 'load' })
  const bild = await stabilesBild(page)
  return {
    hatViewer: page.frames().some((frame) => PDF_VIEWER_FRAME.test(frame.url())),
    bild
  }
}

/**
 * Die Kontrolle, ohne die der ganze Vergleich nichts wert waere: dasselbe
 * Dokument zweimal geoeffnet muss dasselbe Bild ergeben. Erst dann sagt ein
 * Unterschied etwas ueber die Anmerkung aus und nicht ueber Rendering-Rauschen.
 */
test('dieselbe Seite zweimal geoeffnet ergibt dasselbe Bild', async () => {
  test.skip(browser === null, grund)
  const ohne = await baue('kontrolle.pdf', [])
  const page = await neueSeite()
  try {
    const erste = await fotografiere(page, ohne)
    const zweite = await fotografiere(page, ohne)
    expect(erste.hatViewer).toBe(true)
    expect(zweite.bild).toBe(erste.bild)
  } finally {
    await page.close()
  }
})

/**
 * Der Kern: je Typ einzeln. "Irgendetwas hat sich geaendert" genuegt nicht —
 * sonst deckte ein sichtbarer Stempel mit ab, dass die Unterstreichung fehlt.
 *
 * Drei Zustaende statt zwei, und das ist der Unterschied zwischen einem
 * gruenen Test und einer Aussage: PDFium, die Bibliothek hinter Chromes
 * PDF-Viewer, **erzeugt fuer manche Typen selbst ein Erscheinungsbild**, wenn
 * keines da ist. Ein blosser Vergleich "mit Anmerkung gegen ohne Anmerkung"
 * ginge deshalb auch dann durch, wenn unser Strom stillschweigend verworfen
 * wuerde. Also wird zusaetzlich gegen dieselbe Anmerkung **ohne** `/AP`
 * gehalten: unterscheidet sich das Bild auch davon, zeichnet Chrome wirklich
 * unseren Strom.
 */
for (const typ of GEMALTE_TYPEN) {
  test('Chrome zeichnet das Erscheinungsbild von ' + typ, async () => {
    test.skip(browser === null, grund)
    const leerePfad = await baue('ohne-' + typ + '.pdf', [])
    const ohneApPfad = await baue('ohne-ap-' + typ + '.pdf', [typ], false)
    const mitApPfad = await baue('mit-' + typ + '.pdf', [typ])

    const page = await neueSeite()
    try {
      const leer = await fotografiere(page, leerePfad)
      const ohneAp = await fotografiere(page, ohneApPfad)
      const mitAp = await fotografiere(page, mitApPfad)
      expect(leer.hatViewer).toBe(true)
      expect(mitAp.hatViewer).toBe(true)

      // Exit-Kriterium: die Anmerkung ist im fremden Betrachter sichtbar.
      expect(
        mitAp.bild,
        'Chrome zeigt fuer ' +
          typ +
          ' dasselbe Bild wie ohne die Anmerkung. Der Appearance-Stream wird ' +
          'also nicht gezeichnet — genau der Fall, den R1 beschreibt.'
      ).not.toBe(leer.bild)

      // Und es ist unser Strom, nicht ein von PDFium erzeugter Ersatz.
      expect(
        mitAp.bild,
        'Chrome zeigt fuer ' +
          typ +
          ' mit und ohne /AP dasselbe Bild. Dann stammt das Sichtbare nicht ' +
          'aus unserem Appearance-Stream, und der Test belegte nichts.'
      ).not.toBe(ohneAp.bild)
    } finally {
      await page.close()
    }
  })
}

/**
 * S3.2, Aufgabe 4: der Bildstempel — die grafische Signatur. Dieselben drei
 * Zustaende wie oben; das Bild ist ein deckendes Blau ueber 360x120 Punkten,
 * damit es in einem Seitenbild nicht zu uebersehen ist.
 */
test('Chrome zeichnet den Bildstempel der grafischen Signatur', async () => {
  test.skip(browser === null, grund)

  async function baueSignatur(name: string, mitErscheinung: boolean): Promise<string> {
    const dokument = await PDFDocument.load(quelle)
    const seite = dokument.getPage(0)
    const { height } = seite.getSize()
    if (seite.node.Annots() === undefined) {
      seite.node.set(PDFName.of('Annots'), dokument.context.obj([]))
    }
    const png = kleinesPng(4, 4, [0, 0, 255])
    const eintrag: Annotation = {
      ...annotation('Stamp', height),
      inhalt: 'Signatur (Bild)',
      bild: alsPngUrl(png)
    }
    const eingebettet = await dokument.embedPng(new Uint8Array(png))
    const ap = erscheinungFuer(eintrag, dokument.context, () => null, eingebettet.ref)
    expect(ap).not.toBeNull()
    const dict = dokument.context.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      Rect: [...eintrag.rect],
      F: 4
    })
    if (mitErscheinung && ap !== null) dict.set(PDFName.of('AP'), ap)
    seite.node.Annots()?.push(dokument.context.register(dict))
    const pfad = join(verzeichnis, name)
    writeFileSync(pfad, await dokument.save())
    return pfad
  }

  const leerePfad = await baue('ohne-signatur.pdf', [])
  const ohneApPfad = await baueSignatur('ohne-ap-signatur.pdf', false)
  const mitApPfad = await baueSignatur('mit-signatur.pdf', true)

  const page = await neueSeite()
  try {
    const leer = await fotografiere(page, leerePfad)
    const ohneAp = await fotografiere(page, ohneApPfad)
    const mitAp = await fotografiere(page, mitApPfad)
    expect(leer.hatViewer).toBe(true)
    expect(mitAp.hatViewer).toBe(true)
    expect(
      mitAp.bild,
      'Chrome zeigt fuer den Bildstempel dasselbe Bild wie ohne die Anmerkung. ' +
        'Das Bild-XObject wird also nicht gezeichnet.'
    ).not.toBe(leer.bild)
    expect(
      mitAp.bild,
      'Chrome zeigt fuer den Bildstempel mit und ohne /AP dasselbe Bild.'
    ).not.toBe(ohneAp.bild)
  } finally {
    await page.close()
  }
})

/**
 * S3.2, Aufgaben 1 und 2: ausgefuellte Formularwerte und das Flachlegen —
 * ueber die **echte** Schreibfunktion (deshalb liegt sie seit S3.2 in
 * `schreibpfad.ts`, ohne Electron).
 *
 * Drei Zustaende: die leere Fixture, dieselbe mit Werten (Felder bleiben
 * Felder, pdf-lib erzeugt die Appearances, D14), und dieselbe flachgelegt
 * (keine Felder mehr, der Text liegt im Seiteninhalt). Beide muessen sich vom
 * leeren Formular unterscheiden — sonst saehe ein fremder Betrachter die
 * Eingaben nicht. Und flachgelegt darf nicht leer aussehen: das waere genau
 * der Datenverlust, vor dem der Bestaetigungsdialog warnt.
 */
test('Chrome zeigt ausgefuellte und flachgelegte Formularwerte', async () => {
  test.skip(browser === null, grund)
  const acroform = new Uint8Array(await readFile(resolve('test/fixtures/acroform.pdf')))
  const keine = { neue: [], geaendert: [], geloescht: [] }
  const werte = {
    'person.name': 'Max Muster',
    zustimmung: true,
    anrede: 'herr',
    land: 'Schweiz',
    notiz: 'Zeile eins\nZeile zwei'
  }
  const leerPfad = join(verzeichnis, 'formular-leer.pdf')
  const ausgefuelltPfad = join(verzeichnis, 'formular-ausgefuellt.pdf')
  const flachPfad = join(verzeichnis, 'formular-flach.pdf')
  writeFileSync(leerPfad, await wendeAenderungenAn(acroform, keine))
  writeFileSync(
    ausgefuelltPfad,
    await wendeAenderungenAn(acroform, keine, { formularwerte: werte })
  )
  writeFileSync(
    flachPfad,
    await wendeAenderungenAn(acroform, keine, { formularwerte: werte, flachlegen: true })
  )
  // Flachgelegt heisst: keine Felder mehr in der Datei.
  const flach = await PDFDocument.load(new Uint8Array(await readFile(flachPfad)))
  expect(flach.getForm().getFields()).toHaveLength(0)

  const page = await neueSeite()
  try {
    const leer = await fotografiere(page, leerPfad)
    const ausgefuellt = await fotografiere(page, ausgefuelltPfad)
    const flachgelegt = await fotografiere(page, flachPfad)
    expect(leer.hatViewer).toBe(true)
    expect(ausgefuellt.bild, 'Chrome zeigt die eingetragenen Werte nicht.').not.toBe(leer.bild)
    expect(
      flachgelegt.bild,
      'Chrome zeigt das flachgelegte Formular wie das leere: die Werte sind beim Flachlegen verloren gegangen.'
    ).not.toBe(leer.bild)
  } finally {
    await page.close()
  }
})

test('Chrome zeichnet alle Typen zusammen', async () => {
  test.skip(browser === null, grund)
  const ohne = await baue('ohne-alle.pdf', [])
  const mit = await baue('mit-allen.pdf', GEMALTE_TYPEN)

  const page = await neueSeite()
  try {
    const leer = await fotografiere(page, ohne)
    const gezeichnet = await fotografiere(page, mit)
    expect(gezeichnet.bild).not.toBe(leer.bild)
  } finally {
    await page.close()
  }
})
