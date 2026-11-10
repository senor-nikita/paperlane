import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import { ANNOTATIONSMODUS_FORMULARE } from '../pdf-haertung'
import type { Abbrechbar } from './renderqueue'

/**
 * Das Aussehen digitaler Unterschriften.
 *
 * Die Hauptansicht zeichnet mit `annotationMode: DISABLE` (Invariante 6):
 * Annotationen und Eingabefelder malt die Anwendung selbst. Fuer ein
 * Unterschriftsfeld gibt es aber nichts zu "bearbeiten" - sein Aussehen (die
 * eingefuegte Handschrift, der Stempel des Signierdienstes) ist ein fertiges
 * Bild im Dokument, das niemand nachbaut. Ohne DISABLE-Ausnahme blieb das Feld
 * leer, obwohl die Unterschrift in der Datei steht (Befund vom 2026-11-10: ein
 * mit einem anderen Programm signiertes Formular zeigte hier eine leere Flaeche).
 *
 * Deshalb zeichnet pdf.js die Seite ein zweites Mal im Modus ENABLE_FORMS -
 * dort malt es Unterschriftsfelder in die Canvas, Eingabefelder aber nicht -
 * und uebernommen wird **nur das Rechteck eines Unterschriftsfeldes**. Alles
 * andere, was dieser Modus noch malt (Anmerkungen), bleibt unbenutzt; so
 * entsteht keine zweite, eingebrannte Fassung davon.
 */

/** Ein Unterschriftsfeld mit Aussehen, in Geraetepixeln der Canvas. */
export interface Flaeche {
  x: number
  y: number
  breite: number
  hoehe: number
}

/** Das, was von `PageViewport` gebraucht wird; macht die Rechnung ohne pdf.js pruefbar. */
export interface Rechenkasten {
  width: number
  height: number
  /** Die Matrix `[a, b, c, d, e, f]` von PDF-Punkten auf Canvas-Pixel (`PageViewport.transform`). */
  transform: readonly number[]
}

/**
 * Das Rechteck eines Feldes in Canvas-Pixeln als `[links, oben, rechts, unten]`.
 *
 * Aus den vier Ecken, nicht aus zweien: bei einer gedrehten Seite wandern die
 * Ecken, und aus `(x1, y1)` und `(x2, y2)` allein wuerde ein falsches Rechteck.
 * pdf.js 6 hat dafuer keine Methode mehr, nur noch die Matrix.
 */
function rechteckInPixeln(
  rect: readonly number[],
  transform: readonly number[]
): [number, number, number, number] | null {
  if (transform.length !== 6 || transform.some((zahl) => !Number.isFinite(zahl))) return null
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = rect
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2]
  ] as const) {
    xs.push(a * x + c * y + e)
    ys.push(b * x + d * y + f)
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function vierZahlen(wert: unknown): number[] | null {
  if (!Array.isArray(wert) || wert.length !== 4) return null
  const zahlen = (wert as unknown[]).map((eintrag) => (typeof eintrag === 'number' ? eintrag : NaN))
  return zahlen.every((zahl) => Number.isFinite(zahl)) ? zahlen : null
}

/**
 * Die Unterschriftsfelder mit Aussehen aus den Annotationsdaten von pdf.js.
 * Jeder Datensatz wird einzeln geprueft: ein Widget ohne Rechteck, ein
 * verstecktes oder eines ohne Aussehen ergibt keine Flaeche.
 */
export function unterschriftsflaechen(rohe: unknown, kasten: Rechenkasten): Flaeche[] {
  if (!Array.isArray(rohe)) return []
  const flaechen: Flaeche[] = []
  for (const eintrag of rohe as unknown[]) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const daten = eintrag as Record<string, unknown>
    if (daten['subtype'] !== 'Widget' || daten['fieldType'] !== 'Sig') continue
    if (daten['hasAppearance'] !== true || daten['hidden'] === true) continue
    const rect = vierZahlen(daten['rect'])
    if (rect === null) continue
    const pixel = rechteckInPixeln(rect, kasten.transform)
    if (pixel === null) continue
    // Auf ganze Pixel nach aussen gerundet, damit kein Rand der Unterschrift
    // fehlt, und auf die Canvas begrenzt.
    const links = Math.max(0, Math.floor(pixel[0]))
    const oben = Math.max(0, Math.floor(pixel[1]))
    const rechts = Math.min(kasten.width, Math.ceil(pixel[2]))
    const unten = Math.min(kasten.height, Math.ceil(pixel[3]))
    if (rechts <= links || unten <= oben) continue
    flaechen.push({ x: links, y: oben, breite: rechts - links, hoehe: unten - oben })
  }
  return flaechen
}

export interface UnterschriftenOptionen {
  /** Meldet den laufenden Auftrag, damit die Renderwarteschlange ihn abbrechen kann. */
  merke?: (auftrag: Abbrechbar) => void
  /** Fuer Tests: ein anderer Weg zu einer Zeichenflaeche. */
  erzeugeCanvas?: () => HTMLCanvasElement
}

/**
 * Zeichnet das Aussehen aller Unterschriftsfelder der Seite in `kontext`.
 *
 * Gibt es kein Feld mit Aussehen, passiert nichts und es kostet nichts - das
 * ist bei fast allen Seiten so. Sonst wird die Seite einmal in eine Zeichenflaeche
 * gerendert, die nur die Umgrenzung der Felder abdeckt, und je Feld das
 * Rechteck uebernommen.
 */
export async function zeichneUnterschriften(
  seite: PDFPageProxy,
  kontext: CanvasRenderingContext2D,
  viewport: PageViewport,
  optionen: UnterschriftenOptionen = {}
): Promise<void> {
  const flaechen = unterschriftsflaechen(await seite.getAnnotations(), viewport)
  if (flaechen.length === 0) return

  const links = Math.min(...flaechen.map((flaeche) => flaeche.x))
  const oben = Math.min(...flaechen.map((flaeche) => flaeche.y))
  const rechts = Math.max(...flaechen.map((flaeche) => flaeche.x + flaeche.breite))
  const unten = Math.max(...flaechen.map((flaeche) => flaeche.y + flaeche.hoehe))

  const canvas = (optionen.erzeugeCanvas ?? (() => document.createElement('canvas')))()
  canvas.width = rechts - links
  canvas.height = unten - oben
  const hilfskontext = canvas.getContext('2d')
  if (hilfskontext === null) return

  // Derselbe Blick auf die Seite, nur so verschoben, dass die Ecke der
  // Umgrenzung links oben liegt: die Zeichenflaeche bleibt klein, auch bei
  // starkem Zoom.
  const ausschnitt = viewport.clone({
    offsetX: viewport.offsetX - links,
    offsetY: viewport.offsetY - oben
  })
  const auftrag = seite.render({
    canvas,
    canvasContext: hilfskontext,
    viewport: ausschnitt,
    annotationMode: ANNOTATIONSMODUS_FORMULARE
  })
  optionen.merke?.(auftrag)
  await auftrag.promise

  for (const flaeche of flaechen) {
    kontext.drawImage(
      canvas,
      flaeche.x - links,
      flaeche.y - oben,
      flaeche.breite,
      flaeche.hoehe,
      flaeche.x,
      flaeche.y,
      flaeche.breite,
      flaeche.hoehe
    )
  }
}
