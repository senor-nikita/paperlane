// Invariante 3: 80 % Statements auf den in DIESEM Schritt geaenderten Dateien.
// Kein Standardwerkzeug leistet das, deshalb dieses Skript.
// Scharf ab S0.3 (Plan Rev 2, Abschnitt 2.2) — davor meldet es nur.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { relative, resolve, sep } from 'node:path'

const THRESHOLD = 80
const REPORT = 'coverage/coverage-final.json'

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

function toPosix(p) {
  return p.split(sep).join('/')
}

/** Eine Vergleichsbasis gibt es erst ab dem ersten Commit (Fall S0.1). */
function hasBaseline() {
  return git(['rev-parse', '--verify', 'HEAD']) !== null
}

function changedFiles() {
  const base = git(['merge-base', 'main', 'HEAD'])
  const head = git(['rev-parse', 'HEAD'])
  const files = new Set()

  if (base !== null && head !== null && base !== head) {
    const diff = git(['diff', '--name-only', base, 'HEAD'])
    if (diff) for (const f of diff.split('\n')) files.add(f)
  }
  const working = git(['diff', '--name-only', 'HEAD'])
  if (working) for (const f of working.split('\n')) files.add(f)
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
  if (untracked) for (const f of untracked.split('\n')) files.add(f)

  return [...files].filter((f) => /\.(ts|tsx)$/.test(f) && f.startsWith('src/'))
}

if (!hasBaseline()) {
  console.log(
    'coverage-changed: kein Commit vorhanden, also keine Vergleichsbasis. ' +
      'Kein Gate — Invariante 3 ist ab S0.3 scharf (Plan Rev 2, Abschnitt 2.2).'
  )
  process.exit(0)
}

if (!existsSync(REPORT)) {
  console.error(`FEHLT: ${REPORT}`)
  console.error('Zuerst:  npx vitest run --coverage')
  process.exit(1)
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'))
const covered = new Map()
for (const [absolute, entry] of Object.entries(report)) {
  const counts = Object.values(entry.s ?? {})
  const total = counts.length
  const hit = counts.filter((n) => n > 0).length
  const pct = total === 0 ? 100 : (hit / total) * 100
  covered.set(toPosix(relative(process.cwd(), resolve(absolute))), pct)
}

const changed = changedFiles().filter((f) => covered.has(f))

if (changed.length === 0) {
  console.log('coverage-changed: keine geaenderten Dateien im Geltungsbereich.')
  process.exit(0)
}

let failed = false
for (const file of changed.sort()) {
  const pct = covered.get(file)
  const ok = pct >= THRESHOLD
  if (!ok) failed = true
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${pct.toFixed(1).padStart(5)} %  ${file}`)
}

if (failed) {
  console.error(`Mindestens eine geaenderte Datei liegt unter ${THRESHOLD} % Statements.`)
  process.exit(1)
}
console.log(`Alle ${changed.length} geaenderten Datei(en) >= ${THRESHOLD} %.`)
