import { PDFArray, PDFName, PDFNumber, type PDFDocument, type PDFPage } from 'pdf-lib'
import type { Kasten, Zuschnitt } from '../shared/mutation'
import { t } from '../shared/i18n'

/**
 * Seiten zuschneiden (S6.3, D21) - der Teil im Main.
 *
 * Gesetzt wird ausschliesslich `/CropBox`. Der Inhalt ausserhalb bleibt im
 * Dokument, ebenso Anmerkungen, die ganz oder teilweise ausserhalb liegen:
 * sie werden weder verschoben noch entfernt. Ein Betrachter blendet sie
 * lediglich aus. Wer "Zuschnitt aufheben" waehlt, sieht wieder alles.
 *
 * Den Rahmen rechnet der Renderer aus dem, was er zeigt, in
 * PDF-Benutzerkoordinaten um (`viewer/zuschnitt.ts`). Hier wird er nur noch
 * gegen die MediaBox begrenzt: ein Zuschnitt kann die Seite nie ueber die
 * MediaBox hinaus vergroessern - dort gibt es nichts, was zu zeigen waere,
 * und pdf.js und PDFium schnitten ohnehin wieder zurueck.
 */

/** Kleinste Kantenlaenge eines Zuschnitts in Punkten (gut 3,5 mm). */
export const MIN_ZUSCHNITT_KANTE = 10

/** Die Box als sortiertes Rechteck. `null`, wenn sie fehlt oder unbrauchbar ist. */
export function leseKasten(seite: PDFPage, name: 'MediaBox' | 'CropBox'): Kasten | null {
  // `getMediaBox`/`getCropBox` von pdf-lib liefern Breite und Hoehe aus der
  // Differenz, bei verkehrt herum notierten Boxen also negativ. Deshalb die
  // vier Zahlen selbst lesen und sortieren.
  // Vererbbar und moeglicherweise indirekt: ueber den Kontext aufloesen.
  const roh = seite.node.getInheritableAttribute(PDFName.of(name))
  const wert = roh === undefined ? undefined : seite.doc.context.lookup(roh)
  const feld = wert instanceof PDFArray ? wert : undefined
  if (feld === undefined || feld.size() !== 4) return null
  const zahlen: number[] = []
  for (let i = 0; i < 4; i++) {
    const zahl = feld.lookup(i)
    if (!(zahl instanceof PDFNumber) || !Number.isFinite(zahl.asNumber())) return null
    zahlen.push(zahl.asNumber())
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = zahlen
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
}

/** Die Schnittmenge zweier Rechtecke, `null` wenn sie leer ist. */
export function schneide(a: Kasten, b: Kasten): Kasten | null {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  return x1 < x2 && y1 < y2 ? [x1, y1, x2, y2] : null
}

/**
 * Was ein Betrachter von der Seite zeigt: CropBox geschnitten mit MediaBox,
 * wie pdf.js (`PDFPageProxy.view`) und die PDF-Norm (14.11.2) es vorsehen.
 * Ohne CropBox ist es die MediaBox.
 */
export function sichtbarerKasten(seite: PDFPage): Kasten {
  const media = leseKasten(seite, 'MediaBox') ?? mediaAusPdfLib(seite)
  const crop = leseKasten(seite, 'CropBox')
  return (crop === null ? null : schneide(crop, media)) ?? media
}

function mediaAusPdfLib(seite: PDFPage): Kasten {
  const { x, y, width, height } = seite.getMediaBox()
  return [
    Math.min(x, x + width),
    Math.min(y, y + height),
    Math.max(x, x + width),
    Math.max(y, y + height)
  ]
}

function setzeCropBox(seite: PDFPage, kasten: Kasten): void {
  seite.setCropBox(kasten[0], kasten[1], kasten[2] - kasten[0], kasten[3] - kasten[1])
}

/**
 * Wendet die Zuschnitte an. Die Seitennummern hat der Aufrufer gegen die
 * Seitenzahl geprueft; hier wird jede Seite einzeln gegen ihre MediaBox
 * geprueft. Wirft mit einem Satz fuer den Nutzer, bevor irgendetwas
 * geschrieben ist - eine halb zugeschnittene Auswahl gibt es nicht.
 */
export function schneideSeitenZu(dokument: PDFDocument, zuschnitte: readonly Zuschnitt[]): void {
  const neu: { seite: PDFPage; kasten: Kasten }[] = []
  for (const zuschnitt of zuschnitte) {
    const seite = dokument.getPage(zuschnitt.seite - 1)
    const media = leseKasten(seite, 'MediaBox') ?? mediaAusPdfLib(seite)
    if (zuschnitt.rahmen === null) {
      // "Zuschnitt aufheben": die CropBox ausdruecklich auf die MediaBox,
      // statt den Schluessel zu loeschen - `/CropBox` ist vererbbar, und
      // ohne eigenen Eintrag gaelte sonst die des Elternknotens.
      neu.push({ seite, kasten: media })
      continue
    }
    const kasten = schneide(zuschnitt.rahmen, media)
    if (
      kasten === null ||
      kasten[2] - kasten[0] < MIN_ZUSCHNITT_KANTE ||
      kasten[3] - kasten[1] < MIN_ZUSCHNITT_KANTE
    ) {
      throw new Error(t('zuschnitt.ausserhalb', { seite: zuschnitt.seite }))
    }
    neu.push({ seite, kasten })
  }
  for (const { seite, kasten } of neu) setzeCropBox(seite, kasten)
}
