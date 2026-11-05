// Fixture fuer PDF nach Word (S6.7): Text, Ueberschriften und zwei Bilder.
//
// Deterministisch wie der Rest des Korpus (S0.3): keine Zeitstempel, Bilder
// aus dem Rauschen mit festem Seed. Der Aufbau ist das, was die Gruppierung
// erkennen soll - Ueberschrift ueber relative Groesse, Absaetze ueber den
// Abstand, Silbentrennung am Zeilenende, fett und kursiv ueber den
// Schriftnamen - und die Bilder stehen zwischen den Absaetzen.
import { StandardFonts } from 'pdf-lib'
import { createNoisePng } from './noise-png.mjs'

/**
 * Baut die Seiten in ein leeres pdf-lib-Dokument. Die Tests pruefen die
 * erwartete Textfolge gegen genau diese Zeilen (test/unit/word-docx.test.ts).
 */
export async function fuelleWordPdf(doc) {
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const fett = await doc.embedFont(StandardFonts.HelveticaBold)
  const kursiv = await doc.embedFont(StandardFonts.HelveticaOblique)
  const bild1 = await doc.embedPng(createNoisePng(120, 80, 7))
  const bild2 = await doc.embedPng(createNoisePng(90, 90, 11))

  const zeilen = (seite, texte, y, schrift = normal, groesse = 11) => {
    texte.forEach((text, index) => {
      seite.drawText(text, { x: 72, y: y - index * 14, size: groesse, font: schrift })
    })
  }

  const s1 = doc.addPage([595, 842])
  s1.drawText('Bericht zur Messreihe', { x: 72, y: 760, size: 24, font: fett })
  zeilen(
    s1,
    [
      'Dieser Bericht fasst die Ergebnisse der ersten Mess-',
      'reihe zusammen. Die Werte wurden an drei Tagen erhoben',
      'und stimmen gut mit der Erwartung ueberein.'
    ],
    720
  )
  s1.drawImage(bild1, { x: 72, y: 540, width: 180, height: 120 })
  s1.drawText('Methode', { x: 72, y: 500, size: 16, font: fett })
  zeilen(
    s1,
    [
      'Gemessen wurde mit einem geeichten Geraet. Jeder Wert',
      'ist der Mittelwert aus fuenf Einzelmessungen.'
    ],
    470
  )
  s1.drawText('Hinweis:', { x: 72, y: 420, size: 11, font: fett })
  s1.drawText('Ausreisser wurden nicht entfernt.', { x: 120, y: 420, size: 11, font: kursiv })

  const s2 = doc.addPage([595, 842])
  s2.drawText('Ergebnis', { x: 72, y: 760, size: 16, font: fett })
  zeilen(s2, ['Die Abweichung liegt unter zwei Prozent.'], 730)
  s2.drawImage(bild2, { x: 72, y: 560, width: 135, height: 135 })
  zeilen(s2, ['Damit ist die Messreihe abgeschlossen.'], 520)
}
