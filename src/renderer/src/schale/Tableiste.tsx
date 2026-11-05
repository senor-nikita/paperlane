import { useEffect, useRef, useState } from 'react'
import { useGeaendertJeTab, useTabs } from '../tabs-store'
import { tastenFuer } from '../../../shared/tastatur'
import { useT } from '../sprache'

/**
 * Die Tab-Leiste (S6.1b): je offenem Dokument ein Reiter mit Namen,
 * Aenderungsstern und Schliessen-Knopf.
 *
 * **Tastatur nach dem WAI-ARIA-Muster "Tabs" mit manueller Aktivierung:**
 * Pfeil links/rechts und Pos1/Ende bewegen nur den Fokus innerhalb der
 * Leiste, Enter oder Leertaste aktivieren. Automatisch zu aktivieren hiesse
 * hier, bei jedem Pfeildruck den ganzen Stand eines Dokuments aus- und
 * einzuspielen - und ein gesperrter Wechsel (`sperrgrund`) wuerde den Fokus
 * mitten in der Bewegung festhalten. Nur ein Reiter steht in der Tabfolge
 * (roving tabIndex); sonst muesste man sich durch alle Reiter tabben, um
 * zum Dokument zu kommen.
 *
 * **Warum die Schliessen-Knoepfe nicht in der `tablist` stehen:** eine
 * `tablist` darf nur `tab`-Kinder haben (axe: aria-required-children), und
 * ein Knopf im `tab` waere ein verschachteltes Bedienelement, das
 * Screenreader verschlucken (nested-interactive). Die `tablist` ist deshalb
 * `display: contents` - ihre Reiter werden Flex-Kinder der aeusseren Leiste,
 * und `order` stellt jeden Schliessen-Knopf sichtbar hinter seinen Reiter.
 * Die Knoepfe stehen nicht in der Tabfolge (sie kaemen alle hinter allen
 * Reitern, also weit weg von ihrem Tab); die Tastatur schliesst mit Strg+W.
 */

/** Blau wie Fokusring und Ablagerahmen: 7,4:1 auf Weiss (S5.2a). */
const AKZENT = '#1a4fb4'

/** Ein Reiter wird nicht breiter; laengere Namen enden mit "...", der volle steht im `title`. */
const MAX_BREITE = '14rem'

export function Tableiste(): React.JSX.Element | null {
  const tabs = useTabs((zustand) => zustand.tabs)
  const aktiv = useTabs((zustand) => zustand.aktiv)
  const wechsle = useTabs((zustand) => zustand.wechsle)
  const schliesse = useTabs((zustand) => zustand.schliesse)
  const geaendert = useGeaendertJeTab()
  const t = useT()

  /** Der Reiter, der den Fokus traegt - nicht zwingend der aktive (manuelle Aktivierung). */
  const [fokusId, setFokusId] = useState<string | null>(null)
  const reiterRefs = useRef(new Map<string, HTMLButtonElement>())

  // Nach jedem Wechsel gehoert der Tabstopp wieder dem aktiven Reiter, und
  // der wird sichtbar gescrollt - bei vielen Tabs laege er sonst ausserhalb
  // der Leiste, und man saehe nicht, wo man ist.
  useEffect(() => {
    setFokusId(null)
    if (aktiv === null) return
    // jsdom kennt `scrollIntoView` nicht; im Fenster gibt es sie immer.
    reiterRefs.current.get(aktiv)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [aktiv])

  if (tabs.length === 0) return null

  const traegerId =
    fokusId !== null && tabs.some((tab) => tab.id === fokusId) ? fokusId : (aktiv ?? tabs[0]?.id)

  const fokussiere = (index: number): void => {
    const ziel = tabs[index]
    if (ziel === undefined) return
    setFokusId(ziel.id)
    const knopf = reiterRefs.current.get(ziel.id)
    knopf?.focus()
    knopf?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  const schliesseTab = (id: string): void => {
    schliesse(id).catch((error: unknown) => {
      console.error('Tab konnte nicht geschlossen werden:', error)
    })
  }

  const beiTaste = (ereignis: React.KeyboardEvent, index: number): void => {
    let ziel: number | null = null
    if (ereignis.key === 'ArrowRight') ziel = (index + 1) % tabs.length
    else if (ereignis.key === 'ArrowLeft') ziel = (index - 1 + tabs.length) % tabs.length
    else if (ereignis.key === 'Home') ziel = 0
    else if (ereignis.key === 'End') ziel = tabs.length - 1
    if (ziel === null) return
    // Pos1 und Ende sind im Fenster auch Kuerzel (Anfang/Ende des
    // Dokuments). In der Leiste gehoeren sie der Leiste.
    ereignis.preventDefault()
    ereignis.stopPropagation()
    fokussiere(ziel)
  }

  return (
    <div
      data-testid="tableiste"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        overflowY: 'hidden',
        // Kein Umbruch: viele Tabs scrollen seitlich, statt die Leiste
        // mehrzeilig und das Dokument kleiner zu machen.
        flexWrap: 'nowrap',
        flexShrink: 0,
        borderBottom: '1px solid var(--linie)',
        background: 'var(--papier)'
      }}
    >
      <div role="tablist" aria-label={t('tabs.titel')} style={{ display: 'contents' }}>
        {tabs.map((tab, index) => {
          const istAktiv = tab.id === aktiv
          const nummer = index + 1
          return (
            <button
              key={tab.id}
              ref={(knopf) => {
                if (knopf === null) reiterRefs.current.delete(tab.id)
                else reiterRefs.current.set(tab.id, knopf)
              }}
              type="button"
              role="tab"
              id={'reiter-' + tab.id}
              aria-selected={istAktiv}
              aria-controls="dokumentbereich"
              tabIndex={tab.id === traegerId ? 0 : -1}
              data-testid={'tab-' + String(nummer)}
              title={tab.name}
              onClick={() => {
                setFokusId(tab.id)
                wechsle(tab.id)
              }}
              onFocus={() => setFokusId(tab.id)}
              onKeyDown={(ereignis) => beiTaste(ereignis, index)}
              // Mittelklick schliesst, wie im Browser. `onMouseDown` verhindert
              // das Autoscrollen, das die mittlere Taste sonst startet.
              onMouseDown={(ereignis) => {
                if (ereignis.button === 1) ereignis.preventDefault()
              }}
              onAuxClick={(ereignis) => {
                if (ereignis.button !== 1) return
                ereignis.preventDefault()
                schliesseTab(tab.id)
              }}
              style={{
                order: 2 * index,
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                maxWidth: MAX_BREITE,
                flexShrink: 0,
                padding: '0.35rem 0.4rem 0.35rem 0.7rem',
                border: 'none',
                // Der aktive Reiter traegt eine Unterkante in der Akzentfarbe
                // und liegt auf Weiss wie das Dokument; die Farbe allein waere
                // zu wenig (WCAG 1.4.1), deshalb zusaetzlich fett.
                borderBottom: '3px solid ' + (istAktiv ? AKZENT : 'transparent'),
                background: istAktiv ? 'var(--flaeche)' : 'transparent',
                color: 'var(--tinte)',
                borderRadius: '8px 8px 0 0',
                fontWeight: istAktiv ? 700 : 400,
                fontSize: '0.9em',
                cursor: 'pointer',
                outlineOffset: '-3px'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tab.name}
              </span>
              {geaendert[tab.id] === true && (
                <>
                  {/* Sichtbar der Stern wie in der Kopfleiste; angesagt wird
                      ein Wort, denn "Stern" sagt einem Screenreader nichts. */}
                  <span
                    data-testid={'tab-geaendert-' + String(nummer)}
                    aria-hidden="true"
                    style={{ color: '#a05000', fontWeight: 700 }}
                  >
                    *
                  </span>
                  <span className="nur-fuer-screenreader">{t('tabs.ungespeichert')}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          aria-label={t('tabs.schliessen', { name: tab.name })}
          title={t('tabs.schliessenTitel', { name: tab.name, tasten: tastenFuer('tabSchliessen') })}
          data-testid={'tab-schliessen-' + String(index + 1)}
          tabIndex={-1}
          onClick={() => schliesseTab(tab.id)}
          style={{
            order: 2 * index + 1,
            flexShrink: 0,
            padding: '0 0.5rem 0 0.2rem',
            border: 'none',
            // Flaeche und Unterkante wie der Reiter davor: Knopf und Reiter
            // sollen als ein Tab erscheinen, obwohl sie im DOM getrennt sind.
            borderBottom: '3px solid ' + (tab.id === aktiv ? AKZENT : 'transparent'),
            background: tab.id === aktiv ? '#ffffff' : 'transparent',
            // #555 auf #f0f0f0: 6,4:1, auf Weiss 7,5:1 - ueber den 4,5:1 fuer Text.
            color: '#555555',
            fontSize: '1.1em',
            outlineOffset: '-3px',
            cursor: 'pointer'
          }}
        >
          {'×'}
        </button>
      ))}
    </div>
  )
}
