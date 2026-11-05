import { useCallback, useState } from 'react'
import { useDokument } from '../dokument-store'
import { loeseZielAuf } from './ziel'

/**
 * Ein Eintrag der Gliederung, wie ihn `getOutline` liefert — auf das
 * reduziert, was die Ansicht braucht.
 */
export interface GliederungsKnoten {
  titel: string
  ziel: unknown
  kinder: GliederungsKnoten[]
}

interface GliederungProps {
  knoten: readonly GliederungsKnoten[]
}

const EINRUECKUNG = 12

/**
 * Die Gliederung des Dokuments als aufklappbarer Baum.
 *
 * Der Sprung laeuft ueber `loeseZielAuf` (ziel.ts) und nicht ueber eigenen
 * Code: S2.1 braucht dieselbe Aufloesung fuer Link-Annotationen, und zwei
 * Fassungen behandeln FitR garantiert unterschiedlich.
 */
export function Gliederung({ knoten }: GliederungProps): React.JSX.Element {
  const dokument = useDokument((zustand) => zustand.dokument)
  const springeZuZiel = useDokument((zustand) => zustand.springeZuZiel)
  // Aufgeklappt wird ueber den Pfad im Baum ("0.2.1") verwaltet. Ein Flag im
  // Knoten selbst waere verlockend, machte die Daten aber veraenderlich.
  const [offen, setOffen] = useState<ReadonlySet<string>>(new Set(['0']))

  const klappe = useCallback((pfad: string) => {
    setOffen((vorher) => {
      const naechste = new Set(vorher)
      if (naechste.has(pfad)) naechste.delete(pfad)
      else naechste.add(pfad)
      return naechste
    })
  }, [])

  const springe = useCallback(
    (ziel: unknown) => {
      if (dokument === null) return
      loeseZielAuf(dokument, ziel)
        .then((position) => {
          if (position === null) {
            // Nicht stillschweigend nichts tun: ein Eintrag, der beim Klick
            // nichts macht, sieht nach einem kaputten Programm aus.
            console.error('Gliederungseintrag ohne aufloesbares Ziel:', ziel)
            return
          }
          springeZuZiel(position)
        })
        .catch((fehler: unknown) => {
          console.error('Sprungziel konnte nicht aufgeloest werden:', fehler)
        })
    },
    [dokument, springeZuZiel]
  )

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '0.25rem 0.25rem 0.5rem' }}>
      {knoten.map((eintrag, nummer) => (
        <Zweig
          key={String(nummer) + ':' + eintrag.titel}
          knoten={eintrag}
          pfad={String(nummer)}
          tiefe={0}
          offen={offen}
          klappe={klappe}
          springe={springe}
        />
      ))}
    </ul>
  )
}

interface ZweigProps {
  knoten: GliederungsKnoten
  pfad: string
  tiefe: number
  offen: ReadonlySet<string>
  klappe: (pfad: string) => void
  springe: (ziel: unknown) => void
}

function Zweig({ knoten, pfad, tiefe, offen, klappe, springe }: ZweigProps): React.JSX.Element {
  const hatKinder = knoten.kinder.length > 0
  const istOffen = offen.has(pfad)

  return (
    <li>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2px' }}>
        <button
          type="button"
          data-testid={'gliederung-klappe-' + pfad}
          aria-label={istOffen ? 'Zuklappen' : 'Aufklappen'}
          aria-expanded={hatKinder ? istOffen : undefined}
          disabled={!hatKinder}
          onClick={() => {
            klappe(pfad)
          }}
          style={{
            width: '14px',
            flex: '0 0 auto',
            marginLeft: String(tiefe * EINRUECKUNG) + 'px',
            border: 'none',
            background: 'none',
            cursor: hatKinder ? 'pointer' : 'default',
            color: hatKinder ? '#555' : 'transparent',
            padding: 0,
            fontSize: '10px',
            lineHeight: '18px'
          }}
        >
          {istOffen ? '▾' : '▸'}
        </button>
        <button
          type="button"
          data-testid={'gliederung-eintrag-' + pfad}
          title={knoten.titel}
          onClick={() => {
            springe(knoten.ziel)
          }}
          style={{
            flex: 1,
            textAlign: 'left',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            padding: '1px 2px',
            fontSize: '12px',
            lineHeight: '18px',
            color: '#1a1a1a'
          }}
        >
          {knoten.titel}
        </button>
      </div>
      {hatKinder && istOffen && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {knoten.kinder.map((kind, nummer) => (
            <Zweig
              key={String(nummer) + ':' + kind.titel}
              knoten={kind}
              pfad={pfad + '.' + String(nummer)}
              tiefe={tiefe + 1}
              offen={offen}
              klappe={klappe}
              springe={springe}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
