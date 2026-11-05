// Guard fuer Invariante 7, Modul-Haelfte: kein Netzwerk aus dem Quelltext.
//
// Die Invariante hat zwei Haelften. Die CSP-Haelfte (connect-src 'none')
// haengt an src/main/csp.ts und test/guards/csp.test.ts. Die zweite Haelfte —
// kein fetch, kein XHR, keine Node-Netzwerkmodule in src/ — war bis S5.3 nur
// zur Haelfte scharf: eslint.config.js verbietet die Globals fetch und
// XMLHttpRequest, aber kein einziges Node-Netzwerkmodul. Ein Import von
// node-https im Main waere durch jede Pruefung gerutscht.
//
// Warum ein Guard und keine ESLint-Regel: der Guard liest Text und sieht
// deshalb auch, was eine Import-Regel nicht sieht — CommonJS-Aufrufe,
// dynamische Importe, Zugriffe ueber process.binding — und er deckt scripts/
// mit ab, das eslint.config.js ausdruecklich ignoriert.
//
// Auto-Update und Versionspruefung sind in ADR 0004 abgelehnt. Eine Zeile darf
// den Begriff dennoch tragen, wenn sie mit INVARIANTE-7 markiert ist — gedacht
// fuer die Faelle, in denen eine Netzwerk-API nachweislich lokal arbeitet. Die
// Markierung ist kein Freibrief fuer einen echten Aufruf: der braucht eine
// eigene ADR (Plan, Paragraph 7).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ZIELE = ['src', 'scripts']
const FREIGABE = 'INVARIANTE-7'

// Die Netzwerkmodule von Node, mit und ohne node-Praefix — beide Schreibweisen
// laden dasselbe Modul. Erfasst werden Import, Re-Export, CommonJS-Aufruf und
// dynamischer Import, jeweils in einfachen oder doppelten Anfuehrungszeichen.
const MODULE = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns']
const MODULLISTE = MODULE.flatMap((name) => [name, 'node:' + name]).join('|')
const MODULZUGRIFF = new RegExp(
  '(?:from|import|require)\\s*\\(?\\s*[\'"](?:' + MODULLISTE + ')[\'"]',
  'i'
)

// Die Netzwerk-Globals. ESLint deckt die ersten beiden in src/ ab, aber nicht
// in scripts/, und ein Zugriff ueber globalThis entgeht no-restricted-globals
// ohnehin.
//
// Der Ruecklick verlangt, dass vor dem Namen kein Punkt und kein Wortzeichen
// steht. Ohne ihn traf das Muster jedes `<etwas>.fetch(` — auch einen
// Zwischenspeicher mit einer Methode dieses Namens. Solche Fehlalarme kosten
// mehr als sie bringen: jeder zwingt zu einer INVARIANTE-7-Markierung, die
// nichts mit Netzwerk zu tun hat, und macht die Markierung zur Gewohnheit
// statt zur Ausnahme.
const GLOBALS = /(?<![.\w])(?:globalThis\.)?(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/

// Electrons eigener Netzwerkweg im Main-Prozess. Er faellt nicht unter den
// Ruecklick oben, gehoert aber ausdruecklich erfasst: `net.fetch` ist eine
// echte Netzwerk-API, auch wenn sie im Projekt derzeit nur eine `file:`-URL
// laedt (src/main/index.ts, dort mit Begruendung markiert).
const ELECTRON_NET = /\bnet\.(?:fetch|request)\s*\(/
const BINDING = /process\.binding\s*\(\s*['"](?:net|tls|http_parser|dns)['"]/

const PRUEFUNGEN = [
  { muster: MODULZUGRIFF, grund: 'Node-Netzwerkmodul' },
  { muster: GLOBALS, grund: 'Netzwerk-Global' },
  { muster: ELECTRON_NET, grund: 'Electron-net' },
  { muster: BINDING, grund: 'process.binding auf Netzwerk' }
]

const ENDUNGEN = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

function dateien(pfad) {
  if (!existsSync(pfad)) return []
  if (statSync(pfad).isFile()) return ENDUNGEN.test(pfad) ? [pfad] : []
  return readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
}

let treffer = 0
for (const ziel of ZIELE) {
  for (const datei of dateien(ziel)) {
    const zeilen = readFileSync(datei, 'utf8').split('\n')
    zeilen.forEach((zeile, index) => {
      if (zeile.includes(FREIGABE)) return
      const fund = PRUEFUNGEN.find(({ muster }) => muster.test(zeile))
      if (!fund) return
      console.error(datei + ':' + String(index + 1) + '  [' + fund.grund + ']  ' + zeile.trim())
      treffer += 1
    })
  }
}

if (treffer > 0) {
  console.error('')
  console.error(
    String(treffer) +
      ' Fundstelle(n). Invariante 7 verbietet jeden Netzwerkaufruf aus dem\n' +
      'Quelltext. Auto-Update und Versionspruefung sind in ADR 0004 abgelehnt.\n' +
      'Arbeitet die API an dieser Stelle nachweislich lokal, die Zeile mit ' +
      FREIGABE +
      '\n' +
      'markieren und begruenden. Soll die Invariante fallen, braucht das eine\n' +
      'eigene ADR (Plan, Paragraph 7) — nicht eine Ausnahme an dieser Stelle.'
  )
  process.exit(1)
}
console.log('OK  kein Netzwerkzugriff in ' + ZIELE.join(', ') + '.')
