// Erzeugt PNG-Bilder aus deterministischem Rauschen.
//
// Zweck: das Performance-Fixture braucht Bilder, die pdf.js echte Arbeit kosten.
// Rauschen ist praktisch inkompressibel, ein Bild bleibt also gross und muss
// beim Rendern tatsaechlich dekodiert werden. Ein einfarbiges Bild waere winzig
// und wuerde das Budget bedeutungslos machen.
//
// Bewusst ohne Bildbibliothek: PNG ist mit node:zlib in wenigen Zeilen
// schreibbar, und jede weitere Abhaengigkeit muesste in THIRD_PARTY.md.
import { deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)
  return Buffer.concat([length, typed, crc])
}

/** Mulberry32 — kleiner, deterministischer Pseudozufall fuer reproduzierbare Fixtures. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} seed  gleicher Seed -> byte-identisches Bild
 * @returns {Buffer} PNG, 8 Bit RGB
 */
export function createNoisePng(width, height, seed) {
  const random = mulberry32(seed)

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // Bittiefe
  ihdr[9] = 2 // Farbtyp RGB
  ihdr[10] = 0 // Kompression
  ihdr[11] = 0 // Filtermethode
  ihdr[12] = 0 // kein Interlacing

  // Jede Zeile beginnt mit dem Filterbyte 0 (kein Filter).
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < width * 3; x++) {
      raw[offset] = Math.floor(random() * 256)
      offset += 1
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
