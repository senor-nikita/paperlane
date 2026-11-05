/**
 * Minimaler TrueType-Leser fuer die Glyphpruefung (S6.6b, ADR 0005 Punkt 3).
 *
 * Beantwortet genau drei Fragen an ein eingebettetes Programm (`FontFile2`
 * oder `FontFile3/OpenType` mit `glyf`): welcher Glyph gehoert zu einem
 * Zeichen (`cmap`), hat er einen **Umriss** (`loca`/`glyf`), und wie breit ist
 * er (`hmtx`)? Mehr nicht - kein Rendering, kein Hinting, keine Teilmenge.
 *
 * Warum der Umriss und nicht nur "Glyph-ID existiert": Word bettet zwar alle
 * Glyph-Slots ein, laesst unbenutzte aber leer. Ein naiver Test hielte sie
 * fuer vorhanden, und das neue Zeichen waere unsichtbar (ADR 0005,
 * Fehlerbilder).
 *
 * Warum selbst gelesen statt `@pdf-lib/fontkit` zur Laufzeit: fontkit waere
 * eine neue Laufzeitabhaengigkeit mit eigenem Parser fuer alle Tabellen
 * (GSUB, GPOS, CFF, ...) - fuer fremde Eingabe die groessere Angriffsflaeche.
 * Die drei Tabellen hier sind klein, und jeder Zugriff ist bereichsgeprueft.
 */

export interface TrueTypeProgramm {
  anzahlGlyphen: number
  einheitenProEm: number
  /** Hat der Glyph einen Umriss (Konturen oder zusammengesetzt)? */
  hatUmriss: (gid: number) => boolean
  /** Vorschub in Schrifteinheiten. */
  vorschub: (gid: number) => number
  /** Nachschlag in einer cmap-Untertabelle, `null` wenn es sie nicht gibt. */
  cmap: (plattform: number, kodierung: number) => ((zeichen: number) => number) | null
}

interface Tabelle {
  offset: number
  laenge: number
}

class Leser {
  readonly dv: DataView
  constructor(readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  u8(o: number): number {
    return this.dv.getUint8(o)
  }
  u16(o: number): number {
    return this.dv.getUint16(o)
  }
  i16(o: number): number {
    return this.dv.getInt16(o)
  }
  u32(o: number): number {
    return this.dv.getUint32(o)
  }
}

/** Liest das Programm oder liefert `null`, wenn es kein brauchbares TrueType ist. */
export function leseTrueType(bytes: Uint8Array): TrueTypeProgramm | null {
  try {
    return lese(bytes)
  } catch {
    return null
  }
}

function lese(bytes: Uint8Array): TrueTypeProgramm | null {
  const l = new Leser(bytes)
  const version = l.u32(0)
  // 0x00010000 TrueType, 'true' (Apple), 'OTTO' waere CFF - ohne glyf nicht pruefbar.
  if (version !== 0x00010000 && version !== 0x74727565) return null
  const anzahlTabellen = l.u16(4)
  const tabellen = new Map<string, Tabelle>()
  for (let k = 0; k < anzahlTabellen; k++) {
    const o = 12 + k * 16
    const tag = String.fromCharCode(l.u8(o), l.u8(o + 1), l.u8(o + 2), l.u8(o + 3))
    const offset = l.u32(o + 8)
    const laenge = l.u32(o + 12)
    if (offset + laenge > bytes.length) continue
    tabellen.set(tag, { offset, laenge })
  }
  const head = tabellen.get('head')
  const maxp = tabellen.get('maxp')
  const loca = tabellen.get('loca')
  const glyf = tabellen.get('glyf')
  if (head === undefined || maxp === undefined || loca === undefined || glyf === undefined) {
    return null
  }
  const einheitenProEm = l.u16(head.offset + 18) || 1000
  const langesLoca = l.i16(head.offset + 50) === 1
  const anzahlGlyphen = l.u16(maxp.offset + 4)

  const glyphBereich = (gid: number): [number, number] | null => {
    if (gid < 0 || gid >= anzahlGlyphen) return null
    let a: number
    let b: number
    if (langesLoca) {
      if ((gid + 2) * 4 > loca.laenge) return null
      a = l.u32(loca.offset + gid * 4)
      b = l.u32(loca.offset + gid * 4 + 4)
    } else {
      if ((gid + 2) * 2 > loca.laenge) return null
      a = l.u16(loca.offset + gid * 2) * 2
      b = l.u16(loca.offset + gid * 2 + 2) * 2
    }
    if (b < a || b > glyf.laenge) return null
    return [glyf.offset + a, b - a]
  }

  const hatUmriss = (gid: number): boolean => {
    const bereich = glyphBereich(gid)
    if (bereich === null || bereich[1] < 10) return false
    // numberOfContours: > 0 einfache Konturen, < 0 zusammengesetzt, 0 leer.
    return l.i16(bereich[0]) !== 0
  }

  const hhea = tabellen.get('hhea')
  const hmtx = tabellen.get('hmtx')
  const anzahlMetriken = hhea === undefined ? 0 : l.u16(hhea.offset + 34)
  const vorschub = (gid: number): number => {
    if (hmtx === undefined || anzahlMetriken === 0) return 0
    const index = Math.min(gid, anzahlMetriken - 1)
    if (index * 4 + 2 > hmtx.laenge) return 0
    return l.u16(hmtx.offset + index * 4)
  }

  const cmapTabelle = tabellen.get('cmap')
  const cmap = (plattform: number, kodierung: number): ((zeichen: number) => number) | null => {
    if (cmapTabelle === undefined) return null
    // Kopf und Eintraege gegen die Tabellenlaenge geprueft (Gate Phase 6, L3):
    // eine `cmap` der Laenge 0 am Dateiende warf sonst einen RangeError.
    const basis = cmapTabelle.offset
    const grenze = basis + cmapTabelle.laenge
    if (basis + 4 > grenze) return null
    const anzahl = l.u16(basis + 2)
    for (let k = 0; k < anzahl; k++) {
      const o = basis + 4 + k * 8
      if (o + 8 > grenze) return null
      if (l.u16(o) !== plattform || l.u16(o + 2) !== kodierung) continue
      const unter = basis + l.u32(o + 4)
      try {
        return untertabelle(l, unter, grenze)
      } catch {
        return null
      }
    }
    return null
  }

  return { anzahlGlyphen, einheitenProEm, hatUmriss, vorschub, cmap }
}

function untertabelle(l: Leser, o: number, grenze: number): ((zeichen: number) => number) | null {
  if (o + 6 > grenze) return null
  const format = l.u16(o)
  const sicher =
    (f: (z: number) => number) =>
    (z: number): number => {
      try {
        return f(z)
      } catch {
        return 0
      }
    }
  if (format === 0) {
    return sicher((z) => (z >= 0 && z < 256 && o + 6 + z < grenze ? l.u8(o + 6 + z) : 0))
  }
  if (format === 4) {
    if (o + 14 > grenze) return null
    const segmente = l.u16(o + 6) / 2
    const ende = o + 14
    const anfang = ende + segmente * 2 + 2
    const delta = anfang + segmente * 2
    const bereich = delta + segmente * 2
    if (bereich + segmente * 2 > grenze) return null
    return sicher((z) => {
      if (z < 0 || z > 0xffff) return 0
      for (let s = 0; s < segmente; s++) {
        if (z > l.u16(ende + s * 2)) continue
        const a = l.u16(anfang + s * 2)
        if (z < a) return 0
        const d = l.u16(delta + s * 2)
        const r = l.u16(bereich + s * 2)
        if (r === 0) return (z + d) & 0xffff
        const adresse = bereich + s * 2 + r + (z - a) * 2
        if (adresse + 2 > grenze) return 0
        const g = l.u16(adresse)
        return g === 0 ? 0 : (g + d) & 0xffff
      }
      return 0
    })
  }
  if (format === 6) {
    if (o + 10 > grenze) return null
    const erstes = l.u16(o + 6)
    const anzahl = l.u16(o + 8)
    return sicher((z) => {
      const i = z - erstes
      if (i < 0 || i >= anzahl || o + 10 + i * 2 + 2 > grenze) return 0
      return l.u16(o + 10 + i * 2)
    })
  }
  if (format === 12) {
    if (o + 16 > grenze) return null
    const gruppen = l.u32(o + 12)
    if (o + 16 + gruppen * 12 > grenze) return null
    return sicher((z) => {
      for (let g = 0; g < gruppen; g++) {
        const p = o + 16 + g * 12
        const von = l.u32(p)
        const bis = l.u32(p + 4)
        if (z >= von && z <= bis) return l.u32(p + 8) + (z - von)
      }
      return 0
    })
  }
  return null
}
