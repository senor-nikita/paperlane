import { useEffect, type RefObject } from 'react'
import { useDokument } from '../dokument-store'
import { flacherTreffer, useSuche } from '../suche-store'
import { useT } from '../sprache'
import { Sinnbild } from './Symbol'

/**
 * Die Volltextsuche in der Kopfleiste (S1.4).
 *
 * Der Sprung zum gewaehlten Treffer steht hier und nicht in der App-Schale: er
 * gehoert zur Suche, und ausserhalb eines geoeffneten Dokuments gibt es keine
 * Treffer, zu denen gesprungen werden koennte.
 */
export function Suchleiste({
  feldRef
}: {
  feldRef: RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const begriff = useSuche((zustand) => zustand.begriff)
  const optionen = useSuche((zustand) => zustand.optionen)
  const ergebnisse = useSuche((zustand) => zustand.ergebnisse)
  const gesamt = useSuche((zustand) => zustand.gesamt)
  const aktuell = useSuche((zustand) => zustand.aktuell)
  const laeuft = useSuche((zustand) => zustand.laeuft)
  const setzeBegriff = useSuche((zustand) => zustand.setzeBegriff)
  const setzeOptionen = useSuche((zustand) => zustand.setzeOptionen)
  const starte = useSuche((zustand) => zustand.starte)
  const weiter = useSuche((zustand) => zustand.weiter)
  const springeZuSeite = useDokument((zustand) => zustand.springeZuSeite)
  const t = useT()

  useEffect(() => {
    if (aktuell === 0) return
    const ziel = flacherTreffer(ergebnisse, aktuell)
    if (ziel !== null) springeZuSeite(ziel.seite)
  }, [aktuell, ergebnisse, springeZuSeite])

  return (
    <div className="gruppe suche">
      <span className="suchfeld">
        <Sinnbild name="suche" groesse={16} />
        <input
          ref={feldRef}
          aria-label={t('suche.begriff')}
          data-testid="such-eingabe"
          value={begriff}
          placeholder={t('suche.platzhalter')}
          onChange={(ereignis) => setzeBegriff(ereignis.target.value)}
          onKeyDown={(ereignis) => {
            if (ereignis.key === 'Enter') void starte()
          }}
        />
      </span>
      {/* Suchen startet auch die Eingabetaste; der Knopf bleibt fuer die Maus
          und als benannter Befehl fuer Screenreader. */}
      <button
        type="button"
        className="knopf knopf-symbol"
        aria-label={t('suche.suchen')}
        title={t('suche.suchen')}
        onClick={() => void starte()}
      >
        <Sinnbild name="suche" />
      </button>
      <button
        type="button"
        className="knopf knopf-symbol"
        aria-label={t('suche.vorheriger')}
        title={t('suche.vorheriger')}
        onClick={() => weiter(-1)}
      >
        <Sinnbild name="hoch" />
      </button>
      <button
        type="button"
        className="knopf knopf-symbol"
        aria-label={t('suche.naechster')}
        title={t('suche.naechster')}
        onClick={() => weiter(1)}
      >
        <Sinnbild name="runter" />
      </button>
      {/* Das Ergebnis erscheint nach dem Absenden, ohne Fokuswechsel. */}
      <span data-testid="treffer-anzeige" role="status" className="leise trefferstand">
        {laeuft
          ? t('suche.laeuft')
          : gesamt === 0
            ? t('suche.keine')
            : t('suche.stand', { aktuell, gesamt })}
      </span>
      <label className="option">
        <input
          type="checkbox"
          data-testid="option-grossschreibung"
          checked={optionen.achteAufGrossschreibung}
          onChange={(ereignis) =>
            setzeOptionen({ achteAufGrossschreibung: ereignis.target.checked })
          }
        />{' '}
        {t('suche.grossKlein')}
      </label>
      <label className="option">
        <input
          type="checkbox"
          data-testid="option-ganze-woerter"
          checked={optionen.nurGanzeWoerter}
          onChange={(ereignis) => setzeOptionen({ nurGanzeWoerter: ereignis.target.checked })}
        />{' '}
        {t('suche.ganzeWoerter')}
      </label>
    </div>
  )
}
