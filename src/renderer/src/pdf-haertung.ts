/**
 * Die Haertungsoptionen fuer pdf.js an genau einer Stelle (Invariante 6).
 *
 * - `enableScripting: false` — eingebettetes JavaScript in PDFs wird nicht
 *   ausgefuehrt. Das ist der klassische Angriffsvektor bei fremden Dokumenten.
 * - `isEvalSupported: false` — kein `new Function`. Notwendig, weil die CSP
 *   kein `unsafe-eval` erlaubt. Preis: PDFs mit PostScript-Funktionen sind
 *   messbar langsamer (Risiko R3, Fixture `shading.pdf`).
 * - `enableXfa: false` — XFA-Formulare werden nicht ausgefuehrt. S1.5 erkennt
 *   den Fall und erklaert ihn, statt eine scheinbar leere Seite zu zeigen.
 *
 * Bewusst in einem eigenen Modul ohne pdf.js-Import: so laesst sich die
 * Haertung pruefen, ohne den Worker zu laden.
 */
export const PDFJS_HAERTUNG = {
  enableScripting: false,
  isEvalSupported: false,
  enableXfa: false,
  isOffscreenCanvasSupported: true
} as const

/**
 * `AnnotationMode.DISABLE`. Als Zahl und nicht ueber einen Import aus pdf.js,
 * damit dieses Modul weiter ohne pdf.js auskommt; der Guard-Test gleicht den
 * Wert gegen die Bibliothek ab, damit er nicht stillschweigend veraltet.
 */
export const ANNOTATIONSMODUS_AUS = 0

/**
 * Die Haertung fuer das Zeichnen einer Seite (Invariante 6, scharf ab S2.1).
 *
 * `annotationMode` ist kein Parameter von `getDocument`, sondern von
 * `PDFPageProxy.render` — deshalb eine zweite Konstante und trotzdem dieselbe
 * Datei: die Haertung liegt an genau einer Stelle.
 *
 * Standard waere `ENABLE`. pdf.js malt Annotationen mit Appearance-Stream dann
 * direkt in die Canvas, und der eigene Layer zeichnet sie ein zweites Mal
 * darueber. Zwei Folgen, beide schlecht: doppelte Darstellung schon in
 * `annotated.pdf`, und ab S2.2 bliebe eine **geloeschte** Annotation sichtbar,
 * weil sie im Bild eingebrannt ist.
 */
export const PDFJS_RENDER_HAERTUNG = {
  annotationMode: ANNOTATIONSMODUS_AUS
} as const
