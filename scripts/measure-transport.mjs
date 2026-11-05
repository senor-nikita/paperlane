// Misst die beiden Kandidaten fuer den Datei-Transport (Entscheidung D4).
//
// Variante A: das gesamte Dokument als ArrayBuffer uebergeben. Entspricht dem
//   Weg "Datei im Main lesen, Bytes ueber IPC an den Renderer".
// Variante B: PDFDataRangeTransport. pdf.js fordert Byte-Bereiche nach Bedarf
//   an; nur ein Anfangsstueck wird vorab geliefert.
//
// Gemessen wird die Zeit bis zur ersten auswertbaren Seite, also bis
// getOperatorList() durch ist. Das Rastern selbst fehlt hier - dafuer braeuchte
// es einen Canvas -, aber der teure Teil beim Oeffnen eines grossen Dokuments
// ist das Parsen von Querverweistabelle, Seitenbaum und Content-Stream, und
// genau den erfasst diese Messung.
//
// Aufruf: node scripts/measure-transport.mjs [datei]
import { openSync, readSync, closeSync, statSync, readFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const DATEI = process.argv[2] ?? 'test/fixtures/large-heavy.pdf'
const ANFANGSSTUECK = 64 * 1024
const LAEUFE = 3

if (!existsSync(DATEI)) {
  console.error('Datei fehlt: ' + DATEI)
  console.error('Erzeugen mit: npm run fixtures')
  process.exit(1)
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

/** Gemeinsame Optionen. Muessen zur Factory im Renderer passen. */
const OPTIONEN = {
  enableScripting: false,
  isEvalSupported: false,
  enableXfa: false
}

async function ersteSeite(getDocumentParameter) {
  const start = performance.now()
  const aufgabe = pdfjs.getDocument({ ...OPTIONEN, ...getDocumentParameter })
  const dokument = await aufgabe.promise
  const seite = await dokument.getPage(1)
  await seite.getOperatorList()
  const dauer = performance.now() - start
  const seiten = dokument.numPages
  // In pdf.js v6 raeumt der Ladeauftrag auf, nicht der Dokument-Proxy.
  await aufgabe.destroy()
  return { dauer, seiten }
}

async function messeVarianteA() {
  const bytes = new Uint8Array(readFileSync(DATEI))
  return ersteSeite({ data: bytes })
}

async function messeVarianteB() {
  const groesse = statSync(DATEI).size
  const griff = openSync(DATEI, 'r')
  try {
    const anfang = Buffer.alloc(Math.min(ANFANGSSTUECK, groesse))
    readSync(griff, anfang, 0, anfang.length, 0)

    const transport = new pdfjs.PDFDataRangeTransport(groesse, new Uint8Array(anfang))
    let angeforderteBereiche = 0
    let angeforderteBytes = 0
    transport.requestDataRange = (von, bis) => {
      angeforderteBereiche += 1
      angeforderteBytes += bis - von
      const stueck = Buffer.alloc(bis - von)
      readSync(griff, stueck, 0, stueck.length, von)
      transport.onDataRange(von, new Uint8Array(stueck))
    }

    const ergebnis = await ersteSeite({ range: transport })
    return { ...ergebnis, angeforderteBereiche, angeforderteBytes }
  } finally {
    closeSync(griff)
  }
}

function zeile(name, werte) {
  const schnitt = werte.reduce((a, b) => a + b, 0) / werte.length
  const min = Math.min(...werte)
  const max = Math.max(...werte)
  console.log(
    '  ' +
      name.padEnd(28) +
      schnitt.toFixed(0).padStart(7) +
      ' ms   (min ' +
      min.toFixed(0) +
      ', max ' +
      max.toFixed(0) +
      ')'
  )
}

const groesse = statSync(DATEI).size
console.log('Datei: ' + DATEI + '  (' + (groesse / 1024 / 1024).toFixed(1) + ' MB)')
console.log('Gemessen: Zeit bis zur ersten auswertbaren Seite, ' + String(LAEUFE) + ' Laeufe')
console.log('')

const a = []
const b = []
let letzteB = null
for (let i = 0; i < LAEUFE; i++) {
  a.push((await messeVarianteA()).dauer)
  letzteB = await messeVarianteB()
  b.push(letzteB.dauer)
}

zeile('A: ganzer ArrayBuffer', a)
zeile('B: PDFDataRangeTransport', b)
console.log('')
if (letzteB !== null) {
  console.log(
    '  Variante B forderte ' +
      String(letzteB.angeforderteBereiche) +
      ' Bereiche an, zusammen ' +
      (letzteB.angeforderteBytes / 1024 / 1024).toFixed(1) +
      ' MB von ' +
      (groesse / 1024 / 1024).toFixed(1) +
      ' MB'
  )
  console.log('  Seiten im Dokument: ' + String(letzteB.seiten))
}
