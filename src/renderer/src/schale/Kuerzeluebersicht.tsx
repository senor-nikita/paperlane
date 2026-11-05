import { Fragment } from 'react'
import { alsTasten, beschreibeBefehl, KUERZEL, type Kuerzel } from '../../../shared/tastatur'
import { useT } from '../sprache'
import { useDokumentwerkzeuge } from './dokumentwerkzeuge-logik'
import { useFeldfokus } from './feldfokus'
import { feldrahmen } from './stile'

/**
 * Die Uebersicht aller Tastenkuerzel (S5.2a, Aufgabe 1).
 *
 * **Erzeugt aus `shared/tastatur.ts`, nicht abgeschrieben.** Genau das ist
 * das Exit-Kriterium des Schritts: eine zweite, von Hand gepflegte Liste
 * waere nach dem ersten geaenderten Kuerzel falsch, und niemand merkte es.
 * Dieselbe Map versorgt bereits den Tastenzuhoerer des Fensters und die
 * Accelerators im Menue - was hier steht, ist deshalb zwangslaeufig das, was
 * die Anwendung tatsaechlich tut.
 *
 * Seit S6.1b hat ein Befehl gelegentlich zwei Belegungen (Strg+Tab und
 * Strg+Bild-ab). Sie stehen in einer Zeile: zwei Zeilen "Naechster Tab"
 * saehen nach zwei verschiedenen Befehlen aus.
 */
const HAUPTBELEGUNGEN = KUERZEL.filter((kuerzel) => !kuerzel.zweitbelegung)

function belegungen(haupt: Kuerzel): Kuerzel[] {
  return [haupt, ...KUERZEL.filter((k) => k.zweitbelegung && k.befehl === haupt.befehl)]
}

export function Kuerzeluebersicht(): React.JSX.Element {
  const schliesse = useDokumentwerkzeuge((zustand) => zustand.schliesse)
  const { behaelterRef, beiTaste } = useFeldfokus(schliesse)
  const t = useT()

  return (
    <div
      ref={behaelterRef}
      tabIndex={-1}
      onKeyDown={beiTaste}
      data-testid="kuerzeluebersicht"
      role="group"
      aria-label={t('kuerzel.titel')}
      style={{ ...feldrahmen, maxHeight: '50vh', overflowY: 'auto' }}
    >
      <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
        <caption style={{ textAlign: 'left', fontWeight: 700, paddingBottom: '0.3rem' }}>
          {t('kuerzel.titel')}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', padding: '0.15rem 0.8rem 0.15rem 0' }}>
              {t('kuerzel.befehl')}
            </th>
            <th scope="col" style={{ textAlign: 'left', padding: '0.15rem 0' }}>
              {t('kuerzel.taste')}
            </th>
          </tr>
        </thead>
        <tbody>
          {HAUPTBELEGUNGEN.map((kuerzel) => (
            <tr key={kuerzel.befehl} data-testid={'kuerzel-' + kuerzel.befehl}>
              <td style={{ padding: '0.15rem 0.8rem 0.15rem 0' }}>
                {beschreibeBefehl(kuerzel.befehl)}
              </td>
              <td style={{ padding: '0.15rem 0', whiteSpace: 'nowrap' }}>
                {belegungen(kuerzel).map((belegung, index) => (
                  <Fragment key={belegung.accelerator}>
                    {index > 0 && t('kuerzel.oder')}
                    <kbd>{alsTasten(belegung.accelerator)}</kbd>
                  </Fragment>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          type="button"
          data-testid="kuerzeluebersicht-schliessen"
          className="knopf"
          onClick={schliesse}
        >
          {t('schale.schliessen')}
        </button>
      </div>
    </div>
  )
}
