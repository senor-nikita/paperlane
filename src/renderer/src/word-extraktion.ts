import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { ANNOTATIONSMODUS_AUS } from './pdf-haertung'
import {
  findeBilder,
  hatText,
  rgbaAusBilddaten,
  stilAusSchrift,
  type Bildaufruf,
  type Bildstueck,
  type RohSeite,
  type Textstueck
} from './word-export'

/**
 * PDF nach Word (S6.7): die Anbindung an pdf.js. Liest je Seite den Text
 * (`getTextContent`) und die Bilder aus der Operatorliste und macht aus
 * jedem Bild ein PNG - ueber ein Canvas, das nicht im DOM haengt, wie beim
 * PNG-Export (S4.2b).
 *
 * Die Operatorliste wird mit `annotationMode: DISABLE` geholt, derselben
 * Haertung wie beim Zeichnen (Invariante 6): exportiert wird der
 * Seiteninhalt, keine Anmerkungen und keine Formularfelder. Mit derselben
 * Einstellung wie die Anzeige teilt sich der Aufruf zudem deren Cache.
 */

/** Groesste Bildkante im Export; mehr braucht ein Textdokument nicht. */
export const MAX_BILD_KANTE = 2048
/** Groesser dekodiert pdf.js kaum etwas Sinnvolles; darueber wird uebersprungen. */
const MAX_BILD_PIXEL = 64 * 1024 * 1024
/** So lange wird auf ein Bild aus dem Worker gewartet. */
const BILD_WARTEZEIT_MS = 10_000

interface Schriftobjekt {
  name?: unknown
  bold?: unknown
  italic?: unknown
}

export interface Bildobjekt {
  width?: unknown
  height?: unknown
  kind?: unknown
  data?: unknown
  bitmap?: unknown
}

/** Ein Textstueck, wie pdf.js es liefert - nur die Felder, die hier zaehlen. */
interface PdfText {
  str: string
  transform: unknown[]
  width: number
  fontName: string
}

/**
 * Die Textstuecke von `getTextContent`, ohne die Markierungen fuer markierten
 * Inhalt. Ueber `unknown`, weil pdf.js `transform` als `any[]` typisiert.
 */
function textstuecke(items: readonly unknown[]): PdfText[] {
  return items.filter((item): item is PdfText => {
    if (typeof item !== 'object' || item === null) return false
    const wert = item as Record<string, unknown>
    return (
      typeof wert['str'] === 'string' &&
      Array.isArray(wert['transform']) &&
      typeof wert['width'] === 'number' &&
      typeof wert['fontName'] === 'string'
    )
  })
}

function zahl(wert: unknown): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
}

/**
 * Die Schrift eines Textstuecks. pdf.js kennt den echten Namen erst, wenn die
 * Schrift fuer die Operatorliste geladen wurde - deshalb kommt die zuerst.
 */
function schriftstil(
  seite: PDFPageProxy,
  schluessel: string,
  familie: string | undefined
): { fett: boolean; kursiv: boolean } {
  let objekt: Schriftobjekt = {}
  try {
    if (seite.commonObjs.has(schluessel)) {
      objekt = seite.commonObjs.get(schluessel) as Schriftobjekt
    }
  } catch {
    // Noch nicht aufgeloest: dann eben nur die Familie.
  }
  const name = typeof objekt.name === 'string' ? objekt.name : (familie ?? '')
  return stilAusSchrift(name, { bold: objekt.bold, italic: objekt.italic })
}

/** Holt ein Bild aus dem Objektspeicher - oder `null` nach der Wartezeit. */
function holeBild(seite: PDFPageProxy, kennung: string): Promise<Bildobjekt | null> {
  const speicher = kennung.startsWith('g_') ? seite.commonObjs : seite.objs
  return new Promise((erfuelle) => {
    const zeitgeber = setTimeout(() => {
      erfuelle(null)
    }, BILD_WARTEZEIT_MS)
    speicher.get(kennung, (daten: unknown) => {
      clearTimeout(zeitgeber)
      erfuelle(typeof daten === 'object' && daten !== null ? daten : null)
    })
  })
}

function istBitmap(wert: unknown): wert is CanvasImageSource & { width: number; height: number } {
  return (
    typeof wert === 'object' &&
    wert !== null &&
    typeof (wert as { width?: unknown }).width === 'number' &&
    typeof (wert as { height?: unknown }).height === 'number'
  )
}

/**
 * Ein Bild von pdf.js als PNG, auf `MAX_BILD_KANTE` verkleinert. `null`, wenn
 * es sich nicht zeichnen laesst - ein fehlendes Bild ist besser als ein
 * abgebrochener Export.
 */
export async function pngAusBild(bild: Bildobjekt): Promise<Uint8Array | null> {
  const breite = typeof bild.width === 'number' ? bild.width : 0
  const hoehe = typeof bild.height === 'number' ? bild.height : 0
  if (breite <= 0 || hoehe <= 0 || breite * hoehe > MAX_BILD_PIXEL) return null

  const faktor = Math.min(1, MAX_BILD_KANTE / Math.max(breite, hoehe))
  const zielBreite = Math.max(1, Math.round(breite * faktor))
  const zielHoehe = Math.max(1, Math.round(hoehe * faktor))
  const canvas = document.createElement('canvas')
  canvas.width = zielBreite
  canvas.height = zielHoehe
  const kontext = canvas.getContext('2d')
  if (kontext === null) return null
  const zwischen = document.createElement('canvas')
  try {
    if (istBitmap(bild.bitmap)) {
      kontext.drawImage(bild.bitmap, 0, 0, zielBreite, zielHoehe)
    } else {
      const daten = bild.data
      if (typeof bild.kind !== 'number' || !ArrayBuffer.isView(daten)) return null
      const rgba = rgbaAusBilddaten({
        width: breite,
        height: hoehe,
        kind: bild.kind,
        data: daten as unknown as ArrayLike<number>
      })
      if (rgba === null) return null
      if (faktor === 1) {
        const bilddaten = kontext.createImageData(breite, hoehe)
        bilddaten.data.set(rgba)
        kontext.putImageData(bilddaten, 0, 0)
      } else {
        // Verkleinern geht nur ueber drawImage, und das braucht ein Canvas
        // in voller Groesse als Quelle.
        zwischen.width = breite
        zwischen.height = hoehe
        const zwischenKontext = zwischen.getContext('2d')
        if (zwischenKontext === null) return null
        const bilddaten = zwischenKontext.createImageData(breite, hoehe)
        bilddaten.data.set(rgba)
        zwischenKontext.putImageData(bilddaten, 0, 0)
        kontext.drawImage(zwischen, 0, 0, zielBreite, zielHoehe)
      }
    }
    const blob = await new Promise<Blob | null>((erfuelle) => {
      canvas.toBlob(erfuelle, 'image/png')
    })
    return blob === null ? null : new Uint8Array(await blob.arrayBuffer())
  } finally {
    // Wie beim PNG-Export: den Speicher sofort freigeben.
    canvas.width = 0
    canvas.height = 0
    zwischen.width = 0
    zwischen.height = 0
  }
}

/** Macht aus einem Bild von pdf.js ein PNG; einspritzbar fuer Tests ohne Canvas. */
export type PngWandler = (bild: Bildobjekt) => Promise<Uint8Array | null>

async function bildstueck(
  seite: PDFPageProxy,
  aufruf: Bildaufruf,
  wandle: PngWandler
): Promise<Bildstueck | null> {
  const objekt =
    typeof aufruf.quelle === 'string'
      ? await holeBild(seite, aufruf.quelle)
      : (aufruf.quelle as Bildobjekt)
  if (objekt === null) return null
  const png = await wandle(objekt)
  if (png === null) return null
  return {
    png,
    links: aufruf.links,
    oben: aufruf.oben,
    breitePt: aufruf.rechts - aufruf.links,
    hoehePt: aufruf.oben - aufruf.unten
  }
}

/** Die Masse der Seite ohne Drehung - in diesem Raum liegen Text und Bilder. */
function seitenmasse(seite: PDFPageProxy): { breitePt: number; hoehePt: number } {
  const [x0 = 0, y0 = 0, x1 = 595, y1 = 842] = seite.view
  return { breitePt: Math.abs(x1 - x0), hoehePt: Math.abs(y1 - y0) }
}

/** Liest Text und Bilder einer Seite. */
export async function extrahiereSeite(
  seite: PDFPageProxy,
  wandle: PngWandler = pngAusBild
): Promise<RohSeite> {
  const operatoren = await seite.getOperatorList({ annotationMode: ANNOTATIONSMODUS_AUS })
  const inhalt = await seite.getTextContent()
  const stile = new Map<string, { fett: boolean; kursiv: boolean }>()
  const stuecke: Textstueck[] = []
  for (const item of textstuecke(inhalt.items)) {
    let stil = stile.get(item.fontName)
    if (stil === undefined) {
      stil = schriftstil(seite, item.fontName, inhalt.styles[item.fontName]?.fontFamily)
      stile.set(item.fontName, stil)
    }
    const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = [0, 1, 2, 3, 4, 5].map((stelle) =>
      zahl(item.transform[stelle])
    )
    stuecke.push({
      text: item.str,
      x,
      y,
      breite: item.width,
      groesse: Math.hypot(c, d) || Math.hypot(a, b),
      ...stil
    })
  }
  const bilder: Bildstueck[] = []
  for (const aufruf of findeBilder(operatoren.fnArray, operatoren.argsArray)) {
    const stueck = await bildstueck(seite, aufruf, wandle)
    if (stueck !== null) bilder.push(stueck)
  }
  return { ...seitenmasse(seite), stuecke, bilder }
}

/**
 * Hat das Dokument eine Textebene (Aufgabe 5)? Gesucht wird bis zur ersten
 * Seite mit Text - bei einem gewoehnlichen Dokument ist das Seite 1. Ein
 * gescanntes Dokument ohne Texterkennung liefert nur Bilder, und das soll der
 * Nutzer vorher wissen.
 */
export async function hatTextebene(
  dokument: PDFDocumentProxy,
  abgebrochen: () => boolean = () => false
): Promise<boolean> {
  for (let nummer = 1; nummer <= dokument.numPages; nummer++) {
    if (abgebrochen()) return true
    const seite = await dokument.getPage(nummer)
    const inhalt = await seite.getTextContent()
    if (hatText(textstuecke(inhalt.items).map((item) => ({ text: item.str })))) return true
  }
  return false
}
