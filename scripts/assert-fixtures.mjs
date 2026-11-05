// Guard: der Testkorpus ist vollstaendig, traegt seine Kennzeichen, und das
// Performance-Fixture ist nicht eingecheckt.
//
// Mit --deterministic wird zusaetzlich neu erzeugt und byte-weise verglichen.
// Das laeuft nicht bei jedem `verify`, weil es die 1,5-MB-Dateien jedes Mal neu
// schreiben wuerde — es gehoert in CI und in den manuellen Lauf.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const OUT = 'test/fixtures'
const NICHT_COMMITTEN = 'large-heavy.pdf'

/**
 * Liefert allen auffindbaren Text: Rohbytes, entpackte Streams und die darin
 * als Hex notierten Zeichenketten. pdf-lib komprimiert Content-Streams und
 * schreibt Text als <hex> — ohne beides findet eine naive Suche nichts.
 */
function durchsuchbarerText(buffer) {
  const teile = [buffer.toString('latin1')]
  const roh = buffer.toString('latin1')
  let position = 0
  for (;;) {
    const start = roh.indexOf('stream', position)
    if (start === -1) break
    // 'endstream' enthaelt 'stream'. Ohne diese Pruefung verschiebt sich die
    // Suche und ganze Streams werden uebersprungen.
    if (roh.slice(start - 3, start) === 'end') {
      position = start + 6
      continue
    }
    const datenStart = roh[start + 6] === '\r' ? start + 8 : start + 7
    const ende = roh.indexOf('endstream', datenStart)
    if (ende === -1) break
    try {
      const klar = inflateSync(buffer.subarray(datenStart, ende)).toString('latin1')
      teile.push(klar)
      for (const treffer of klar.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        teile.push(Buffer.from(treffer[1], 'hex').toString('latin1'))
      }
    } catch {
      // Kein Flate-Stream (z. B. verschluesselt oder roh) — Rohbytes reichen.
      teile.push(buffer.subarray(datenStart, ende).toString('latin1'))
    }
    position = ende + 9
  }
  return teile.join('\n')
}

const ERWARTUNGEN = [
  ['single-page.pdf', /Wasserzeichen/, 'Suchbegriff im Text'],
  ['large-500.pdf', /\/Count 500/, '500 Seiten'],
  ['large-500.pdf', /Seite 500 von 500/, 'Text der letzten Seite'],
  ['scanned.pdf', /\/Subtype\s*\/Image/, 'Bild'],
  ['acroform.pdf', /\/AcroForm/, 'Formular'],
  ['acroform.pdf', /\/Btn/, 'Schaltflaechenfeld'],
  ['acroform.pdf', /\/Ch/, 'Auswahlfeld'],
  ['annotated.pdf', /\/Highlight/, 'Markierung'],
  ['annotated.pdf', /\/Subtype\s*\/Text/, 'Notiz'],
  ['annotated.pdf', /\/Subtype\s*\/Link/, 'Verweis'],
  ['annotated.pdf', /\/URI/, 'externer Verweis'],
  ['outline.pdf', /\/Outlines/, 'Gliederung'],
  ['outline.pdf', /\/Dests/, 'benannte Ziele'],
  // Die vier Zielarten, die das Modul aus S1.3d beherrschen muss.
  ['outline.pdf', /\/XYZ/, 'XYZ-Ziel'],
  ['outline.pdf', /\/FitH/, 'FitH-Ziel'],
  ['outline.pdf', /\/FitR/, 'FitR-Ziel'],
  ['xfa.pdf', /\/XFA/, 'XFA-Formular'],
  ['js-embedded.pdf', /\/JavaScript/, 'eingebettetes Skript'],
  ['js-embedded.pdf', /\/OpenAction/, 'Skript beim Oeffnen'],
  ['shading.pdf', /\/FunctionType 4/, 'PostScript-Funktion'],
  ['encrypted.pdf', /\/Encrypt/, 'Verschluesselung'],
  ['encrypted.pdf', /\/Filter\s*\/Standard/, 'Standard-Sicherheitshandler'],
  // S6.7: PDF nach Word braucht Text in zwei Schriftschnitten und Bilder.
  ['word.pdf', /Bericht zur Messreihe/, 'Ueberschrift'],
  ['word.pdf', /\/Helvetica-Bold/, 'fette Schrift'],
  ['word.pdf', /\/Subtype\s*\/Image/, 'Bild']
]

const ERWARTETE_DATEIEN = [...new Set(ERWARTUNGEN.map(([name]) => name)), 'corrupt.pdf']

let fehler = 0
function pruefe(bedingung, text) {
  console.log((bedingung ? 'OK    ' : 'FEHLER') + '  ' + text)
  if (!bedingung) fehler += 1
}

// 1. Vollstaendigkeit
for (const name of ERWARTETE_DATEIEN) {
  pruefe(existsSync(join(OUT, name)), 'vorhanden: ' + name)
}

// 2. Kennzeichen
const cache = new Map()
for (const [name, muster, was] of ERWARTUNGEN) {
  if (!existsSync(join(OUT, name))) continue
  if (!cache.has(name)) cache.set(name, durchsuchbarerText(readFileSync(join(OUT, name))))
  pruefe(muster.test(cache.get(name)), name.padEnd(18) + was)
}

// 3. corrupt.pdf muss beschaedigt sein
const corrupt = readFileSync(join(OUT, 'corrupt.pdf'), 'latin1')
pruefe(corrupt.startsWith('%PDF'), 'corrupt.pdf         beginnt wie ein PDF')
pruefe(!corrupt.includes('%%EOF'), 'corrupt.pdf         ist abgeschnitten')

// 4. Das Performance-Fixture darf nicht eingecheckt sein
let getrackt = ''
try {
  getrackt = execFileSync('git', ['ls-files', join(OUT, NICHT_COMMITTEN)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
} catch {
  getrackt = ''
}
pruefe(getrackt === '', NICHT_COMMITTEN + '     ist nicht eingecheckt')

// 5. Optional: Determinismus
if (process.argv.includes('--deterministic')) {
  const hashe = () =>
    Object.fromEntries(
      readdirSync(OUT)
        .filter((f) => f.endsWith('.pdf') && f !== NICHT_COMMITTEN)
        .sort()
        .map((f) => [
          f,
          createHash('sha256')
            .update(readFileSync(join(OUT, f)))
            .digest('hex')
        ])
    )
  const vorher = hashe()
  execFileSync(process.execPath, ['scripts/generate-fixtures.mjs', '--skip-heavy'], {
    stdio: ['ignore', 'ignore', 'inherit']
  })
  const nachher = hashe()
  for (const [name, hash] of Object.entries(vorher)) {
    pruefe(nachher[name] === hash, name.padEnd(18) + 'byte-identisch nach Neuerzeugung')
  }
}

// 6. Groessenregel: committete Fixtures bleiben klein, damit das Repository
//    nicht durch Testdaten waechst. Was groesser sein muss, wird erzeugt statt
//    eingecheckt (siehe large-heavy.pdf).
const MAX_BYTES = 1024 * 1024
for (const name of ERWARTETE_DATEIEN) {
  const pfad = join(OUT, name)
  if (!existsSync(pfad)) continue
  const groesse = readFileSync(pfad).length
  pruefe(
    groesse < MAX_BYTES,
    name.padEnd(18) + 'unter 1 MB (' + (groesse / 1024).toFixed(0) + ' kB)'
  )
}

if (fehler > 0) {
  console.error('')
  console.error(String(fehler) + ' Pruefung(en) fehlgeschlagen. Neu erzeugen mit: npm run fixtures')
  process.exit(1)
}
console.log('')
console.log('Testkorpus vollstaendig und plausibel.')
