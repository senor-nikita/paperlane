// Guard: jede Abhaengigkeit steht in THIRD_PARTY.md.
//
// Ohne diesen Abgleich veraltet die Lizenzuebersicht beim ersten `npm install`,
// den jemand vergisst nachzutragen.
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const doku = readFileSync('THIRD_PARTY.md', 'utf8')

const alle = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {})
].sort()

// Prettier richtet Markdown-Tabellen aus und fuellt die Zellen mit Leerzeichen
// auf. Ein naiver includes-Vergleich auf "| name |" schlaegt dadurch fehl.
const dokumentiert = new Set(
  doku
    .split(/\r?\n/)
    .filter((zeile) => zeile.startsWith('|'))
    .map((zeile) => zeile.split('|')[1]?.trim())
    .filter((name) => name !== undefined && name.length > 0)
)

const fehlend = alle.filter((name) => !dokumentiert.has(name))

if (fehlend.length > 0) {
  console.error('Nicht in THIRD_PARTY.md dokumentiert:')
  for (const name of fehlend) console.error('  ' + name)
  console.error('')
  console.error('Tabelle neu erzeugen: npm run third-party')
  process.exit(1)
}
console.log('OK  alle ' + String(alle.length) + ' Abhaengigkeiten dokumentiert.')
