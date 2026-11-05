import { APP_NAME } from '../../../shared/app-info'
import { xfaText } from '../../../shared/errors'
import { useDokument } from '../dokument-store'
import { useSuche } from '../suche-store'
import { useT } from '../sprache'

/**
 * Die Meldungszeilen ueber dem Dokument.
 *
 * Vier Faelle, die derselben Regel folgen: der Leser erfaehrt, warum etwas
 * anders aussieht als erwartet, ohne dass ihm der Fokus weggenommen wird.
 * Deshalb tragen alle eine Live-Region — `alert` fuer den Hinweis, der etwas
 * unterbricht, `status` fuer die uebrigen, die nur erklaeren.
 */
export function Meldungen(): React.JSX.Element {
  const t = useT()
  const hinweis = useDokument((zustand) => zustand.hinweis)
  const setzeHinweis = useDokument((zustand) => zustand.setzeHinweis)
  const istXfa = useDokument((zustand) => zustand.istXfa)
  const eingeschraenkteRechte = useDokument((zustand) => zustand.eingeschraenkteRechte)
  const verschluesselt = useDokument((zustand) => zustand.verschluesselt)
  const bereit = useDokument((zustand) => zustand.ladeZustand === 'bereit')
  const hatText = useSuche((zustand) => zustand.hatDurchsuchbarenText)

  return (
    <>
      {hinweis !== null && (
        <p
          data-testid="hinweis"
          // Der Hinweis erscheint, ohne dass der Fokus wandert - etwa wenn die
          // Datei waehrend des Lesens verschwindet. Ohne Live-Region bekaeme
          // ein Screenreader-Nutzer davon nichts mit.
          role="alert"
          style={{
            margin: 0,
            padding: '0.5rem 0.75rem',
            background: '#ffe6cc',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center'
          }}
        >
          {hinweis}
          <button
            type="button"
            data-testid="hinweis-schliessen"
            className="knopf"
            onClick={() => setzeHinweis(null)}
          >
            {t('meldung.schliessen')}
          </button>
        </p>
      )}

      {bereit && istXfa && (
        <p
          data-testid="xfa-hinweis"
          // Erklaert, warum die Seite fast leer aussieht. Hoeflich angesagt,
          // nicht unterbrechend: der Inhalt ist ja da.
          role="status"
          style={{ margin: 0, padding: '0.5rem 0.75rem', background: '#fff6d5' }}
        >
          {xfaText()}
        </p>
      )}

      {/* D13: anzeigen und ignorieren. Die Flags im PDF sind keine
          Zugriffskontrolle - wer das Dokument oeffnen kann, hat den Schluessel,
          und sie wirken nur, solange der Betrachter freiwillig mitspielt. Sie
          zu befolgen naehme dem Nutzer Funktionen an seinen eigenen Dateien,
          ohne dass jemand geschuetzt waere; sie zu verschweigen verschwiege den
          Wunsch des Autors. */}
      {bereit && eingeschraenkteRechte.length > 0 && (
        <p
          data-testid="rechte-hinweis"
          role="status"
          style={{ margin: 0, padding: '0.5rem 0.75rem', background: '#f0f0f0', color: '#444' }}
        >
          {t('meldung.rechte', { rechte: eingeschraenkteRechte.join(', '), app: APP_NAME })}
        </p>
      )}

      {/* S2.3a, Aufgabe 4: pdf-lib kann verschluesselte Dokumente nicht
          entschluesseln. Mit `ignoreEncryption` kaemen unentschluesselte
          Streams heraus und das neu geschriebene Dokument waere beschaedigt.
          Die Schreibpfade sind deshalb gesperrt — und der Grund gehoert
          sichtbar dazu, nicht nur in einen Knopf-Titel. */}
      {bereit && verschluesselt && (
        <p
          data-testid="verschluesselt-hinweis"
          role="status"
          style={{ margin: 0, padding: '0.5rem 0.75rem', background: '#f0f0f0', color: '#444' }}
        >
          {t('meldung.verschluesselt')}
        </p>
      )}

      {bereit && hatText === false && (
        <p
          data-testid="kein-text-hinweis"
          style={{ margin: 0, padding: '0.5rem 0.75rem', background: '#fff6d5' }}
        >
          {t('meldung.keinText')}
        </p>
      )}
    </>
  )
}
