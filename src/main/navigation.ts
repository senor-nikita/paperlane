/**
 * Navigation ist grundsaetzlich gesperrt: die Anwendung ist ein Dokumentbetrachter,
 * kein Browser. Erlaubt bleibt nur, was dieselbe Herkunft hat wie das bereits
 * geladene Dokument — sonst wuerde im Entwicklungsmodus jeder Full Reload des
 * Dev-Servers blockiert.
 *
 * Verglichen werden Protokoll und Host, NICHT `URL.origin`. Fuer nicht-spezielle
 * Schemata liefert die WHATWG-URL-Implementierung `"null"` als Origin — sowohl
 * `app://bundle` als auch `app://andere` und sogar `file:///` haetten damit
 * dieselbe "Origin" und wuerden einander als gleich gelten. Ein Origin-Vergleich
 * waere hier also wirkungslos.
 *
 * Externe Links werden ab S2.1 ueber einen eigenen IPC-Kanal an
 * `shell.openExternal` gereicht, mit Schema-Allowlist und Bestaetigungsdialog —
 * nicht ueber Navigation.
 */
export function isAllowedNavigation(target: string, current: string): boolean {
  try {
    const ziel = new URL(target)
    const jetzt = new URL(current)
    return ziel.protocol === jetzt.protocol && ziel.host === jetzt.host
  } catch {
    return false
  }
}
