import { useState } from 'react'
import { useDokument } from '../dokument-store'
import { useT } from '../sprache'

/**
 * Die Passwortabfrage fuer verschluesselte Dokumente (S1.5, Fall 2).
 *
 * Das Passwort bleibt im Renderer: es geht an pdf.js und sonst nirgendwohin,
 * nie an den Main-Prozess und in keine Datei. Ein E2E-Test liest
 * settings.json und paperlane.log und belegt das.
 */
export function Passwortabfrage(): React.JSX.Element | null {
  const frage = useDokument((zustand) => zustand.passwortFrage)
  const beantworte = useDokument((zustand) => zustand.beantwortePasswort)
  const [eingabe, setEingabe] = useState('')
  const t = useT()

  if (frage === null) return null

  return (
    <form
      data-testid="passwort-abfrage"
      onSubmit={(ereignis) => {
        ereignis.preventDefault()
        beantworte(eingabe)
        setEingabe('')
      }}
      style={{
        margin: 0,
        padding: '0.5rem 0.75rem',
        background: '#e6efff',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}
    >
      {/* Der Fehlversuch steht in einer eigenen Live-Region. Im Label allein
          wuerde er nicht angesagt: der Fokus liegt beim erneuten Fragen schon
          im Feld, und der Nutzer wuesste nicht, warum das Dokument nicht
          aufgeht. */}
      {frage.erneut && (
        <span role="alert" data-testid="passwort-fehler">
          {t('passwort.falsch')}
        </span>
      )}
      <label htmlFor="passwort-feld">
        {frage.erneut ? t('passwort.erneut') : t('passwort.frage')}
      </label>
      <input
        id="passwort-feld"
        data-testid="passwort-feld"
        type="password"
        autoFocus
        value={eingabe}
        onChange={(ereignis) => setEingabe(ereignis.target.value)}
        style={{ padding: '0.2rem', width: '12rem' }}
      />
      <button type="submit" data-testid="passwort-ok" className="knopf">
        {t('passwort.oeffnen')}
      </button>
      <button
        type="button"
        data-testid="passwort-abbrechen"
        className="knopf"
        onClick={() => {
          setEingabe('')
          beantworte(null)
        }}
      >
        {t('passwort.abbrechen')}
      </button>
    </form>
  )
}
