/**
 * Entfernt Geheimnisse aus Protokolleintraegen.
 *
 * Notwendig, weil S1.5 Passwoerter fuer verschluesselte PDFs entgegennimmt und
 * die Fehlertaxonomie technische Details mitprotokolliert. Ein Passwort darf
 * niemals auf der Platte landen.
 */
const GEHEIM = /pass(wort|word)|kennwort|secret|token|geheim/i
const MAX_TIEFE = 8
export const ERSATZ = '[redigiert]'

export function redigiere(wert: unknown): unknown {
  return begehe(wert, new WeakSet<object>(), 0)
}

function begehe(wert: unknown, gesehen: WeakSet<object>, tiefe: number): unknown {
  if (tiefe > MAX_TIEFE) return '[zu tief verschachtelt]'
  if (wert === null || typeof wert !== 'object') return wert

  // Error-Eigenschaften sind nicht aufzaehlbar; ohne Sonderbehandlung wuerde
  // aus einem Fehler ein leeres Objekt.
  if (wert instanceof Error) {
    return { name: wert.name, message: wert.message, stack: wert.stack }
  }

  if (gesehen.has(wert)) return '[zyklische Referenz]'
  gesehen.add(wert)

  if (Array.isArray(wert)) return wert.map((eintrag) => begehe(eintrag, gesehen, tiefe + 1))

  const ergebnis: Record<string, unknown> = {}
  for (const [schluessel, inhalt] of Object.entries(wert as Record<string, unknown>)) {
    ergebnis[schluessel] = GEHEIM.test(schluessel) ? ERSATZ : begehe(inhalt, gesehen, tiefe + 1)
  }
  return ergebnis
}
