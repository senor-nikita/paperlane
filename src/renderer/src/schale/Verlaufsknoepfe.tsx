import { useHistorie } from '../historie'
import { useT } from '../sprache'
import { Sinnbild } from './Symbol'

/**
 * Rueckgaengig und Wiederholen (S2.2), seit S6.9 in der Kopfleiste: sie
 * gelten fuer jede Aenderung, auch fuer Seitenoperationen, und gehoeren
 * deshalb nicht hinter "Bearbeiten".
 */
export function Verlaufsknoepfe(): React.JSX.Element {
  const t = useT()
  const vergangenheit = useHistorie((zustand) => zustand.vergangenheit)
  const zukunft = useHistorie((zustand) => zustand.zukunft)
  const rueckgaengig = useHistorie((zustand) => zustand.rueckgaengig)
  const wiederholen = useHistorie((zustand) => zustand.wiederholen)
  const beschaeftigt = useHistorie((zustand) => zustand.beschaeftigt)
  const letzterSchritt = vergangenheit[vergangenheit.length - 1]
  const naechsterSchritt = zukunft[zukunft.length - 1]
  return (
    <>
      <button
        type="button"
        data-testid="rueckgaengig"
        className="knopf knopf-symbol"
        aria-label={t('werkzeug.rueckgaengig')}
        disabled={letzterSchritt === undefined || beschaeftigt}
        title={
          letzterSchritt === undefined
            ? t('werkzeug.nichtsRueckgaengig')
            : t('werkzeug.rueckgaengigTitel', { schritt: letzterSchritt.beschreibung })
        }
        onClick={rueckgaengig}
      >
        <Sinnbild name="rueckgaengig" />
      </button>
      <button
        type="button"
        data-testid="wiederholen"
        className="knopf knopf-symbol"
        aria-label={t('werkzeug.wiederholen')}
        disabled={naechsterSchritt === undefined || beschaeftigt}
        title={
          naechsterSchritt === undefined
            ? t('werkzeug.nichtsWiederholen')
            : t('werkzeug.wiederholenTitel', { schritt: naechsterSchritt.beschreibung })
        }
        onClick={wiederholen}
      >
        <Sinnbild name="wiederholen" />
      </button>
    </>
  )
}
