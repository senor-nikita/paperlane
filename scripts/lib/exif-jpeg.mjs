// Erzeugt minimale, deterministische Baseline-JPEGs mit einem EXIF-
// Orientation-Tag - fuer die acht Fixtures aus S6.4 (R17: pdf-lib beachtet
// die EXIF-Ausrichtung nicht, die Anwendung muss sie im Renderer anwenden).
//
// Bewusst ohne Bildbibliothek, wie noise-png.mjs bei den PNG-Fixtures: jedes
// erzeugte Bild besteht nur aus 8x8-Bloecken **konstanter** Helligkeit. Fuer
// einen konstanten Block sind nach der JPEG-Formel (Annex A.3.3) alle
// AC-Koeffizienten exakt Null und der DC-Koeffizient exakt `8 * (pegel-128)`
// - eine echte diskrete Kosinustransformation ist damit unnoetig, das Bild
// laesst sich analytisch kodieren. Die Huffman-Tabellen sind eigene, minimale
// Tabellen (DHT legt sie im Dateikopf vollstaendig fest, ein Decoder braucht
// keine Standardtabelle); fuer den DC-Kanal wird trotzdem die bekannte
// Standardtabelle aus Anhang K der Norm verwendet (oeffentliche Zahlentabelle,
// keine kreative Werkleistung) - Wiedererkennbarkeit hilft nichts, Korrektheit
// zaehlt.

/** BITS/HUFFVAL der DC-Luminanz-Tabelle aus Anhang K der JPEG-Norm (ITU T.81). */
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_HUFFVAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** Eigene, minimale AC-Tabelle: nur EOB (Lauf/Groesse 0x00), ein Bit lang. */
const AC_BITS = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const AC_HUFFVAL = [0x00]

/** Erzeugt Code und Laenge je Symbol aus BITS/HUFFVAL (Anhang C, Standardverfahren). */
function huffmanCodes(bits, huffval) {
  const groessen = []
  for (let laenge = 1; laenge <= 16; laenge++) {
    for (let i = 0; i < bits[laenge - 1]; i++) groessen.push(laenge)
  }
  const codes = []
  let code = 0
  let k = 0
  while (k < groessen.length) {
    const laenge = groessen[k]
    while (k < groessen.length && groessen[k] === laenge) {
      codes.push(code)
      code++
      k++
    }
    code <<= 1
  }
  const tabelle = new Map()
  for (let i = 0; i < huffval.length; i++) {
    tabelle.set(huffval[i], { code: codes[i], laenge: groessen[i] })
  }
  return tabelle
}

/** Schreibt einzelne Bits MSB-zuerst und stopft 0xFF mit einer Null (Entropiecodierung). */
class Bitschreiber {
  constructor() {
    this.bytes = []
    this.puffer = 0
    this.anzahl = 0
  }

  schreibeBits(wert, laenge) {
    for (let i = laenge - 1; i >= 0; i--) {
      this.puffer = (this.puffer << 1) | ((wert >> i) & 1)
      this.anzahl++
      if (this.anzahl === 8) {
        this.pushByte(this.puffer)
        this.puffer = 0
        this.anzahl = 0
      }
    }
  }

  pushByte(byte) {
    this.bytes.push(byte & 0xff)
    if ((byte & 0xff) === 0xff) this.bytes.push(0x00)
  }

  /** Am Ende mit Einsen auffuellen (Standardverhalten fuer den letzten Byte). */
  fertig() {
    if (this.anzahl > 0) {
      const rest = 8 - this.anzahl
      this.puffer = (this.puffer << rest) | ((1 << rest) - 1)
      this.pushByte(this.puffer)
      this.puffer = 0
      this.anzahl = 0
    }
    return Buffer.from(this.bytes)
  }
}

/** Kategorie (SSSS) und VLI-Bits einer DC-Differenz (Standardalgorithmus). */
function vli(diff) {
  if (diff === 0) return { kategorie: 0, bits: 0 }
  const betrag = Math.abs(diff)
  const kategorie = Math.floor(Math.log2(betrag)) + 1
  const bits = diff > 0 ? diff : diff + ((1 << kategorie) - 1)
  return { kategorie, bits }
}

function marker(code) {
  return Buffer.from([0xff, code])
}

function segment(code, inhalt) {
  const laenge = Buffer.alloc(2)
  laenge.writeUInt16BE(inhalt.length + 2, 0)
  return Buffer.concat([marker(code), laenge, inhalt])
}

/** Die APP1-EXIF-Nutzlast mit genau einem Tag: Orientation (0x0112, SHORT). */
function exifApp1(orientation) {
  const tiff = Buffer.alloc(26)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(0x002a, 2)
  tiff.writeUInt32LE(8, 4) // Offset des IFD0 relativ zum TIFF-Kopf
  tiff.writeUInt16LE(1, 8) // ein Eintrag
  tiff.writeUInt16LE(0x0112, 10) // Tag: Orientation
  tiff.writeUInt16LE(3, 12) // Typ: SHORT
  tiff.writeUInt32LE(1, 14) // Anzahl
  tiff.writeUInt16LE(orientation, 18) // Wert in den ersten 2 Byte des Werteblocks
  tiff.writeUInt16LE(0, 20) // Fuellbyte
  tiff.writeUInt32LE(0, 22) // kein weiteres IFD
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
}

function dht(klasseUndId, bits, huffval) {
  return segment(
    0xc4,
    Buffer.concat([Buffer.from([klasseUndId]), Buffer.from(bits), Buffer.from(huffval)])
  )
}

/**
 * Baut ein minimales Graustufen-Baseline-JPEG.
 *
 * @param {number} breite Vielfaches von 8.
 * @param {number} hoehe Vielfaches von 8.
 * @param {number[]} bloecke Helligkeit (0-255) je 8x8-Block, zeilenweise -
 *   Laenge muss `(breite/8) * (hoehe/8)` sein.
 * @param {number} orientation EXIF-Orientation-Wert 1-8.
 */
export function createOrientedJpeg(breite, hoehe, bloecke, orientation) {
  if (breite % 8 !== 0 || hoehe % 8 !== 0) {
    throw new Error('Breite und Hoehe muessen Vielfache von 8 sein.')
  }
  const erwarteteBloecke = (breite / 8) * (hoehe / 8)
  if (bloecke.length !== erwarteteBloecke) {
    throw new Error('Falsche Blockanzahl: erwartet ' + String(erwarteteBloecke))
  }

  const dcCodes = huffmanCodes(DC_BITS, DC_HUFFVAL)
  const acCodes = huffmanCodes(AC_BITS, AC_HUFFVAL)
  const eob = acCodes.get(0x00)

  const schreiber = new Bitschreiber()
  let vorherigerDc = 0
  for (const pegel of bloecke) {
    const dc = 8 * (pegel - 128)
    const diff = dc - vorherigerDc
    vorherigerDc = dc
    const { kategorie, bits } = vli(diff)
    const huffman = dcCodes.get(kategorie)
    if (huffman === undefined)
      throw new Error('DC-Kategorie ausserhalb der Tabelle: ' + String(kategorie))
    schreiber.schreibeBits(huffman.code, huffman.laenge)
    if (kategorie > 0) schreiber.schreibeBits(bits, kategorie)
    // Alle AC-Koeffizienten sind bei einem konstanten Block exakt Null - ein
    // einzelnes End-of-Block schliesst den Block ab.
    if (eob === undefined) throw new Error('AC-Tabelle ohne EOB-Symbol.')
    schreiber.schreibeBits(eob.code, eob.laenge)
  }
  const entropiedaten = schreiber.fertig()

  const dqt = segment(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]))
  const sof0 = segment(
    0xc0,
    Buffer.concat([
      Buffer.from([8]),
      (() => {
        const b = Buffer.alloc(2)
        b.writeUInt16BE(hoehe, 0)
        return b
      })(),
      (() => {
        const b = Buffer.alloc(2)
        b.writeUInt16BE(breite, 0)
        return b
      })(),
      Buffer.from([1, 1, 0x11, 0])
    ])
  )
  const sos = segment(0xda, Buffer.from([1, 1, 0x00, 0, 63, 0]))

  return Buffer.concat([
    marker(0xd8),
    segment(0xe1, exifApp1(orientation)),
    dqt,
    sof0,
    dht(0x00, DC_BITS, DC_HUFFVAL),
    dht(0x10, AC_BITS, AC_HUFFVAL),
    sos,
    entropiedaten,
    marker(0xd9)
  ])
}

/**
 * Das Testbild fuer die acht Orientierungen: 32x16 Rohpixel (4x2 Bloecke),
 * obere Haelfte hell, untere Haelfte dunkel - nach Anwendung der Ausrichtung
 * erkennt ein Betrachter oben/unten, und Orientierungen mit 90°-Drehung
 * (5, 6, 7, 8) vertauschen zusaetzlich Breite und Hoehe.
 */
export function createOrientationFixture(orientation) {
  const hell = 220
  const dunkel = 40
  const bloecke = [hell, hell, hell, hell, dunkel, dunkel, dunkel, dunkel]
  return createOrientedJpeg(32, 16, bloecke, orientation)
}
