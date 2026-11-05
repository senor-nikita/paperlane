import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Zielauflösung fuer PDF-Sprungziele — im Plan `resolveDestination`.
 *
 * Bewusst ein eigenes Modul und kein Teil der Gliederung: S2.1 braucht dieselbe
 * Aufloesung fuer Link-Annotationen. In den Gliederungscode eingebettet waere
 * Doppelarbeit vorprogrammiert, und zwei Fassungen behandeln FitR garantiert
 * unterschiedlich.
 *
 * Ein Ziel ist entweder ein benannter Verweis (Zeichenkette) oder ein
 * explizites Feld `[seitenRef, /Art, ...Werte]`. Die Werte stehen in
 * PDF-Punkten im Benutzerkoordinatensystem: Ursprung unten links, y waechst
 * nach oben. Die Ansicht rechnet dagegen von oben — daher die Umrechnung hier
 * an einer Stelle statt an jeder Aufrufstelle.
 */
export interface Zielausrichtung {
  /**
   * Anteil 0..1 von der Seitenoberkante. `null`, wenn das Ziel keine Position
   * nennt: dann bleibt die Ansicht, wo sie ist, und springt nur die Seite an.
   */
  anteilVonOben: number | null
  /** Vom Ziel gewuenschter Zoom. `null` bei 0 oder fehlender Angabe. */
  zoom: number | null
}

export interface Zielposition extends Zielausrichtung {
  /** Einsbasierte Seitennummer. */
  seite: number
}

function nameVon(wert: unknown): string | null {
  // pdf.js liefert den Namen als { name: 'XYZ' }; in roh gelesenen Feldern
  // steht er auch als blosse Zeichenkette.
  if (typeof wert === 'string') return wert
  if (typeof wert === 'object' && wert !== null && 'name' in wert) {
    const inhalt: unknown = wert.name
    return typeof inhalt === 'string' ? inhalt : null
  }
  return null
}

function zahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

function begrenze(anteil: number): number {
  return Math.min(1, Math.max(0, anteil))
}

/**
 * Deutet die Ausrichtungsangaben eines expliziten Ziels, also alles hinter der
 * Seitenangabe.
 *
 * Unbekannte Arten liefern `null` statt zu werfen: ein Ziel, das diese Fassung
 * nicht kennt, soll die Seite trotzdem anspringen — das ist deutlich besser
 * als ein toter Verweis.
 */
export function deuteAusrichtung(
  angaben: readonly unknown[],
  seitenHoehe: number
): Zielausrichtung {
  const vonUnten = (wert: unknown): number | null => {
    const oben = zahl(wert)
    if (oben === null || seitenHoehe <= 0) return null
    return begrenze((seitenHoehe - oben) / seitenHoehe)
  }

  switch (nameVon(angaben[0])) {
    // [/XYZ links oben zoom] — die haeufigste Form.
    case 'XYZ':
      return { anteilVonOben: vonUnten(angaben[2]), zoom: zoomWert(angaben[3]) }
    // [/FitH oben] und [/FitBH oben]
    case 'FitH':
    case 'FitBH':
      return { anteilVonOben: vonUnten(angaben[1]), zoom: null }
    // [/FitR links unten rechts oben] — die Oberkante steht an vierter Stelle.
    case 'FitR':
      return { anteilVonOben: vonUnten(angaben[4]), zoom: null }
    // Ganze Seite beziehungsweise ganze Breite: der Anfang der Seite.
    case 'Fit':
    case 'FitB':
    case 'FitV':
    case 'FitBV':
      return { anteilVonOben: 0, zoom: null }
    default:
      return { anteilVonOben: null, zoom: null }
  }
}

/** Zoom 0 und `null` bedeuten im PDF "aktuellen Wert behalten". */
function zoomWert(wert: unknown): number | null {
  const gelesen = zahl(wert)
  return gelesen === null || gelesen <= 0 ? null : gelesen
}

/**
 * Loest ein Ziel gegen das Dokument auf.
 *
 * `null`, wenn das Ziel unbrauchbar ist — etwa ein benannter Verweis, den das
 * Dokument nicht kennt. Die Aufrufstelle meldet das dann sichtbar, statt still
 * nichts zu tun.
 */
export async function loeseZielAuf(
  dokument: PDFDocumentProxy,
  ziel: unknown
): Promise<Zielposition | null> {
  const explizit =
    typeof ziel === 'string'
      ? await dokument.getDestination(ziel)
      : Array.isArray(ziel)
        ? ziel
        : null
  if (explizit === null || explizit.length === 0) return null

  const seitenIndex = await seitenIndexVon(dokument, explizit[0])
  if (seitenIndex === null) return null

  const seite = await dokument.getPage(seitenIndex + 1)
  // `view` ist der MediaBox-Ausschnitt in Benutzerkoordinaten und damit das
  // richtige Mass: Zielangaben sind unabhaengig von der Seitendrehung.
  const unten = seite.view[1] ?? 0
  const oben = seite.view[3] ?? 0
  const hoehe = oben - unten

  return { seite: seitenIndex + 1, ...deuteAusrichtung(explizit.slice(1), hoehe) }
}

async function seitenIndexVon(dokument: PDFDocumentProxy, angabe: unknown): Promise<number | null> {
  // Manche Dokumente nennen die Seite als blosse Nummer statt als Referenz.
  const alsZahl = zahl(angabe)
  if (alsZahl !== null) return alsZahl >= 0 ? Math.floor(alsZahl) : null
  if (typeof angabe !== 'object' || angabe === null) return null
  try {
    return await dokument.getPageIndex(angabe as Parameters<PDFDocumentProxy['getPageIndex']>[0])
  } catch (fehler) {
    console.error('Sprungziel verweist auf keine gueltige Seite:', fehler)
    return null
  }
}
