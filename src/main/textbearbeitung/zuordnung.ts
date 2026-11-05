import { vergleichsform, type TextZeile } from '../../shared/textzeilen'
import type { Glyph } from './interpreter'

/**
 * Zuordnung pdf.js-Zeile <-> Glyphen im Content-Stream (S6.6b, ADR 0005).
 *
 * Eine Glyphe gehoert zur Zeile, wenn ihre Richtung stimmt, ihr Anfang auf
 * der Grundlinie liegt (Toleranz 0,35 Schriftgroessen) und ihre Mitte
 * zwischen Anfang und Ende der Zeile. Ob das die **richtigen** Glyphen sind,
 * entscheidet danach der Textvergleich - weicht er ab, wird nichts geaendert.
 */
export function glyphenDerZeile(glyphen: readonly Glyph[], zeile: TextZeile): Glyph[] {
  const toleranz = 0.35 * zeile.groesse
  const rand = 0.3 * zeile.groesse
  const lage = (g: Glyph): number => zeile.dx * g.x + zeile.dy * g.y
  return glyphen
    .filter((g) => {
      const winkel = Math.round((Math.atan2(g.dy, g.dx) * 180) / Math.PI)
      if ((winkel === -180 ? 180 : winkel) !== zeile.winkel) return false
      const p = -zeile.dy * g.x + zeile.dx * g.y
      const s = zeile.dx * ((g.x + g.ex) / 2) + zeile.dy * ((g.y + g.ey) / 2)
      return (
        Math.abs(p - zeile.grundlinie) < toleranz && s >= zeile.von - rand && s <= zeile.bis + rand
      )
    })
    .sort((u, v) => lage(u) - lage(v))
}

/** Der Text der Glyphen in Leserichtung; Unbekanntes als Ersatzzeichen. */
export function glyphText(glyphen: readonly Glyph[]): string {
  return glyphen.map((g) => g.uni ?? '�').join('')
}

/** Stimmt der Operatortext mit dem pdf.js-Text der Zeile ueberein? */
export function textStimmt(glyphen: readonly Glyph[], zeile: TextZeile): boolean {
  return vergleichsform(glyphText(glyphen)) === vergleichsform(zeile.text)
}
