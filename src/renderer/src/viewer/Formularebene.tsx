import { useEffect } from 'react'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'
import { APP_NAME } from '../../../shared/app-info'
import { AUS, pruefeWert, type Feldwert, type Formularfeld } from '../../../shared/formulare'
import { useDokument } from '../dokument-store'
import { useFormular } from '../formular-store'
import { rechteckZuBildschirm, type Bildschirmrechteck } from './koordinaten'
import { useSeitenmatrix } from './seitenmatrix'
import './formularebene.css'

/**
 * Die Formularebene (S3.1): je Widget ein echtes Eingabeelement, ueber der
 * Seite positioniert wie die Annotationen aus S2.1.
 *
 * Echte `<input>`, `<select>` und `<textarea>` und keine Nachbauten — der
 * Browser bringt Fokus, Tastatur, Zwischenablage und Hilfsmittel mit, und all
 * das nachzubauen waere Aufwand ohne Gewinn. Die Reihenfolge im DOM ist die
 * Reihenfolge im Dokument; damit stimmt die Tab-Reihenfolge von selbst.
 *
 * Unter den Feldern zeichnet die Canvas **nicht** die im Dokument
 * hinterlegten Werte: `annotationMode: DISABLE` (Invariante 6, seit S2.1)
 * laesst pdf.js die Widget-Appearances aus. Sonst schiene der alte Wert
 * unter dem neuen durch.
 */
export function skriptHinweis(): string {
  return t('formular.skript', { app: APP_NAME })
}

interface FormularebeneProps {
  index: number
}

export function Formularebene({ index }: FormularebeneProps): React.JSX.Element | null {
  useT()
  const dokument = useDokument((zustand) => zustand.dokument)
  const felder = useFormular((zustand) => zustand.proSeite[index + 1])
  const werte = useFormular((zustand) => zustand.werte)
  const setzeWert = useFormular((zustand) => zustand.setzeWert)
  const ladeSeite = useFormular((zustand) => zustand.ladeSeite)
  const matrix = useSeitenmatrix(index)

  useEffect(() => {
    if (dokument === null) return
    void ladeSeite(dokument, index + 1)
  }, [dokument, index, ladeSeite])

  if (matrix === null || felder === undefined || felder.length === 0) return null

  return (
    <div className="formularebene" data-testid={'formularebene-' + String(index + 1)}>
      {felder
        .filter((feld) => !feld.versteckt && feld.art !== 'unbekannt')
        .map((feld) => (
          <Feld
            key={feld.id}
            feld={feld}
            flaeche={rechteckZuBildschirm(feld.rect, matrix)}
            wert={werte[feld.name] ?? feld.ausgangswert}
            setzeWert={setzeWert}
          />
        ))}
    </div>
  )
}

interface FeldProps {
  feld: Formularfeld
  flaeche: Bildschirmrechteck
  wert: Feldwert
  setzeWert: (name: string, wert: Feldwert) => void
}

/** Schriftgroesse aus der Feldhoehe, damit der Text bei jedem Zoom passt. */
function schriftgroesse(flaeche: Bildschirmrechteck, mehrzeilig: boolean): number {
  const basis = mehrzeilig ? 14 : flaeche.hoehe * 0.6
  return Math.max(8, Math.min(basis, 28))
}

function Feld({ feld, flaeche, wert, setzeWert }: FeldProps): React.JSX.Element | null {
  const fehler = pruefeWert(feld, wert)
  const skript = feld.format?.art === 'skript'
  const kennung =
    'formularfeld-' + feld.name + (feld.art === 'auswahlknopf' ? '-' + (feld.exportwert ?? '') : '')
  const klassen = [
    'formularfeld',
    'formularfeld-' + feld.art,
    feld.pflicht ? 'formularfeld-pflicht' : '',
    feld.schreibgeschuetzt ? 'formularfeld-gesperrt' : '',
    fehler !== null ? 'formularfeld-ungueltig' : ''
  ]
    .filter((klasse) => klasse.length > 0)
    .join(' ')
  const lage: React.CSSProperties = {
    left: flaeche.links,
    top: flaeche.oben,
    width: flaeche.breite,
    height: flaeche.hoehe,
    fontSize: schriftgroesse(flaeche, feld.mehrzeilig)
  }
  const gemeinsam = {
    'data-testid': kennung,
    'data-feldname': feld.name,
    'data-fehler': fehler ?? undefined,
    'aria-label': feld.hilfetext ?? feld.name,
    'aria-required': feld.pflicht || undefined,
    'aria-invalid': fehler !== null || undefined,
    // Der Titel traegt die Meldung: so sieht man beim Zeigen, was fehlt.
    title: fehler ?? (skript ? skriptHinweis() : (feld.hilfetext ?? undefined))
  }

  let element: React.JSX.Element | null = null
  switch (feld.art) {
    case 'text':
      // `readOnly` und nicht `disabled`: ein gesperrtes Feld bleibt lesbar,
      // fokussierbar und kopierbar - es laesst sich nur nicht aendern.
      element = feld.mehrzeilig ? (
        <textarea
          {...gemeinsam}
          className={klassen}
          style={lage}
          value={typeof wert === 'string' ? wert : ''}
          maxLength={feld.maxLaenge ?? undefined}
          readOnly={feld.schreibgeschuetzt}
          onChange={(ereignis) => setzeWert(feld.name, ereignis.target.value)}
        />
      ) : (
        <input
          {...gemeinsam}
          className={klassen}
          style={lage}
          type={feld.passwort ? 'password' : 'text'}
          value={typeof wert === 'string' ? wert : ''}
          maxLength={feld.maxLaenge ?? undefined}
          readOnly={feld.schreibgeschuetzt}
          onChange={(ereignis) => setzeWert(feld.name, ereignis.target.value)}
        />
      )
      break

    case 'kontrollkaestchen':
      element = (
        <input
          {...gemeinsam}
          className={klassen}
          style={lage}
          type="checkbox"
          checked={wert === true}
          disabled={feld.schreibgeschuetzt}
          onChange={(ereignis) => setzeWert(feld.name, ereignis.target.checked)}
        />
      )
      break

    case 'auswahlknopf':
      // Eine Gruppe teilt den Namen; der Wert der Gruppe ist der An-Zustand
      // des gewaehlten Widgets (Aufgabe 5). `Off` heisst: keines.
      element = (
        <input
          {...gemeinsam}
          className={klassen}
          style={lage}
          type="radio"
          name={'formular-' + feld.name}
          value={feld.exportwert ?? ''}
          checked={typeof wert === 'string' && wert !== AUS && wert === feld.exportwert}
          disabled={feld.schreibgeschuetzt}
          onChange={() => setzeWert(feld.name, feld.exportwert ?? AUS)}
        />
      )
      break

    case 'auswahlliste': {
      // Ueber die Gegenrichtung verengen: `Array.isArray` machte aus einem
      // `readonly string[]` ein `any[]`.
      const gewaehlt: readonly string[] =
        typeof wert === 'string' || typeof wert === 'boolean' ? [] : wert
      element = (
        <select
          {...gemeinsam}
          className={klassen}
          style={lage}
          multiple={feld.mehrfach}
          // Ein Listenfeld zeigt seine Optionen offen, ein Kombinationsfeld
          // klappt sie auf. `size` macht den Unterschied.
          size={feld.kombiniert ? undefined : Math.max(2, feld.optionen.length)}
          value={feld.mehrfach ? [...gewaehlt] : (gewaehlt[0] ?? '')}
          disabled={feld.schreibgeschuetzt}
          onChange={(ereignis) => {
            const auswahl = [...ereignis.target.selectedOptions]
              .map((option) => option.value)
              .filter((option) => option.length > 0)
            setzeWert(feld.name, auswahl)
          }}
        >
          {/* Ohne leere Option zeigte ein Kombinationsfeld immer die erste
              als gewaehlt - auch wenn im Dokument nichts gewaehlt ist. */}
          {feld.kombiniert && !feld.mehrfach && <option value="">{'—'}</option>}
          {feld.optionen.map((option) => (
            <option key={option.export} value={option.export}>
              {option.anzeige}
            </option>
          ))}
        </select>
      )
      break
    }

    case 'schaltflaeche':
      // Was eine Schaltflaeche taete, steht in einem Skript - und das laeuft
      // hier nicht. Sichtbar, aber ohne Wirkung, mit Begruendung im Titel.
      element = (
        <button
          {...gemeinsam}
          type="button"
          className={klassen}
          style={lage}
          disabled
          title={skriptHinweis()}
        >
          {feld.hilfetext ?? feld.name}
        </button>
      )
      break

    case 'signatur':
      element = (
        <div
          data-testid={kennung}
          className={klassen}
          style={lage}
          role="img"
          aria-label={t('formular.signaturfeld', { name: feld.name })}
          title={t('formular.signaturfeldTitel')}
        />
      )
      break

    default:
      return null
  }

  return (
    <>
      {element}
      {skript && (
        <span
          className="formularfeld-skripthinweis"
          data-testid={'formular-skripthinweis-' + feld.name}
          role="note"
          aria-label={skriptHinweis()}
          title={skriptHinweis()}
          style={{ left: flaeche.links + flaeche.breite, top: flaeche.oben }}
        >
          JS
        </span>
      )}
    </>
  )
}
