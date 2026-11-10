import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { ANNOTATIONSMODUS_FORMULARE } from '../../src/renderer/src/pdf-haertung'
import {
  unterschriftsflaechen,
  zeichneUnterschriften,
  type Rechenkasten
} from '../../src/renderer/src/viewer/unterschriften'

/**
 * Das Aussehen digitaler Unterschriften. Die Hauptansicht zeichnet mit
 * `annotationMode: DISABLE`, und ein Unterschriftsfeld blieb dadurch leer, auch
 * wenn die Unterschrift in der Datei steht. Hier: welche Felder gemeint sind,
 * wie ihr Rechteck in die Canvas faellt und dass nur dieses Rechteck aus dem
 * zweiten Zeichendurchgang uebernommen wird.
 */

// Ein Blick, bei dem ein PDF-Punkt ein Pixel ist und die y-Achse bei 200
// gespiegelt wird, so wie pdf.js es fuer eine 300 x 200 grosse Seite tut:
// x' = x, y' = 200 - y. `PageViewport` bietet in pdf.js 6 nur noch diese Matrix.
const HOEHE = 200
const kasten: Rechenkasten = {
  width: 300,
  height: HOEHE,
  transform: [1, 0, 0, -1, 0, HOEHE]
}

function feld(abweichung: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subtype: 'Widget',
    fieldType: 'Sig',
    hasAppearance: true,
    hidden: false,
    rect: [50, 100, 150, 150],
    ...abweichung
  }
}

describe('unterschriftsflaechen', () => {
  it('liefert das Rechteck eines Unterschriftsfeldes mit Aussehen in Pixeln', () => {
    expect(unterschriftsflaechen([feld()], kasten)).toEqual([
      { x: 50, y: 50, breite: 100, hoehe: 50 }
    ])
  })

  it('ordnet vertauschte Ecken', () => {
    expect(unterschriftsflaechen([feld({ rect: [150, 150, 50, 100] })], kasten)).toEqual([
      { x: 50, y: 50, breite: 100, hoehe: 50 }
    ])
  })

  it('begrenzt das Rechteck auf die Canvas', () => {
    expect(unterschriftsflaechen([feld({ rect: [-20, 100, 400, 150] })], kasten)).toEqual([
      { x: 0, y: 50, breite: 300, hoehe: 50 }
    ])
  })

  it('rundet nach aussen, damit kein Rand der Unterschrift abgeschnitten wird', () => {
    expect(unterschriftsflaechen([feld({ rect: [50.4, 100.4, 150.6, 150.6] })], kasten)).toEqual([
      { x: 50, y: 49, breite: 101, hoehe: 51 }
    ])
  })

  it.each([
    ['ein anderes Widget', { fieldType: 'Tx' }],
    ['eine andere Annotation', { subtype: 'Highlight' }],
    ['ein Feld ohne Aussehen', { hasAppearance: false }],
    ['ein verstecktes Feld', { hidden: true }],
    ['ein Feld ohne Rechteck', { rect: undefined }],
    ['ein Rechteck mit falscher Laenge', { rect: [1, 2, 3] }],
    ['ein Rechteck mit unbrauchbaren Zahlen', { rect: [1, 2, Number.NaN, 4] }],
    ['ein Rechteck aus Texten', { rect: ['1', '2', '3', '4'] }],
    ['ein Rechteck ohne Flaeche', { rect: [50, 100, 50, 150] }],
    ['ein Rechteck ausserhalb der Seite', { rect: [400, 100, 500, 150] }]
  ])('ignoriert %s', (_name, abweichung) => {
    expect(unterschriftsflaechen([feld(abweichung)], kasten)).toEqual([])
  })

  it('ignoriert Eintraege, die keine Datensaetze sind, und Daten, die keine Liste sind', () => {
    expect(unterschriftsflaechen([null, 7, 'text'], kasten)).toEqual([])
    expect(unterschriftsflaechen(undefined, kasten)).toEqual([])
    expect(unterschriftsflaechen({ rect: [1, 2, 3, 4] }, kasten)).toEqual([])
  })

  // Bei einer um 90 Grad gedrehten Seite (200 breit, 300 hoch) gilt
  // x' = y und y' = x: die Ecken wandern, und aus zwei Ecken allein wuerde ein
  // falsches Rechteck. Das Feld [50 100 150 150] liegt dann bei x 100..150 und
  // y 50..150.
  it('rechnet bei einer gedrehten Seite ueber alle vier Ecken', () => {
    const gedreht: Rechenkasten = { width: 200, height: 300, transform: [0, 1, 1, 0, 0, 0] }
    expect(unterschriftsflaechen([feld()], gedreht)).toEqual([
      { x: 100, y: 50, breite: 50, hoehe: 100 }
    ])
  })

  it('verschiebt um den Versatz der Matrix', () => {
    const versetzt: Rechenkasten = { ...kasten, transform: [2, 0, 0, -2, 10, 400] }
    // x' = 2x + 10, y' = 400 - 2y: Feld [50 100 150 150] -> x 110..310, y 100..200.
    expect(unterschriftsflaechen([feld()], { ...versetzt, width: 400, height: 400 })).toEqual([
      { x: 110, y: 100, breite: 200, hoehe: 100 }
    ])
  })

  it.each([
    ['eine zu kurze Matrix', [1, 0, 0]],
    ['eine Matrix mit unbrauchbaren Zahlen', [1, 0, 0, Number.NaN, 0, 0]]
  ])('verwirft ein Rechteck bei %s', (_name, transform) => {
    expect(unterschriftsflaechen([feld()], { ...kasten, transform })).toEqual([])
  })
})

describe('zeichneUnterschriften', () => {
  const ausschnitt = { art: 'ausschnitt' }

  function blick(klon: () => unknown = () => ausschnitt): PageViewport {
    return {
      width: 300,
      height: HOEHE,
      offsetX: 0,
      offsetY: 0,
      transform: kasten.transform,
      clone: klon
    } as unknown as PageViewport
  }

  function aufbau(
    rohe: unknown,
    renderErgebnis: Promise<void> = Promise.resolve(),
    hilfskontext: unknown = {}
  ) {
    const render = vi.fn(() => ({ promise: renderErgebnis, cancel: vi.fn() }))
    const getAnnotations = vi.fn(() => Promise.resolve(rohe))
    const seite = { getAnnotations, render } as unknown as PDFPageProxy
    const hilfscanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => hilfskontext)
    } as unknown as HTMLCanvasElement
    const erzeugeCanvas = vi.fn(() => hilfscanvas)
    const drawImage = vi.fn()
    const kontext = { drawImage } as unknown as CanvasRenderingContext2D
    return { seite, render, erzeugeCanvas, hilfscanvas, kontext, drawImage }
  }

  it('tut nichts, wenn die Seite kein Unterschriftsfeld mit Aussehen hat', async () => {
    const { seite, render, erzeugeCanvas, kontext, drawImage } = aufbau([feld({ fieldType: 'Tx' })])
    await zeichneUnterschriften(seite, kontext, blick(), { erzeugeCanvas })
    expect(erzeugeCanvas).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('zeichnet die Seite im Modus ENABLE_FORMS und uebernimmt nur das Rechteck des Feldes', async () => {
    const { seite, render, erzeugeCanvas, hilfscanvas, kontext, drawImage } = aufbau([feld()])
    const klon = vi.fn(() => ausschnitt)
    await zeichneUnterschriften(seite, kontext, blick(klon), { erzeugeCanvas })

    // Die Zeichenflaeche deckt nur das Feld ab, nicht die ganze Seite.
    expect(hilfscanvas.width).toBe(100)
    expect(hilfscanvas.height).toBe(50)
    // Derselbe Blick, so verschoben, dass die Ecke des Feldes links oben liegt.
    expect(klon).toHaveBeenCalledWith({ offsetX: -50, offsetY: -50 })
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: hilfscanvas,
        viewport: ausschnitt,
        annotationMode: ANNOTATIONSMODUS_FORMULARE
      })
    )
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalledWith(hilfscanvas, 0, 0, 100, 50, 50, 50, 100, 50)
  })

  it('deckt mehrere Felder mit einer Zeichenflaeche ab und uebernimmt jedes einzeln', async () => {
    const { seite, render, erzeugeCanvas, hilfscanvas, kontext, drawImage } = aufbau([
      feld(),
      feld({ rect: [200, 20, 250, 40] })
    ])
    await zeichneUnterschriften(seite, kontext, blick(), { erzeugeCanvas })

    // Umgrenzung: x 50..250, y 50..180.
    expect(hilfscanvas.width).toBe(200)
    expect(hilfscanvas.height).toBe(130)
    expect(render).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenNthCalledWith(1, hilfscanvas, 0, 0, 100, 50, 50, 50, 100, 50)
    expect(drawImage).toHaveBeenNthCalledWith(2, hilfscanvas, 150, 110, 50, 20, 200, 160, 50, 20)
  })

  it('meldet den Auftrag, damit die Warteschlange ihn abbrechen kann', async () => {
    const { seite, render, erzeugeCanvas, kontext } = aufbau([feld()])
    const merke = vi.fn()
    await zeichneUnterschriften(seite, kontext, blick(), { erzeugeCanvas, merke })
    expect(merke).toHaveBeenCalledTimes(1)
    expect(merke).toHaveBeenCalledWith(render.mock.results[0]?.value)
  })

  it('legt ohne eigene Zeichenflaeche selbst eine an', async () => {
    const { seite, kontext, render } = aufbau([feld()])
    // jsdom hat keine 2D-Flaeche; ohne Kontext bricht die Funktion nach dem
    // Anlegen ab. Es geht nur darum, dass der Standardweg ueber `document` eine
    // Flaeche liefert.
    const anlegen = vi.spyOn(document, 'createElement')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await zeichneUnterschriften(seite, kontext, blick())
    expect(anlegen).toHaveBeenCalledWith('canvas')
    expect(render).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('gibt auf, wenn die Zeichenflaeche keinen Kontext hergibt', async () => {
    const { seite, render, erzeugeCanvas, kontext, drawImage } = aufbau(
      [feld()],
      Promise.resolve(),
      null
    )
    await zeichneUnterschriften(seite, kontext, blick(), { erzeugeCanvas })
    expect(render).not.toHaveBeenCalled()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('reicht einen Fehler beim Zeichnen weiter und uebernimmt nichts', async () => {
    const { seite, erzeugeCanvas, kontext, drawImage } = aufbau(
      [feld()],
      Promise.reject(new Error('kaputt'))
    )
    await expect(zeichneUnterschriften(seite, kontext, blick(), { erzeugeCanvas })).rejects.toThrow(
      'kaputt'
    )
    expect(drawImage).not.toHaveBeenCalled()
  })
})
