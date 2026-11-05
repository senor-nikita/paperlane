import { TextLayer } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
import { useDokument } from '../dokument-store'
import { flacherTreffer, useSuche } from '../suche-store'
import { effektiveDrehung } from './drehung'
import { baueSeitentext, findeTreffer, zerlegeAufElemente } from './suche'
import './textebene.css'

interface TextebeneProps {
  /** Nullbasierter Seitenindex. */
  index: number
}

interface Markierung {
  links: number
  oben: number
  breite: number
  hoehe: number
  aktiv: boolean
}

/**
 * Groesse und Drehung des Ebenen-Containers.
 *
 * pdf.js legt die Spans in **ungedrehten** Seitenkoordinaten ab — `left` und
 * `top` stehen in Prozent der ungedrehten Seite — und ueberlaesst die Drehung
 * dem Viewer. Der Container bekommt deshalb die ungedrehte Groesse; die
 * Drehung leistet die Regel zu `data-drehung` in `textebene.css`, die den
 * Kasten wieder deckungsgleich auf die gedrehte Seite legt.
 *
 * Warum erst nach dem Konstruktor: `TextLayer` ruft seinerseits
 * `setLayerDimensions` und schreibt Breite und Hoehe selbst — als
 * `round()`-Ausdruck ueber CSS-Variablen der pdf.js-Viewer-CSS, die es hier
 * nicht gibt. Der Ausdruck ist damit ungueltig, und die Ebene fiele auf
 * `auto` zurueck.
 */
function setzeEbenenmasse(
  behaelter: HTMLElement,
  ungedreht: { width: number; height: number },
  rotation: number
): void {
  behaelter.style.width = String(ungedreht.width) + 'px'
  behaelter.style.height = String(ungedreht.height) + 'px'
  behaelter.setAttribute('data-drehung', String(((rotation % 360) + 360) % 360))
}

/**
 * Die auswaehlbare Textebene ueber dem Canvas.
 *
 * Sie traegt zwei Aufgaben: Textauswahl mit der Maus und die Rechtecke der
 * Suchtreffer. Beide brauchen dieselbe Ausrichtung, deshalb liegen sie in
 * einer Ebene.
 */
export function Textebene({ index }: TextebeneProps): React.JSX.Element {
  const dokument = useDokument((zustand) => zustand.dokument)
  const zoom = useDokument((zustand) => zustand.zoom)
  const rotation = useDokument((zustand) => zustand.rotation)
  const ergebnisse = useSuche((zustand) => zustand.ergebnisse)
  const aktuell = useSuche((zustand) => zustand.aktuell)
  const begriff = useSuche((zustand) => zustand.begriff)
  const optionen = useSuche((zustand) => zustand.optionen)

  const behaelterRef = useRef<HTMLDivElement>(null)
  const [fertig, setFertig] = useState(0)
  const [markierungen, setMarkierungen] = useState<Markierung[]>([])

  useEffect(() => {
    const behaelter = behaelterRef.current
    if (dokument === null || behaelter === null) return undefined
    let abgebrochen = false
    let ebene: TextLayer | null = null

    const zeichne = async (): Promise<void> => {
      const seite = await dokument.getPage(index + 1)
      if (abgebrochen) return
      // Seitendrehung plus Ansichtsdrehung: `rotation` ersetzt `/Rotate`.
      const drehung = effektiveDrehung(seite.rotate, rotation)
      const viewport = seite.getViewport({ scale: zoom, rotation: drehung })
      // Dieselbe Seite ohne jede Drehung: das ist die Bezugsgroesse, in der
      // pdf.js die Spans ablegt, und damit die Groesse des Containers.
      const ungedreht = seite.getViewport({ scale: zoom, rotation: 0 })
      const inhalt = await seite.getTextContent()
      if (abgebrochen) return
      behaelter.replaceChildren()
      // pdf.js positioniert die Spans ueber diese Variable.
      behaelter.style.setProperty('--scale-factor', String(zoom))
      ebene = new TextLayer({
        textContentSource: inhalt,
        container: behaelter,
        viewport
      })
      setzeEbenenmasse(behaelter, ungedreht, drehung)
      await ebene.render()
      if (!abgebrochen) setFertig((wert) => wert + 1)
    }

    void zeichne().catch((fehler: unknown) => {
      console.error('Textebene von Seite ' + String(index + 1) + ' fehlgeschlagen:', fehler)
    })

    return () => {
      abgebrochen = true
      ebene?.cancel()
    }
  }, [dokument, index, zoom, rotation])

  /**
   * Trefferrechtecke aus den gerenderten Spans ableiten.
   *
   * Gesucht wird dabei im Text der Spans, nicht in den Elementen aus
   * getTextContent. Die beiden stimmen nicht ueberein: pdf.js fuegt beim
   * Rendern Zeilenumbrueche als eigene Elemente ein und laesst leere Elemente
   * aus, sodass die Indizes auseinanderlaufen. Der DOM ist ohnehin die Wahrheit
   * ueber Positionen — die Zaehlung in der Werkzeugleiste bleibt beim Store.
   */
  useEffect(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null || fertig === 0 || begriff.length === 0) {
      setMarkierungen([])
      return
    }
    const seitentreffer = ergebnisse.find((eintrag) => eintrag.seite === index + 1)
    if (seitentreffer === undefined) {
      setMarkierungen([])
      return
    }

    const spans = [...behaelter.querySelectorAll('span')]
    const elemente = spans.map((span) => ({ str: span.textContent ?? '' }))
    const seitentext = baueSeitentext(elemente)
    const treffer = findeTreffer(seitentext, begriff, optionen)

    // Welcher Treffer auf dieser Seite ist der gewaehlte?
    const aktiverTreffer = flacherTreffer(ergebnisse, aktuell)
    const aktiverIndex =
      aktiverTreffer === null || aktiverTreffer.seite !== index + 1
        ? -1
        : seitentreffer.treffer.findIndex((eintrag) => eintrag.von === aktiverTreffer.treffer.von)

    // Der Container ist gedreht, sein Kasten aber nicht: die Drehung legt ihn
    // deckungsgleich auf die gedrehte Seite. Und `getClientRects()` liefert
    // ohnehin Fensterkoordinaten, also bereits transformierte. Deshalb bleibt
    // diese Differenz auch unter Drehung richtig, ohne dass hier irgendwo die
    // CSS-Matrix invertiert werden muesste.
    const rahmen = behaelter.getBoundingClientRect()
    const gefunden: Markierung[] = []
    treffer.forEach((eintrag, nummer) => {
      for (const bereich of zerlegeAufElemente(seitentext, elemente, eintrag)) {
        const textknoten = spans[bereich.element]?.firstChild
        if (textknoten === null || textknoten === undefined) continue
        const spanne = document.createRange()
        try {
          spanne.setStart(textknoten, bereich.von)
          spanne.setEnd(textknoten, bereich.bis)
        } catch {
          continue
        }
        for (const rechteck of spanne.getClientRects()) {
          gefunden.push({
            links: rechteck.left - rahmen.left,
            oben: rechteck.top - rahmen.top,
            breite: rechteck.width,
            hoehe: rechteck.height,
            aktiv: nummer === aktiverIndex
          })
        }
      }
    })
    setMarkierungen(gefunden)
  }, [ergebnisse, aktuell, index, fertig, begriff, optionen])

  return (
    <>
      <div
        ref={behaelterRef}
        className="textebene"
        data-testid={'textebene-' + String(index + 1)}
      />
      {markierungen.map((markierung, nummer) => (
        <div
          key={nummer}
          className={markierung.aktiv ? 'treffer treffer-aktiv' : 'treffer'}
          data-testid={markierung.aktiv ? 'treffer-aktiv' : 'treffer'}
          style={{
            left: String(markierung.links) + 'px',
            top: String(markierung.oben) + 'px',
            width: String(markierung.breite) + 'px',
            height: String(markierung.hoehe) + 'px'
          }}
        />
      ))}
    </>
  )
}
