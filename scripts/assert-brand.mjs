// Guard fuer Invariante 8: keine Fremdmarken im Produkt.
//
// Geprueft werden die Anwendung selbst und ihre Metadaten — nicht die
// Testinfrastruktur. `scripts/` und `test/` sind bewusst ausgenommen: die
// XFA-Spezifikation schreibt den Namensraum `http://ns.adobe.com/xdp/` vor, er
// ist Teil des Dateiformats und keine Markennennung. Genau deshalb ist der
// Geltungsbereich eng gefasst statt "irgendwo im Repository".
//
// README.md ist bewusst NICHT im Geltungsbereich: die Abgrenzungserklaerung
// dort muss benennen, wovon sie abgrenzt. Der Guard schuetzt das Produkt,
// nicht seine Dokumentation.
//
// Eine Zeile darf den Begriff tragen, wenn sie mit MARKENABGRENZUNG markiert
// ist — gedacht fuer Kommentare, die die Abgrenzung erklaeren.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const VERBOTEN = /adobe|acrobat/i
const FREIGABE = 'MARKENABGRENZUNG'
const ZIELE = ['src', 'package.json', 'electron-builder.yml']

function dateien(pfad) {
  if (!existsSync(pfad)) return []
  if (statSync(pfad).isFile()) return [pfad]
  return readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
}

let treffer = 0
for (const ziel of ZIELE) {
  for (const datei of dateien(ziel)) {
    const zeilen = readFileSync(datei, 'utf8').split('\n')
    zeilen.forEach((zeile, index) => {
      if (!VERBOTEN.test(zeile) || zeile.includes(FREIGABE)) return
      console.error(datei + ':' + String(index + 1) + '  ' + zeile.trim())
      treffer += 1
    })
  }
}

if (treffer > 0) {
  console.error('')
  console.error(
    String(treffer) +
      ' Fundstelle(n). Eigenes Branding verwenden. Ist die Nennung technisch\n' +
      'unvermeidbar (Namensraum, Formatbezeichner), die Zeile mit ' +
      FREIGABE +
      ' markieren\n' +
      'und begruenden.'
  )
  process.exit(1)
}
console.log('OK  keine Fremdmarken in ' + ZIELE.join(', ') + '.')
