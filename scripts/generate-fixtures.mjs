// Erzeugt den Testkorpus nach test/fixtures/.
//
// Programmatisch statt gesammelt: so sind die Dokumente frei von Lizenzfragen,
// reproduzierbar und im Zweifel nachvollziehbar. Alle Zeitstempel und
// Erzeugerangaben werden genullt, damit zwei Laeufe byte-identisch sind —
// sonst waere ein Determinismustest nicht moeglich.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { createNoisePng } from './lib/noise-png.mjs'
import { createEncryptedPdf } from './lib/encrypted-pdf.mjs'
import { createShadingPdf } from './lib/shading-pdf.mjs'
import { createXfaPdf } from './lib/xfa-pdf.mjs'
import { fuelleWordPdf } from './lib/word-pdf.mjs'
import { createOrientationFixture } from './lib/exif-jpeg.mjs'
import { createSimpleBmp } from './lib/simple-bmp.mjs'

const OUT = 'test/fixtures'
const SUCHBEGRIFF = 'Wasserzeichen'
export const ENCRYPTED_PASSWORD = 'geheim'

function normalize(doc) {
  doc.setCreationDate(new Date(0))
  doc.setModificationDate(new Date(0))
  doc.setProducer('')
  doc.setCreator('')
  doc.setTitle('paperlane Testdokument')
  doc.setAuthor('paperlane')
}

async function save(doc) {
  normalize(doc)
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

function schreibe(name, bytes) {
  writeFileSync(join(OUT, name), bytes)
  const kb = (bytes.length / 1024).toFixed(1)
  console.log('  ' + name.padEnd(20) + kb.padStart(9) + ' kB')
}

async function singlePage() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('paperlane Testdokument', { x: 72, y: 760, size: 24, font })
  page.drawText('Suchbegriff: ' + SUCHBEGRIFF, { x: 72, y: 720, size: 14, font })
  page.drawText('Zweite Zeile mit auswaehlbarem Text.', { x: 72, y: 700, size: 14, font })
  return save(doc)
}

async function large500() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= 500; n++) {
    const page = doc.addPage([595, 842])
    page.drawText('Seite ' + String(n) + ' von 500', { x: 72, y: 760, size: 20, font })
    // Auf jeder zehnten Seite ein Treffer: die Suche in S1.4 muss genau 50 finden.
    if (n % 10 === 0) page.drawText(SUCHBEGRIFF, { x: 72, y: 700, size: 14, font })
  }
  return save(doc)
}

async function scanned() {
  const doc = await PDFDocument.create()
  const png = await doc.embedPng(createNoisePng(400, 560, 1))
  const page = doc.addPage([595, 842])
  page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 })
  return save(doc) // bewusst ohne Textebene
}

async function acroform() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('Formular', { x: 72, y: 780, size: 20, font })

  const form = doc.getForm()
  // Mit Vorbelegung: der Appearance-Stream enthaelt dann Text, und S3.1 kann
  // belegen, dass er unter dem eigenen Eingabefeld NICHT durchscheint
  // (annotationMode DISABLE - "keine doppelte Darstellung alter Werte").
  const name = form.createTextField('person.name')
  name.setText('Erika Muster')
  name.addToPage(page, { x: 72, y: 700, width: 300, height: 24 })

  const zustimmung = form.createCheckBox('zustimmung')
  zustimmung.addToPage(page, { x: 72, y: 650, width: 18, height: 18 })

  const anrede = form.createRadioGroup('anrede')
  anrede.addOptionToPage('frau', page, { x: 72, y: 600, width: 18, height: 18 })
  anrede.addOptionToPage('herr', page, { x: 120, y: 600, width: 18, height: 18 })

  const land = form.createDropdown('land')
  land.setOptions(['Deutschland', 'Oesterreich', 'Schweiz'])
  land.addToPage(page, { x: 72, y: 550, width: 200, height: 24 })

  // Ab S3.1: die Faelle, die die Aufgaben 2 bis 5 brauchen. Ein Pflichtfeld
  // mit Laengenbegrenzung, ein schreibgeschuetztes Feld, ein mehrzeiliges,
  // eine Mehrfachauswahl - und zwei Felder mit Formatskripten.
  const email = form.createTextField('person.email')
  email.enableRequired()
  email.setMaxLength(40)
  email.addToPage(page, { x: 72, y: 500, width: 300, height: 24 })

  const kennung = form.createTextField('kennung')
  kennung.setText('K-2026')
  kennung.enableReadOnly()
  kennung.addToPage(page, { x: 72, y: 450, width: 120, height: 24 })

  const notiz = form.createTextField('notiz')
  notiz.enableMultiline()
  notiz.addToPage(page, { x: 72, y: 360, width: 300, height: 70 })

  const sprachen = form.createOptionList('sprachen')
  sprachen.setOptions(['Deutsch', 'Englisch', 'Franzoesisch'])
  sprachen.enableMultiselect()
  sprachen.addToPage(page, { x: 72, y: 280, width: 200, height: 60 })

  // Formatskripte, wie Formularwerkzeuge sie anlegen. Sie werden von paperlane NIE
  // ausgefuehrt (Invariante 6) - nur wiedererkannt: das Standardskript
  // AFNumber_Format ergibt eine deklarative Zahlpruefung, ein freies Skript
  // ergibt den Hinweis "wird nicht ausgefuehrt". Hex-Strings, weil die
  // Skripte Klammern enthalten (Gate Phase 2, H1).
  const skript = (code) => doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(code) })
  const betrag = form.createTextField('betrag')
  betrag.addToPage(page, { x: 72, y: 230, width: 120, height: 24 })
  betrag.acroField.dict.set(
    PDFName.of('AA'),
    doc.context.obj({
      F: skript('AFNumber_Format(2, 0, 0, 0, "", true);'),
      K: skript('AFNumber_Keystroke(2, 0, 0, 0, "", true);')
    })
  )
  const sonstiges = form.createTextField('sonstiges')
  sonstiges.addToPage(page, { x: 220, y: 230, width: 152, height: 24 })
  sonstiges.acroField.dict.set(
    PDFName.of('AA'),
    doc.context.obj({ V: skript('if (event.value.length < 3) app.alert("zu kurz");') })
  )

  form.updateFieldAppearances(font)
  return save(doc)
}

async function annotated() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const seite1 = doc.addPage([595, 842])
  const seite2 = doc.addPage([595, 842])
  seite1.drawText('Markierter Text auf Seite eins', { x: 72, y: 760, size: 18, font })
  seite1.drawText('Sprung zu Seite zwei', { x: 72, y: 700, size: 14, font, color: rgb(0, 0, 0.8) })
  seite1.drawText('Externer Verweis', { x: 72, y: 660, size: 14, font, color: rgb(0, 0, 0.8) })
  seite2.drawText('Seite zwei, Ziel des internen Verweises', { x: 72, y: 760, size: 18, font })

  const ctx = doc.context
  const highlight = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [70, 752, 340, 782],
      QuadPoints: [70, 782, 340, 782, 70, 752, 340, 752],
      C: [1, 1, 0],
      F: 4,
      T: PDFString.of('Testautor'),
      Contents: PDFString.of('Vorhandene Markierung')
    })
  )
  const notiz = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Name: 'Comment',
      Rect: [500, 750, 524, 774],
      F: 4,
      T: PDFString.of('Testautor'),
      Contents: PDFString.of('Vorhandene Notiz')
    })
  )
  const internerLink = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [70, 694, 250, 716],
      Border: [0, 0, 0],
      Dest: [seite2.ref, 'XYZ', 0, 842, null]
    })
  )
  const externerLink = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [70, 654, 220, 676],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/') }
    })
  )
  seite1.node.set(PDFName.of('Annots'), ctx.obj([highlight, notiz, internerLink, externerLink]))
  return save(doc)
}

async function jsEmbedded() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('Dokument mit eingebettetem JavaScript', { x: 72, y: 760, size: 18, font })
  page.drawText('Das Skript darf niemals ausgefuehrt werden.', { x: 72, y: 730, size: 12, font })

  const ctx = doc.context
  const aktion = ctx.register(
    ctx.obj({
      Type: 'Action',
      S: 'JavaScript',
      JS: PDFString.of('app.alert("Dieses Skript haette nicht laufen duerfen.");')
    })
  )
  const namen = ctx.register(
    ctx.obj({ JavaScript: { Names: [PDFString.of('Testskript'), aktion] } })
  )
  doc.catalog.set(PDFName.of('Names'), namen)
  doc.catalog.set(PDFName.of('OpenAction'), aktion)
  return save(doc)
}

// --- Performance-Fixture (nicht committet) ----------------------------------

const SCHRIFT_KANDIDATEN = [
  'C:/Windows/Fonts/Candara.ttf',
  'C:/Windows/Fonts/georgia.ttf',
  'C:/Windows/Fonts/times.ttf',
  '/System/Library/Fonts/Supplemental/Georgia.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
]

function findeSchrift() {
  for (const pfad of SCHRIFT_KANDIDATEN) if (existsSync(pfad)) return pfad
  return null
}

async function largeHeavy(seiten) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const standard = await doc.embedFont(StandardFonts.Helvetica)

  const schriftPfad = findeSchrift()
  let eigeneSchrift = null
  if (schriftPfad === null) {
    console.warn(
      '  WARNUNG: keine Systemschrift gefunden. large-heavy.pdf entsteht ohne\n' +
        '  eingebettete Nicht-Standard-Schriften und ist als Perf-Fixture\n' +
        '  entsprechend schwaecher. Geprueft wurden:\n' +
        SCHRIFT_KANDIDATEN.map((p) => '    ' + p).join('\n')
    )
  } else {
    eigeneSchrift = await doc.embedFont(readFileSync(schriftPfad), { subset: false })
    console.log('  Schrift eingebettet: ' + schriftPfad)
  }

  for (let n = 1; n <= seiten; n++) {
    const page = doc.addPage([595, 842])
    const png = await doc.embedPng(createNoisePng(300, 250, n))
    page.drawImage(png, { x: 40, y: 400, width: 515, height: 380 })
    page.drawText('Seite ' + String(n) + ' von ' + String(seiten), {
      x: 40,
      y: 340,
      size: 18,
      font: eigeneSchrift ?? standard
    })
    page.drawText('Fliesstext auf Seite ' + String(n) + ' mit ' + SUCHBEGRIFF + '.', {
      x: 40,
      y: 310,
      size: 12,
      font: standard
    })
  }
  return save(doc)
}

/**
 * S5.1, Aufgabe 2: viele Annotationen. `seiten` Seiten, je `jeSeite`
 * Markierungen - stresst genau den Pfad aus dem S2.2-Befund (jede sichtbare
 * Seite holt ihre Annotationen vom Worker), nicht nur eine dichte erste Seite.
 */
async function manyAnnotations(seiten, jeSeite) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const ctx = doc.context
  for (let n = 1; n <= seiten; n++) {
    const page = doc.addPage([595, 842])
    page.drawText('Seite ' + String(n) + ' von ' + String(seiten), {
      x: 40,
      y: 800,
      size: 16,
      font
    })
    const annots = []
    for (let i = 0; i < jeSeite; i++) {
      const zeile = i % 20
      const spalte = Math.floor(i / 20)
      const y = 770 - zeile * 36
      const x = 40 + spalte * 190
      annots.push(
        ctx.register(
          ctx.obj({
            Type: 'Annot',
            Subtype: 'Highlight',
            Rect: [x, y - 4, x + 170, y + 14],
            QuadPoints: [x, y + 14, x + 170, y + 14, x, y - 4, x + 170, y - 4],
            C: [1, 1, 0],
            F: 4,
            T: PDFString.of('Perf'),
            Contents: PDFString.of('Markierung ' + String(i + 1))
          })
        )
      )
    }
    page.node.set(PDFName.of('Annots'), ctx.obj(annots))
  }
  return save(doc)
}

/** S5.1, Aufgabe 2: ein Formular mit `anzahl` Textfeldern auf einer Seite. */
async function manyFields(anzahl) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('Formular mit ' + String(anzahl) + ' Feldern', { x: 40, y: 810, size: 16, font })
  const form = doc.getForm()
  for (let i = 0; i < anzahl; i++) {
    const zeile = i % 30
    const spalte = Math.floor(i / 30)
    const y = 780 - zeile * 25
    const x = 40 + spalte * 190
    const feld = form.createTextField('feld_' + String(i + 1))
    feld.setText('Wert ' + String(i + 1))
    feld.addToPage(page, { x, y, width: 170, height: 18 })
  }
  form.updateFieldAppearances(font)
  return save(doc)
}

// --- Ablauf -----------------------------------------------------------------

/**
 * Dokument mit Gliederung. Deckt alle vier Zielarten ab, die das
 * Zielaufloesungs-Modul aus S1.3d beherrschen muss: XYZ, FitH, FitR und ein
 * benanntes Ziel. Ohne ein solches Dokument liesse sich der Sprung ueber die
 * Gliederung nur behaupten, nicht pruefen.
 */
async function outline() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const seiten = []
  for (let n = 1; n <= 4; n++) {
    const seite = doc.addPage([595, 842])
    seite.drawText('Seite ' + String(n) + ' von 4', { x: 72, y: 780, size: 20, font })
    seite.drawText('Abschnittsmarke', { x: 72, y: 400, size: 14, font })
    seiten.push(seite)
  }

  const ctx = doc.context
  // Die Eintraege verweisen gegenseitig aufeinander (Parent, Next, Prev),
  // deshalb erst die Referenzen reservieren und danach fuellen.
  const wurzel = ctx.nextRef()
  const kapitel1 = ctx.nextRef()
  const kapitel2 = ctx.nextRef()
  const abschnitt1 = ctx.nextRef()
  const abschnitt2 = ctx.nextRef()

  ctx.assign(wurzel, ctx.obj({ Type: 'Outlines', First: kapitel1, Last: kapitel2, Count: 4 }))
  ctx.assign(
    kapitel1,
    ctx.obj({
      Title: PDFString.of('Kapitel 1'),
      Parent: wurzel,
      Next: kapitel2,
      First: abschnitt1,
      Last: abschnitt2,
      Count: 2,
      Dest: [seiten[0].ref, 'XYZ', 0, 842, null]
    })
  )
  ctx.assign(
    abschnitt1,
    ctx.obj({
      Title: PDFString.of('Abschnitt 1.1'),
      Parent: kapitel1,
      Next: abschnitt2,
      Dest: [seiten[1].ref, 'FitH', 700]
    })
  )
  ctx.assign(
    abschnitt2,
    ctx.obj({
      Title: PDFString.of('Abschnitt 1.2'),
      Parent: kapitel1,
      Prev: abschnitt1,
      // Benanntes Ziel: die Aufloesung muss den Umweg ueber /Names gehen.
      Dest: PDFString.of('abschnitt-zwei')
    })
  )
  ctx.assign(
    kapitel2,
    ctx.obj({
      Title: PDFString.of('Kapitel 2'),
      Parent: wurzel,
      Prev: kapitel1,
      Dest: [seiten[3].ref, 'FitR', 50, 100, 400, 500]
    })
  )

  doc.catalog.set(PDFName.of('Outlines'), wurzel)
  doc.catalog.set(
    PDFName.of('Names'),
    ctx.obj({
      Dests: {
        Names: [PDFString.of('abschnitt-zwei'), [seiten[2].ref, 'XYZ', 0, 400, null]]
      }
    })
  )
  return save(doc)
}

/**
 * Bilder fuer S6.4 (Bilder zu PDF): drei Formate fuer den Durchlauftest -
 * PNG, JPEG (ohne Drehung) und BMP - plus acht JPEGs mit je einem
 * EXIF-Orientation-Wert 1-8 fuer R17 (Handyfotos duerfen nicht quer landen).
 *
 * `createOrientationFixture(1)` traegt keine Drehung und dient zugleich als
 * das "einfache" JPEG im Formate-Test.
 */
function bildPng() {
  // 24x16, deterministisches Rauschen wie beim Perf-Fixture - reicht als
  // "irgendein PNG", ohne eine zweite Bildquelle zu erfinden.
  return createNoisePng(24, 16, 6)
}

function bildBmp() {
  // Zwei Farbstreifen: sichtbar etwas anderes als PNG/JPEG, ohne
  // Bildbibliothek erzeugt.
  return createSimpleBmp(20, 12, (x) => (x < 10 ? [200, 60, 60] : [60, 60, 200]))
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const nurCommittete = process.argv.includes('--skip-heavy')

  console.log('Committete Fixtures:')
  const single = await singlePage()
  schreibe('single-page.pdf', single)
  schreibe('large-500.pdf', await large500())
  schreibe('scanned.pdf', await scanned())
  schreibe('acroform.pdf', await acroform())
  schreibe('annotated.pdf', await annotated())
  schreibe('outline.pdf', await outline())
  schreibe('xfa.pdf', createXfaPdf())
  schreibe('js-embedded.pdf', await jsEmbedded())
  // S6.7: PDF nach Word - Text, Ueberschriften und zwei Bilder.
  const word = await PDFDocument.create()
  await fuelleWordPdf(word)
  schreibe('word.pdf', await save(word))
  schreibe('shading.pdf', createShadingPdf())
  schreibe('encrypted.pdf', createEncryptedPdf(ENCRYPTED_PASSWORD))
  // Abgeschnitten hinter dem Kopf: der Aufbau ist erkennbar, die
  // Querverweistabelle fehlt. Genau der Fall, den S1.5 behandeln muss.
  schreibe('corrupt.pdf', single.subarray(0, Math.floor(single.length * 0.4)))

  mkdirSync(join(OUT, 'bilder'), { recursive: true })
  schreibe('bilder/bild-a.png', bildPng())
  schreibe('bilder/bild-b.jpg', createOrientationFixture(1))
  schreibe('bilder/bild-c.bmp', bildBmp())
  mkdirSync(join(OUT, 'bilder', 'exif'), { recursive: true })
  for (let orientation = 1; orientation <= 8; orientation++) {
    schreibe(
      'bilder/exif/orientation-' + String(orientation) + '.jpg',
      createOrientationFixture(orientation)
    )
  }

  if (nurCommittete) {
    console.log('')
    console.log('large-heavy.pdf uebersprungen (--skip-heavy).')
    return
  }
  console.log('')
  console.log('Performance-Fixtures (nicht committet):')
  schreibe('large-heavy.pdf', await largeHeavy(300))
  schreibe('many-annotations.pdf', await manyAnnotations(50, 10))
  schreibe('many-fields.pdf', await manyFields(300))
}

await main()
