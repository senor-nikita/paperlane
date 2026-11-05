import type { PDFDocumentProxy } from 'pdfjs-dist'
import { begrenzeDpi } from '../../shared/bildmasse'
import { bruecke } from './bruecke'
import { useDokument } from './dokument-store'
import { PDFJS_RENDER_HAERTUNG } from './pdf-haertung'
import { useDokumentwerkzeuge } from './schale/dokumentwerkzeuge-logik'
import { effektiveDrehung } from './viewer/drehung'
import { MAX_CANVAS_KANTE } from './viewer/zoom'
import { t } from '../../shared/i18n'

/**
 * PNG-Export (S4.2b) - ueber denselben Canvas-Renderpfad wie die Anzeige.
 *
 * Das Bild entsteht im Renderer: pdf.js zeichnet die Seite in ein Canvas, das
 * nicht im DOM haengt, das Canvas kodiert PNG. Gedreht wird, wie die Ansicht
 * es zeigt (Seitendrehung plus Ansichtsdrehung, `drehung.ts`) - wer ein
 * Dokument zum Lesen gedreht hat, will das Bild so und nicht auf der Seite.
 *
 * Die Haertung gilt hier wie ueberall (Invariante 6, `annotationMode:
 * DISABLE`): das Bild zeigt den Seiteninhalt, **keine** Anmerkungen und keine
 * Formularfelder. Das ist bewusst so und steht im Feld daneben; ob der
 * Export eine Ausnahme bekommt, entscheidet das Gate der Phase.
 *
 * Die Aufloesung wird je Seite gegen `MAX_CANVAS_KANTE` begrenzt (S1.2,
 * Aufgabe 3): darueber liefert der Browser ein leeres Canvas ohne Fehler, und
 * das PNG waere weiss. Wurde begrenzt, sagt es der Hinweis am Ende.
 */
export interface PngAuftrag {
  /** Einsbasierte Seitennummern. */
  seiten: number[]
  dpi: number
}

export interface GerendertesPng {
  bytes: Uint8Array
  breite: number
  hoehe: number
  /** Die tatsaechlich verwendete Aufloesung. */
  dpi: number
  begrenzt: boolean
}

/** Rendert eine Seite als PNG-Bytes. Exportiert fuer den Unit-Test. */
export async function renderePng(
  dokument: PDFDocumentProxy,
  seitennummer: number,
  dpi: number,
  ansichtsDrehung: number
): Promise<GerendertesPng> {
  const seite = await dokument.getPage(seitennummer)
  const drehung = effektiveDrehung(seite.rotate, ansichtsDrehung)
  const punkte = seite.getViewport({ scale: 1, rotation: drehung })
  const begrenzung = begrenzeDpi(
    { breite: punkte.width, hoehe: punkte.height },
    dpi,
    MAX_CANVAS_KANTE
  )
  const viewport = seite.getViewport({ scale: begrenzung.dpi / 72, rotation: drehung })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const kontext = canvas.getContext('2d')
  if (kontext === null) throw new Error('Kein Zeichenkontext fuer den Export.') // KEIN-UI-TEXT: Protokoll, der Hinweis ist allgemein
  try {
    // Weisser Grund: pdf.js zeichnet auf transparent, ein PNG ohne Grund
    // saehe in manchem Betrachter schwarz aus.
    kontext.fillStyle = '#ffffff'
    kontext.fillRect(0, 0, canvas.width, canvas.height)
    const auftrag = seite.render({
      canvas,
      canvasContext: kontext,
      viewport,
      ...PDFJS_RENDER_HAERTUNG
    })
    await auftrag.promise
    const blob = await new Promise<Blob | null>((erfuelle) => {
      canvas.toBlob(erfuelle, 'image/png')
    })
    if (blob === null) throw new Error('Das Canvas lieferte kein PNG.') // KEIN-UI-TEXT: Protokoll, der Hinweis ist allgemein
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      breite: canvas.width,
      hoehe: canvas.height,
      dpi: begrenzung.dpi,
      begrenzt: begrenzung.begrenzt
    }
  } finally {
    // Den Speicher sofort freigeben, nicht erst mit der naechsten
    // Speicherbereinigung - bei 300 DPI sind das 35 MB je Seite.
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Der ganze Export: Ziele vom Main holen, Seite fuer Seite rendern und
 * schreiben, am Ende einen Hinweis setzen. Bricht der Nutzer den Dialog ab,
 * ist noch nichts gerendert worden.
 */
export async function exportierePng(auftrag: PngAuftrag): Promise<void> {
  const api = bruecke()
  const werkzeuge = useDokumentwerkzeuge.getState()
  const { dokument, pfad, rotation, setzeHinweis } = useDokument.getState()
  if (api === undefined || dokument === null || pfad === null || werkzeuge.laeuft) return
  if (auftrag.seiten.length === 0) return
  werkzeuge.setzeLaeuft(true)
  try {
    const ziele = await api.pngZieleWaehlen({ quelle: pfad, seiten: auftrag.seiten })
    if (ziele.art === 'abgebrochen') return
    if (ziele.art === 'abgelehnt') {
      setzeHinweis(ziele.grund)
      return
    }
    let begrenztAuf: number | null = null
    const geschrieben: string[] = []
    for (const [index, ziel] of ziele.ziele.entries()) {
      useDokumentwerkzeuge
        .getState()
        .setzeFortschritt({ fertig: index, gesamt: ziele.ziele.length })
      const bild = await renderePng(dokument, ziel.seite, auftrag.dpi, rotation)
      if (bild.begrenzt) begrenztAuf = Math.min(begrenztAuf ?? bild.dpi, bild.dpi)
      const ergebnis = await api.pngSchreiben({ pfad: ziel.pfad, bytes: bild.bytes })
      if (ergebnis.art === 'abgelehnt') {
        setzeHinweis(ergebnis.grund)
        return
      }
      geschrieben.push(ergebnis.pfad)
    }
    useDokumentwerkzeuge.getState().schliesse()
    setzeHinweis(beschreibeErgebnis(geschrieben, begrenztAuf))
  } catch (fehler) {
    console.error('PNG-Export fehlgeschlagen:', fehler)
    setzeHinweis(t('png.fehler'))
  } finally {
    const stand = useDokumentwerkzeuge.getState()
    stand.setzeFortschritt(null)
    stand.setzeLaeuft(false)
  }
}

/** Der Hinweis nach dem Export: was geschrieben wurde, und ob begrenzt wurde. */
export function beschreibeErgebnis(
  geschrieben: readonly string[],
  begrenztAuf: number | null
): string {
  const erstes = geschrieben[0] ?? ''
  const name = erstes.split(/[\\/]/).pop() ?? erstes
  const was =
    geschrieben.length === 1
      ? t('png.einBild', { name })
      : t('png.mehrereBilder', {
          anzahl: geschrieben.length,
          ordner: erstes.slice(0, -name.length)
        })
  const zusatz =
    begrenztAuf === null
      ? ''
      : t('png.begrenztHinweis', { dpi: begrenztAuf, kante: MAX_CANVAS_KANTE })
  return was + zusatz
}
