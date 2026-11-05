import { join, normalize, sep } from 'node:path'

/**
 * Loest einen `app://`-Request auf eine Datei im Renderer-Verzeichnis auf.
 * Gibt `null` zurueck, sobald der Pfad das Verzeichnis verlassen wuerde oder
 * nicht dekodierbar ist.
 *
 * Bewusst frei von Electron-Abhaengigkeiten, damit der Traversal-Schutz ohne
 * laufende Anwendung pruefbar ist.
 *
 * Die Funktion wirft nicht: `decodeURIComponent` scheitert bei kaputter
 * Prozentkodierung (etwa `%ZZ`) mit einem URIError, und ein solcher Request
 * darf nicht als unbehandelte Ablehnung im Protokoll-Handler landen. Ein nicht
 * dekodierbarer Pfad ist schlicht kein gueltiger Pfad.
 */
export function resolveRendererFile(requestUrl: string, rendererDir: string): string | null {
  let target: string
  try {
    const { pathname } = new URL(requestUrl)
    target = join(rendererDir, decodeURIComponent(pathname))
  } catch {
    return null
  }
  // Normalisiert, damit der Praefixvergleich auch bei einem mit Schraegstrichen
  // uebergebenen Verzeichnis traegt.
  const wurzel = normalize(rendererDir)
  if (target !== wurzel && !target.startsWith(wurzel + sep)) return null
  return target
}
