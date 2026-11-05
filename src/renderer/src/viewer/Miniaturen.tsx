import { useEffect, useMemo, useRef, useState } from 'react'
import { useDokument } from '../dokument-store'
import { reihenfolgeNachVerschieben } from '../../../shared/mutation'
import { ordneSeitenAn } from '../mutation'
import { useMutation } from '../mutation-store'
import { useSeitenauswahl } from '../seitenauswahl-store'
import { Seitenwerkzeuge } from './Seitenwerkzeuge'
import { Drossel } from './drossel'
import { berechneLayout, sichtbareSeiten } from './layout'
import { Miniatur } from './Miniatur'
import { RenderQueue } from './renderqueue'
import { passendZuBreite } from './zoom'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/** Breite der Sidebar samt Rand und Bildlaufleiste. */
export const SIDEBAR_BREITE = 168
/**
 * Abstand zwischen zwei Miniaturen. Die Seitenzahl (14 px) steht darin, der
 * Rest trennt die Seiten sichtbar voneinander - mit den 16 px der
 * Hauptansicht klebte die Nummer an der naechsten Miniatur.
 */
const MINIATUR_ABSTAND = 36

/** Breite einer Miniatur in CSS-Pixeln. */
export const MINIATUR_BREITE = 120
/** Miniaturen ausserhalb des Sichtfensters, die trotzdem vorgehalten werden. */
const PUFFER = 2
const RAND = 12

/**
 * Wie viele Miniaturen gleichzeitig gezeichnet werden duerfen.
 *
 * Eins. Die Miniaturen teilen sich den pdf.js-Worker mit der Hauptansicht, und
 * die Seite, die der Leser gerade ansieht, hat Vorrang.
 */
const GLEICHZEITIGE_MINIATUREN = 1

/**
 * Die Miniaturen-Sidebar.
 *
 * Eine eigene, kleinere Renderpipeline neben der Hauptansicht: eigenes Layout,
 * eigene Render-Queue, eigene Drossel. Geteilt wird nur das Dokument. Wuerden
 * sich beide eine Queue teilen, brachen die Abbrueche der einen Ansicht die
 * Auftraege der anderen ab.
 */
export function Miniaturen(): React.JSX.Element {
  useT()
  const seitenGroessen = useDokument((zustand) => zustand.seitenGroessen)
  const rotation = useDokument((zustand) => zustand.rotation)
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const springeZuSeite = useDokument((zustand) => zustand.springeZuSeite)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const ausgewaehlt = useSeitenauswahl((zustand) => zustand.ausgewaehlt)
  const waehle = useSeitenauswahl((zustand) => zustand.klick)
  const mutationLaeuft = useMutation((zustand) => zustand.laeuft !== null)

  /**
   * Drag & Drop (S4.1, Aufgabe 1): gezogen wird die Auswahl, wenn die
   * gezogene Seite dazugehoert, sonst nur sie. Abgelegt wird vor oder nach
   * der Zielseite - die untere Haelfte heisst "danach".
   */
  const gezogenRef = useRef<number[] | null>(null)
  const [ablage, setAblage] = useState<{ seite: number; danach: boolean } | null>(null)

  const beiZiehStart = (seite: number): void => {
    gezogenRef.current = ausgewaehlt.has(seite) ? [...ausgewaehlt] : [seite]
  }
  const beiZiehUeber = (seite: number, untereHaelfte: boolean): void => {
    if (gezogenRef.current === null) return
    if (ablage?.seite !== seite || ablage.danach !== untereHaelfte) {
      setAblage({ seite, danach: untereHaelfte })
    }
  }
  const beiZiehEnde = (): void => {
    gezogenRef.current = null
    setAblage(null)
  }
  const beiAblage = (seite: number, untereHaelfte: boolean): void => {
    const bewegte = gezogenRef.current
    beiZiehEnde()
    if (bewegte === null || mutationLaeuft) return
    const vor = untereHaelfte ? seite + 1 : seite
    const reihenfolge = reihenfolgeNachVerschieben(seitenzahl, bewegte, vor)
    if (reihenfolge === null) return
    void ordneSeitenAn(reihenfolge)
  }

  const behaelterRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<RenderQueue | null>(null)
  queueRef.current ??= new RenderQueue()
  const queue = queueRef.current
  const drosselRef = useRef<Drossel | null>(null)
  drosselRef.current ??= new Drossel(GLEICHZEITIGE_MINIATUREN)
  const drossel = drosselRef.current

  const [scrollOben, setScrollOben] = useState(0)
  const [sichtHoehe, setSichtHoehe] = useState(600)

  // Ein Zoom fuer alle Miniaturen, abgeleitet von der ersten Seite. Bei
  // gemischten Seitengroessen fallen einzelne Miniaturen dadurch schmaler aus -
  // genau wie in der Hauptansicht, und ehrlicher als sie zu verzerren.
  const zoom = useMemo(() => {
    const erste = seitenGroessen[0]
    if (erste === undefined) return 0.2
    return passendZuBreite(erste, rotation, MINIATUR_BREITE)
  }, [seitenGroessen, rotation])

  const layout = useMemo(
    () => berechneLayout(seitenGroessen, zoom, rotation, MINIATUR_ABSTAND),
    [seitenGroessen, zoom, rotation]
  )

  useEffect(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null) return undefined
    const beobachter = new ResizeObserver((eintraege) => {
      const rechteck = eintraege[0]?.contentRect
      if (rechteck === undefined) return
      setSichtHoehe(rechteck.height)
    })
    beobachter.observe(behaelter)
    return () => {
      beobachter.disconnect()
    }
  }, [])

  const sichtbar = useMemo(
    () => sichtbareSeiten(layout, scrollOben, sichtHoehe, PUFFER),
    [layout, scrollOben, sichtHoehe]
  )

  // Die aktive Miniatur mitfuehren. Ohne das laeuft die Hauptansicht davon und
  // die Sidebar zeigt weiter den Anfang - dann ist die Markierung wertlos.
  useEffect(() => {
    const behaelter = behaelterRef.current
    const platz = layout.plaetze[aktuelleSeite - 1]
    if (behaelter === null || platz === undefined) return
    const oben = platz.oben
    const unten = oben + platz.hoehe
    const sichtUnten = behaelter.scrollTop + behaelter.clientHeight
    if (oben < behaelter.scrollTop) behaelter.scrollTop = Math.max(0, oben - RAND)
    else if (unten > sichtUnten) behaelter.scrollTop = unten - behaelter.clientHeight + RAND
  }, [aktuelleSeite, layout])

  // Alles ausserhalb des Sichtfensters abbrechen, sonst zeichnet pdf.js
  // Miniaturen fuer laengst weggescrollte Seiten zu Ende.
  useEffect(() => {
    if (sichtbar.von === -1) return
    const behalten = new Set<number>()
    for (let i = sichtbar.von; i <= sichtbar.bis; i++) behalten.add(i)
    queue.brichAlleAusser(behalten)
  }, [sichtbar, queue])

  useEffect(
    () => () => {
      queue.brichAlles()
    },
    [queue]
  )

  const gezeigt = sichtbar.von === -1 ? [] : layout.plaetze.slice(sichtbar.von, sichtbar.bis + 1)

  /**
   * Die Tastenbedienung der Auswahlliste (S5.2a, Aufgabe 1): Pfeile und
   * Pos1/Ende bewegen die aktive Seite, Umschalt erweitert die Auswahl wie
   * der Umschalt-Klick aus S4.1, Leertaste nimmt die aktive Seite dazu oder
   * heraus. Die Liste scrollt der aktiven Seite ohnehin nach - dafuer sorgt
   * derselbe Effekt, der sie auch beim Blaettern in der Hauptansicht fuehrt.
   */
  const beiTaste = (ereignis: React.KeyboardEvent): void => {
    const letzte = layout.plaetze.length
    if (letzte === 0) return
    if (ereignis.key === ' ') {
      ereignis.preventDefault()
      waehle(aktuelleSeite, { strg: true, umschalt: false })
      return
    }
    const ziel =
      ereignis.key === 'ArrowDown'
        ? Math.min(aktuelleSeite + 1, letzte)
        : ereignis.key === 'ArrowUp'
          ? Math.max(aktuelleSeite - 1, 1)
          : ereignis.key === 'Home'
            ? 1
            : ereignis.key === 'End'
              ? letzte
              : null
    if (ziel === null) return
    ereignis.preventDefault()
    springeZuSeite(ziel)
    waehle(ziel, { strg: false, umschalt: ereignis.shiftKey })
  }

  return (
    <>
      <Seitenwerkzeuge />
      <div
        ref={behaelterRef}
        data-testid="miniaturen"
        // Eine Auswahlliste (S5.2a): bis hierher stand `aria-multiselectable`
        // ohne `role="listbox"` da und war damit wirkungslos, und die
        // Miniaturen trugen `aria-selected` ausserhalb einer Liste.
        //
        // Den Fokus fuehrt die Liste selbst ueber `aria-activedescendant`,
        // nicht ueber wandernden `tabIndex`: sie ist virtualisiert, und ein
        // fokussiertes Element verschwindet beim Scrollen aus dem DOM - der
        // Fokus fiele dann auf den Rumpf zurueck. So bleibt er hier, und ein
        // Dokument mit 500 Seiten bleibt eine einzige Station der Tabfolge
        // statt 500.
        role="listbox"
        aria-label={t('miniaturen.titel')}
        aria-multiselectable
        aria-activedescendant={'miniatur-option-' + String(aktuelleSeite)}
        tabIndex={0}
        onKeyDown={beiTaste}
        onScroll={() => {
          setScrollOben(behaelterRef.current?.scrollTop ?? 0)
        }}
        style={{
          // Breite, Hintergrund und Rahmen gehoeren der Sidebar, die diesen
          // Bereich mit der Gliederung teilt (S1.3d).
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
      >
        <div
          style={{
            position: 'relative',
            height: String(layout.gesamthoehe + 2 * RAND) + 'px'
          }}
        >
          <div style={{ position: 'absolute', top: String(RAND) + 'px', left: 0, right: 0 }}>
            {gezeigt.map((platz) => (
              <Miniatur
                key={platz.index}
                platz={platz}
                zoom={zoom}
                queue={queue}
                drossel={drossel}
                aktiv={platz.index + 1 === aktuelleSeite}
                gewaehlt={ausgewaehlt.has(platz.index + 1)}
                ablage={
                  ablage?.seite === platz.index + 1 ? (ablage.danach ? 'danach' : 'davor') : null
                }
                beiKlick={(seite, modifikatoren) => {
                  springeZuSeite(seite)
                  waehle(seite, modifikatoren)
                }}
                beiZiehStart={beiZiehStart}
                beiZiehUeber={beiZiehUeber}
                beiAblage={beiAblage}
                beiZiehEnde={beiZiehEnde}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
