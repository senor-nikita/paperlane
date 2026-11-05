export type CspProfile = 'production' | 'development'

/**
 * Wie die Richtlinie ausgeliefert wird. Einige Direktiven sind header-only:
 * `frame-ancestors` wird in einem <meta> von Chromium ignoriert und erzeugt dort
 * nur eine Konsolenmeldung. Der Header traegt weiterhin die vollstaendige Fassung.
 */
export type CspDelivery = 'header' | 'meta'

/** Direktiven, die ausschliesslich per HTTP-Header wirken. */
export const HEADER_ONLY_DIRECTIVES = ['frame-ancestors'] as const

/**
 * Content-Security-Policy als reine Funktion, damit Invariante 7 pruefbar ist.
 *
 * Zwei Profile, weil `connect-src 'none'` den WebSocket des Vite-Dev-Servers
 * verbietet und damit Hot Reload toetet. Die Lockerung gilt ausschliesslich im
 * Entwicklungsmodus und ist hier sichtbar, nicht versteckt. Der Guard-Test
 * prueft ausschliesslich das Production-Profil.
 *
 * Kein `unsafe-eval` in Production: pdf.js laeuft ab S1.1 mit
 * `isEvalSupported: false`.
 */
export function cspDirectives(
  profile: CspProfile,
  delivery: CspDelivery = 'header'
): Record<string, string> {
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': "'self'",
    'style-src': "'self' 'unsafe-inline'",
    'img-src': "'self' data: blob:",
    'font-src': "'self' data:",
    'connect-src': "'none'",
    'worker-src': "'self' blob:",
    'object-src': "'none'",
    'frame-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'none'",
    'frame-ancestors': "'none'"
  }

  if (profile === 'development') {
    // Vite-HMR braucht den WebSocket zum Dev-Server, React Refresh eine
    // Inline-Praeambel in der index.html.
    directives['connect-src'] = "'self' ws: wss: http://localhost:* http://127.0.0.1:*"
    directives['script-src'] = "'self' 'unsafe-inline'"
  }

  if (delivery === 'meta') {
    for (const name of HEADER_ONLY_DIRECTIVES) delete directives[name]
  }

  return directives
}

export function buildCsp(profile: CspProfile, delivery: CspDelivery = 'header'): string {
  return Object.entries(cspDirectives(profile, delivery))
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
}
