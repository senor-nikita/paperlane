import { useId, useState } from 'react'
import { t as tAktiv } from '../../../shared/i18n'
import {
  MAX_STRICHSTAERKE,
  MIN_STRICHSTAERKE,
  PASSUNGEN,
  istFarbe,
  istPassung,
  type Passung,
  type SettingsPatch
} from '../../../shared/settings'
import {
  istSprachwahl as istSprachwahlWert,
  SPRACHWAHLEN,
  type Sprachwahl
} from '../../../shared/i18n'
import { ladeSprache, useSprache, useT } from '../sprache'
import { useBearbeitung } from '../bearbeitung-store'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { useDokumentwerkzeuge } from './dokumentwerkzeuge-logik'
import { useFeldfokus } from './feldfokus'
import { feldrahmen } from './stile'

/**
 * Der Einstellungsdialog (S5.2a, Aufgabe 5): Autorenname, Vorgaben fuer neue
 * Anmerkungen und die Passung, mit der ein Dokument erscheint.
 *
 * Seit S6.8 mit Sprachwahl (D15 revidiert): Automatisch folgt der
 * Systemsprache, sonst gilt die Wahl. Sie wirkt nach dem Speichern sofort auf
 * Oberflaeche und Menue.
 *
 * Ein Streifen wie die anderen Felder, kein modales Fenster - derselbe
 * Fokus- und Escape-Mechanismus, dieselbe Regel "nur eins offen". Gesichert
 * wird auf Knopfdruck und nicht je Tastendruck: der Autorenname wuerde sonst
 * bei jedem Buchstaben in die Einstellungsdatei geschrieben.
 *
 * Die Startwerte kommen aus den Stores, nicht aus einer eigenen Anfrage an
 * den Main: `useAnnotationsvorgaben` hat sie beim Start dort abgelegt, und
 * die Werkzeugleiste aendert Farbe und Strichstaerke an derselben Stelle.
 */

function beschrifte(passung: Passung): string {
  switch (passung) {
    case 'frei':
      return tAktiv('einst.passungFrei')
    case 'breite':
      return tAktiv('einst.passungBreite')
    case 'seite':
      return tAktiv('einst.passungSeite')
  }
}

/**
 * Die Sprachen heissen in ihrer eigenen Sprache: wer die Oberflaeche nicht
 * lesen kann, findet so trotzdem die eigene.
 */
function beschrifteSprache(wahl: Sprachwahl): string {
  switch (wahl) {
    case 'auto':
      return tAktiv('einst.spracheAuto')
    case 'de':
      return 'Deutsch'
    case 'en':
      return 'English'
  }
}

const ZEILE: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  flexWrap: 'wrap'
}

export function Einstellungen(): React.JSX.Element {
  const schliesse = useDokumentwerkzeuge((zustand) => zustand.schliesse)
  const { behaelterRef, beiTaste } = useFeldfokus(schliesse)
  const t = useT()
  const sprachwahl = useSprache((zustand) => zustand.wahl)

  const autor = useBearbeitung((zustand) => zustand.autor)
  const farbe = useBearbeitung((zustand) => zustand.farbe)
  const strichstaerke = useBearbeitung((zustand) => zustand.strichstaerke)
  const setzeAutor = useBearbeitung((zustand) => zustand.setzeAutor)
  const setzeFarbe = useBearbeitung((zustand) => zustand.setzeFarbe)
  const setzeStrichstaerke = useBearbeitung((zustand) => zustand.setzeStrichstaerke)
  const standardPassung = useDokument((zustand) => zustand.standardPassung)
  const setzeStandardPassung = useDokument((zustand) => zustand.setzeStandardPassung)
  const setzeHinweis = useDokument((zustand) => zustand.setzeHinweis)

  const [autorEingabe, setzeAutorEingabe] = useState(autor)
  const [farbeEingabe, setzeFarbeEingabe] = useState(farbe)
  const [staerkeEingabe, setzeStaerkeEingabe] = useState(String(strichstaerke))
  const [passungEingabe, setzePassungEingabe] = useState<Passung>(standardPassung)
  const [spracheEingabe, setzeSpracheEingabe] = useState<Sprachwahl>(sprachwahl)
  const [staerkeFehler, setzeStaerkeFehler] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [laeuft, setzeLaeuft] = useState(false)

  const kennung = useId()
  const autorId = kennung + '-autor'
  const farbeId = kennung + '-farbe'
  const staerkeId = kennung + '-staerke'
  const passungId = kennung + '-passung'
  const spracheId = kennung + '-sprache'
  const fehlerId = kennung + '-fehler'

  const speichere = async (ereignis: React.FormEvent): Promise<void> => {
    ereignis.preventDefault()
    const staerke = Number(staerkeEingabe.replace(',', '.'))
    if (!Number.isFinite(staerke) || staerke < MIN_STRICHSTAERKE || staerke > MAX_STRICHSTAERKE) {
      setzeFehler(
        t('einst.strichstaerkeFehler', { min: MIN_STRICHSTAERKE, max: MAX_STRICHSTAERKE })
      )
      setzeStaerkeFehler(true)
      return
    }
    setzeStaerkeFehler(false)
    if (!istFarbe(farbeEingabe)) {
      setzeFehler(t('einst.farbeFehler'))
      return
    }
    const name = autorEingabe.trim()
    setzeFehler(null)
    const patch: SettingsPatch = {
      autorName: name,
      annotationen: { farbe: farbeEingabe, strichstaerke: staerke },
      ansicht: { passung: passungEingabe },
      sprache: spracheEingabe
    }
    const api = bruecke()
    if (api === undefined) return
    setzeLaeuft(true)
    try {
      await api.settingsSet(patch)
    } catch (error) {
      console.error('Einstellungen konnten nicht gesichert werden:', error)
      setzeLaeuft(false)
      setzeFehler(t('einst.sichernFehler'))
      return
    }
    // Erst nach dem Sichern in die Stores: was der Main abgelehnt hat, soll
    // die Oberflaeche nicht als uebernommen zeigen.
    setzeAutor(name)
    setzeFarbe(farbeEingabe)
    setzeStrichstaerke(staerke)
    setzeStandardPassung(passungEingabe)
    // Der Main hat die Sprache neu aufgeloest und das Menue neu gebaut; die
    // Oberflaeche holt sie dort ab, damit beide dieselbe sprechen.
    if (spracheEingabe !== sprachwahl) await ladeSprache()
    setzeHinweis(tAktiv('einst.gesichert'))
    useDokumentwerkzeuge.getState().schliesse()
  }

  return (
    <div
      ref={behaelterRef}
      tabIndex={-1}
      onKeyDown={beiTaste}
      data-testid="einstellungen"
      role="group"
      aria-label={t('einst.titel')}
      style={feldrahmen}
    >
      <form
        // Eigene Pruefung mit lesbarer Meldung statt der Browser-Sprechblase,
        // die Screenreader je nach Plattform gar nicht vorlesen.
        noValidate
        onSubmit={(ereignis) => {
          void speichere(ereignis)
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
      >
        <strong>{t('einst.titel')}</strong>
        <div style={ZEILE}>
          <label htmlFor={autorId}>{t('einst.autor')}</label>
          <input
            id={autorId}
            data-testid="einstellungen-autor"
            type="text"
            value={autorEingabe}
            maxLength={200}
            onChange={(ereignis) => {
              setzeAutorEingabe(ereignis.target.value)
            }}
            style={{ width: '16rem' }}
          />
        </div>
        <div style={ZEILE}>
          <label htmlFor={farbeId}>{t('einst.farbe')}</label>
          <input
            id={farbeId}
            data-testid="einstellungen-farbe"
            type="color"
            value={farbeEingabe}
            onChange={(ereignis) => {
              setzeFarbeEingabe(ereignis.target.value)
            }}
          />
          <label htmlFor={staerkeId}>{t('einst.strichstaerke')}</label>
          <input
            id={staerkeId}
            data-testid="einstellungen-strichstaerke"
            type="number"
            inputMode="decimal"
            min={MIN_STRICHSTAERKE}
            max={MAX_STRICHSTAERKE}
            step={0.5}
            value={staerkeEingabe}
            aria-describedby={fehler === null ? undefined : fehlerId}
            aria-invalid={staerkeFehler}
            onChange={(ereignis) => {
              setzeStaerkeEingabe(ereignis.target.value)
            }}
            style={{ width: '4rem' }}
          />
        </div>
        <div style={ZEILE}>
          <label htmlFor={passungId}>{t('einst.passung')}</label>
          <select
            id={passungId}
            data-testid="einstellungen-passung"
            value={passungEingabe}
            onChange={(ereignis) => {
              const wert = ereignis.target.value
              if (istPassung(wert)) setzePassungEingabe(wert)
            }}
          >
            {PASSUNGEN.map((passung) => (
              <option key={passung} value={passung}>
                {beschrifte(passung)}
              </option>
            ))}
          </select>
        </div>
        <div style={ZEILE}>
          <label htmlFor={spracheId}>{t('einst.sprache')}</label>
          <select
            id={spracheId}
            data-testid="einstellungen-sprache"
            value={spracheEingabe}
            onChange={(ereignis) => {
              const wert = ereignis.target.value
              if (istSprachwahlWert(wert)) setzeSpracheEingabe(wert)
            }}
          >
            {SPRACHWAHLEN.map((wahl) => (
              <option key={wahl} value={wahl} lang={wahl === 'auto' ? undefined : wahl}>
                {beschrifteSprache(wahl)}
              </option>
            ))}
          </select>
        </div>
        {fehler !== null && (
          <div
            id={fehlerId}
            role="alert"
            data-testid="einstellungen-fehler"
            style={{ color: '#a33' }}
          >
            {fehler}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="submit"
            data-testid="einstellungen-speichern"
            className="knopf"
            disabled={laeuft}
          >
            {t('einst.speichern')}
          </button>
          <button
            type="button"
            data-testid="einstellungen-schliessen"
            className="knopf"
            onClick={schliesse}
          >
            {t('schale.abbrechen')}
          </button>
        </div>
      </form>
    </div>
  )
}
