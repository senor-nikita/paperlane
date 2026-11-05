/** Anzeigename der Anwendung. Bewusst ohne Fremdmarkenbezug (Invariante 8). */
export const APP_NAME = 'paperlane'

/** Fenstertitel; wird ab S1.1 um den Dateinamen erweitert. */
export function windowTitle(documentName?: string): string {
  return documentName === undefined ? APP_NAME : `${documentName} — ${APP_NAME}`
}
