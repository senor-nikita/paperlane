/**
 * Seitenbereiche, wie der Nutzer sie tippt (S4.2a, Teilen): `1-3, 5, 7-9`.
 *
 * Reine Funktion im `shared`-Ordner: der Renderer prueft die Eingabe live und
 * zeigt Fehler, der Main prueft dieselbe Struktur noch einmal, bevor er
 * schreibt — was aus dem Renderer kommt, ist Eingabe, nicht Wahrheit.
 */
import { t } from './i18n'

export type Bereich = readonly [von: number, bis: number]

export type Bereichsergebnis = { ok: true; bereiche: Bereich[] } | { ok: false; grund: string }

export function parseBereiche(text: string, seitenzahl: number): Bereichsergebnis {
  const teile = text
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  if (teile.length === 0) return { ok: false, grund: t('bereiche.leer') }
  const bereiche: Bereich[] = []
  for (const teil of teile) {
    const treffer = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(teil)
    if (treffer === null) {
      return { ok: false, grund: t('bereiche.ungueltig', { teil }) }
    }
    const von = Number(treffer[1])
    const bis = treffer[2] === undefined ? von : Number(treffer[2])
    if (von < 1 || bis < von) {
      return { ok: false, grund: t('bereiche.reihenfolge', { teil }) }
    }
    if (bis > seitenzahl) {
      return {
        ok: false,
        grund: t('bereiche.ausserhalb', { teil, anzahl: seitenzahl })
      }
    }
    bereiche.push([von, bis])
  }
  return { ok: true, bereiche }
}

/**
 * Teilen nach Seitenzahl: eine Datei je `proDatei` Seiten, die letzte mit dem
 * Rest. `5` bei 12 Seiten ergibt `1-5, 6-10, 11-12`. Das Ergebnis ist eine
 * gewoehnliche Bereichsliste, der Main prueft sie wie jede andere.
 *
 * Nicht erlaubt: keine ganze Zahl ab 1, und eine Zahl ab der Seitenzahl —
 * dann gaebe es nur eine Datei, und das ist kein Teilen.
 */
export function bereicheJeSeitenzahl(text: string, seitenzahl: number): Bereichsergebnis {
  const treffer = /^\s*(\d+)\s*$/.exec(text)
  const proDatei = treffer === null ? 0 : Number(treffer[1])
  if (proDatei < 1) return { ok: false, grund: t('teilen.seitenzahlUngueltig') }
  if (proDatei >= seitenzahl) {
    return { ok: false, grund: t('teilen.seitenzahlZuGross', { anzahl: seitenzahl }) }
  }
  const bereiche: Bereich[] = []
  for (let von = 1; von <= seitenzahl; von += proDatei) {
    bereiche.push([von, Math.min(von + proDatei - 1, seitenzahl)])
  }
  return { ok: true, bereiche }
}

/** Kurzform fuer die Anzeige: `[[1,3],[5,5]]` → `1-3, 5`. */
export function formatiereBereiche(bereiche: readonly Bereich[]): string {
  return bereiche
    .map(([von, bis]) => (von === bis ? String(von) : String(von) + '-' + String(bis)))
    .join(', ')
}
