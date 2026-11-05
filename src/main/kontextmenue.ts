import type { MenuItemConstructorOptions } from 'electron'
import type { AnwendungsEreignis } from '../shared/ipc'
import { t } from '../shared/i18n'
import { findeKuerzel, type Befehl } from '../shared/tastatur'

/** Ab wie vielen Zeichen die Auswahl im Eintrag gekuerzt wird. */
const MAX_ZEICHEN = 30

export interface KontextUmgebung {
  /** Der markierte Text, wie ihn Electron im Ereignis liefert. */
  auswahl: string
  /** Electrons `editFlags.canCopy` — nur dann ist Kopieren sinnvoll. */
  kannKopieren: boolean
  sende: (befehl: AnwendungsEreignis) => void
}

/**
 * Auswahl fuer die Beschriftung aufbereiten.
 *
 * Ueber Zeilen hinweg markierter Text enthaelt Umbrueche; ungekuerzt zoege ein
 * markierter Absatz das Menue ueber den Bildschirmrand.
 */
export function kuerzeAuswahl(text: string): string {
  const einzeilig = text.replace(/\s+/g, ' ').trim()
  return einzeilig.length > MAX_ZEICHEN ? einzeilig.slice(0, MAX_ZEICHEN) + '…' : einzeilig
}

/**
 * Das Kontextmenue als reine Funktion — gleiches Muster wie das
 * Anwendungsmenue.
 *
 * Ohne Auswahl bleibt nur "Alles auswaehlen" stehen: ein Kontextmenue, das
 * ausgegraute Eintraege zeigt, ist ehrlicher als eines, das gar nicht aufgeht,
 * aber ein leeres waere beides nicht.
 *
 * Ab Phase 2 kommen hier Markieren und Notiz dazu (S2.2).
 */
export function baueKontextmenueVorlage(umgebung: KontextUmgebung): MenuItemConstructorOptions[] {
  const { auswahl, kannKopieren, sende } = umgebung
  const gekuerzt = kuerzeAuswahl(auswahl)
  if (gekuerzt.length === 0) return [{ role: 'selectAll', label: t('menue.allesAuswaehlen') }]

  /**
   * Die Markup-Aktionen aus S2.2 laufen als gewoehnliche Befehle ueber den
   * Ereigniskanal — kein zweiter Nutzlasttyp, ADR 0002 bleibt unberuehrt. Der
   * Renderer wendet sie auf die bestehende Auswahl an, ohne dass das Werkzeug
   * gewechselt werden muss.
   */
  const markup = (befehl: Befehl, label: string): MenuItemConstructorOptions => ({
    label,
    accelerator: findeKuerzel(befehl).accelerator,
    click: () => {
      sende({ art: 'befehl', befehl })
    }
  })

  return [
    { role: 'copy', label: t('menue.kopieren'), enabled: kannKopieren },
    {
      label: t('kontext.suchen', { text: gekuerzt }),
      click: () => {
        sende({ art: 'sucheNachAuswahl', text: auswahl })
      }
    },
    { type: 'separator' },
    markup('markiereAuswahl', t('kontext.markieren')),
    markup('unterstreicheAuswahl', t('kontext.unterstreichen')),
    markup('durchstreicheAuswahl', t('kontext.durchstreichen')),
    { type: 'separator' },
    { role: 'selectAll', label: t('menue.allesAuswaehlen') }
  ]
}
