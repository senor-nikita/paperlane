import { deflateSync } from 'node:zlib'

/**
 * Ein kleines, gueltiges PNG — gebaut statt als Konstante hinterlegt, damit
 * kein Test an einer Base64-Zeichenkette haengt, die niemand mehr pruefen
 * kann. RGBA, deckend, in einer Farbe. Gebraucht von der Reparse-Pruefung
 * und der Chrome-Gegenprobe fuer den Bildstempel (S3.2, Aufgabe 4).
 */
export function kleinesPng(
  breite = 2,
  hoehe = 2,
  farbe: readonly [number, number, number] = [0, 0, 255]
): Buffer {
  const crcTabelle = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer): number => {
    let c = 0xffffffff
    for (const b of bytes) c = (crcTabelle[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const block = (typ: string, daten: Buffer): Buffer => {
    const laenge = Buffer.alloc(4)
    laenge.writeUInt32BE(daten.length)
    const kopf = Buffer.concat([Buffer.from(typ, 'latin1'), daten])
    const pruefsumme = Buffer.alloc(4)
    pruefsumme.writeUInt32BE(crc(kopf))
    return Buffer.concat([laenge, kopf, pruefsumme])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(breite, 0)
  ihdr.writeUInt32BE(hoehe, 4)
  ihdr[8] = 8 // Bittiefe
  ihdr[9] = 6 // RGBA
  const pixel = Buffer.from([farbe[0], farbe[1], farbe[2], 255])
  const zeile = Buffer.concat([Buffer.from([0]), ...Array.from({ length: breite }, () => pixel)])
  const idat = deflateSync(Buffer.concat(Array.from({ length: hoehe }, () => zeile)))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block('IHDR', ihdr),
    block('IDAT', idat),
    block('IEND', Buffer.alloc(0))
  ])
}

export function alsPngUrl(png: Buffer): string {
  return 'data:image/png;base64,' + png.toString('base64')
}
