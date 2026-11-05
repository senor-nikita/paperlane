import { useDokument } from '../dokument-store'
import { dreheSeiten, loescheSeiten, zielseiten } from '../mutation'
import { useMutation } from '../mutation-store'
import { useSeitenauswahl } from '../seitenauswahl-store'
import { useUebersicht } from '../uebersicht-store'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'
import { tastenFuer } from '../../../shared/tastatur'
import { Sinnbild } from '../schale/Symbol'

/**
 * Die Seitenwerkzeuge ueber der Miniaturenleiste (S4.1, Aufgabe 1): loeschen
 * und **dauerhaft** drehen - auf die Auswahl, sonst auf die aktuelle Seite.
 *
 * "Dauerhaft" steht im Titel, weil es die Verwechslung ist, die hier droht:
 * die Drehung aus der Kopfleiste (S1.2) dreht die Ansicht und schreibt
 * nichts; diese hier schreibt `/Rotate` in die Seite und gilt in jedem
 * Betrachter. Neu anordnen geht ueber Ziehen in der Leiste selbst.
 */
export function Seitenwerkzeuge(): React.JSX.Element {
  useT()
  const ausgewaehlt = useSeitenauswahl((zustand) => zustand.ausgewaehlt)
  const leere = useSeitenauswahl((zustand) => zustand.leere)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const verschluesselt = useDokument((zustand) => zustand.verschluesselt)
  const laeuft = useMutation((zustand) => zustand.laeuft !== null)
  const uebersichtOffen = useUebersicht((zustand) => zustand.offen)
  const oeffneUebersicht = useUebersicht((zustand) => zustand.oeffne)

  const anzahl = ausgewaehlt.size
  const gesperrt = verschluesselt || laeuft
  const beschriftung = anzahl === 0 ? t('werkzeuge.aktuelle') : t('werkzeuge.gewaehlt', { anzahl })

  return (
    <div
      data-testid="seitenwerkzeuge"
      role="toolbar"
      aria-label={t('werkzeuge.titel')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.4rem 0.5rem',
        borderBottom: '1px solid var(--linie)',
        fontSize: '0.8em',
        flex: '0 0 auto',
        flexWrap: 'wrap'
      }}
    >
      <span data-testid="seitenwerkzeuge-stand" className="leise" style={{ flexBasis: '100%' }}>
        {beschriftung}
      </span>
      <button
        type="button"
        data-testid="seiten-drehen-links"
        className="knopf knopf-symbol"
        aria-label={t('werkzeuge.linksTitel')}
        disabled={gesperrt}
        title={t('werkzeuge.linksTitel')}
        onClick={() => void dreheSeiten(zielseiten(), 270)}
      >
        <Sinnbild name="linksDrehen" />
      </button>
      <button
        type="button"
        data-testid="seiten-drehen-rechts"
        className="knopf knopf-symbol"
        aria-label={t('werkzeuge.rechtsTitel')}
        disabled={gesperrt}
        title={t('werkzeuge.rechtsTitel')}
        onClick={() => void dreheSeiten(zielseiten(), 90)}
      >
        <Sinnbild name="rechtsDrehen" />
      </button>
      <button
        type="button"
        data-testid="seiten-loeschen"
        className="knopf knopf-symbol"
        aria-label={t('werkzeuge.loeschenTitel')}
        disabled={gesperrt || seitenzahl <= 1 || anzahl >= seitenzahl}
        title={t('werkzeuge.loeschenTitel')}
        onClick={() => void loescheSeiten(zielseiten())}
      >
        <Sinnbild name="loeschen" />
      </button>
      {!uebersichtOffen && (
        <button
          type="button"
          data-testid="seitenuebersicht-oeffnen"
          className="knopf"
          title={t('werkzeuge.uebersichtTitel', { tasten: tastenFuer('seitenuebersicht') })}
          onClick={oeffneUebersicht}
        >
          {t('werkzeuge.uebersicht')}
        </button>
      )}
      {anzahl > 0 && (
        <button
          type="button"
          data-testid="seitenauswahl-aufheben"
          className="knopf"
          onClick={leere}
        >
          {t('werkzeuge.auswahlAufheben')}
        </button>
      )}
    </div>
  )
}
