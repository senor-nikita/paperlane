/** Englischer Katalog; Aufbau wie de.ts. */
import type { Katalog } from './index'
import { main } from './en/main'
import { menue } from './en/menue'
import { schale } from './en/schale'
import { viewer } from './en/viewer'

export const en: Katalog = {
  ...menue,
  ...main,
  ...schale,
  ...viewer
}
