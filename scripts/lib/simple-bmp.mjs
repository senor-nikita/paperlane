// Ein minimaler, unkomprimierter 24-Bit-BMP-Schreiber - fuer das dritte
// Bildformat im S6.4-Testkorpus (Aufgabe 2: WebP/GIF/BMP ueber Canvas).
// BMP ist das mit Abstand einfachste Rasterformat: ein Kopf plus rohe
// Pixelbytes, zeilenweise von unten nach oben, jede Zeile auf 4 Byte
// aufgefuellt - keine Kompression, keine Bibliothek noetig.

/**
 * @param {number} breite
 * @param {number} hoehe
 * @param {(x: number, y: number) => [number, number, number]} pixel RGB je Punkt.
 * @returns {Buffer}
 */
export function createSimpleBmp(breite, hoehe, pixel) {
  const zeilenGroesse = Math.ceil((breite * 3) / 4) * 4
  const bilddatenGroesse = zeilenGroesse * hoehe
  const dateiGroesse = 14 + 40 + bilddatenGroesse

  const datei = Buffer.alloc(dateiGroesse)
  // BITMAPFILEHEADER
  datei.write('BM', 0, 'latin1')
  datei.writeUInt32LE(dateiGroesse, 2)
  datei.writeUInt32LE(0, 6)
  datei.writeUInt32LE(14 + 40, 10) // Offset der Pixeldaten

  // BITMAPINFOHEADER
  datei.writeUInt32LE(40, 14)
  datei.writeInt32LE(breite, 18)
  datei.writeInt32LE(hoehe, 22)
  datei.writeUInt16LE(1, 26) // Planes
  datei.writeUInt16LE(24, 28) // Bits/Pixel
  datei.writeUInt32LE(0, 30) // keine Kompression
  datei.writeUInt32LE(bilddatenGroesse, 34)
  datei.writeInt32LE(2835, 38) // ~72 dpi
  datei.writeInt32LE(2835, 42)
  datei.writeUInt32LE(0, 46)
  datei.writeUInt32LE(0, 50)

  // Pixeldaten: Zeilen von unten nach oben, je Pixel B, G, R.
  for (let y = 0; y < hoehe; y++) {
    const quellzeile = hoehe - 1 - y
    const versatz = 14 + 40 + y * zeilenGroesse
    for (let x = 0; x < breite; x++) {
      const [r, g, b] = pixel(x, quellzeile)
      const p = versatz + x * 3
      datei[p] = b
      datei[p + 1] = g
      datei[p + 2] = r
    }
  }
  return datei
}
