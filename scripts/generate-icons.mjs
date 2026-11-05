// Erzeugt die App-Icons nach build/.
//
// Selbst gezeichnet statt heruntergeladen: ein fremdes Icon braeuchte eine
// Lizenzangabe in THIRD_PARTY.md, und Invariante 8 verbietet ohnehin jede
// Anspielung auf fremde Bildsprache. Die Marke ist deshalb aus der eigenen
// Palette gebaut (Blau aus schale.css) und zitiert nichts.
//
// Bewusst ohne Bildbibliothek und ohne SVG-Rasterer: die Geometrie steht
// einmal als Datenstruktur da (FORMEN), und zwei Ausgaben lesen sie —
// alsSvg() schreibt die Quelle, rastere() zeichnet Pixel. So koennen SVG und
// PNG nicht auseinanderlaufen, und es kommt keine Abhaengigkeit hinzu: PNG
// laesst sich mit node:zlib schreiben, .ico und .icns sind blosse Container
// um mehrere PNGs beziehungsweise Bitmaps.
//
// Die PNG-Hilfsmittel stehen hier noch einmal statt in scripts/lib/noise-png.mjs:
// jenes Modul schreibt RGB ohne Alphakanal und gehoert dem Fixture-Korpus,
// dessen Determinismustest an seiner Ausgabe haengt. Ein gemeinsamer Umbau
// haette die Fixtures beruehrt, ohne hier etwas zu sparen.
//
// Reproduzierbar: keine Zeitstempel, keine Zufallszahlen, feste Kompressionsstufe.
// Zwei Laeufe ergeben byte-identische Dateien.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const OUT = 'build'
const KANTE = 1024 // Bezugsgroesse der Geometrie

// --- Motiv ------------------------------------------------------------------
//
// "paperlane": ein hochkantes Blatt Papier auf blauer Kachel, darauf eine
// senkrechte Fahrbahn mit gestrichelter Mittellinie. Vier Ebenen, mehr nicht
// — Kachel, Blatt, Bahn, Striche. Bei 16 px bleiben die ersten drei klar
// unterscheidbar; die Striche entfallen dort (SCHWELLE_STRICHE), die
// Silhouette traegt das Motiv allein.
//
// Die Bahn ist bewusst parallel und nicht perspektivisch verjuengt. Ein nach
// oben zulaufender Keil auf einem hellen Blatt liest sich als grosser
// Buchstabe A — und ein Buchstabe auf der Kachel eines PDF-Betrachters zitiert
// die Bildsprache eines fremden Produkts, unabhaengig von der Farbe
// (Invariante 8). Aus demselben Grund: kein Rot, keine Schrift, kein Eselsohr.

const BLAU_HELL = '#2f6feb' // Akzent aus formularebene.css
const BLAU_TIEF = '#12336e'
const BLAU_BAHN = '#1a4fb4' // Fokusfarbe aus schale.css
const PAPIER = '#f7f8fa'
const MARKIERUNG = '#ffffff'

const KACHEL = { x: 48, y: 48, breite: 928, hoehe: 928, radius: 208 }
const BLATT = { x: 216, y: 168, breite: 592, hoehe: 688, radius: 32 }

// Die Bahn stoesst unten an die Blattkante und endet oben knapp 100 Einheiten
// darunter: sie kommt aus dem Blatt heraus auf den Betrachter zu, und der
// Papierstreifen darueber wirkt wie ein Horizont. Liefe sie oben und unten
// bis an den Rand, zerschnitte sie das Blatt in zwei helle Balken und das
// Papier waere als Papier nicht mehr zu erkennen; schwebte sie frei in der
// Mitte, waere sie ein Balken und keine Bahn. Breite 208 von 592: schmaler
// faellt sie bei 16 px auf gut zwei Bildpunkte zusammen.
const BAHN = { x: 408, y: BLATT.y + 96, breite: 208, hoehe: BLATT.hoehe - 96, radius: 0 }

// Mittellinie: vier gleiche Striche, die beiden Raender und die drei Luecken
// gleich gross, damit die Reihe symmetrisch in der Bahn sitzt
// (5 * 64 Zwischenraum + 4 * 68 Strich = 592 Bahnhoehe). Ganze Zahlen, weil
// gerade Kanten bei kleinen Groessen sauberer rastern als krumme.
const STRICHE = [328, 460, 592, 724].map((y) => ({ x: 488, y, breite: 48, hoehe: 68 }))

const farbe = (wert) => ({ art: 'farbe', wert })

/**
 * Alle Formen von hinten nach vorn. Die Reihenfolge ist die Zeichenreihenfolge;
 * jede Fuellung ist deckend. Diese Zusicherung traegt den Rasterer: pro
 * Abtastpunkt gewinnt schlicht die letzte Form, die ihn enthaelt.
 *
 * Eine Form ist immer ein Rechteck mit Eckradius — das Motiv braucht nicht
 * mehr, und weniger Formarten heisst: SVG-Ausgabe und Rasterer koennen nicht
 * unterschiedlich interpretieren.
 */
const GRUNDFORMEN = [
  { ...KACHEL, fuellung: { art: 'verlauf', id: 'kachel', von: BLAU_HELL, bis: BLAU_TIEF } },
  { ...BLATT, fuellung: farbe(PAPIER) },
  { ...BAHN, fuellung: farbe(BLAU_BAHN) }
]

const FORMEN = [
  ...GRUNDFORMEN,
  ...STRICHE.map((s) => ({ ...s, radius: 0, fuellung: farbe(MARKIERUNG) }))
]

// Unterhalb dieser Kantenlaenge entfaellt die Mittellinie. Ein Strich ist dort
// unter einem Bildpunkt breit und wird nicht zum Strich, sondern zu einem
// Grauschleier, der die ganze Bahn aufhellt — das Motiv verliert Kontrast,
// ohne etwas zu gewinnen. Groessenabhaengige Vereinfachung ist bei Icons
// ueblich; die Silhouette bleibt dabei dieselbe.
const SCHWELLE_STRICHE = 32

function formenFuer(groesse) {
  return groesse >= SCHWELLE_STRICHE ? FORMEN : GRUNDFORMEN
}

// --- Geometrie --------------------------------------------------------------

/** @returns {boolean} liegt (x, y) im Rechteck mit Eckradius? */
function inRundrect(f, x, y) {
  if (x < f.x || y < f.y || x > f.x + f.breite || y > f.y + f.hoehe) return false
  const r = f.radius
  if (r <= 0) return true
  // Das aus der Flaeche geschnittene Kreuz gehoert immer dazu; nur in den vier
  // Eckquadraten entscheidet der Abstand zum Eckmittelpunkt.
  if (x >= f.x + r && x <= f.x + f.breite - r) return true
  if (y >= f.y + r && y <= f.y + f.hoehe - r) return true
  const mx = Math.min(Math.max(x, f.x + r), f.x + f.breite - r)
  const my = Math.min(Math.max(y, f.y + r), f.y + f.hoehe - r)
  return (x - mx) * (x - mx) + (y - my) * (y - my) <= r * r
}

/** Umschliessendes Rechteck, damit der Rasterer Formen billig verwerfen kann. */
function huelle(f) {
  return { x0: f.x, y0: f.y, x1: f.x + f.breite, y1: f.y + f.hoehe }
}

function hexZuRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

/**
 * Farbe einer Form an der Stelle y. Der Verlauf laeuft senkrecht ueber die
 * eigene Hoehe der Form, damit SVG und Rasterer dieselbe Achse benutzen.
 */
function farbeAn(f, y) {
  if (f.fuellung.art === 'farbe') return hexZuRgb(f.fuellung.wert)
  const t = Math.min(Math.max((y - f.y) / f.hoehe, 0), 1)
  const von = hexZuRgb(f.fuellung.von)
  const bis = hexZuRgb(f.fuellung.bis)
  return [0, 1, 2].map((k) => von[k] + (bis[k] - von[k]) * t)
}

// --- SVG --------------------------------------------------------------------

function alsSvg() {
  const verlaeufe = FORMEN.filter((f) => f.fuellung.art === 'verlauf').map(
    (f) =>
      '    <linearGradient id="' +
      f.fuellung.id +
      '" x1="0" y1="' +
      String(f.y) +
      '" x2="0" y2="' +
      String(f.y + f.hoehe) +
      '" gradientUnits="userSpaceOnUse">\n' +
      '      <stop offset="0" stop-color="' +
      f.fuellung.von +
      '" />\n' +
      '      <stop offset="1" stop-color="' +
      f.fuellung.bis +
      '" />\n' +
      '    </linearGradient>'
  )

  const fuellungAls = (f) =>
    f.fuellung.art === 'verlauf' ? 'url(#' + f.fuellung.id + ')' : f.fuellung.wert

  const koerper = FORMEN.map((f) => {
    const radius = f.radius > 0 ? ' rx="' + String(f.radius) + '"' : ''
    return (
      '  <rect x="' +
      String(f.x) +
      '" y="' +
      String(f.y) +
      '" width="' +
      String(f.breite) +
      '" height="' +
      String(f.hoehe) +
      '"' +
      radius +
      ' fill="' +
      fuellungAls(f) +
      '" />'
    )
  })

  return (
    '<!-- Erzeugt von scripts/generate-icons.mjs. Nicht von Hand aendern:\n' +
    '     die Geometrie steht dort, diese Datei ist ihre Ausgabe. -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    String(KANTE) +
    ' ' +
    String(KANTE) +
    '" width="' +
    String(KANTE) +
    '" height="' +
    String(KANTE) +
    '" role="img" aria-label="paperlane">\n' +
    '  <title>paperlane</title>\n' +
    '  <defs>\n' +
    verlaeufe.join('\n') +
    '\n  </defs>\n' +
    koerper.join('\n') +
    '\n</svg>\n'
  )
}

// --- Rasterer ---------------------------------------------------------------

const ABTASTUNG = 4 // Unterabtastung je Achse, also 16 Proben je Bildpunkt

/**
 * Zeichnet die fuer `groesse` gueltigen Formen in ein RGBA-Raster.
 *
 * Kantenglaettung durch Unterabtastung statt durch Verkleinern eines grossen
 * Bildes: bei 16 px entscheidet jeder halbe Bildpunkt, und eine Probe genau
 * in der Geometrie ist genauer als ein nachtraeglich gemittelter Kasten.
 *
 * @param {number} groesse Kantenlaenge in Bildpunkten
 * @returns {Uint8Array} groesse * groesse * 4 Bytes, nicht vormultipliziert
 */
function rastere(groesse) {
  const hin = KANTE / groesse
  const formen = formenFuer(groesse)
  const huellen = formen.map(huelle)
  const daten = new Uint8Array(groesse * groesse * 4)
  const anteil = 1 / (ABTASTUNG * ABTASTUNG)

  for (let py = 0; py < groesse; py++) {
    for (let px = 0; px < groesse; px++) {
      // Vormultipliziert sammeln: nur so mischen halb bedeckte Randpunkte
      // richtig, ohne dass die Farbe transparenter Proben durchschlaegt.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ABTASTUNG; sy++) {
        const y = (py + (sy + 0.5) / ABTASTUNG) * hin
        for (let sx = 0; sx < ABTASTUNG; sx++) {
          const x = (px + (sx + 0.5) / ABTASTUNG) * hin
          // Von vorn nach hinten: die erste Form, die den Punkt enthaelt,
          // verdeckt alle darunter (alle Fuellungen sind deckend).
          for (let i = formen.length - 1; i >= 0; i--) {
            const h = huellen[i]
            if (x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1) continue
            if (!inRundrect(formen[i], x, y)) continue
            const [fr, fg, fb] = farbeAn(formen[i], y)
            r += fr
            g += fg
            b += fb
            a += 255
            break
          }
        }
      }
      const o = (py * groesse + px) * 4
      if (a > 0) {
        // Zurueckrechnen: gesammelte Farbe geteilt durch gesammelte Deckung.
        daten[o] = Math.round(r / (a / 255))
        daten[o + 1] = Math.round(g / (a / 255))
        daten[o + 2] = Math.round(b / (a / 255))
        daten[o + 3] = Math.round(a * anteil)
      }
    }
  }
  return daten
}

// --- PNG --------------------------------------------------------------------

const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabelle[n] = c >>> 0
  }
  return tabelle
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABELLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4)
  laenge.writeUInt32BE(daten.length, 0)
  const getypt = Buffer.concat([Buffer.from(typ, 'latin1'), daten])
  const pruefsumme = Buffer.alloc(4)
  pruefsumme.writeUInt32BE(crc32(getypt), 0)
  return Buffer.concat([laenge, getypt, pruefsumme])
}

/** @returns {Buffer} PNG, 8 Bit RGBA (Farbtyp 6), ohne Interlacing */
function alsPng(groesse, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(groesse, 0)
  ihdr.writeUInt32BE(groesse, 4)
  ihdr[8] = 8 // Bittiefe
  ihdr[9] = 6 // Farbtyp RGBA
  ihdr[10] = 0 // Kompression
  ihdr[11] = 0 // Filtermethode
  ihdr[12] = 0 // kein Interlacing

  // Filterbyte 1 (Sub) je Zeile: die Flaechen sind gross und einfarbig,
  // waagerechte Differenzen sind daher fast durchweg null und komprimieren
  // deutlich besser als ungefilterte Zeilen.
  const zeile = groesse * 4
  const roh = Buffer.alloc(groesse * (1 + zeile))
  for (let y = 0; y < groesse; y++) {
    const ziel = y * (1 + zeile)
    roh[ziel] = 1
    for (let i = 0; i < zeile; i++) {
      const links = i >= 4 ? rgba[y * zeile + i - 4] : 0
      roh[ziel + 1 + i] = (rgba[y * zeile + i] - links) & 0xff
    }
  }

  return Buffer.concat([
    PNG_SIGNATUR,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- ICO --------------------------------------------------------------------

const ICO_GROESSEN = [16, 24, 32, 48, 64, 128, 256]

/**
 * Windows-Bitmap fuer einen .ico-Eintrag: BITMAPINFOHEADER, danach BGRA von
 * unten nach oben, danach die 1-Bit-Maske.
 *
 * Warum ueberhaupt Bitmap statt PNG: PNG-Eintraege versteht Windows erst ab
 * Vista und einige Werkzeuge bis heute nicht. Die kleinen Groessen liegen
 * deshalb als Bitmap vor; nur 256 px wird als PNG abgelegt, wie es seit
 * Vista ueblich ist — unkomprimiert waere der Eintrag allein 256 kB gross.
 */
function alsDib(groesse, rgba) {
  const kopf = Buffer.alloc(40)
  kopf.writeUInt32LE(40, 0) // biSize
  kopf.writeInt32LE(groesse, 4) // biWidth
  kopf.writeInt32LE(groesse * 2, 8) // biHeight: Bild und Maske uebereinander
  kopf.writeUInt16LE(1, 12) // biPlanes
  kopf.writeUInt16LE(32, 14) // biBitCount
  kopf.writeUInt32LE(0, 16) // biCompression BI_RGB

  const bild = Buffer.alloc(groesse * groesse * 4)
  // Maskenzeilen sind auf vier Byte aufgefuellt, die BGRA-Zeilen sind es
  // durch ihre Breite ohnehin.
  const maskenZeile = Math.ceil(groesse / 32) * 4
  const maske = Buffer.alloc(maskenZeile * groesse)

  for (let y = 0; y < groesse; y++) {
    const quelle = y * groesse * 4
    const ziel = (groesse - 1 - y) * groesse * 4
    for (let x = 0; x < groesse; x++) {
      const q = quelle + x * 4
      const z = ziel + x * 4
      bild[z] = rgba[q + 2]
      bild[z + 1] = rgba[q + 1]
      bild[z + 2] = rgba[q]
      bild[z + 3] = rgba[q + 3]
      // Maskenbit gesetzt heisst durchsichtig. Aelteres Windows wertet nur
      // die Maske aus und wuerde die runden Ecken sonst als Kasten zeichnen.
      if (rgba[q + 3] < 128) {
        const m = (groesse - 1 - y) * maskenZeile + (x >> 3)
        maske[m] |= 0x80 >> (x & 7)
      }
    }
  }
  return Buffer.concat([kopf, bild, maske])
}

function alsIco(bilder) {
  const eintraege = ICO_GROESSEN.map((groesse) => ({
    groesse,
    daten:
      groesse >= 256 ? alsPng(groesse, bilder.get(groesse)) : alsDib(groesse, bilder.get(groesse))
  }))

  const kopf = Buffer.alloc(6)
  kopf.writeUInt16LE(0, 0) // reserviert
  kopf.writeUInt16LE(1, 2) // Typ 1 = Icon
  kopf.writeUInt16LE(eintraege.length, 4)

  let versatz = 6 + eintraege.length * 16
  const verzeichnis = eintraege.map((e) => {
    const zeile = Buffer.alloc(16)
    // 256 wird als 0 notiert: das Feld ist ein Byte breit.
    zeile[0] = e.groesse >= 256 ? 0 : e.groesse
    zeile[1] = e.groesse >= 256 ? 0 : e.groesse
    zeile[2] = 0 // Farbtabelle ungenutzt
    zeile[3] = 0 // reserviert
    zeile.writeUInt16LE(1, 4) // Ebenen
    zeile.writeUInt16LE(32, 6) // Bit je Bildpunkt
    zeile.writeUInt32LE(e.daten.length, 8)
    zeile.writeUInt32LE(versatz, 12)
    versatz += e.daten.length
    return zeile
  })

  return Buffer.concat([kopf, ...verzeichnis, ...eintraege.map((e) => e.daten)])
}

// --- ICNS -------------------------------------------------------------------

// Nur die Typen, die PNG aufnehmen duerfen. Die 1x-Plaetze fuer 16 und 32 px
// (is32/il32) fehlen bewusst: sie verlangen ein eigenes Lauflaengenformat mit
// getrennter Maske, und macOS rechnet diese Groessen sonst aus ic11/ic12
// herunter. Lieber eine Groesse weniger als ein selbst gebasteltes Format.
const ICNS_EINTRAEGE = [
  ['ic11', 32], // 16 @2x
  ['ic12', 64], // 32 @2x
  ['ic07', 128],
  ['ic13', 256], // 128 @2x
  ['ic08', 256],
  ['ic14', 512], // 256 @2x
  ['ic09', 512],
  ['ic10', 1024] // 512 @2x
]

function alsIcns(pngs) {
  const bloecke = ICNS_EINTRAEGE.map(([typ, groesse]) => {
    const daten = pngs.get(groesse)
    const kopf = Buffer.alloc(8)
    kopf.write(typ, 0, 'latin1')
    kopf.writeUInt32BE(8 + daten.length, 4) // Laenge einschliesslich Kopf
    return Buffer.concat([kopf, daten])
  })

  const gesamt = 8 + bloecke.reduce((summe, b) => summe + b.length, 0)
  const kopf = Buffer.alloc(8)
  kopf.write('icns', 0, 'latin1')
  kopf.writeUInt32BE(gesamt, 4)
  return Buffer.concat([kopf, ...bloecke])
}

// --- Ablauf -----------------------------------------------------------------

function schreibe(name, bytes) {
  writeFileSync(join(OUT, name), bytes)
  const kb = (bytes.length / 1024).toFixed(1)
  console.log('  ' + name.padEnd(12) + kb.padStart(9) + ' kB')
}

function main() {
  mkdirSync(OUT, { recursive: true })

  const gebraucht = [...new Set([KANTE, ...ICO_GROESSEN, ...ICNS_EINTRAEGE.map((e) => e[1])])].sort(
    (a, b) => a - b
  )
  const raster = new Map()
  const pngs = new Map()
  for (const groesse of gebraucht) {
    const rgba = rastere(groesse)
    raster.set(groesse, rgba)
    pngs.set(groesse, alsPng(groesse, rgba))
  }

  console.log('App-Icons:')
  schreibe('icon.svg', Buffer.from(alsSvg(), 'utf8'))
  // 1024 px als icon.png: electron-builder leitet daraus unter Linux alle
  // Groessen ab und nimmt die Datei auch als Rueckfallweg fuer andere Ziele.
  schreibe('icon.png', pngs.get(KANTE))
  schreibe('icon.ico', alsIco(raster))
  schreibe('icon.icns', alsIcns(pngs))
  console.log('')
  console.log('  ico:  ' + ICO_GROESSEN.join(', ') + ' px')
  console.log('  icns: ' + ICNS_EINTRAEGE.map(([typ, g]) => typ + '/' + String(g)).join(', '))
}

main()
