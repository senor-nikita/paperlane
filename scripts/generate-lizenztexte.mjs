// Erzeugt build/generated/THIRD_PARTY_LICENSES.txt: die Lizenztexte aller
// Laufzeit-Abhaengigkeiten, die der Installer als `THIRD_PARTY_LICENSES.txt`
// neben LICENSE und NOTICE ablegt (electron-builder.yml, extraResources).
//
// Die Datei entsteht bei jedem `npm run dist`; sie ist nicht eingecheckt, weil
// sie nur den Stand von node_modules wiedergibt. Fehlt sie, bricht
// electron-builder ab - der Installer erscheint nie ohne sie.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { lizenzdatei, pruefePakete, sammleLaufzeitPakete } from './lib/lizenztexte.mjs'

const ZIEL = 'build/generated/THIRD_PARTY_LICENSES.txt'

const pakete = sammleLaufzeitPakete()
const probleme = pruefePakete(pakete)
if (probleme.length > 0) {
  console.error('Lizenztexte nicht vollstaendig:')
  for (const problem of probleme) console.error('  ' + problem)
  process.exit(1)
}
mkdirSync(dirname(ZIEL), { recursive: true })
writeFileSync(ZIEL, lizenzdatei(pakete), 'utf8')
console.log('OK  ' + ZIEL + ' (' + String(pakete.length) + ' Pakete)')
