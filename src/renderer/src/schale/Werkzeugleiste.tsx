import { useEffect, useMemo, useState } from 'react'
import {
  AUSRICHTUNGEN,
  FAMILIE_BESCHRIFTUNG,
  MAX_SCHRIFTGROESSE,
  MIN_SCHRIFTGROESSE,
  SCHRIFTFAMILIEN,
  STANDARD_AUSRICHTUNG,
  STANDARD_SCHRIFTFAMILIE,
  STANDARD_SCHRIFTGROESSE,
  type Ausrichtung,
  type SchriftFamilie
} from '../../../shared/freitext'
import { MAX_STRICHSTAERKE, MIN_STRICHSTAERKE } from '../../../shared/settings'
import { useAnnotationen } from '../annotations-store'
import { loescheAnnotation, veraendereAnnotation } from '../annotationsbefehle'
import {
  STEMPEL_TEXTE,
  useBearbeitung,
  type StempelText,
  type Werkzeug
} from '../bearbeitung-store'
import { bruecke } from '../bruecke'
import { aendere, farbeAusHex, hexAusFarbe } from '../viewer/erzeugen'
import { Signaturfeld } from './Signaturfeld'
import { Zuschneideleiste } from './Zuschneideleiste'
import { tastenFuer } from '../../../shared/tastatur'
import { useT } from '../sprache'

/**
 * Die Werkzeugleiste fuer Annotationen (S2.2, Aufgabe 1).
 *
 * Der aktive Modus ist sichtbar — ohne das waere nach dem naechsten Klick
 * unklar, warum eine Notiz statt einer Markierung entstand. Escape kehrt zur
 * Auswahl zurueck; das Kuerzel liegt in der zentralen Liste (`tastatur.ts`)
 * und wird nicht hier behandelt, damit Menue und Anwendung dasselbe tun.
 */

const WERKZEUGE: readonly Werkzeug[] = [
  'auswahl',
  'markieren',
  'unterstreichen',
  'durchstreichen',
  'notiz',
  'text',
  'freihand',
  'stempel',
  'signatur',
  'zuschneiden',
  'textBearbeiten'
]

/** Sichert geaenderte Vorgaben. Ein Fehlschlag darf das Zeichnen nicht stoppen. */
function sichereVorgaben(farbe: string, strichstaerke: number): void {
  const api = bruecke()
  if (api === undefined) return
  api.settingsSet({ annotationen: { farbe, strichstaerke } }).catch((error: unknown) => {
    console.error('Vorgaben fuer Anmerkungen konnten nicht gesichert werden:', error)
  })
}

export function Werkzeugleiste(): React.JSX.Element {
  const t = useT()
  const werkzeug = useBearbeitung((zustand) => zustand.werkzeug)
  const farbe = useBearbeitung((zustand) => zustand.farbe)
  const strichstaerke = useBearbeitung((zustand) => zustand.strichstaerke)
  const stempel = useBearbeitung((zustand) => zustand.stempel)
  const signaturBild = useBearbeitung((zustand) => zustand.signaturBild)
  const ausgewaehlt = useBearbeitung((zustand) => zustand.ausgewaehlt)
  const setzeWerkzeug = useBearbeitung((zustand) => zustand.setzeWerkzeug)
  const setzeFarbe = useBearbeitung((zustand) => zustand.setzeFarbe)
  const setzeStrichstaerke = useBearbeitung((zustand) => zustand.setzeStrichstaerke)
  const setzeStempel = useBearbeitung((zustand) => zustand.setzeStempel)

  const proSeite = useAnnotationen((zustand) => zustand.proSeite)

  const gewaehlte = useMemo(() => {
    if (ausgewaehlt === null) return null
    for (const liste of Object.values(proSeite)) {
      const treffer = liste.find((eintrag) => eintrag.id === ausgewaehlt)
      if (treffer !== undefined) return treffer
    }
    return null
  }, [ausgewaehlt, proSeite])

  /**
   * Das Signaturfeld oeffnet sich von selbst, wenn das Werkzeug ohne Bild
   * gewaehlt wird — sonst klickte man auf die Seite, und nichts geschaehe.
   * Mit Bild bleibt es zu; "Aendern" holt es zurueck.
   */
  const [signaturfeldOffen, setSignaturfeldOffen] = useState(false)
  useEffect(() => {
    if (werkzeug === 'signatur' && signaturBild === null) setSignaturfeldOffen(true)
    if (werkzeug !== 'signatur') setSignaturfeldOffen(false)
  }, [werkzeug, signaturBild])

  /**
   * Farbe und Strichstaerke wirken auf zweierlei: auf das, was als Naechstes
   * entsteht, und — wenn etwas ausgewaehlt ist — auf die Auswahl. Beides zu
   * trennen haette zwei Farbwaehler nebeneinander gebraucht.
   */
  const uebernimmFarbe = (neu: string): void => {
    setzeFarbe(neu)
    sichereVorgaben(neu, strichstaerke)
    if (gewaehlte !== null) {
      veraendereAnnotation(gewaehlte, aendere(gewaehlte, { farbe: farbeAusHex(neu) }))
    }
  }

  const uebernimmStaerke = (neu: number): void => {
    setzeStrichstaerke(neu)
    sichereVorgaben(farbe, neu)
    if (gewaehlte !== null) {
      veraendereAnnotation(gewaehlte, aendere(gewaehlte, { strichstaerke: neu }))
    }
  }

  return (
    <>
      <div
        data-testid="werkzeugleiste"
        role="toolbar"
        aria-label={t('werkzeug.leiste')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.35rem 0.75rem',
          borderBottom: '1px solid var(--linie)',
          background: 'var(--flaeche-2)',
          flexWrap: 'wrap'
        }}
      >
        {WERKZEUGE.map((eintrag) => (
          <button
            key={eintrag}
            type="button"
            data-testid={'werkzeug-' + eintrag}
            title={t(`werkzeug.${eintrag}.titel`, {
              tasten: tastenFuer('werkzeugTextBearbeiten')
            })}
            aria-pressed={werkzeug === eintrag}
            onClick={() => {
              setzeWerkzeug(eintrag)
            }}
            className="knopf"
            style={{
              // Gedrueckt zeigt die Klasse `knopf` ueber `aria-pressed`;
              // fett bleibt dazu, die Farbe allein reichte nicht (WCAG 1.4.1).
              fontWeight: werkzeug === eintrag ? 700 : 400
            }}
          >
            {t(`werkzeug.${eintrag}`)}
          </button>
        ))}

        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
        >
          {t('werkzeug.farbe')}
          <input
            type="color"
            data-testid="werkzeug-farbe"
            aria-label={t('werkzeug.farbe')}
            value={gewaehlte === null ? farbe : hexAusFarbe(gewaehlte.farbe)}
            onChange={(ereignis) => {
              uebernimmFarbe(ereignis.target.value)
            }}
            style={{ width: '2.2rem', height: '1.6rem', padding: 0 }}
          />
        </label>

        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
        >
          {t('werkzeug.staerke')}
          <input
            type="range"
            data-testid="werkzeug-staerke"
            aria-label={t('werkzeug.strichstaerke')}
            min={MIN_STRICHSTAERKE}
            max={MAX_STRICHSTAERKE}
            step={0.5}
            value={gewaehlte?.strichstaerke ?? strichstaerke}
            onChange={(ereignis) => {
              uebernimmStaerke(Number.parseFloat(ereignis.target.value))
            }}
            style={{ width: '5rem' }}
          />
        </label>

        {werkzeug === 'stempel' && (
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
          >
            {t('werkzeug.stempeltextKurz')}
            <select
              data-testid="werkzeug-stempeltext"
              aria-label={t('werkzeug.stempeltext')}
              value={stempel}
              onChange={(ereignis) => {
                setzeStempel(ereignis.target.value as StempelText)
              }}
            >
              {STEMPEL_TEXTE.map((text) => (
                <option key={text} value={text}>
                  {t(`stempel.${text}`)}
                </option>
              ))}
            </select>
          </label>
        )}

        {werkzeug === 'signatur' && (
          <span
            data-testid="werkzeug-signatur-stand"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85em' }}
          >
            {signaturBild === null ? (
              t('werkzeug.keinSignaturbild')
            ) : (
              <>
                <img
                  data-testid="werkzeug-signatur-vorschau"
                  src={signaturBild.url}
                  alt={t('werkzeug.signaturVorschau')}
                  style={{ height: '1.4rem', maxWidth: '6rem', border: '1px solid #d0d0d0' }}
                />
                {t('werkzeug.signaturKlicken')}
              </>
            )}
            <button
              type="button"
              data-testid="werkzeug-signatur-aendern"
              className="knopf"
              onClick={() => {
                setSignaturfeldOffen(true)
              }}
            >
              {signaturBild === null
                ? t('werkzeug.signaturZeichnen')
                : t('werkzeug.signaturAendern')}
            </button>
          </span>
        )}

        {gewaehlte !== null && gewaehlte.typ === 'FreeText' && (
          <>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
            >
              {t('werkzeug.schrift')}
              <select
                data-testid="werkzeug-schriftfamilie"
                aria-label={t('werkzeug.schriftfamilie')}
                value={gewaehlte.schriftFamilie ?? STANDARD_SCHRIFTFAMILIE}
                onChange={(ereignis) => {
                  veraendereAnnotation(
                    gewaehlte,
                    aendere(gewaehlte, { schriftFamilie: ereignis.target.value as SchriftFamilie })
                  )
                }}
              >
                {SCHRIFTFAMILIEN.map((familie) => (
                  <option key={familie} value={familie}>
                    {FAMILIE_BESCHRIFTUNG[familie]}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
            >
              {t('werkzeug.groesse')}
              <input
                type="number"
                data-testid="werkzeug-schriftgroesse"
                aria-label={t('werkzeug.schriftgroesse')}
                min={MIN_SCHRIFTGROESSE}
                max={MAX_SCHRIFTGROESSE}
                value={gewaehlte.schriftGroesse ?? STANDARD_SCHRIFTGROESSE}
                onChange={(ereignis) => {
                  const wert = Number.parseFloat(ereignis.target.value)
                  if (!Number.isFinite(wert)) return
                  veraendereAnnotation(
                    gewaehlte,
                    aendere(gewaehlte, {
                      schriftGroesse: Math.min(
                        MAX_SCHRIFTGROESSE,
                        Math.max(MIN_SCHRIFTGROESSE, wert)
                      )
                    })
                  )
                }}
                style={{ width: '3.2rem' }}
              />
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
            >
              <input
                type="checkbox"
                data-testid="werkzeug-fett"
                checked={gewaehlte.schriftFett === true}
                onChange={(ereignis) => {
                  veraendereAnnotation(
                    gewaehlte,
                    aendere(gewaehlte, { schriftFett: ereignis.target.checked })
                  )
                }}
              />
              {t('werkzeug.fett')}
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
            >
              <input
                type="checkbox"
                data-testid="werkzeug-kursiv"
                checked={gewaehlte.schriftKursiv === true}
                onChange={(ereignis) => {
                  veraendereAnnotation(
                    gewaehlte,
                    aendere(gewaehlte, { schriftKursiv: ereignis.target.checked })
                  )
                }}
              />
              {t('werkzeug.kursiv')}
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
            >
              {t('werkzeug.ausrichtung')}
              <select
                data-testid="werkzeug-ausrichtung"
                aria-label={t('werkzeug.ausrichtung')}
                value={gewaehlte.ausrichtung ?? STANDARD_AUSRICHTUNG}
                onChange={(ereignis) => {
                  veraendereAnnotation(
                    gewaehlte,
                    aendere(gewaehlte, { ausrichtung: ereignis.target.value as Ausrichtung })
                  )
                }}
              >
                {AUSRICHTUNGEN.map((ausrichtung) => (
                  <option key={ausrichtung} value={ausrichtung}>
                    {t(`ausrichtung.${ausrichtung}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {gewaehlte !== null && (
          <>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em' }}
            >
              {t('werkzeug.deckung')}
              <input
                type="range"
                data-testid="werkzeug-opazitaet"
                aria-label={t('werkzeug.deckkraft')}
                min={0.1}
                max={1}
                step={0.1}
                value={gewaehlte.opazitaet}
                onChange={(ereignis) => {
                  veraendereAnnotation(
                    gewaehlte,
                    aendere(gewaehlte, { opazitaet: Number.parseFloat(ereignis.target.value) })
                  )
                }}
                style={{ width: '5rem' }}
              />
            </label>
            <button
              type="button"
              data-testid="werkzeug-loeschen"
              className="knopf"
              onClick={() => {
                loescheAnnotation(gewaehlte)
              }}
            >
              {t('werkzeug.loeschen')}
            </button>
          </>
        )}
      </div>
      {werkzeug === 'zuschneiden' && <Zuschneideleiste />}
      {werkzeug === 'textBearbeiten' && (
        <p
          data-testid="textbearbeitung-hinweis"
          role="note"
          style={{
            margin: 0,
            padding: '0.3rem 0.75rem',
            fontSize: '0.85em',
            background: 'var(--akzent-weich)'
          }}
        >
          {t('werkzeug.textBearbeitenHinweis')}
        </p>
      )}
      {signaturfeldOffen && (
        <Signaturfeld
          onFertig={() => {
            setSignaturfeldOffen(false)
          }}
        />
      )}
    </>
  )
}
