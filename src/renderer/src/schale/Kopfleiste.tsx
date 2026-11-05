import { useEffect, useState, type RefObject } from 'react'
import { APP_NAME } from '../../../shared/app-info'
import { useDokument } from '../dokument-store'
import { useFormular } from '../formular-store'
import { loescheAktuelleSeite } from '../mutation'
import { useMutation } from '../mutation-store'
import { tastenFuer } from '../../../shared/tastatur'
import { useT } from '../sprache'
import { useTabs } from '../tabs-store'
import { useBearbeitung } from '../bearbeitung-store'
import { exportiereFdf, speichere, useAnzahlAenderungen } from './speichern'
import { Suchleiste } from './Suchleiste'
import { Verlaufsknoepfe } from './Verlaufsknoepfe'
import { Sinnbild, type SymbolName } from './Symbol'
import { parseZoomEingabe } from '../viewer/zoom'

/** Die Anzeige im Zoomfeld: ganze Prozent, wie sie auch getippt werden. */
function zoomText(zoom: number): string {
  return String(Math.round(zoom * 100)) + ' %'
}

/**
 * Die Kopfleiste: Datei oeffnen, Seitenleiste, Seitennavigation, Ansicht,
 * Suche und der Name des Dokuments.
 *
 * Alles ausser dem Oeffnen-Knopf erscheint erst mit einem geladenen Dokument —
 * Knoepfe, die auf nichts wirken koennen, sind schlechter als keine.
 */
export function Kopfleiste({
  seiteRef,
  sucheRef
}: {
  seiteRef: RefObject<HTMLInputElement | null>
  sucheRef: RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const t = useT()
  const bereit = useDokument((zustand) => zustand.ladeZustand === 'bereit')
  const name = useDokument((zustand) => zustand.name)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const mutationLaeuft = useMutation((zustand) => zustand.laeuft !== null)
  const zoom = useDokument((zustand) => zustand.zoom)
  const passung = useDokument((zustand) => zustand.passung)
  const sidebarSichtbar = useDokument((zustand) => zustand.sidebarSichtbar)
  // Seit S6.1 in einem neuen Tab; das offene Dokument bleibt.
  const oeffneUeberDialog = useTabs((zustand) => zustand.oeffneUeberDialog)
  const springeZuSeite = useDokument((zustand) => zustand.springeZuSeite)
  const zoomeStufe = useDokument((zustand) => zustand.zoomeStufe)
  const setzePassung = useDokument((zustand) => zustand.setzePassung)
  const drehe = useDokument((zustand) => zustand.drehe)
  const schalteSidebar = useDokument((zustand) => zustand.schalteSidebar)
  const verschluesselt = useDokument((zustand) => zustand.verschluesselt)
  const offeneAenderungen = useAnzahlAenderungen()
  const leisteOffen = useBearbeitung((zustand) => zustand.leisteOffen)
  const schalteLeiste = useBearbeitung((zustand) => zustand.schalteLeiste)
  // Nur, wenn eine gelesene Seite Felder traegt: Knoepfe, die auf nichts
  // wirken koennen, sind schlechter als keine.
  const hatFormular = useFormular((zustand) =>
    Object.values(zustand.proSeite).some((felder) => felder.length > 0)
  )

  const spalten = useDokument((zustand) => zustand.spalten)
  const setzeSpalten = useDokument((zustand) => zustand.setzeSpalten)
  const setzeZoom = useDokument((zustand) => zustand.setzeZoom)

  const [seiteneingabe, setSeiteneingabe] = useState('1')
  const [zoomeingabe, setZoomeingabe] = useState(zoomText(zoom))

  useEffect(() => {
    setSeiteneingabe(String(aktuelleSeite))
  }, [aktuelleSeite])

  // Der Zoom aendert sich auch ohne Tippen: Knoepfe, Tastenkuerzel, Passung.
  useEffect(() => {
    setZoomeingabe(zoomText(zoom))
  }, [zoom])

  // Eine Angabe, die keine Zahl ist, stellt die Anzeige zurueck; eine Zahl
  // ausserhalb des erlaubten Bereichs wird begrenzt (siehe `parseZoomEingabe`).
  const uebernimmZoomeingabe = (): void => {
    const faktor = parseZoomEingabe(zoomeingabe)
    if (faktor === null) {
      setZoomeingabe(zoomText(zoom))
      return
    }
    setzeZoom(faktor)
    // Gleicher Wert wie vorher: der Effekt oben liefe nicht, die Anzeige
    // behielte aber den getippten Text ("150" statt "150 %").
    setZoomeingabe(zoomText(faktor))
  }

  const uebernimmSeiteneingabe = (): void => {
    const gewuenscht = Number.parseInt(seiteneingabe, 10)
    if (Number.isNaN(gewuenscht)) {
      setSeiteneingabe(String(aktuelleSeite))
      return
    }
    springeZuSeite(gewuenscht)
  }

  // Ein Knopf, der nur ein Symbol zeigt: Beschriftung fuer Screenreader und
  // Tooltip aus demselben Text (S6.9).
  const symbolKnopf = (
    name: SymbolName,
    beschriftung: string,
    beiKlick: () => void,
    weiteres: { testId?: string; gesperrt?: boolean; gedrueckt?: boolean; titel?: string } = {}
  ): React.JSX.Element => (
    <button
      type="button"
      className="knopf knopf-symbol"
      aria-label={beschriftung}
      title={weiteres.titel ?? beschriftung}
      data-testid={weiteres.testId}
      disabled={weiteres.gesperrt}
      aria-pressed={weiteres.gedrueckt}
      onClick={beiKlick}
    >
      <Sinnbild name={name} />
    </button>
  )

  return (
    <header className="kopfleiste">
      <strong className="marke">{APP_NAME}</strong>
      <button
        type="button"
        className="knopf knopf-primaer"
        onClick={() => void oeffneUeberDialog()}
      >
        <Sinnbild name="oeffnen" />
        {t('kopf.oeffnen')}
      </button>

      {bereit && (
        <>
          {/* Speichern (S2.3a). Bei einem mit Passwort geoeffneten Dokument
              gesperrt: pdf-lib kann es nicht entschluesseln und schriebe beim
              Neuschreiben eine beschaedigte Datei. Die Erklaerung steht als
              Meldung ueber dem Dokument, nicht nur als Titel — ein gesperrter
              Knopf ohne Grund sieht nach einem Fehler aus. */}
          <div className="gruppe">
            <button
              type="button"
              data-testid="speichern-knopf"
              className="knopf"
              style={{ fontWeight: offeneAenderungen > 0 ? 700 : 400 }}
              disabled={verschluesselt}
              title={
                verschluesselt
                  ? t('kopf.verschluesseltTitel')
                  : t('kopf.speichernTitel', { tasten: tastenFuer('speichern') })
              }
              onClick={() => void speichere('gleich')}
            >
              <Sinnbild name="speichern" />
              {t('kopf.speichern')}
            </button>
            <button
              type="button"
              data-testid="speichern-unter-knopf"
              className="knopf knopf-leise"
              disabled={verschluesselt}
              title={
                verschluesselt
                  ? t('kopf.verschluesseltTitel')
                  : t('kopf.speichernUnterTitel', { tasten: tastenFuer('speichernUnter') })
              }
              onClick={() => void speichere('neu')}
            >
              {t('kopf.speichernUnter')}
            </button>
            {hatFormular && (
              <>
                <button
                  type="button"
                  data-testid="flachlegen-knopf"
                  className="knopf knopf-leise"
                  disabled={verschluesselt}
                  title={t('kopf.flachlegenTitel', { tasten: tastenFuer('formularFlachlegen') })}
                  onClick={() => void speichere('gleich', { flachlegen: true })}
                >
                  {t('kopf.flachlegen')}
                </button>
                <button
                  type="button"
                  data-testid="fdf-knopf"
                  className="knopf knopf-leise"
                  title={t('kopf.fdfTitel', { tasten: tastenFuer('fdfExportieren') })}
                  onClick={() => void exportiereFdf()}
                >
                  FDF
                </button>
              </>
            )}
          </div>

          <div className="gruppe">
            {symbolKnopf('seitenleiste', t('kopf.seitenleiste'), () => schalteSidebar(), {
              testId: 'sidebar-schalter',
              gedrueckt: sidebarSichtbar
            })}
          </div>

          <div className="gruppe">
            {symbolKnopf('anfang', t('kopf.anfang'), () => springeZuSeite(1))}
            {symbolKnopf('zurueck', t('kopf.zurueck'), () => springeZuSeite(aktuelleSeite - 1))}
            <input
              ref={seiteRef}
              aria-label={t('kopf.seitenzahl')}
              data-testid="seiten-eingabe"
              value={seiteneingabe}
              onChange={(ereignis) => setSeiteneingabe(ereignis.target.value)}
              onBlur={uebernimmSeiteneingabe}
              onKeyDown={(ereignis) => {
                if (ereignis.key === 'Enter') uebernimmSeiteneingabe()
              }}
              style={{ width: '2.8rem', textAlign: 'center' }}
            />
            <span data-testid="seiten-anzeige" className="leise">
              {t('kopf.von', { anzahl: seitenzahl })}
            </span>
            {symbolKnopf('vor', t('kopf.vor'), () => springeZuSeite(aktuelleSeite + 1))}
            {symbolKnopf('ende', t('kopf.ende'), () => springeZuSeite(seitenzahl))}
            {symbolKnopf('loeschen', t('kopf.seiteLoeschen'), () => void loescheAktuelleSeite(), {
              testId: 'seite-loeschen-knopf',
              gesperrt: seitenzahl <= 1 || verschluesselt || mutationLaeuft,
              titel:
                seitenzahl <= 1
                  ? t('kopf.letzteSeiteTitel')
                  : t('kopf.seiteLoeschenTitel', { tasten: tastenFuer('seiteLoeschen') })
            })}
          </div>

          <div className="gruppe">
            {symbolKnopf('kleiner', t('kopf.kleiner'), () => zoomeStufe(-1))}
            <input
              aria-label={t('kopf.zoomEingabe')}
              data-testid="zoom-anzeige"
              className="zoomwert"
              inputMode="decimal"
              value={zoomeingabe}
              onChange={(ereignis) => setZoomeingabe(ereignis.target.value)}
              onBlur={uebernimmZoomeingabe}
              onKeyDown={(ereignis) => {
                if (ereignis.key === 'Enter') uebernimmZoomeingabe()
                if (ereignis.key === 'Escape') setZoomeingabe(zoomText(zoom))
              }}
              style={{ width: '4.2rem', textAlign: 'center' }}
            />
            {symbolKnopf('groesser', t('kopf.groesser'), () => zoomeStufe(1))}
            {symbolKnopf('breite', t('kopf.breite'), () => setzePassung('breite', zoom), {
              gedrueckt: passung === 'breite'
            })}
            {symbolKnopf('seite', t('kopf.seite'), () => setzePassung('seite', zoom), {
              gedrueckt: passung === 'seite'
            })}
            {symbolKnopf(
              'zweiSeiten',
              t('kopf.zweiSeiten'),
              () => setzeSpalten(spalten === 2 ? 1 : 2),
              { testId: 'zwei-seiten-schalter', gedrueckt: spalten === 2 }
            )}
            {symbolKnopf('linksDrehen', t('kopf.linksDrehen'), () => drehe(-1))}
            {symbolKnopf('rechtsDrehen', t('kopf.rechtsDrehen'), () => drehe(1))}
          </div>

          <div className="gruppe">
            <Verlaufsknoepfe />
            <button
              type="button"
              className="knopf"
              data-testid="bearbeiten-schalter"
              aria-pressed={leisteOffen}
              title={t('kopf.bearbeitenTitel')}
              onClick={schalteLeiste}
            >
              <Sinnbild name="bearbeiten" />
              {t('kopf.bearbeiten')}
            </button>
          </div>

          <Suchleiste feldRef={sucheRef} />
        </>
      )}

      <span data-testid="dokument-name" className="leise dokumentname">
        {name ?? t('kopf.keinDokument')}
        {/* Der Stern ist die uebliche Marke fuer "ungespeichert". Die Zahl
            steht daneben, weil sie beim Pruefen hilft und den Leser nichts
            kostet; angesagt wird beides nur einmal, ueber das aria-label. */}
        {bereit && offeneAenderungen > 0 && (
          <span
            data-testid="aenderungs-marke"
            aria-label={t('kopf.ungespeichert', { anzahl: offeneAenderungen })}
            style={{ marginLeft: '0.4rem', color: '#a05000', fontWeight: 700 }}
          >
            *{offeneAenderungen}
          </span>
        )}
      </span>
    </header>
  )
}
