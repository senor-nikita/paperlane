import { useEffect, useRef, useState } from 'react'
import { useDokument } from '../dokument-store'
import { PDFJS_RENDER_HAERTUNG } from '../pdf-haertung'
import { Annotationsebene } from './Annotationsebene'
import { Bearbeitungsebene } from './Bearbeitungsebene'
import { effektiveDrehung } from './drehung'
import { Formularebene } from './Formularebene'
import type { SeitenPlatz } from './layout'
import type { RenderQueue } from './renderqueue'
import { Textbearbeitungsebene } from './Textbearbeitungsebene'
import { Textebene } from './Textebene'
import { Zuschnittebene } from './Zuschnittebene'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

interface SeiteProps {
  platz: SeitenPlatz
  queue: RenderQueue
}

/**
 * Eine einzelne Seite als Canvas.
 *
 * Wird nur fuer Seiten im Sichtfenster erzeugt. Alles ausserhalb existiert im
 * DOM gar nicht — genau das haelt den Speicher unabhaengig von der Seitenzahl.
 */
export function Seite({ platz, queue }: SeiteProps): React.JSX.Element {
  useT()
  const dokument = useDokument((zustand) => zustand.dokument)
  const zoom = useDokument((zustand) => zustand.zoom)
  const rotation = useDokument((zustand) => zustand.rotation)
  const merkeSeitenGroesse = useDokument((zustand) => zustand.merkeSeitenGroesse)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [kaputt, setzeKaputt] = useState(false)
  const index = platz.index

  useEffect(() => {
    if (dokument === null) return undefined
    let abgebrochen = false
    setzeKaputt(false)

    const zeichne = async (): Promise<void> => {
      const seite = await dokument.getPage(index + 1)
      if (abgebrochen) return

      // Die echte Groesse nachtragen: beim Oeffnen wurde fuer alle Seiten die
      // der ersten angenommen.
      const roh = seite.getViewport({ scale: 1 })
      merkeSeitenGroesse(index, { breite: roh.width, hoehe: roh.height })

      const canvas = canvasRef.current
      if (canvas === null) return
      const kontext = canvas.getContext('2d')
      if (kontext === null) return

      // Drehung ausschliesslich ueber getViewport. Ein CSS-transform waere hier
      // verlockend und bleibt verboten: die Annotationsebene rechnet ihre
      // Koordinaten gegen diesen Kasten, und jede davon muesste dann
      // zusaetzlich die CSS-Matrix invertieren (Risiko R6).
      //
      // Die Textebene ist die eine, begruendete Ausnahme (Aenderungshistorie
      // zum 2026-09-08): pdf.js legt ihre Spans in ungedrehten
      // Seitenkoordinaten ab, und ihr gedrehter Container liegt deckungsgleich
      // auf diesem hier — es wird auch dort keine Matrix invertiert.
      //
      // `rotation` ersetzt die Seitendrehung, statt sie zu ergaenzen - deshalb
      // die Summe aus beiden (`drehung.ts`).
      const geraetePixel = window.devicePixelRatio
      const viewport = seite.getViewport({
        scale: zoom * geraetePixel,
        rotation: effektiveDrehung(seite.rotate, rotation)
      })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = String(Math.floor(viewport.width / geraetePixel)) + 'px'
      canvas.style.height = String(Math.floor(viewport.height / geraetePixel)) + 'px'

      // `PDFJS_RENDER_HAERTUNG` haelt `annotationMode: DISABLE` fest
      // (Invariante 6 ab S2.1): Annotationen zeichnet ausschliesslich die
      // Annotationsebene, sonst laege ueber jeder eine zweite, eingebrannte.
      const auftrag = seite.render({
        canvas,
        canvasContext: kontext,
        viewport,
        ...PDFJS_RENDER_HAERTUNG
      })
      queue.starte(index, auftrag)
      await auftrag.promise
      queue.fertig(index)
    }

    void zeichne().catch((fehler: unknown) => {
      // Ein abgebrochener Auftrag ist kein Fehler, sondern der Normalfall beim
      // schnellen Scrollen.
      if (fehler instanceof Error && fehler.name === 'RenderingCancelledException') return
      console.error('Seite ' + String(index + 1) + ' konnte nicht gezeichnet werden:', fehler)
      // Sichtbar markieren statt leer zu lassen (S1.5, Fall 1): bei einem
      // beschaedigten Dokument bleiben die lesbaren Seiten lesbar, und der
      // Leser sieht, welche fehlen.
      if (!abgebrochen) setzeKaputt(true)
    })

    return () => {
      abgebrochen = true
      queue.brich(index)
    }
  }, [dokument, index, zoom, rotation, queue, merkeSeitenGroesse])

  return (
    <div
      data-testid={'seite-' + String(index + 1)}
      style={{
        position: 'absolute',
        top: String(platz.oben) + 'px',
        // Bei zwei Spalten steht die Seite links oder rechts der Mitte.
        left: 'calc(50% + ' + String(platz.mitte ?? 0) + 'px)',
        transform: 'translateX(-50%)',
        width: String(platz.breite) + 'px',
        height: String(platz.hoehe) + 'px',
        background: '#ffffff',
        // Papier auf dem Tisch: kurzer Kantenschatten und ein weicher
        // Schlagschatten statt eines grauen Hofs.
        boxShadow: 'var(--schatten-seite)'
      }}
    >
      {/* Das gezeichnete Bild der Seite (S5.2a, Aufgabe 4). Den Text liefert
          die Textebene daneben als echte DOM-Spans; das Bild bekommt nur
          Rolle und Namen, damit eine gescannte Seite ohne Text nicht als
          namenlose Grafik gemeldet wird. */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('seite.nummer', { seite: index + 1 })}
        data-testid={'seiten-canvas-' + String(index + 1)}
      />
      {kaputt && (
        <p
          data-testid={'seite-kaputt-' + String(index + 1)}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: 0,
            padding: '1rem',
            textAlign: 'center',
            color: '#a00',
            background: '#fff3f3'
          }}
        >
          Seite {index + 1} ist beschaedigt und laesst sich nicht anzeigen.
        </p>
      )}
      <Textebene index={index} />
      {/* Ueber der Textebene, wie im Plan vorgesehen: ein Verweis soll
          anklickbar sein, und ein Suchtreffer darunter bleibt sichtbar. Die
          Ebene laesst Zeigereignisse durch, damit die Textauswahl aus S1.4
          nicht unter jeder Markierung endet. */}
      <Annotationsebene index={index} />
      {/* Formularfelder (S3.1) ueber den Anmerkungen und unter der
          Bearbeitungsebene: die Felder brauchen Zeigereignisse, aber ein
          Zeichenwerkzeug soll auch ueber einem Feld zeichnen duerfen. */}
      <Formularebene index={index} />
      {/* Ganz oben, weil sie Zeigereignisse annehmen muss. Sie tut es nur
          dort, wo das gewaehlte Werkzeug es verlangt (S2.2). */}
      <Bearbeitungsebene index={index} />
      {/* Nur mit dem Werkzeug "Zuschneiden" vorhanden (S6.3). */}
      <Zuschnittebene index={index} />
      {/* Nur mit dem Werkzeug "Text bearbeiten" vorhanden (S6.6b). */}
      <Textbearbeitungsebene index={index} />
    </div>
  )
}
