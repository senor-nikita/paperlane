import { useEffect, useRef, useState } from 'react'
import { useBearbeitung } from '../bearbeitung-store'
import { useDokument } from '../dokument-store'
import { useZuschnitt } from '../zuschnitt-store'
import { effektiveDrehung } from './drehung'
import type { Punkt } from './koordinaten'
import {
  flaecheAusRaendern,
  GRIFFE,
  raenderAusZug,
  seitenmass,
  zieheGriff,
  type Griff,
  type Raender,
  type SeitenGeometrie
} from './zuschnitt'

/**
 * Der Rahmen des Werkzeugs "Zuschneiden" auf einer Seite (S6.3, D21).
 *
 * Ganz oben im Stapel von `Seite.tsx` und nur da, solange das Werkzeug
 * gewaehlt ist - sonst existiert die Ebene nicht und nimmt keinem anderen
 * Werkzeug einen Klick weg. Aufziehen auf freier Flaeche, Ziehen an den acht
 * Griffen aendert die Groesse, Ziehen im Inneren verschiebt. Gerechnet wird
 * in Raendern (`zuschnitt.ts`), also in dem, was der Nutzer sieht; in
 * PDF-Koordinaten erst beim Anwenden.
 */

interface ZuschnittebeneProps {
  /** Nullbasierter Seitenindex. */
  index: number
}

/** Kantenlaenge eines Griffs in CSS-Pixeln. */
const GRIFF = 10

/** Erst ab so vielen Pixeln wird aus einem Klick ein aufgezogener Rahmen. */
const ZUG_SCHWELLE = 3

type Ziehen =
  | { art: 'aufziehen'; start: Punkt; startPixel: Punkt; begonnen: boolean }
  | { art: 'griff'; griff: Griff; start: Raender; startPixel: Punkt }

/** Wo ein Griff sitzt, als Anteil von Breite und Hoehe des Rahmens. */
const GRIFF_LAGE: Record<Exclude<Griff, 'innen'>, [number, number]> = {
  linksOben: [0, 0],
  oben: [0.5, 0],
  rechtsOben: [1, 0],
  rechts: [1, 0.5],
  rechtsUnten: [1, 1],
  unten: [0.5, 1],
  linksUnten: [0, 1],
  links: [0, 0.5]
}

const GRIFF_ZEIGER: Record<Exclude<Griff, 'innen'>, string> = {
  linksOben: 'nwse-resize',
  rechtsUnten: 'nwse-resize',
  rechtsOben: 'nesw-resize',
  linksUnten: 'nesw-resize',
  oben: 'ns-resize',
  unten: 'ns-resize',
  links: 'ew-resize',
  rechts: 'ew-resize'
}

export function Zuschnittebene({ index }: ZuschnittebeneProps): React.JSX.Element | null {
  const seite = index + 1
  const werkzeug = useBearbeitung((zustand) => zustand.werkzeug)
  const dokument = useDokument((zustand) => zustand.dokument)
  const zoom = useDokument((zustand) => zustand.zoom)
  const rotation = useDokument((zustand) => zustand.rotation)
  const rahmenSeite = useZuschnitt((zustand) => zustand.seite)
  const raender = useZuschnitt((zustand) => zustand.raender)
  const setze = useZuschnitt((zustand) => zustand.setze)
  const aendere = useZuschnitt((zustand) => zustand.aendere)
  const [geometrie, setGeometrie] = useState<SeitenGeometrie | null>(null)
  const ziehenRef = useRef<Ziehen | null>(null)
  const aktiv = werkzeug === 'zuschneiden'

  useEffect(() => {
    if (!aktiv || dokument === null) {
      setGeometrie(null)
      return undefined
    }
    let abgebrochen = false
    dokument
      .getPage(seite)
      .then((proxy) => {
        if (!abgebrochen && Array.isArray(proxy.view)) {
          setGeometrie({ view: proxy.view, rotate: proxy.rotate })
        }
      })
      .catch((fehler: unknown) => {
        console.error('Seitenmasse fuer den Zuschnitt fehlen:', fehler)
      })
    return () => {
      abgebrochen = true
    }
  }, [aktiv, dokument, seite])

  if (!aktiv || geometrie === null || zoom <= 0) return null
  const mass = seitenmass(geometrie.view, effektiveDrehung(geometrie.rotate, rotation))
  const eigene = rahmenSeite === seite ? raender : null
  const flaeche = eigene === null ? null : flaecheAusRaendern(eigene, mass, zoom)

  /** Zeigerposition in Punkten, Bildschirmrichtung, ab der linken oberen Seitenecke. */
  const inPunkten = (ereignis: React.PointerEvent<HTMLElement>): Punkt => {
    const rechteck = ereignis.currentTarget.getBoundingClientRect()
    return {
      x: (ereignis.clientX - rechteck.left) / zoom,
      y: (ereignis.clientY - rechteck.top) / zoom
    }
  }

  const beiZeigerAb = (ereignis: React.PointerEvent<HTMLDivElement>): void => {
    if (ereignis.button !== 0) return
    ereignis.preventDefault()
    ereignis.currentTarget.setPointerCapture(ereignis.pointerId)
    const startPixel = { x: ereignis.clientX, y: ereignis.clientY }
    const griff = (ereignis.target as HTMLElement).dataset['griff'] as Griff | undefined
    if (griff !== undefined && eigene !== null) {
      ziehenRef.current = { art: 'griff', griff, start: eigene, startPixel }
      return
    }
    ziehenRef.current = {
      art: 'aufziehen',
      start: inPunkten(ereignis),
      startPixel,
      begonnen: false
    }
  }

  const beiZeigerBewegung = (ereignis: React.PointerEvent<HTMLDivElement>): void => {
    const ziehen = ziehenRef.current
    if (ziehen === null) return
    if (ziehen.art === 'griff') {
      const dx = (ereignis.clientX - ziehen.startPixel.x) / zoom
      const dy = (ereignis.clientY - ziehen.startPixel.y) / zoom
      aendere(zieheGriff(ziehen.start, ziehen.griff, dx, dy, mass))
      return
    }
    const weit =
      Math.abs(ereignis.clientX - ziehen.startPixel.x) >= ZUG_SCHWELLE ||
      Math.abs(ereignis.clientY - ziehen.startPixel.y) >= ZUG_SCHWELLE
    if (!ziehen.begonnen && !weit) return
    ziehen.begonnen = true
    setze(seite, mass, raenderAusZug(ziehen.start, inPunkten(ereignis), mass))
  }

  const beiZeigerAuf = (): void => {
    ziehenRef.current = null
  }

  return (
    <div
      data-testid={'zuschnittflaeche-' + String(seite)}
      onPointerDown={beiZeigerAb}
      onPointerMove={beiZeigerBewegung}
      onPointerUp={beiZeigerAuf}
      onPointerCancel={beiZeigerAuf}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: 'crosshair',
        touchAction: 'none',
        pointerEvents: 'auto'
      }}
    >
      {flaeche !== null && (
        <div
          data-testid={'zuschnittrahmen-' + String(seite)}
          data-griff="innen"
          style={{
            position: 'absolute',
            left: String(flaeche.links) + 'px',
            top: String(flaeche.oben) + 'px',
            width: String(flaeche.breite) + 'px',
            height: String(flaeche.hoehe) + 'px',
            border: '1px dashed #2f6feb',
            boxSizing: 'border-box',
            cursor: 'move',
            // Alles ausserhalb abdunkeln: so sieht man vor dem Anwenden, was
            // wegfaellt. Der Schatten reicht ueber jede Seitengroesse hinaus,
            // der Behaelter schneidet ihn an der Seitenkante ab.
            boxShadow: '0 0 0 100000px rgba(0, 0, 0, 0.45)'
          }}
        >
          {GRIFFE.map((griff) => {
            const [x, y] = GRIFF_LAGE[griff]
            return (
              <span
                key={griff}
                data-griff={griff}
                data-testid={'zuschnittgriff-' + griff}
                style={{
                  position: 'absolute',
                  left: 'calc(' + String(x * 100) + '% - ' + String(GRIFF / 2) + 'px)',
                  top: 'calc(' + String(y * 100) + '% - ' + String(GRIFF / 2) + 'px)',
                  width: String(GRIFF) + 'px',
                  height: String(GRIFF) + 'px',
                  background: '#ffffff',
                  border: '1px solid #2f6feb',
                  boxSizing: 'border-box',
                  cursor: GRIFF_ZEIGER[griff]
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
