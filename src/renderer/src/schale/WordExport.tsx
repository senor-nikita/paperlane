import { useEffect, useState } from 'react'
import { useDokument } from '../dokument-store'
import { hatTextebene } from '../word-extraktion'
import { useDokumentwerkzeuge } from './dokumentwerkzeuge-logik'
import { useFeldfokus } from './feldfokus'
import { feldrahmen } from './stile'
import { brichWordExportAb, exportiereWord } from './word-export-logik'
import { useT } from '../sprache'

/**
 * Das Feld fuer PDF nach Word (S6.7). Es nennt die Grenzen **vorab** (R16):
 * das Layout ist grob, Spalten und Tabellen gehen verloren, Texterkennung gibt
 * es nicht. Hat das Dokument keine Textebene, steht das da, bevor jemand auf
 * Exportieren drueckt (Aufgabe 5). Waehrend gelesen wird, zeigt es die Seite
 * und bietet Abbrechen an (Aufgabe 4).
 */
export function WordExport(): React.JSX.Element {
  const dokument = useDokument((zustand) => zustand.dokument)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const laeuft = useDokumentwerkzeuge((zustand) => zustand.laeuft)
  const fortschritt = useDokumentwerkzeuge((zustand) => zustand.fortschritt)
  const schliesse = useDokumentwerkzeuge((zustand) => zustand.schliesse)
  const { behaelterRef, beiTaste } = useFeldfokus(schliesse)
  const t = useT()
  const [seitenumbruch, setSeitenumbruch] = useState(true)
  const [textebene, setTextebene] = useState<'pruefe' | 'vorhanden' | 'fehlt'>('pruefe')

  useEffect(() => {
    if (dokument === null) return undefined
    let vorbei = false
    hatTextebene(dokument, () => vorbei)
      .then((vorhanden) => {
        if (!vorbei) setTextebene(vorhanden ? 'vorhanden' : 'fehlt')
      })
      .catch((fehler: unknown) => {
        console.error('Textebene liess sich nicht pruefen:', fehler)
        // Im Zweifel nicht warnen: der Export selbst sagt, was er findet.
        if (!vorbei) setTextebene('vorhanden')
      })
    return () => {
      vorbei = true
    }
  }, [dokument])

  return (
    <div
      ref={behaelterRef}
      tabIndex={-1}
      onKeyDown={beiTaste}
      data-testid="word"
      role="group"
      aria-label={t('word.titel')}
      style={feldrahmen}
    >
      <p data-testid="word-grenzen" style={{ margin: 0, fontSize: '0.85em', color: '#444' }}>
        {t('word.grenzen')}
      </p>
      {textebene === 'fehlt' && (
        <p
          data-testid="word-kein-text"
          role="alert"
          style={{ margin: 0, fontSize: '0.85em', color: '#a33' }}
        >
          {t('word.keinText')}
        </p>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.9em' }}>
        <input
          type="checkbox"
          data-testid="word-seitenumbruch"
          checked={seitenumbruch}
          disabled={laeuft}
          onChange={(ereignis) => {
            setSeitenumbruch(ereignis.target.checked)
          }}
        />
        {t('word.seitenumbruch')}
      </label>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="word-ausfuehren"
          className="knopf"
          style={{ fontWeight: 700 }}
          disabled={laeuft}
          title={t('ziel.datei')}
          onClick={() => {
            void exportiereWord({ seitenumbruch })
          }}
        >
          {t('word.exportieren', { anzahl: seitenzahl })}
        </button>
        <button
          type="button"
          data-testid="word-abbrechen"
          className="knopf"
          onClick={() => {
            if (laeuft) {
              brichWordExportAb()
            } else {
              schliesse()
            }
          }}
        >
          {t('schale.abbrechen')}
        </button>
        {fortschritt !== null && (
          <span data-testid="word-fortschritt" role="status" style={{ fontSize: '0.85em' }}>
            {fortschritt.fertig < fortschritt.gesamt
              ? t('word.liest', { seite: fortschritt.fertig + 1, gesamt: fortschritt.gesamt })
              : t('word.schreibt')}
          </span>
        )}
      </div>
    </div>
  )
}
