import { useEffect, useState } from 'react'
import type { ZuletztEintrag } from '../../../shared/ipc'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { useTabs } from '../tabs-store'
import { beginneBilderZuPdf } from './bilderzupdf-logik'
import { useT } from '../sprache'

/**
 * Was anstelle des Dokuments steht: der leere Zustand mit der Liste der
 * zuletzt geoeffneten Dateien, die Ladeanzeige und die Fehlermeldung.
 *
 * Die Liste kommt aus dem Main-Prozess, weil nur der weiss, ob die Dateien
 * noch da sind. Nicht mehr vorhandene bleiben sichtbar und ausgegraut: sie
 * kommentarlos zu verschlucken hiesse, den Nutzer im Unklaren zu lassen, wo
 * sein Dokument geblieben ist (S1.3e).
 */
export function Startseite(): React.JSX.Element {
  const ladeZustand = useDokument((zustand) => zustand.ladeZustand)
  const fehler = useDokument((zustand) => zustand.fehler)
  const pfad = useDokument((zustand) => zustand.pfad)
  const oeffneUeberPfad = useTabs((zustand) => zustand.oeffneUeberPfad)
  const [zuletzt, setZuletzt] = useState<ZuletztEintrag[]>([])
  const bereit = ladeZustand === 'bereit'
  const t = useT()

  useEffect(() => {
    const api = bruecke()
    if (api === undefined || bereit) return
    api
      .zuletztGeoeffnet()
      .then(setZuletzt)
      .catch((error: unknown) => {
        console.error('Zuletzt geoeffnete Dokumente konnten nicht gelesen werden:', error)
      })
  }, [bereit, pfad])

  return (
    <section
      data-testid="ansicht"
      style={{ flex: 1, padding: '1.5rem 2rem', background: 'var(--tisch)', overflow: 'auto' }}
    >
      {ladeZustand === 'leer' && (
        <>
          <p>{t('start.leer')}</p>
          <p>
            <button
              type="button"
              data-testid="startseite-aus-bildern"
              className="knopf"
              onClick={() => void beginneBilderZuPdf()}
            >
              {t('start.ausBildern')}
            </button>
          </p>
          {zuletzt.length > 0 && (
            <section data-testid="zuletzt-liste">
              <h2 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>{t('start.zuletzt')}</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {zuletzt.map((eintrag) => (
                  <li key={eintrag.pfad} style={{ marginBottom: '0.25rem' }}>
                    <button
                      type="button"
                      data-testid={'zuletzt-' + eintrag.name}
                      disabled={!eintrag.existiert}
                      title={
                        eintrag.existiert
                          ? eintrag.pfad
                          : t('start.nichtGefundenTitel', { pfad: eintrag.pfad })
                      }
                      onClick={() => {
                        void oeffneUeberPfad(eintrag.pfad)
                      }}
                      className="knopf"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        cursor: eintrag.existiert ? 'pointer' : 'default',
                        // #6a6a6a statt #999: auch ausgegrauter Text soll
                        // lesbar bleiben - 4,8:1 auf #f2f2f2 (S5.2a, Aufgabe 4).
                        color: eintrag.existiert ? '#1a1a1a' : '#6a6a6a'
                      }}
                    >
                      {eintrag.name}
                      {!eintrag.existiert && t('start.nichtGefunden')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {ladeZustand === 'laedt' && <p>{t('start.laedt')}</p>}
      {ladeZustand === 'fehler' && (
        <p data-testid="fehlermeldung" style={{ color: '#a00' }}>
          {t('start.fehler', { fehler: fehler ?? '' })}
        </p>
      )}
    </section>
  )
}
