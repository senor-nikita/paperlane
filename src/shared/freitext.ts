/**
 * Gemeinsame Typen und reine Hilfsfunktionen fuer `/FreeText` (S6.5).
 *
 * Bewusst getrennt von `shared/annotations.ts` und ohne jeden Import: dieses
 * Modul landet ungekuerzt im Renderer-Bundle (Werkzeugleiste, Bearbeitungsebene)
 * **und** im Main (main/freitext-schriften.ts baut pdf-lib-Namen daraus). Ein
 * Import von `pdf-lib` hier zöge die ganze Bibliothek in den Renderer, obwohl
 * der nur die drei Namen und ein paar Zahlen braucht.
 *
 * D22: Standardschriften (Helvetica, Times, Courier) mit WinAnsi-Kodierung —
 * keine eingebettete Schrift, kein `fontkit`. Begruendung im Entscheidungslog
 * des Plans (§6, D22): WinAnsi stellt Umlaute **und** das Eurozeichen dar
 * (empirisch mit pdf-lib gegengeprueft), das deckt das Exit-Kriterium von
 * S6.5 vollstaendig ab. Eine eingebettete freie Schrift waere eine neue
 * Abhaengigkeit ohne zusaetzlichen Nutzen fuer genau dieses Kriterium.
 */

export const SCHRIFTFAMILIEN = ['Helvetica', 'Times', 'Courier'] as const
export type SchriftFamilie = (typeof SCHRIFTFAMILIEN)[number]

export function istSchriftFamilie(wert: string): wert is SchriftFamilie {
  return (SCHRIFTFAMILIEN as readonly string[]).includes(wert)
}

export const AUSRICHTUNGEN = ['links', 'mitte', 'rechts'] as const
export type Ausrichtung = (typeof AUSRICHTUNGEN)[number]

export const STANDARD_SCHRIFTFAMILIE: SchriftFamilie = 'Helvetica'
export const STANDARD_SCHRIFTGROESSE = 12
export const STANDARD_AUSRICHTUNG: Ausrichtung = 'links'
export const MIN_SCHRIFTGROESSE = 6
export const MAX_SCHRIFTGROESSE = 96

/** Anzeigename fuer die Werkzeugleiste. */
export const FAMILIE_BESCHRIFTUNG: Record<SchriftFamilie, string> = {
  Helvetica: 'Helvetica',
  Times: 'Times',
  Courier: 'Courier'
}

/**
 * `/Q`-Wert der PDF-Spezifikation: 0 links, 1 mittig, 2 rechts. Gilt fuer
 * `/FreeText` genauso wie fuer Formular-Textfelder.
 */
export function qAusAusrichtung(ausrichtung: Ausrichtung): 0 | 1 | 2 {
  if (ausrichtung === 'mitte') return 1
  if (ausrichtung === 'rechts') return 2
  return 0
}

export function ausrichtungAusQ(wert: unknown): Ausrichtung {
  if (wert === 1) return 'mitte'
  if (wert === 2) return 'rechts'
  return 'links'
}

/**
 * Grobe Ableitung von Familie und Stil aus einem fremden Schriftnamen (etwa
 * aus `/DA` eines Fremddokuments, S6.5 Aufgabe 3).
 *
 * Nur ein Best-Effort: ein Fremddokument kann jeden Namen eintragen. Trifft
 * nichts zu, ist Helvetica ohne Stil die sichere Vorgabe — dieselbe, die auch
 * neue Textfelder bekommen.
 */
export function schriftFamilieAusName(name: string): SchriftFamilie {
  const klein = name.toLowerCase()
  if (klein.includes('times') || klein.includes('serif')) return 'Times'
  if (klein.includes('cour') || klein.includes('mono')) return 'Courier'
  return 'Helvetica'
}

export function stilAusName(name: string): { fett: boolean; kursiv: boolean } {
  const klein = name.toLowerCase()
  return {
    fett: klein.includes('bold'),
    kursiv: klein.includes('italic') || klein.includes('oblique')
  }
}
