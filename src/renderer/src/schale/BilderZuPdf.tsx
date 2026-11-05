import {
  bilderHinzufuegen,
  erzeugeBilderPdf,
  useBilderZuPdf,
  type BildAusrichtung,
  type Seitengroesse
} from './bilderzupdf-logik'
import { useFeldfokus } from './feldfokus'
import { feldrahmen } from './stile'
import { useT } from '../sprache'

/**
 * Das Feld "Aus Bildern erstellen…" (S6.4, D18) - eine Liste wie beim
 * Zusammenfuehren (S4.2a), plus die Optionen aus Aufgabe 3: Seitengroesse,
 * Ausrichtung, Rand. Ein Eintrag ohne Seitenmasse ist noch in der
 * Normalisierung (EXIF, Formatumwandlung) und blockiert das Erstellen, statt
 * ein unvollstaendiges Bild stillschweigend auszulassen.
 */
export function BilderZuPdf(): React.JSX.Element | null {
  const offen = useBilderZuPdf((zustand) => zustand.offen)
  const eintraege = useBilderZuPdf((zustand) => zustand.eintraege)
  const seitengroesse = useBilderZuPdf((zustand) => zustand.seitengroesse)
  const ausrichtung = useBilderZuPdf((zustand) => zustand.ausrichtung)
  const randMm = useBilderZuPdf((zustand) => zustand.randMm)
  const laeuft = useBilderZuPdf((zustand) => zustand.laeuft)
  const verschiebe = useBilderZuPdf((zustand) => zustand.verschiebe)
  const entferne = useBilderZuPdf((zustand) => zustand.entferne)
  const setzeSeitengroesse = useBilderZuPdf((zustand) => zustand.setzeSeitengroesse)
  const setzeAusrichtung = useBilderZuPdf((zustand) => zustand.setzeAusrichtung)
  const setzeRandMm = useBilderZuPdf((zustand) => zustand.setzeRandMm)
  const schliesse = useBilderZuPdf((zustand) => zustand.schliesse)
  const { behaelterRef, beiTaste } = useFeldfokus(schliesse)
  const t = useT()

  if (!offen) return null

  const nochNichtFertig = eintraege.some((e) => e.seite === null && e.fehler === null)
  const bereit = eintraege.filter((e) => e.seite !== null).length
  const kannErstellen = !laeuft && !nochNichtFertig && bereit > 0

  return (
    <div
      ref={behaelterRef}
      tabIndex={-1}
      onKeyDown={beiTaste}
      data-testid="bilder-zu-pdf"
      role="group"
      aria-label={t('bilder.titel')}
      style={feldrahmen}
    >
      <p style={{ margin: 0, fontSize: '0.85em', color: '#444' }}>{t('bilder.erklaerung')}</p>
      {eintraege.length === 0 ? (
        <p data-testid="bilder-zu-pdf-leer" style={{ margin: 0, fontSize: '0.85em' }}>
          {t('bilder.leer')}
        </p>
      ) : (
        <ol data-testid="bilder-zu-pdf-liste" style={{ margin: 0, paddingLeft: '1.5rem' }}>
          {eintraege.map((eintrag, index) => (
            <li
              key={eintrag.id}
              data-testid={'bilder-zu-pdf-eintrag-' + String(index + 1)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9em' }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {eintrag.name}
              </span>
              <span
                style={{ color: eintrag.fehler !== null ? '#a33' : '#666', fontSize: '0.85em' }}
              >
                {eintrag.fehler ??
                  (eintrag.seite === null ? t('bilder.wirdGelesen') : t('bilder.bereit'))}
              </span>
              <button
                type="button"
                data-testid={'bilder-zu-pdf-hoch-' + String(index + 1)}
                className="knopf"
                disabled={index === 0}
                aria-label={t('liste.nachOben')}
                onClick={() => {
                  verschiebe(index, -1)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                data-testid={'bilder-zu-pdf-runter-' + String(index + 1)}
                className="knopf"
                disabled={index === eintraege.length - 1}
                aria-label={t('liste.nachUnten')}
                onClick={() => {
                  verschiebe(index, 1)
                }}
              >
                ↓
              </button>
              <button
                type="button"
                data-testid={'bilder-zu-pdf-entfernen-' + String(index + 1)}
                className="knopf"
                aria-label={t('liste.entfernen')}
                onClick={() => {
                  entferne(index)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.9em' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {t('bilder.seitengroesse')}
          <select
            data-testid="bilder-zu-pdf-seitengroesse"
            value={seitengroesse}
            onChange={(ereignis) => {
              setzeSeitengroesse(ereignis.target.value as Seitengroesse)
            }}
          >
            <option value="bild">{t('bilder.wieBild')}</option>
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {t('bilder.ausrichtung')}
          <select
            data-testid="bilder-zu-pdf-ausrichtung"
            value={ausrichtung}
            disabled={seitengroesse === 'bild'}
            onChange={(ereignis) => {
              setzeAusrichtung(ereignis.target.value as BildAusrichtung)
            }}
          >
            <option value="auto">{t('bilder.automatisch')}</option>
            <option value="hoch">{t('format.hoch')}</option>
            <option value="quer">{t('format.quer')}</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {t('bilder.rand')}
          <input
            type="number"
            data-testid="bilder-zu-pdf-rand"
            min={0}
            max={100}
            step={1}
            disabled={seitengroesse === 'bild'}
            value={randMm}
            onChange={(ereignis) => {
              const wert = Number(ereignis.target.value)
              if (Number.isFinite(wert) && wert >= 0) setzeRandMm(wert)
            }}
            style={{ width: '4rem', padding: '0.2rem 0.4rem' }}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="bilder-zu-pdf-hinzufuegen"
          className="knopf"
          disabled={laeuft}
          onClick={() => void bilderHinzufuegen(null)}
        >
          {t('bilder.hinzufuegen')}
        </button>
        <button
          type="button"
          data-testid="bilder-zu-pdf-ausfuehren"
          className="knopf"
          style={{ fontWeight: 700 }}
          disabled={!kannErstellen}
          title={nochNichtFertig ? t('bilder.nochLesen') : t('ziel.speichernUnter')}
          onClick={() => void erzeugeBilderPdf()}
        >
          {t('bilder.erstellen', { anzahl: bereit })}
        </button>
        <button
          type="button"
          data-testid="bilder-zu-pdf-abbrechen"
          className="knopf"
          onClick={schliesse}
        >
          {t('schale.abbrechen')}
        </button>
      </div>
    </div>
  )
}
