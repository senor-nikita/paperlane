import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { merkeLesestelle, useDokument } from '../dokument-store'
import { Seite } from './Seite'
import {
  bestimmeAnker,
  bestimmeZoomAnker,
  berechneLayout,
  SEITENABSTAND,
  scrollFuerAnker,
  scrollNachZoom,
  sichtbareSeiten,
  type Anker,
  type ZoomAnker
} from './layout'
import { RenderQueue } from './renderqueue'
import {
  begrenzeFuerCanvas,
  begrenzeZoom,
  passendZuBreite,
  passendZuSeite,
  radFaktor
} from './zoom'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/** Seiten ausserhalb des Sichtfensters, die trotzdem vorgehalten werden. */
const PUFFER = 2
const RAND = 24

export function Dokumentansicht(): React.JSX.Element {
  useT()
  const seitenGroessen = useDokument((zustand) => zustand.seitenGroessen)
  const zoom = useDokument((zustand) => zustand.zoom)
  const rotation = useDokument((zustand) => zustand.rotation)
  const passung = useDokument((zustand) => zustand.passung)
  const spalten = useDokument((zustand) => zustand.spalten)
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const setzePassung = useDokument((zustand) => zustand.setzePassung)
  const geheZuSeite = useDokument((zustand) => zustand.geheZuSeite)
  const sprungZiel = useDokument((zustand) => zustand.sprungZiel)
  const sprungAnteil = useDokument((zustand) => zustand.sprungAnteil)
  const sprungErledigt = useDokument((zustand) => zustand.sprungErledigt)

  const behaelterRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<RenderQueue | null>(null)
  queueRef.current ??= new RenderQueue()
  const queue = queueRef.current

  const [scrollOben, setScrollOben] = useState(0)
  const [masse, setMasse] = useState({ breite: 800, hoehe: 600 })

  const layout = useMemo(
    () => berechneLayout(seitenGroessen, zoom, rotation, SEITENABSTAND, spalten),
    [seitenGroessen, zoom, rotation, spalten]
  )

  // Der Rad-Zoom liest das Layout ausserhalb des Renderns (im Listener).
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  /** Der Anker eines Rad-Zooms, bis das neue Layout steht (siehe Layout-Effekt unten). */
  const zoomAnkerRef = useRef<{ anker: ZoomAnker; faktor: number; x: number; y: number } | null>(
    null
  )

  // Beim Zoomen und Drehen die Leseposition halten. Ohne Anker springt sie bei
  // jeder Stufe an den Anfang des naechstbesten Platzes.
  const ankerRef = useRef<Anker | null>(null)
  const letzterPassungsWert = useRef('')

  useEffect(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null) return undefined
    const beobachter = new ResizeObserver((eintraege) => {
      const rechteck = eintraege[0]?.contentRect
      if (rechteck === undefined) return
      setMasse({ breite: rechteck.width, hoehe: rechteck.height })
    })
    beobachter.observe(behaelter)
    return () => {
      beobachter.disconnect()
    }
  }, [])

  // Passung neu berechnen, wenn sich Breite, Drehung oder Modus aendern.
  useEffect(() => {
    const erste = seitenGroessen[0]
    if (erste === undefined || passung === 'frei') return
    const verfuegbareBreite = Math.max(100, masse.breite - 2 * RAND)
    const verfuegbareHoehe = Math.max(100, masse.hoehe - 2 * RAND)
    const roh =
      passung === 'breite'
        ? passendZuBreite(erste, rotation, verfuegbareBreite, spalten)
        : passendZuSeite(erste, rotation, verfuegbareBreite, verfuegbareHoehe, spalten)
    const begrenzt = begrenzeFuerCanvas(roh, erste, rotation, window.devicePixelRatio)
    const schluessel = passung + ':' + String(Math.round(begrenzt * 1000))
    if (letzterPassungsWert.current === schluessel) return
    letzterPassungsWert.current = schluessel
    setzePassung(passung, begrenzt)
  }, [seitenGroessen, masse, rotation, passung, spalten, setzePassung])

  // Ein Sprung von aussen: Knopf, Eingabefeld, Tastenkuerzel oder
  // wiederhergestellte Leseposition. Danach wird das Ziel geloescht, sonst
  // liesse sich dieselbe Seite kein zweites Mal anspringen.
  useEffect(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null || sprungZiel === null) return
    const platz = layout.plaetze[sprungZiel - 1]
    if (platz !== undefined) {
      // Ein Ziel aus der Gliederung nennt oft eine Stelle mitten auf der Seite
      // (S1.3d). Ohne Anteil bleibt es beim Seitenanfang.
      const anteil = sprungAnteil ?? 0
      behaelter.scrollTop = platz.oben + anteil * platz.hoehe
      ankerRef.current = { index: platz.index, anteil }
      merkeLesestelle(platz.index + 1, anteil)
    }
    sprungErledigt()
  }, [sprungZiel, sprungAnteil, layout, sprungErledigt])

  /**
   * Strg + Mausrad zoomt stufenlos, und die Stelle unter dem Zeiger bleibt
   * dort (auch beim Touchpad-Spreizen, das als Strg + Rad ankommt).
   *
   * Mehrere Rad-Ereignisse je Bild werden zu einem Zoomschritt gebuendelt:
   * jeder Schritt rechnet das Layout neu und stoesst Zeichenauftraege an.
   * Der Listener haengt nativ und nicht ueber React, weil nur ein nicht
   * passiver Listener `preventDefault` darf - sonst zoomt zusaetzlich die
   * Seite des Browsers.
   */
  useEffect(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null) return undefined
    let faktor = 1
    let zeiger = { x: 0, y: 0 }
    let rahmen: number | null = null
    const wendeAn = (): void => {
      rahmen = null
      const schritt = faktor
      faktor = 1
      const { zoom: alt, setzeZoom } = useDokument.getState()
      const neu = begrenzeZoom(alt * schritt)
      if (neu === alt) return
      const aktuell = layoutRef.current
      const flaechenBreite = Math.max(behaelter.clientWidth, aktuell.maxBreite + 2 * RAND)
      const anker = bestimmeZoomAnker(
        aktuell,
        behaelter.scrollTop,
        behaelter.scrollLeft,
        zeiger.x,
        zeiger.y,
        flaechenBreite,
        RAND
      )
      zoomAnkerRef.current =
        anker === null ? null : { anker, faktor: neu / alt, x: zeiger.x, y: zeiger.y }
      setzeZoom(neu)
    }
    const beiRad = (ereignis: WheelEvent): void => {
      if (!ereignis.ctrlKey) return
      ereignis.preventDefault()
      const rechteck = behaelter.getBoundingClientRect()
      zeiger = { x: ereignis.clientX - rechteck.left, y: ereignis.clientY - rechteck.top }
      faktor *= radFaktor(ereignis.deltaY, ereignis.deltaMode)
      rahmen ??= requestAnimationFrame(wendeAn)
    }
    behaelter.addEventListener('wheel', beiRad, { passive: false })
    return () => {
      behaelter.removeEventListener('wheel', beiRad)
      if (rahmen !== null) cancelAnimationFrame(rahmen)
    }
  }, [])

  // Nach einem Rad-Zoom die Stelle unter dem Zeiger wieder unter den Zeiger
  // legen. Als Layout-Effekt: vor dem Zeichnen und vor dem Anker-Effekt unten.
  useLayoutEffect(() => {
    const behaelter = behaelterRef.current
    const ziel = zoomAnkerRef.current
    if (behaelter === null || ziel === null) return
    zoomAnkerRef.current = null
    const flaechenBreite = Math.max(behaelter.clientWidth, layout.maxBreite + 2 * RAND)
    const position = scrollNachZoom(
      layout,
      ziel.anker,
      ziel.faktor,
      ziel.x,
      ziel.y,
      flaechenBreite,
      RAND
    )
    behaelter.scrollTop = position.oben
    behaelter.scrollLeft = position.links
    // Der Anker unten soll an diese Stelle fuehren und nicht an die alte.
    ankerRef.current = bestimmeAnker(layout, behaelter.scrollTop)
  }, [layout])

  // Nach einem Zoom- oder Drehwechsel den Anker wieder anfahren.
  useEffect(() => {
    const behaelter = behaelterRef.current
    const anker = ankerRef.current
    if (behaelter === null || anker === null) return
    behaelter.scrollTop = scrollFuerAnker(layout, anker)
  }, [layout])

  const beiScroll = useCallback(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null) return
    setScrollOben(behaelter.scrollTop)
    ankerRef.current = bestimmeAnker(layout, behaelter.scrollTop)
    const naechste = (ankerRef.current?.index ?? 0) + 1
    // Fuer den Tabwechsel: die Stelle in der Seite, nicht nur die Seite (S6.1b).
    if (ankerRef.current !== null) merkeLesestelle(naechste, ankerRef.current.anteil)
    if (naechste !== aktuelleSeite) geheZuSeite(naechste)
  }, [layout, aktuelleSeite, geheZuSeite])

  const sichtbar = useMemo(
    () => sichtbareSeiten(layout, scrollOben, masse.hoehe, PUFFER),
    [layout, scrollOben, masse.hoehe]
  )

  // Alles ausserhalb des Sichtfensters abbrechen, sonst arbeitet pdf.js
  // Auftraege fuer laengst weggescrollte Seiten ab.
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

  return (
    <div
      ref={behaelterRef}
      onScroll={beiScroll}
      data-testid="ansicht"
      // Fokussierbar (S5.2a, Aufgabe 1): ein scrollender Behaelter nimmt die
      // Bild- und Pfeiltasten des Browsers nur entgegen, wenn er den Fokus
      // hat. Ohne `tabIndex` liess sich das Dokument mit der Tastatur allein
      // nicht durchblaettern - man kam schlicht nicht hinein.
      tabIndex={0}
      role="region"
      aria-label={t('ansicht.dokument')}
      style={{ flex: 1, overflow: 'auto', background: 'var(--tisch)', position: 'relative' }}
    >
      <div
        data-testid="seitenflaeche"
        style={{
          position: 'relative',
          height: String(layout.gesamthoehe + 2 * RAND) + 'px',
          // Mindestens so breit wie die breiteste Seite samt Rand: die Seiten
          // stehen mittig (`left: 50%` plus `translateX(-50%)`), und bei
          // `100%` ragte eine breitere Seite links ins Negative - dorthin
          // scrollt kein Browser, und die linke Haelfte waere unerreichbar.
          width: 'max(100%, ' + String(Math.ceil(layout.maxBreite) + 2 * RAND) + 'px)'
        }}
      >
        <div style={{ position: 'absolute', top: String(RAND) + 'px', left: 0, right: 0 }}>
          {gezeigt.map((platz) => (
            <Seite key={platz.index} platz={platz} queue={queue} />
          ))}
        </div>
      </div>
    </div>
  )
}
