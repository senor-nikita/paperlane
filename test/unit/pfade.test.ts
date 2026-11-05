import { describe, expect, it } from 'vitest'
import { istLokalerDateipfad } from '../../src/main/bilderpdf'
import { pfadklasse, type Pfadklasse } from '../../src/shared/pfade'

/**
 * Wohin zeigt ein Pfad, den der Renderer nennt? Netzwerk- und Geraetepfade
 * duerfen den Main-Prozess nicht zu einem Zugriff bringen. Klassifiziert wird
 * die Zeichenkette mit der Windows-Lesart: `/` und `\` sind dasselbe Zeichen.
 */
const FAELLE: [string, Pfadklasse][] = [
  // lokal
  ['C:\\Dokumente\\a.pdf', 'lokal'],
  ['C:/Dokumente/a.pdf', 'lokal'],
  ['relativ\\a.pdf', 'lokal'],
  ['  C:\\Dokumente\\a.pdf', 'lokal'],
  ['C:\\x\\console.pdf', 'lokal'],
  // Netzwerk, in jeder Schreibweise von zwei Trennzeichen am Anfang
  ['\\\\server\\freigabe\\a.pdf', 'netz'],
  ['//server/freigabe/a.pdf', 'netz'],
  ['/\\server\\freigabe\\a.pdf', 'netz'],
  ['\\/server/freigabe/a.pdf', 'netz'],
  ['\\\\10.0.0.1\\s\\a.pdf', 'netz'],
  // Geraete und Namensraeume
  ['\\\\?\\C:\\x\\a.pdf', 'geraet'],
  ['\\\\.\\pipe\\x', 'geraet'],
  ['\\??\\UNC\\s\\x.pdf', 'geraet'],
  ['//?/C:/x.pdf', 'geraet'],
  ['/\\?\\C:\\x.pdf', 'geraet'],
  ['C:\\x\\CON.pdf', 'geraet'],
  ['NUL', 'geraet'],
  ['C:\\x\\com1.PDF', 'geraet'],
  ['C:\\x\\Lpt9.png', 'geraet']
]

describe('pfadklasse', () => {
  it.each(FAELLE)('ordnet "%s" als %s ein', (pfad, erwartet) => {
    expect(pfadklasse(pfad)).toBe(erwartet)
  })
})

describe('istLokalerDateipfad (Bilder)', () => {
  // Der Schutz fuer Bilder aus Drag & Drop prueft dieselbe Klassifikation. Die
  // alte Pruefung am Rohstring liess `/\server\x.png` durch, das Windows als
  // Netzwerkpfad versteht.
  it.each(FAELLE)('"%s" -> %s', (pfad, klasse) => {
    expect(istLokalerDateipfad(pfad)).toBe(klasse === 'lokal')
  })

  it('lehnt die gemischte Schreibweise ab, die frueher durchkam', () => {
    expect(istLokalerDateipfad('/\\server\\freigabe\\x.png')).toBe(false)
    expect(istLokalerDateipfad('\\/server/freigabe/x.png')).toBe(false)
  })
})
