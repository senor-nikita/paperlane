import { useEffect, useState } from 'react'
import { useDokument } from '../dokument-store'
import { useMutation } from '../mutation-store'
import { useSeitenauswahl } from '../seitenauswahl-store'
import { hebeZuschnittAuf, schneideZu } from '../zuschnitt'
import { useZuschnitt, type ZuschnittZiel } from '../zuschnitt-store'
import { ausMm, zuMm, type Raender } from '../viewer/zuschnitt'
import { feldrahmen } from './stile'
import { t, zahl } from '../../../shared/i18n'
import { useT } from '../sprache'

/**
 * Die Leiste des Werkzeugs "Zuschneiden" (S6.3, Aufgaben 1, 3 und 5):
 * Raender in mm anzeigen und eintippen, das Ziel waehlen, anwenden oder den
 * Zuschnitt aufheben - und der Hinweis, dass Zuschneiden nichts entfernt.
 *
 * Erscheint unter der Werkzeugleiste, solange das Werkzeug gewaehlt ist. Der
 * Rahmen selbst liegt auf der Seite (`viewer/Zuschnittebene.tsx`).
 */

const RAENDER: readonly (keyof Raender)[] = ['links', 'oben', 'rechts', 'unten']

function beschrifte(rand: keyof Raender): { name: string; label: string } {
  switch (rand) {
    case 'links':
      return { name: t('zuschnitt.links'), label: t('zuschnitt.randLinks') }
    case 'oben':
      return { name: t('zuschnitt.oben'), label: t('zuschnitt.randOben') }
    case 'rechts':
      return { name: t('zuschnitt.rechts'), label: t('zuschnitt.randRechts') }
    case 'unten':
      return { name: t('zuschnitt.unten'), label: t('zuschnitt.randUnten') }
  }
}

interface MmFeldProps {
  schluessel: keyof Raender
  beschriftung: { name: string; label: string }
  /** Punkte; `null` ohne Rahmen. */
  wert: number | null
  onWert: (punkte: number) => void
}

/**
 * Ein Feld in mm. Der Text steht lokal, damit ein halb getippter Wert
 * ("12,") nicht vom gerundeten Stand ueberschrieben wird; uebernommen wird
 * jede lesbare Zahl, begrenzt vom Speicher.
 */
function MmFeld({ schluessel, beschriftung, wert, onWert }: MmFeldProps): React.JSX.Element {
  const anzeige = wert === null ? '' : String(zuMm(wert))
  const [text, setText] = useState(anzeige)
  useEffect(() => {
    setText(anzeige)
  }, [anzeige])

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}>
      {beschriftung.name}
      <input
        type="text"
        inputMode="decimal"
        data-testid={'zuschnitt-' + schluessel}
        aria-label={beschriftung.label}
        disabled={wert === null}
        value={text}
        onChange={(ereignis) => {
          const eingabe = ereignis.target.value
          setText(eingabe)
          const zahl = Number.parseFloat(eingabe.replace(',', '.'))
          if (Number.isFinite(zahl)) onWert(ausMm(zahl))
        }}
        onBlur={() => {
          setText(anzeige)
        }}
        style={{ width: '4rem' }}
      />
      mm
    </label>
  )
}

export function Zuschneideleiste(): React.JSX.Element {
  const dokument = useDokument((zustand) => zustand.dokument)
  const raender = useZuschnitt((zustand) => zustand.raender)
  const mass = useZuschnitt((zustand) => zustand.mass)
  const seite = useZuschnitt((zustand) => zustand.seite)
  const ziel = useZuschnitt((zustand) => zustand.ziel)
  const aendere = useZuschnitt((zustand) => zustand.aendere)
  const setzeZiel = useZuschnitt((zustand) => zustand.setzeZiel)
  const auswahl = useSeitenauswahl((zustand) => zustand.ausgewaehlt.size)
  const laeuft = useMutation((zustand) => zustand.laeuft)
  useT()

  // Ein Rahmen gehoert zu einer Seite dieses Dokuments: bei einem Wechsel
  // (anderer Tab, Neuladen nach einer Mutation) und beim Verlassen des
  // Werkzeugs ist er hinfaellig.
  useEffect(() => {
    useZuschnitt.getState().verwerfe()
  }, [dokument])
  useEffect(
    () => () => {
      useZuschnitt.getState().verwerfe()
    },
    []
  )

  const groesse =
    raender === null || mass === null
      ? null
      : t('zuschnitt.groesse', {
          breite: zahl(zuMm(mass.breite - raender.links - raender.rechts)),
          hoehe: zahl(zuMm(mass.hoehe - raender.oben - raender.unten))
        })

  return (
    <div
      data-testid="zuschneiden"
      role="group"
      aria-label={t('zuschnitt.titel')}
      style={{ ...feldrahmen, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}
    >
      <span data-testid="zuschnitt-stand" style={{ fontSize: '0.85em' }}>
        {raender === null || seite === null
          ? t('zuschnitt.aufziehen')
          : t('zuschnitt.stand', { seite, groesse: String(groesse) })}
      </span>
      {RAENDER.map((schluessel) => (
        <MmFeld
          key={schluessel}
          schluessel={schluessel}
          beschriftung={beschrifte(schluessel)}
          wert={raender === null ? null : raender[schluessel]}
          onWert={(punkte) => {
            if (raender !== null) aendere({ ...raender, [schluessel]: punkte })
          }}
        />
      ))}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}>
        {t('zuschnitt.anwendenAuf')}
        <select
          data-testid="zuschnitt-ziel"
          aria-label={t('zuschnitt.anwendenAuf')}
          value={ziel}
          onChange={(ereignis) => {
            setzeZiel(ereignis.target.value as ZuschnittZiel)
          }}
        >
          <option value="seite">{t('zuschnitt.dieseSeite')}</option>
          <option value="auswahl" disabled={auswahl === 0}>
            {t('zuschnitt.auswahl')}
          </option>
          <option value="alle">{t('zuschnitt.alle')}</option>
        </select>
      </label>
      <button
        type="button"
        data-testid="zuschnitt-anwenden"
        className="knopf"
        disabled={raender === null || laeuft !== null}
        onClick={() => {
          void schneideZu()
        }}
      >
        {t('zuschnitt.anwenden')}
      </button>
      <button
        type="button"
        data-testid="zuschnitt-aufheben"
        className="knopf"
        disabled={laeuft !== null}
        title={t('zuschnitt.aufhebenTitel')}
        onClick={() => {
          void hebeZuschnittAuf()
        }}
      >
        {t('zuschnitt.aufheben')}
      </button>
      <span
        data-testid="zuschnitt-hinweis"
        role="note"
        style={{ fontSize: '0.85em', color: '#555' }}
      >
        {t('zuschnitt.hinweis')}
      </span>
    </div>
  )
}
