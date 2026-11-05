import { PDFDocument } from 'pdf-lib'
import type { BildFormat, BildPdfAuftrag, BildSeite } from '../shared/ipc'
import { pfadklasse } from '../shared/pfade'
import { bildart } from './schreibpfad'

/**
 * Bilder zu PDF (S6.4, D18) — der electron-freie Kern, nach dem Muster von
 * `zusammenfuehren.ts`: reine Funktionen auf Bytes und Zahlen, kein Dialog,
 * kein Dateisystem. Der Main-Prozess (`ipc.ts`) liest Dateien, fragt Dialoge
 * und ruft hierher; die Dialoge selbst liegen in `bild.ts` (Wiederverwendung
 * des Signaturbild-Moduls aus S3.2).
 */

/** Ab dieser Gesamtgroesse werden alle gewaehlten Bilder abgelehnt (Aufgabe 6). */
export const MAX_BILDER_GESAMT_BYTES = 100 * 1024 * 1024

/**
 * Review M4: eine einzelne Datei darf nicht mehr als das hier sein - sonst
 * haelt eine Ablage vieler grosser Kamerabilder (25 MB je Bild sind ueblich)
 * ein Vielfaches des Gesamtlimits im Main, solange die Schleife laeuft und
 * erst am Ende summiert. Grosszuegiger als `MAX_BILD_BYTES` (Signaturbild),
 * weil echte Fotos hierherkommen sollen.
 */
export const MAX_BILD_DATEI_BYTES = 50 * 1024 * 1024

/**
 * Security M2: pdf-lib dekodiert PNG/JPEG im Main vollstaendig zu RGBA, bevor
 * irgendetwas die Pixelmasse prueft - ein 1 MB grosses 16384x16384-PNG kostet
 * so 4,1 GB RSS fuer ein einziges Bild. Kopf lesen und ablehnen, **bevor**
 * `embedPng`/`embedJpg` laufen.
 */
export const MAX_BILD_MEGAPIXEL = 100_000_000
/** L4: auch eine sehr lange, schmale "Bombe" bleibt unter dem Megapixel-Limit. */
export const MAX_BILD_KANTE_PX = 20_000
/** Summe ueber alle Seiten eines Auftrags - mehrere Bilder knapp unter dem Einzellimit. */
export const MAX_BILDER_GESAMT_MEGAPIXEL = 300_000_000

function u16be(bytes: Uint8Array, versatz: number): number {
  return ((bytes[versatz] ?? 0) << 8) | (bytes[versatz + 1] ?? 0)
}

function u32be(bytes: Uint8Array, versatz: number): number {
  return (
    (((bytes[versatz] ?? 0) << 24) |
      ((bytes[versatz + 1] ?? 0) << 16) |
      ((bytes[versatz + 2] ?? 0) << 8) |
      (bytes[versatz + 3] ?? 0)) >>>
    0
  )
}

/** BMP-Felder stehen little-endian, anders als PNG (big-endian) und JPEG. */
function u32le(bytes: Uint8Array, versatz: number): number {
  return (
    ((bytes[versatz] ?? 0) |
      ((bytes[versatz + 1] ?? 0) << 8) |
      ((bytes[versatz + 2] ?? 0) << 16) |
      ((bytes[versatz + 3] ?? 0) << 24)) >>>
    0
  )
}

/** Breite/Hoehe aus dem `IHDR`-Chunk - den ersten 24 Bytes eines PNG. */
export function pngPixelmasse(bytes: Uint8Array): { breite: number; hoehe: number } | null {
  if (bytes.length < 24) return null
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null
  }
  return { breite: u32be(bytes, 16), hoehe: u32be(bytes, 20) }
}

/**
 * Breite/Hoehe aus dem ersten SOFn-Marker (Start Of Frame) eines JPEG. Lauft
 * ueber die Marker-Segmente, statt sie zu dekodieren - dieselbe Grenzen-Logik
 * wie beim Lexer der Textbearbeitung: jeder Schritt rueckt um die im Segment
 * genannte Laenge vor, kein Rueckwaertslauf, kein Endlos.
 */
export function jpegPixelmasse(bytes: Uint8Array): { breite: number; hoehe: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]
    if (marker === undefined) break
    // Marker ohne Segment (Fuellbyte, Restart, SOI/EOI): kein Laengenfeld.
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    if (i + 3 >= bytes.length) return null
    const segmentLaenge = u16be(bytes, i + 2)
    if (segmentLaenge < 2) return null
    const istSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (istSof) {
      if (i + 9 >= bytes.length) return null
      return { hoehe: u16be(bytes, i + 5), breite: u16be(bytes, i + 7) }
    }
    i += 2 + segmentLaenge
  }
  return null
}

/** Die tatsaechlichen Pixelmasse aus dem Kopf, `null` wenn nicht lesbar. */
export function bildPixelmasse(
  format: 'png' | 'jpeg',
  bytes: Uint8Array
): { breite: number; hoehe: number } | null {
  return format === 'png' ? pngPixelmasse(bytes) : jpegPixelmasse(bytes)
}

const PNG_KOPF = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_KOPF = [0xff, 0xd8, 0xff]
const GIF_KOPF = [0x47, 0x49, 0x46, 0x38]
const RIFF_KOPF = [0x52, 0x49, 0x46, 0x46]
const WEBP_KENNUNG = [0x57, 0x45, 0x42, 0x50]

/**
 * Security M1: `BM` allein sind zwei Bytes - jede Datei, die zufaellig damit
 * beginnt (oder umbenannt wurde), gaelte als BMP. Ein echter BITMAPFILEHEADER
 * ist 14 Bytes lang, gefolgt von der Groesse des Infoheaders - die einer der
 * gebraeuchlichen Werte sein muss (12 = BITMAPCOREHEADER, 40 = BITMAPINFOHEADER,
 * 108/124 = V4/V5).
 */
const BMP_INFOHEADER_GROESSEN = new Set([12, 40, 108, 124])

function istPlausiblesBmp(bytes: Uint8Array): boolean {
  if (bytes.length < 18) return false
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return false
  const infoheaderGroesse = u32le(bytes, 14)
  return BMP_INFOHEADER_GROESSEN.has(infoheaderGroesse)
}

/**
 * Erkennt eines der fuenf unterstuetzten Formate am Dateikopf — nicht an
 * Endung oder MIME-Typ (dieselbe Begruendung wie `bildart` in `schreibpfad.ts`:
 * eine umbenannte Datei ist der haeufigste Grund fuer eine falsche Annahme).
 */
export function bildformat(bytes: Uint8Array): BildFormat | null {
  const hat = (versatz: number, muster: readonly number[]): boolean =>
    muster.every((wert, i) => bytes[versatz + i] === wert)
  if (hat(0, PNG_KOPF)) return 'png'
  if (hat(0, JPEG_KOPF)) return 'jpeg'
  if (hat(0, GIF_KOPF) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'gif'
  }
  if (istPlausiblesBmp(bytes)) return 'bmp'
  if (hat(0, RIFF_KOPF) && hat(8, WEBP_KENNUNG)) return 'webp'
  return null
}

/** Endungen, die `bilderWaehlen` ueberhaupt liest - dieselbe Liste wie im Renderer. */
export const BILD_ENDUNGEN = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

/** Hoechstens so viele Pfade in einer Drag-&-Drop-Ablage - mehr ist kein Versehen. */
export const MAX_PFADE_JE_AUFTRAG = 500

/**
 * Security M1: ein Pfad, den `bilderWaehlen` liest, ohne dass der Nutzer ihn
 * im Dialog gewaehlt hat (Drag & Drop). Ein UNC-Pfad (`\\server\freigabe`)
 * oder ein Geraetepfad (`\\?\`, `\\.\`) spricht ein fremdes Ziel im Netz oder
 * ein Geraet an - DNS-Aufloesung und SMB/NTLM inklusive (Invariante 7). Ein
 * reservierter Name (`CON`, `NUL`, ...) meint unter Windows ein Geraet, egal
 * welche Endung dranhaengt.
 */
export function istLokalerDateipfad(pfad: string): boolean {
  // Die Klassifikation steht in `shared/pfade.ts`. Sie liest `/` und `\` als
  // dasselbe Trennzeichen: ein Pruefung am Rohstring liess `/\server\x.png`
  // durch, das Windows als Netzwerkpfad versteht.
  return pfadklasse(pfad) === 'lokal'
}

function endungVon(pfad: string): string {
  const punkt = pfad.lastIndexOf('.')
  return punkt === -1 ? '' : pfad.slice(punkt).toLowerCase()
}

/**
 * Prueft eine Pfadliste aus Drag & Drop (Security M1): nichtleer, begrenzte
 * Laenge, ohne Doppelte, nur lokale Laufwerkspfade mit einer unterstuetzten
 * Bildendung. Kanonisieren und Symlink-Aufloesung passieren erst im Main
 * (`ipc.ts`), der dafuer `fs.stat` braucht - eine reine Funktion wie diese
 * greift nicht aufs Dateisystem zu.
 */
export function pruefePfadListe(eingabe: unknown): string[] | null {
  if (!Array.isArray(eingabe) || eingabe.length === 0) return null
  if (eingabe.length > MAX_PFADE_JE_AUFTRAG) return null
  if (!eingabe.every((wert) => typeof wert === 'string' && wert.trim().length > 0)) return null
  const pfade = eingabe as string[]
  if (!pfade.every((pfad) => istLokalerDateipfad(pfad) && BILD_ENDUNGEN.has(endungVon(pfad)))) {
    return null
  }
  return [...new Set(pfade)]
}

/** Papiergroessen in PDF-Punkten (1 pt = 1/72 Zoll), Hochformat-Reihenfolge. */
export const A4_PT = { breite: 595.28, hoehe: 841.89 } as const
export const LETTER_PT = { breite: 612, hoehe: 792 } as const

/** `'bild'` legt die Seite im Verhaeltnis 96 dpi an (Aufgabe 3). */
const PT_JE_PX = 72 / 96
const PT_JE_MM = 72 / 25.4

export function pxZuPt(px: number): number {
  return px * PT_JE_PX
}

export function mmZuPt(mm: number): number {
  return mm * PT_JE_MM
}

export interface Seitenlayout {
  seite: { breite: number; hoehe: number }
  bild: { x: number; y: number; breite: number; hoehe: number }
}

/**
 * Die Geometrie einer Seite: Seitenmasse und die Position des eingepassten
 * Bilds darauf. Reine Zahlen, unabhaengig von pdf-lib — das macht die
 * Kombinatorik aus Aufgabe 3 (Seitengroesse × Ausrichtung × Rand) mit
 * gewoehnlichen Unit-Tests pruefbar.
 *
 * `'bild'`: die Seite ist genau so gross wie das Bild bei 96 dpi, ohne Rand.
 * `'a4'`/`'letter'`: das Bild wird unter Wahrung des Seitenverhaeltnisses in
 * die Flaeche innerhalb des Rands eingepasst und zentriert.
 */
export function berechneSeitenlayout(
  bild: { breitePx: number; hoehePx: number },
  seitengroesse: BildPdfAuftrag['seitengroesse'],
  ausrichtung: BildPdfAuftrag['ausrichtung'],
  randMm: number
): Seitenlayout {
  if (!(bild.breitePx > 0) || !(bild.hoehePx > 0)) {
    throw new Error('Ungueltige Bildabmessungen.')
  }

  if (seitengroesse === 'bild') {
    const breite = pxZuPt(bild.breitePx)
    const hoehe = pxZuPt(bild.hoehePx)
    return { seite: { breite, hoehe }, bild: { x: 0, y: 0, breite, hoehe } }
  }

  const basis = seitengroesse === 'a4' ? A4_PT : LETTER_PT
  const bildIstHochkant = bild.breitePx <= bild.hoehePx
  const quer = ausrichtung === 'quer' || (ausrichtung === 'auto' && !bildIstHochkant)
  const seite = quer
    ? { breite: Math.max(basis.breite, basis.hoehe), hoehe: Math.min(basis.breite, basis.hoehe) }
    : { breite: Math.min(basis.breite, basis.hoehe), hoehe: Math.max(basis.breite, basis.hoehe) }

  const rand = Math.max(0, mmZuPt(randMm))
  const verfuegbarBreite = Math.max(0, seite.breite - 2 * rand)
  const verfuegbarHoehe = Math.max(0, seite.hoehe - 2 * rand)
  const verhaeltnis = bild.breitePx / bild.hoehePx

  let breite = 0
  let hoehe = 0
  if (verfuegbarBreite > 0 && verfuegbarHoehe > 0) {
    if (verfuegbarBreite / verfuegbarHoehe > verhaeltnis) {
      hoehe = verfuegbarHoehe
      breite = hoehe * verhaeltnis
    } else {
      breite = verfuegbarBreite
      hoehe = breite / verhaeltnis
    }
  }
  const x = rand + (verfuegbarBreite - breite) / 2
  const y = rand + (verfuegbarHoehe - hoehe) / 2
  return { seite, bild: { x, y, breite, hoehe } }
}

/** Grobe, aber ausreichende Formpruefung des Auftrags aus dem Renderer (Eingabe, keine Wahrheit). */
export function pruefeBildPdfAuftrag(eingabe: unknown): BildPdfAuftrag | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const e = eingabe as Record<string, unknown>
  if (!Array.isArray(e.seiten) || e.seiten.length === 0) return null
  const seiten: BildSeite[] = []
  let gesamt = 0
  let gesamtMegapixel = 0
  for (const roh of e.seiten) {
    if (typeof roh !== 'object' || roh === null) return null
    const s = roh as Record<string, unknown>
    if (s.format !== 'png' && s.format !== 'jpeg') return null
    if (!(s.bytes instanceof Uint8Array) || s.bytes.byteLength === 0) return null
    // L4: `Infinity`/NaN/<=0 muss draussen bleiben - `Infinity > 0` ist wahr,
    // `!(s.breitePx > 0)` allein liess es vorher durch. Eine Obergrenze dazu:
    // eine Seite breiter oder hoeher als die groesste erlaubte Bildkante ist
    // ohnehin kein echtes Bild mehr.
    if (typeof s.breitePx !== 'number' || !Number.isFinite(s.breitePx) || s.breitePx <= 0) {
      return null
    }
    if (typeof s.hoehePx !== 'number' || !Number.isFinite(s.hoehePx) || s.hoehePx <= 0) {
      return null
    }
    if (s.breitePx > MAX_BILD_KANTE_PX || s.hoehePx > MAX_BILD_KANTE_PX) return null
    const erkannt = bildart(s.bytes)
    const erwartet = erkannt === 'png' ? 'png' : erkannt === 'jpg' ? 'jpeg' : null
    if (erwartet === null || erwartet !== s.format) return null

    // Security M2: die behaupteten Masse gegen den tatsaechlichen Bildkopf
    // pruefen, **bevor** pdf-lib das Bild dekodiert - sonst dekodiert
    // `embedPng`/`embedJpg` im Main ein Bild, dessen wahre Groesse niemand
    // vorher gesehen hat (ein 1 MB PNG kann 16384x16384 Pixel behaupten).
    const tatsaechlich = bildPixelmasse(s.format, s.bytes)
    if (tatsaechlich === null) return null
    if (tatsaechlich.breite !== s.breitePx || tatsaechlich.hoehe !== s.hoehePx) return null
    if (tatsaechlich.breite > MAX_BILD_KANTE_PX || tatsaechlich.hoehe > MAX_BILD_KANTE_PX) {
      return null
    }
    const megapixel = tatsaechlich.breite * tatsaechlich.hoehe
    if (megapixel > MAX_BILD_MEGAPIXEL) return null
    gesamtMegapixel += megapixel
    if (gesamtMegapixel > MAX_BILDER_GESAMT_MEGAPIXEL) return null

    gesamt += s.bytes.byteLength
    seiten.push({ format: s.format, bytes: s.bytes, breitePx: s.breitePx, hoehePx: s.hoehePx })
  }
  if (gesamt > MAX_BILDER_GESAMT_BYTES) return null
  if (e.seitengroesse !== 'bild' && e.seitengroesse !== 'a4' && e.seitengroesse !== 'letter') {
    return null
  }
  if (e.ausrichtung !== 'hoch' && e.ausrichtung !== 'quer' && e.ausrichtung !== 'auto') return null
  if (typeof e.randMm !== 'number' || !Number.isFinite(e.randMm) || e.randMm < 0) return null
  if (typeof e.vorschlag !== 'string' || e.vorschlag.trim().length === 0) return null
  return {
    seiten,
    seitengroesse: e.seitengroesse,
    ausrichtung: e.ausrichtung,
    randMm: e.randMm,
    vorschlag: e.vorschlag
  }
}

/** Baut das PDF: eine Seite je Bild, in der genannten Reihenfolge. */
export async function baueBilderPdf(auftrag: BildPdfAuftrag): Promise<Uint8Array> {
  if (auftrag.seiten.length === 0) throw new Error('Keine Bilder fuer das PDF.') // KEIN-UI-TEXT: Invariante, der IPC-Handler prueft vorher
  const dokument = await PDFDocument.create()
  for (const seite of auftrag.seiten) {
    const layout = berechneSeitenlayout(
      seite,
      auftrag.seitengroesse,
      auftrag.ausrichtung,
      auftrag.randMm
    )
    const eingebettet =
      seite.format === 'png'
        ? await dokument.embedPng(seite.bytes)
        : await dokument.embedJpg(seite.bytes)
    const pdfSeite = dokument.addPage([layout.seite.breite, layout.seite.hoehe])
    pdfSeite.drawImage(eingebettet, {
      x: layout.bild.x,
      y: layout.bild.y,
      width: layout.bild.breite,
      height: layout.bild.hoehe
    })
  }
  return dokument.save()
}
