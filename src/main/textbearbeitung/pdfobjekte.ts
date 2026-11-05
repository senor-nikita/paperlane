import { constants as zlibKonstanten, inflateSync } from 'node:zlib'
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject
} from 'pdf-lib'
import { t } from '../../shared/i18n'

/**
 * Kleine Helfer fuer pdf-lib-Objekte (S6.6b). Jeder Zugriff loest Referenzen
 * auf und liefert bei unerwartetem Typ `undefined` statt zu werfen - fremde
 * Dokumente halten sich nicht an die Spezifikation.
 */

/** Groesster dekodierter Stream, den die Textbearbeitung anfasst. */
export const MAX_STROMBYTES = 64 * 1024 * 1024

export class TextAbgelehnt extends Error {}

export function nimm(ctx: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? ctx.lookup(obj) : obj
}

export function dict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const o = nimm(ctx, obj)
  if (o instanceof PDFDict) return o
  if (o instanceof PDFStream) return o.dict
  return undefined
}

export function nurDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const o = nimm(ctx, obj)
  return o instanceof PDFDict ? o : undefined
}

export function eintrag(
  ctx: PDFContext,
  d: PDFDict | undefined,
  key: string
): PDFObject | undefined {
  return d === undefined ? undefined : nimm(ctx, d.get(PDFName.of(key)))
}

export function nameVon(ctx: PDFContext, d: PDFDict | undefined, key: string): string | undefined {
  const o = eintrag(ctx, d, key)
  return o instanceof PDFName ? o.decodeText() : undefined
}

export function zahlVon(ctx: PDFContext, d: PDFDict | undefined, key: string): number | undefined {
  const o = eintrag(ctx, d, key)
  return o instanceof PDFNumber ? o.asNumber() : undefined
}

/** Ein Feld aus Zahlen; Unterfelder (wie in `/W`) werden verschachtelt geliefert. */
export type Zahlenfeld = (number | Zahlenfeld)[]

export function zahlenfeld(
  ctx: PDFContext,
  obj: PDFObject | undefined,
  tiefe = 0
): Zahlenfeld | undefined {
  const o = nimm(ctx, obj)
  if (!(o instanceof PDFArray) || tiefe > 2) return undefined
  return o.asArray().map((x) => {
    const w = nimm(ctx, x)
    if (w instanceof PDFArray) return zahlenfeld(ctx, w, tiefe + 1) ?? []
    return w instanceof PDFNumber ? w.asNumber() : 0
  })
}

export function flacheZahlen(feld: Zahlenfeld | undefined): number[] | undefined {
  return feld?.map((x) => (typeof x === 'number' ? x : 0))
}

/**
 * Die Filterkette eines Streams als Namen, samt `DecodeParms` je Stufe.
 * `undefined`, wenn `/Filter` weder Name noch Feld aus Namen ist.
 */
function filterkette(
  ctx: PDFContext,
  d: PDFDict
): { name: string; parms: PDFObject | undefined }[] | undefined {
  const filter = nimm(ctx, d.get(PDFName.of('Filter')))
  const parms = nimm(ctx, d.get(PDFName.of('DecodeParms')))
  if (filter === undefined) return []
  if (filter instanceof PDFName) {
    return [{ name: filter.decodeText(), parms: parms instanceof PDFArray ? parms.get(0) : parms }]
  }
  if (!(filter instanceof PDFArray)) return undefined
  const kette: { name: string; parms: PDFObject | undefined }[] = []
  for (let k = 0; k < filter.size(); k++) {
    const f = nimm(ctx, filter.get(k))
    if (!(f instanceof PDFName)) return undefined
    kette.push({
      name: f.decodeText(),
      parms: parms instanceof PDFArray ? parms.get(k) : k === 0 ? parms : undefined
    })
  }
  return kette
}

/** `DecodeParms`, die an den Bytes nichts aendern (fehlend, leer, Predictor 1). */
function ohneWirkung(ctx: PDFContext, parms: PDFObject | undefined): boolean {
  const p = nimm(ctx, parms)
  if (p === undefined || p === PDFNull) return true
  if (!(p instanceof PDFDict)) return false
  const predictor = nimm(ctx, p.get(PDFName.of('Predictor')))
  return predictor === undefined || (predictor instanceof PDFNumber && predictor.asNumber() <= 1)
}

function inflate(bytes: Uint8Array, grenze: number): Uint8Array {
  try {
    // `Z_SYNC_FLUSH`: ein abgeschnittener Strom liefert, was da ist, statt zu
    // werfen - so nachsichtig wie pdf.js (vormals der Rueckfall ueber pdf-lib).
    return new Uint8Array(
      inflateSync(bytes, { maxOutputLength: grenze, finishFlush: zlibKonstanten.Z_SYNC_FLUSH })
    )
  } catch (fehler) {
    if (fehler instanceof RangeError) throw new TextAbgelehnt(t('text.stromGross'))
    throw new TextAbgelehnt(t('text.stromKaputt'))
  }
}

function asciiHex(bytes: Uint8Array, grenze: number): Uint8Array {
  const out = new Uint8Array(Math.min(grenze + 1, Math.ceil(bytes.length / 2)))
  let n = 0
  let hoch = -1
  for (const c of bytes) {
    if (c === 62) break
    const w =
      c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1
    if (w < 0) continue
    if (hoch < 0) hoch = w
    else {
      if (n >= grenze) throw new TextAbgelehnt(t('text.stromGross'))
      out[n++] = (hoch << 4) | w
      hoch = -1
    }
  }
  if (hoch >= 0) {
    if (n >= grenze) throw new TextAbgelehnt(t('text.stromGross'))
    out[n++] = hoch << 4
  }
  return out.slice(0, n)
}

function ascii85(bytes: Uint8Array, grenze: number): Uint8Array {
  // Obergrenze vor dem Anlegen: hoechstens vier Bytes je Eingabezeichen ('z').
  const out = new Uint8Array(Math.min(grenze + 4, bytes.length * 4 + 4))
  let n = 0
  const gruppe: number[] = []
  const schreibe = (anzahl: number): void => {
    let wert = 0
    for (let k = 0; k < 5; k++) wert = wert * 85 + (gruppe[k] ?? 84)
    for (let k = 0; k < anzahl; k++) {
      if (n >= grenze) throw new TextAbgelehnt(t('text.stromGross'))
      out[n++] = (wert >>> (24 - 8 * k)) & 255
    }
    gruppe.length = 0
  }
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i] as number
    if (c === 126) break // '~' aus '~>'
    if (c === 122 && gruppe.length === 0) {
      for (let k = 0; k < 4; k++) {
        if (n >= grenze) throw new TextAbgelehnt(t('text.stromGross'))
        out[n++] = 0
      }
      continue
    }
    if (c < 33 || c > 117) continue
    gruppe.push(c - 33)
    if (gruppe.length === 5) schreibe(4)
  }
  if (gruppe.length > 1) schreibe(gruppe.length - 1)
  return out.slice(0, n)
}

/**
 * Dekodierte Bytes eines Streams, hoechstens `grenze` Bytes (Gate Phase 6,
 * M3). Jede Stufe der Filterkette ist selbst begrenzt: Flate ueber zlib mit
 * `maxOutputLength`, ASCIIHex und ASCII85 mit eigener Grenze. Alle anderen
 * Filter (LZW, RunLength, Predictoren, Bildfilter) lehnt die Textbearbeitung
 * ab - pdf-lib dekodierte sie ungebremst und erst danach waere geprueft worden.
 */
export function strombytes(stream: PDFObject | undefined, grenze = MAX_STROMBYTES): Uint8Array {
  if (stream instanceof PDFRawStream) {
    const ctx = stream.dict.context
    const kette = filterkette(ctx, stream.dict)
    if (kette === undefined) throw new TextAbgelehnt(t('text.filterUngueltig'))
    let bytes: Uint8Array = stream.contents
    if (kette.length === 0 && bytes.length > grenze) throw new TextAbgelehnt(t('text.stromGross'))
    for (const { name, parms } of kette) {
      if ((name === 'FlateDecode' || name === 'Fl') && ohneWirkung(ctx, parms)) {
        bytes = inflate(bytes, grenze)
      } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
        bytes = asciiHex(bytes, grenze)
      } else if (name === 'ASCII85Decode' || name === 'A85') {
        bytes = ascii85(bytes, grenze)
      } else {
        throw new TextAbgelehnt(
          t('text.filterUnbekannt', {
            filter: ohneWirkung(ctx, parms) ? name : t('text.filterMitParametern', { filter: name })
          })
        )
      }
    }
    return bytes
  }
  if (stream instanceof PDFStream) {
    const bytes = stream.getContents()
    if (bytes.length > grenze) throw new TextAbgelehnt(t('text.stromGross'))
    return bytes
  }
  return new Uint8Array()
}

export function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let k = 0; k < bytes.length; k += 8192)
    s += String.fromCharCode(...bytes.subarray(k, k + 8192))
  return s
}
