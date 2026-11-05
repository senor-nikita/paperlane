/**
 * Deutscher Katalog: Quelle aller Schluessel. Nach Bereichen aufgeteilt; ein
 * doppelter Schluessel ueber Bereiche hinweg faellt im Test auf
 * (test/unit/i18n.test.ts), weil der Spread ihn sonst still ueberschriebe.
 *
 * Bereiche: `menue` (Menues, Kuerzel), `main` (Dialoge und Meldungen des
 * Main-Prozesses), `schale` (Leisten, Dialoge, Hinweise im Renderer),
 * `viewer` (Dokumentansicht, Seitenleiste, Ebenen).
 */
import { main } from './de/main'
import { menue } from './de/menue'
import { schale } from './de/schale'
import { viewer } from './de/viewer'

export const de = {
  ...menue,
  ...main,
  ...schale,
  ...viewer
} as const
