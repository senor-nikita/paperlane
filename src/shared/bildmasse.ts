/**
 * Rechnerei fuer den PNG-Export (S4.2b), ohne DOM und ohne pdf.js.
 *
 * Eine PDF-Seite misst in Punkten (1/72 Zoll). Bei `dpi` Punkten je Zoll hat
 * das Bild `punkte * dpi / 72` Pixel je Kante. Die Grenze setzt der Browser:
 * ein Canvas darf je Kante hoechstens `maxKante` Pixel haben (S1.2, Aufgabe 3
 * - `MAX_CANVAS_KANTE`), darueber liefert er stillschweigend ein leeres Bild.
 * Deshalb wird die Aufloesung **vorher** begrenzt und dem Nutzer gesagt, statt
 * hinterher ein weisses PNG zu schreiben.
 */

export interface Groesse {
  breite: number
  hoehe: number
}

export const STANDARD_DPI = 150
export const DPI_MIN = 18
export const DPI_MAX = 2400

/** Pixelmasse einer Seite in Punkten bei `dpi`, wie pdf.js sie zeichnen wuerde. */
export function pixelmasse(seite: Groesse, dpi: number): Groesse {
  const faktor = dpi / 72
  return { breite: Math.floor(seite.breite * faktor), hoehe: Math.floor(seite.hoehe * faktor) }
}

/** Die hoechste ganze DPI-Zahl, bei der keine Kante ueber `maxKante` geraet. */
export function hoechsteDpi(seite: Groesse, maxKante: number): number {
  const laengste = Math.max(seite.breite, seite.hoehe)
  if (laengste <= 0) return DPI_MAX
  return Math.max(1, Math.floor((maxKante * 72) / laengste))
}

/**
 * Begrenzt die gewuenschte Aufloesung auf das, was das Canvas hergibt.
 * `begrenzt` sagt, ob gekuerzt wurde - das ist die Meldung an den Nutzer.
 */
export function begrenzeDpi(
  seite: Groesse,
  dpi: number,
  maxKante: number
): { dpi: number; begrenzt: boolean } {
  const hoechste = hoechsteDpi(seite, maxKante)
  return dpi > hoechste ? { dpi: hoechste, begrenzt: true } : { dpi, begrenzt: false }
}

/** `bericht.pdf`, Seite 3 → `bericht-S3.png`. Dasselbe Schema wie `teilname`. */
export function pngName(dokumentname: string, seite: number): string {
  return dokumentname.replace(/\.pdf$/i, '') + '-S' + String(seite) + '.png'
}
