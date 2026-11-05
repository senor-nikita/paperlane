import { create } from 'zustand'
import { setzeSprache, t, type Sprache, type Sprachwahl } from '../../shared/i18n'
import { bruecke } from './bruecke'

/**
 * Die Sprache der Oberflaeche im Renderer (S6.8).
 *
 * Die aktive Sprache selbst liegt im shared-Modul (`t` liest sie); dieser
 * Store sorgt nur dafuer, dass Komponenten neu zeichnen, wenn sie wechselt.
 * Aufgeloest wird im Main (`spracheGet`): dort liegt die Einstellung und die
 * Systemsprache, und Menue und Oberflaeche sollen nie verschieden sprechen.
 */
interface SpracheZustand {
  sprache: Sprache
  /** Die Einstellung, wie sie der Nutzer gewaehlt hat (fuer den Dialog). */
  wahl: Sprachwahl
  setze: (sprache: Sprache, wahl: Sprachwahl) => void
}

export const useSprache = create<SpracheZustand>((set) => ({
  sprache: 'de',
  wahl: 'auto',
  setze: (sprache, wahl) => {
    setzeSprache(sprache)
    // Screenreader waehlen die Aussprache nach `lang`; ein englischer Text
    // mit deutscher Aussprache ist kaum verstaendlich.
    document.documentElement.lang = sprache
    set({ sprache, wahl })
  }
}))

/**
 * `t` fuer Komponenten: dieselbe Funktion, aber die Komponente zeichnet bei
 * einem Sprachwechsel neu. Jede Komponente mit eigenem Text ruft das selbst -
 * ein Elternteil, das neu zeichnet, erreicht memoisierte Kinder nicht.
 */
export function useT(): typeof t {
  useSprache((zustand) => zustand.sprache)
  return t
}

/**
 * Sprache und Wahl beim Main erfragen und setzen. Beim Start vor dem ersten
 * Zeichnen, damit die Oberflaeche nicht erst deutsch aufblitzt, und nach
 * jeder Aenderung der Einstellung. Ohne Bruecke (Browser-Vorschau, Tests)
 * bleibt es beim Deutschen.
 */
export async function ladeSprache(): Promise<void> {
  const api = bruecke()
  if (api === undefined) return
  try {
    const [sprache, einstellungen] = await Promise.all([api.spracheGet(), api.settingsGet()])
    useSprache.getState().setze(sprache, einstellungen.sprache)
  } catch (error) {
    console.error('Sprache konnte nicht gelesen werden:', error)
  }
}
