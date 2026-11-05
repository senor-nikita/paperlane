import { useEffect, useId, useRef, useState } from 'react'
import { useDokument } from '../dokument-store'
import { Annotationsliste } from './Annotationsliste'
import { Gliederung, type GliederungsKnoten } from './Gliederung'
import { Miniaturen, SIDEBAR_BREITE } from './Miniaturen'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

type Bereich = 'miniaturen' | 'gliederung' | 'anmerkungen'

/**
 * Wandelt die Ausgabe von `getOutline` in unsere Knoten.
 *
 * Bewusst defensiv: das Feld kommt aus einem fremden Dokument. Ein Eintrag
 * ohne Titel wird uebergangen statt als leere Zeile angezeigt.
 */
export function wandleGliederung(roh: unknown): GliederungsKnoten[] {
  if (!Array.isArray(roh)) return []
  const knoten: GliederungsKnoten[] = []
  for (const eintrag of roh) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const teil = eintrag as { title?: unknown; dest?: unknown; items?: unknown }
    const titel = typeof teil.title === 'string' ? teil.title.trim() : ''
    if (titel.length === 0) continue
    knoten.push({ titel, ziel: teil.dest ?? null, kinder: wandleGliederung(teil.items) })
  }
  return knoten
}

const reiter = (aktiv: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '0.3rem 0.2rem',
  border: 'none',
  borderBottom: aktiv ? '2px solid #2f6feb' : '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: aktiv ? 700 : 400
})

/**
 * Die Sidebar mit ihren Bereichen.
 *
 * Die Gliederung wird hier geladen und nicht beim Oeffnen des Dokuments: das
 * Budget "erste Seite unter zwei Sekunden" aus S1.2 soll nicht an einem
 * Inhaltsverzeichnis haengen, das der Leser vielleicht nie aufschlaegt.
 */
export function Sidebar(): React.JSX.Element {
  useT()
  const dokument = useDokument((zustand) => zustand.dokument)
  const [gliederung, setGliederung] = useState<GliederungsKnoten[] | null>(null)
  const [bereich, setBereich] = useState<Bereich>('miniaturen')
  // Eine Kennung je Seitenleiste, damit Reiter und Bereich aufeinander zeigen
  // koennen, ohne dass zwei Instanzen dieselben Kennungen vergaeben.
  const kennung = useId()
  const reiterRefs = useRef<Partial<Record<Bereich, HTMLButtonElement | null>>>({})

  useEffect(() => {
    if (dokument === null) {
      setGliederung(null)
      return undefined
    }
    let abgebrochen = false
    dokument
      .getOutline()
      .then((roh: unknown) => {
        if (abgebrochen) return
        const knoten = wandleGliederung(roh)
        // Kein leerer Bereich: fehlt die Gliederung, gibt es den Reiter nicht.
        setGliederung(knoten.length === 0 ? null : knoten)
      })
      .catch((fehler: unknown) => {
        console.error('Gliederung konnte nicht gelesen werden:', fehler)
        if (!abgebrochen) setGliederung(null)
      })
    return () => {
      abgebrochen = true
    }
  }, [dokument])

  // Ein Dokumentwechsel kann den offenen Bereich unter den Fuessen wegziehen.
  // Betroffen ist nur die Gliederung: die Anmerkungen bleiben, wo sie sind —
  // wer sie offen hatte, will sie auch im naechsten Dokument sehen.
  useEffect(() => {
    if (gliederung !== null) return
    setBereich((vorher) => (vorher === 'gliederung' ? 'miniaturen' : vorher))
  }, [gliederung])

  const zeigeGliederung = gliederung !== null && bereich === 'gliederung'

  // Die Reiterleiste steht seit S2.1 immer: die Anmerkungen gibt es in jedem
  // Dokument, auch wenn die Liste am Ende leer bleibt. Nur der Reiter
  // "Gliederung" bleibt an ihr Vorhandensein gebunden - ein leerer Baum waere
  // eine Zeile, die nichts erklaert.
  const reiterListe: { schluessel: Bereich; beschriftung: string }[] = [
    { schluessel: 'miniaturen', beschriftung: t('sidebar.miniaturen') },
    ...(gliederung !== null
      ? [{ schluessel: 'gliederung' as const, beschriftung: t('sidebar.gliederung') }]
      : []),
    { schluessel: 'anmerkungen', beschriftung: t('sidebar.anmerkungen') }
  ]

  /**
   * Pfeiltasten wechseln den Reiter, Pos1 und Ende springen an die Enden
   * (S5.2a, Aufgabe 1). So verlangt es das Tab-Muster: die Reiterleiste ist
   * **eine** Station in der Tabfolge, innerhalb wird mit den Pfeilen gewaehlt -
   * deshalb traegt nur der aktive Reiter `tabIndex={0}`.
   */
  const beiTaste = (ereignis: React.KeyboardEvent, stelle: number): void => {
    const letzte = reiterListe.length - 1
    const ziel =
      ereignis.key === 'ArrowRight'
        ? stelle === letzte
          ? 0
          : stelle + 1
        : ereignis.key === 'ArrowLeft'
          ? stelle === 0
            ? letzte
            : stelle - 1
          : ereignis.key === 'Home'
            ? 0
            : ereignis.key === 'End'
              ? letzte
              : null
    if (ziel === null) return
    ereignis.preventDefault()
    const gewaehlt = reiterListe[ziel]
    if (gewaehlt === undefined) return
    setBereich(gewaehlt.schluessel)
    reiterRefs.current[gewaehlt.schluessel]?.focus()
  }

  return (
    <aside
      data-testid="sidebar"
      aria-label={t('sidebar.titel')}
      style={{
        width: String(SIDEBAR_BREITE) + 'px',
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--papier)',
        borderRight: '1px solid var(--linie)'
      }}
    >
      <div
        role="tablist"
        aria-label={t('sidebar.bereiche')}
        style={{ display: 'flex', borderBottom: '1px solid var(--linie)', flex: '0 0 auto' }}
      >
        {reiterListe.map((eintrag, stelle) => {
          const aktiv = bereich === eintrag.schluessel
          return (
            <button
              key={eintrag.schluessel}
              type="button"
              role="tab"
              id={kennung + '-reiter-' + eintrag.schluessel}
              data-testid={'reiter-' + eintrag.schluessel}
              aria-selected={aktiv}
              aria-controls={kennung + '-bereich'}
              tabIndex={aktiv ? 0 : -1}
              ref={(element) => {
                reiterRefs.current[eintrag.schluessel] = element
              }}
              style={reiter(aktiv)}
              onClick={() => {
                setBereich(eintrag.schluessel)
              }}
              onKeyDown={(ereignis) => {
                beiTaste(ereignis, stelle)
              }}
            >
              {eintrag.beschriftung}
            </button>
          )
        })}
      </div>

      {/* Ein Bereich zur Zeit, deshalb ein einziges Tabpanel, das sich vom
          jeweils aktiven Reiter benennen laesst. */}
      <div
        role="tabpanel"
        id={kennung + '-bereich'}
        aria-labelledby={kennung + '-reiter-' + bereich}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        {bereich === 'anmerkungen' ? (
          <Annotationsliste />
        ) : zeigeGliederung ? (
          <div data-testid="gliederung" style={{ flex: 1, overflow: 'auto' }}>
            <Gliederung knoten={gliederung} />
          </div>
        ) : (
          <Miniaturen />
        )}
      </div>
    </aside>
  )
}
