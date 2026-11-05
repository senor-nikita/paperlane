// Guard fuer ADR 0004 auf der Paketseite: das Auslieferungspaket enthaelt
// keine Update-Zusage.
//
// Anlass ist ein Befund aus S5.3, Aufgabe 1. electron-builder leitet ohne
// `publish: null` aus dem Git-Remote selbsttaetig einen GitHub-Provider ab und
// legt eine `app-update.yml` in `resources/` — mit Eigentuemer, Repository und
// Cache-Verzeichnis. Die Datei ist ohne electron-updater wirkungslos, aber sie
// ist eine Zusage, die das Projekt nach ADR 0004 nicht gibt, und sie waere in
// einem Sicherheits-Audit (S5.2b) zu Recht ein Fund.
//
// Geprueft wird zweierlei: die Konfiguration traegt `publish: null`, und ein
// bereits gebautes Paket enthaelt keine `app-update.yml`. Der zweite Teil ist
// still, solange nichts gebaut wurde — `release/` entsteht erst bei
// `npm run dist`, nicht bei `npm run build`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const KONFIGURATION = 'electron-builder.yml'
const PAKETE = 'release'
const VERBOTEN = 'app-update.yml'

let fehler = 0

if (!existsSync(KONFIGURATION)) {
  console.error('FEHLT: ' + KONFIGURATION)
  process.exit(1)
}

const konfiguration = readFileSync(KONFIGURATION, 'utf8')
if (!/^publish:\s*null\s*$/m.test(konfiguration)) {
  console.error(
    KONFIGURATION +
      ' traegt kein `publish: null`.\n' +
      'Ohne diese Zeile leitet electron-builder aus dem Git-Remote einen\n' +
      'Update-Provider ab und legt eine ' +
      VERBOTEN +
      ' ins Paket. ADR 0004\n' +
      'schliesst Auto-Update aus.'
  )
  fehler += 1
}

function suche(pfad) {
  if (!existsSync(pfad)) return []
  if (statSync(pfad).isFile()) return pfad.endsWith(VERBOTEN) ? [pfad] : []
  return readdirSync(pfad).flatMap((eintrag) => suche(join(pfad, eintrag)))
}

const funde = suche(PAKETE)
for (const fund of funde) {
  console.error(fund + '  Update-Beschreibung im Paket (ADR 0004).')
  fehler += 1
}

if (fehler > 0) process.exit(1)

console.log(
  existsSync(PAKETE)
    ? 'OK  kein ' + VERBOTEN + ' im Paket, `publish: null` gesetzt.'
    : 'OK  `publish: null` gesetzt (kein Paket in ' + PAKETE + ' zum Pruefen).'
)
