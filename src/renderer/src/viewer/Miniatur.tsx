import { useEffect, useRef } from 'react'
import { useDokument } from '../dokument-store'
import { PDFJS_RENDER_HAERTUNG } from '../pdf-haertung'
import { effektiveDrehung } from './drehung'
import type { Drossel } from './drossel'
import type { SeitenPlatz } from './layout'
import type { RenderQueue } from './renderqueue'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/** Klickmodifikatoren fuer die Mehrfachauswahl (S4.1). */
export interface Klickmodifikatoren {
  strg: boolean
  umschalt: boolean
}

interface MiniaturProps {
  platz: SeitenPlatz
  zoom: number
  queue: RenderQueue
  drossel: Drossel
  aktiv: boolean
  /** Teil der Mehrfachauswahl (S4.1). */
  gewaehlt: boolean
  /** Ablageziel waehrend eines Ziehens: davor oder danach einfuegen. */
  ablage: 'davor' | 'danach' | null
  beiKlick: (seite: number, modifikatoren: Klickmodifikatoren) => void
  beiZiehStart: (seite: number) => void
  beiZiehUeber: (seite: number, untereHaelfte: boolean) => void
  beiAblage: (seite: number, untereHaelfte: boolean) => void
  beiZiehEnde: () => void
  /**
   * Linke Kante in CSS-Pixeln (Raster der Seitenuebersicht, S6.2). Ohne sie
   * steht die Miniatur mittig in ihrer Spalte wie in der Seitenleiste.
   */
  links?: number
  /**
   * Nebeneinander statt untereinander (S6.2): "davor" und "danach" meinen
   * dann die linke und rechte Haelfte, die Einfuegemarke steht seitlich.
   */
  waagerecht?: boolean
  /**
   * Vorsatz fuer `id` und Testkennung. Die Seitenleiste bleibt unter der
   * Seitenuebersicht bestehen; gleiche Kennungen gaebe es sonst zweimal.
   */
  kennung?: string
}

/**
 * Eine einzelne Miniatur.
 *
 * Bewusst ohne Textebene: die Miniatur ist ein Bild zum Anspringen, keine
 * zweite Lesefaeche. Eine zweite Textebene ueber demselben Dokument wuerde die
 * Auswahl der Hauptansicht stoeren und die Suche aus S1.4 doppelt bedienen.
 *
 * Sie traegt ihre Seitengroesse auch nicht in den Store nach. Das taete sie
 * korrekt, wuerde aber beim Blaettern durch die Sidebar das Layout der
 * Hauptansicht unter dem Leser verschieben.
 */
export function Miniatur({
  platz,
  zoom,
  queue,
  drossel,
  aktiv,
  gewaehlt,
  ablage,
  beiKlick,
  beiZiehStart,
  beiZiehUeber,
  beiAblage,
  beiZiehEnde,
  links,
  waagerecht = false,
  kennung = 'miniatur'
}: MiniaturProps): React.JSX.Element {
  useT()
  /** Liegt der Zeiger in der hinteren Haelfte - unten, oder rechts im Raster? */
  const hintereHaelfte = (ereignis: React.DragEvent<HTMLElement>): boolean => {
    const rahmen = ereignis.currentTarget.getBoundingClientRect()
    return waagerecht
      ? ereignis.clientX > rahmen.left + rahmen.width / 2
      : ereignis.clientY > rahmen.top + rahmen.height / 2
  }
  const markeDavor = ablage === 'davor' ? '4px solid #e0731d' : undefined
  const markeDanach = ablage === 'danach' ? '4px solid #e0731d' : undefined
  const dokument = useDokument((zustand) => zustand.dokument)
  const rotation = useDokument((zustand) => zustand.rotation)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const index = platz.index
  const seitennummer = index + 1

  useEffect(() => {
    if (dokument === null) return undefined
    let abgebrochen = false

    const zeichne = async (): Promise<void> => {
      // Erst den Platz an der Drossel holen, dann erst pdf.js beschaeftigen.
      await drossel.betritt()
      try {
        if (abgebrochen) return
        const seite = await dokument.getPage(seitennummer)
        if (abgebrochen) return

        const canvas = canvasRef.current
        if (canvas === null) return
        const kontext = canvas.getContext('2d')
        if (kontext === null) return

        // Drehung ausschliesslich ueber getViewport - dieselbe Regel wie in der
        // Hauptansicht (Invariante aus S1.2).
        const geraetePixel = window.devicePixelRatio
        const viewport = seite.getViewport({
          scale: zoom * geraetePixel,
          rotation: effektiveDrehung(seite.rotate, rotation)
        })

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = String(Math.floor(viewport.width / geraetePixel)) + 'px'
        canvas.style.height = String(Math.floor(viewport.height / geraetePixel)) + 'px'

        // Dieselbe Haertung wie in der Hauptansicht: sonst braennte pdf.js die
        // Annotationen in die Miniatur ein, und Invariante 6 gaelte nur fuer
        // die halbe Anwendung.
        const auftrag = seite.render({
          canvas,
          canvasContext: kontext,
          viewport,
          ...PDFJS_RENDER_HAERTUNG
        })
        queue.starte(index, auftrag)
        await auftrag.promise
        queue.fertig(index)
      } finally {
        drossel.verlasse()
      }
    }

    void zeichne().catch((fehler: unknown) => {
      // Ein abgebrochener Auftrag ist der Normalfall beim schnellen Scrollen.
      if (fehler instanceof Error && fehler.name === 'RenderingCancelledException') return
      console.error('Miniatur ' + String(seitennummer) + ' konnte nicht gezeichnet werden:', fehler)
    })

    return () => {
      abgebrochen = true
      queue.brich(index)
    }
  }, [dokument, index, seitennummer, zoom, rotation, queue, drossel])

  return (
    <button
      type="button"
      // Eintrag einer Auswahlliste (S5.2a): `aria-selected` gilt nur innerhalb
      // einer solchen, und `Miniaturen` fuehrt den Fokus ueber
      // `aria-activedescendant` - deshalb hier eine feste Kennung, `role` und
      // die Position. Die Liste ist virtualisiert; ohne `aria-setsize` saehe
      // der Screenreader nur die rund zwoelf Miniaturen im DOM.
      role="option"
      id={kennung + '-option-' + String(seitennummer)}
      tabIndex={-1}
      data-testid={kennung + '-' + String(seitennummer)}
      aria-label={t('seite.nummer', { seite: seitennummer })}
      aria-current={aktiv ? 'page' : undefined}
      aria-selected={gewaehlt}
      aria-posinset={seitennummer}
      aria-setsize={seitenzahl}
      data-gewaehlt={gewaehlt ? 'ja' : undefined}
      data-ablage={ablage ?? undefined}
      draggable
      onClick={(ereignis) => {
        beiKlick(seitennummer, {
          strg: ereignis.ctrlKey || ereignis.metaKey,
          umschalt: ereignis.shiftKey
        })
      }}
      onDragStart={(ereignis) => {
        ereignis.dataTransfer.effectAllowed = 'move'
        // Irgendein Inhalt, sonst startet mancher Browser das Ziehen nicht.
        ereignis.dataTransfer.setData('text/plain', String(seitennummer))
        beiZiehStart(seitennummer)
      }}
      onDragOver={(ereignis) => {
        ereignis.preventDefault()
        ereignis.dataTransfer.dropEffect = 'move'
        beiZiehUeber(seitennummer, hintereHaelfte(ereignis))
      }}
      onDrop={(ereignis) => {
        ereignis.preventDefault()
        // Nicht weiter zum Fenster: dessen Ablage erwartet Dateien und
        // meldete sonst "keine Datei" ueber den Hinweis des Umordnens.
        ereignis.stopPropagation()
        beiAblage(seitennummer, hintereHaelfte(ereignis))
      }}
      onDragEnd={beiZiehEnde}
      style={{
        position: 'absolute',
        top: String(platz.oben) + 'px',
        left: links === undefined ? '50%' : String(links) + 'px',
        transform: links === undefined ? 'translateX(-50%)' : undefined,
        display: 'block',
        padding: 0,
        cursor: 'pointer',
        background: '#ffffff',
        // #1a4fb4 statt #2f6feb: dieselbe Farbe steht unten als 10-px-Text,
        // und dort reicht #2f6feb mit 4,2:1 nicht (S5.2a, Aufgabe 4).
        border: aktiv ? '2px solid #1a4fb4' : '1px solid #c4c4c4',
        boxShadow: gewaehlt
          ? '0 0 0 3px rgba(26,79,180,0.55)'
          : aktiv
            ? '0 0 0 2px rgba(26,79,180,0.25)'
            : '0 1px 3px rgba(0,0,0,0.2)',
        // Die Einfuegemarke beim Ziehen: ein Balken ueber oder unter der Seite.
        borderTop: waagerecht ? undefined : markeDavor,
        borderBottom: waagerecht ? undefined : markeDanach,
        borderLeft: waagerecht ? markeDavor : undefined,
        borderRight: waagerecht ? markeDanach : undefined,
        lineHeight: 0
      }}
    >
      {/* Der Eintrag traegt sein Label ("Seite N"); das Bild darin fuegt dem
          Screenreader nichts hinzu und wuerde nur als leere Grafik gemeldet. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-testid={kennung + '-canvas-' + String(seitennummer)}
      />
      {/* Die Nummer steht im Abstand unter der Miniatur; ohne sie liesse sich
          eine bestimmte Seite in der Sidebar nur raten. */}
      <span
        style={{
          display: 'block',
          fontSize: '10px',
          lineHeight: '14px',
          textAlign: 'center',
          color: aktiv ? '#1a4fb4' : '#555'
        }}
      >
        {seitennummer}
      </span>
    </button>
  )
}
