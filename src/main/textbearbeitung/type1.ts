/**
 * Type1-Programme (`FontFile`) fuer die Glyphpruefung (S6.6b, ADR 0005).
 *
 * Aus dem Programm werden nur die Namen der `/CharStrings` mit ihrer Breite
 * (`hsbw`/`sbw`) und die eingebaute Kodierung gelesen. Eine Teilmenge (LaTeX,
 * pdfTeX) enthaelt nur die benutzten Glyphen - ob ein neues Zeichen gesetzt
 * werden kann, entscheidet also genau diese Namensliste.
 */

export interface Type1Programm {
  /** Glyphname -> Breite in 1/1000 em (oder `null`, wenn nicht lesbar). */
  glyphen: Map<string, number | null>
  /** Eingebaute Kodierung aus dem Klartextteil (`dup 65 /A put`), leer bei StandardEncoding. */
  kodierung: Map<number, string>
  standardKodierung: boolean
}

/** Mehr Glyphen hat kein vernuenftiges Type1-Programm; schuetzt vor Endlosschleifen. */
const MAX_GLYPHEN = 65536

function entschluessele(bytes: Uint8Array, r: number, ueberspringen: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, bytes.length - ueberspringen))
  for (let k = 0; k < bytes.length; k++) {
    const c = bytes[k] as number
    const p = c ^ (r >> 8)
    r = ((c + r) * 52845 + 22719) & 0xffff
    if (k >= ueberspringen) out[k - ueberspringen] = p
  }
  return out
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  // In Bloecken: String.fromCharCode mit sehr vielen Argumenten sprengt den Stack.
  for (let k = 0; k < bytes.length; k += 8192) {
    s += String.fromCharCode(...bytes.subarray(k, k + 8192))
  }
  return s
}

/** Breite aus dem ersten Befehl eines CharStrings (`hsbw` oder `sbw`). */
function breiteAus(charstring: Uint8Array, lenIV: number): number | null {
  const d = entschluessele(charstring, 4330, lenIV)
  const stapel: number[] = []
  for (let k = 0; k < d.length && stapel.length < 48;) {
    const v = d[k] as number
    if (v >= 32) {
      if (v <= 246) {
        stapel.push(v - 139)
        k++
      } else if (v <= 250) {
        stapel.push((v - 247) * 256 + (d[k + 1] ?? 0) + 108)
        k += 2
      } else if (v <= 254) {
        stapel.push(-(v - 251) * 256 - (d[k + 1] ?? 0) - 108)
        k += 2
      } else {
        stapel.push(
          ((d[k + 1] ?? 0) << 24) |
            ((d[k + 2] ?? 0) << 16) |
            ((d[k + 3] ?? 0) << 8) |
            (d[k + 4] ?? 0)
        )
        k += 5
      }
    } else {
      if (v === 13) return stapel[1] ?? null
      if (v === 12 && d[k + 1] === 7) return stapel[2] ?? null
      return null
    }
  }
  return null
}

/**
 * Liest ein Type1-Programm. `laenge1` ist `/Length1` des Streams: so lang ist
 * der Klartextteil, danach folgt der eexec-verschluesselte.
 */
export function leseType1(bytes: Uint8Array, laenge1: number): Type1Programm | null {
  try {
    return lese(bytes, laenge1)
  } catch {
    return null
  }
}

function lese(bytes: Uint8Array, laenge1: number): Type1Programm | null {
  let grenze = laenge1 > 0 && laenge1 < bytes.length ? laenge1 : -1
  const klartextRoh = latin1(bytes.subarray(0, grenze > 0 ? grenze : Math.min(bytes.length, 65536)))
  if (grenze < 0) {
    const eexec = klartextRoh.indexOf('eexec')
    if (eexec < 0) return null
    grenze = eexec + 5
    while (grenze < bytes.length && [10, 13, 32, 9].includes(bytes[grenze] as number)) grenze++
  }
  const klartext = klartextRoh.slice(0, grenze)

  const kodierung = new Map<number, string>()
  const standardKodierung = /\/Encoding\s+StandardEncoding\s+def/.test(klartext)
  if (!standardKodierung) {
    for (const m of klartext.matchAll(/dup\s+(\d+)\s*\/([^\s/[\]{}()<>]+)\s+put/g)) {
      const code = Number(m[1])
      if (code >= 0 && code < 256) kodierung.set(code, m[2] as string)
    }
  }

  const bin = bytes.subarray(grenze)
  let klar = entschluessele(bin, 55665, 4)
  if (!latin1(klar.subarray(0, 4000)).includes('/')) {
    // Hex-kodiert (PFA-Stil).
    const hex = latin1(bin).replace(/[^0-9A-Fa-f]/g, '')
    const b = new Uint8Array(Math.floor(hex.length / 2))
    for (let k = 0; k < b.length; k++) b[k] = parseInt(hex.substring(k * 2, k * 2 + 2), 16)
    klar = entschluessele(b, 55665, 4)
  }
  const s = latin1(klar)
  const lenIVTreffer = /\/lenIV\s+(-?\d+)/.exec(s)
  const lenIV = lenIVTreffer === null ? 4 : Math.max(0, Number(lenIVTreffer[1]))
  const glyphen = new Map<string, number | null>()
  let i = s.indexOf('/CharStrings')
  if (i < 0) return { glyphen, kodierung, standardKodierung }
  const beginn = s.indexOf('begin', i)
  if (beginn < 0) return { glyphen, kodierung, standardKodierung }
  i = beginn + 5
  const eintrag = /\/([^\s/[\]{}()<>]+)\s+(\d+)\s+(RD|-\|)\s/y
  const abschluss = /\s*(ND|\|-|noaccess\s+def)/y
  while (i < s.length && glyphen.size < MAX_GLYPHEN) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++
    eintrag.lastIndex = i
    const m = eintrag.exec(s)
    if (m === null) break
    const laenge = Number(m[2])
    const start = eintrag.lastIndex
    if (start + laenge > klar.length) break
    glyphen.set(m[1] as string, breiteAus(klar.subarray(start, start + laenge), lenIV))
    i = start + laenge
    abschluss.lastIndex = i
    if (abschluss.exec(s) !== null) i = abschluss.lastIndex
  }
  return { glyphen, kodierung, standardKodierung }
}
