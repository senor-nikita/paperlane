// Guard: jede Laufzeit-Abhaengigkeit bringt eine Lizenzangabe mit, und keine ist
// starkes Copyleft.
//
// Die Lizenztexte selbst entstehen erst beim Bauen des Installers
// (scripts/generate-lizenztexte.mjs). Dieser Guard faengt den Fall frueher ab:
// ein neues Paket ohne Lizenz oder mit GPL soll beim naechsten `npm run verify`
// auffallen, nicht erst beim Installer.
import { pruefePakete, sammleLaufzeitPakete } from './lib/lizenztexte.mjs'

const pakete = sammleLaufzeitPakete()
if (pakete.length === 0) {
  console.error('Keine Laufzeit-Pakete gefunden - ist node_modules installiert?')
  process.exit(1)
}
const probleme = pruefePakete(pakete)
if (probleme.length > 0) {
  console.error('Lizenzproblem bei Laufzeit-Abhaengigkeiten:')
  for (const problem of probleme) console.error('  ' + problem)
  process.exit(1)
}
console.log('OK  Lizenzangaben aller ' + String(pakete.length) + ' Laufzeit-Pakete vorhanden.')
