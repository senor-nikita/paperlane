import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))

/**
 * Die echte TextLayer von pdf.js braucht Layout, das jsdom nicht hat. Die
 * Attrappe erzeugt dieselbe Struktur - ein Span je Textelement -, damit die
 * Ableitung der Trefferrechtecke pruefbar wird.
 */
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
  TextLayer: class {
    private readonly container: HTMLElement
    private readonly quelle: { items: { str: string }[] }
    constructor({
      container,
      textContentSource
    }: {
      container: HTMLElement
      textContentSource: { items: { str: string }[] }
    }) {
      this.container = container
      this.quelle = textContentSource
    }
    render(): Promise<void> {
      for (const eintrag of this.quelle.items) {
        const span = document.createElement('span')
        span.textContent = eintrag.str
        this.container.append(span)
      }
      return Promise.resolve()
    }
    cancel(): void {}
  }
}))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useSuche, leereTextCache } = await import('../../src/renderer/src/suche-store')
const { Textebene } = await import('../../src/renderer/src/viewer/Textebene')

const ITEMS = [{ str: 'Hier Wasser', hasEOL: false }, { str: 'zeichen steht' }]

function stubDokument(): void {
  useDokument.setState({
    pfad: 'C:/a.pdf',
    seitenzahl: 1,
    zoom: 1,
    rotation: 0,
    dokument: {
      numPages: 1,
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 595, height: 842 }),
          getTextContent: () => Promise.resolve({ items: ITEMS })
        })
    } as never
  })
}

beforeEach(() => {
  leereTextCache()
  useSuche.getState().zuruecksetzen()
  stubDokument()
  // jsdom kennt kein Layout; ohne diese Attrappen liefert jeder Bereich 0x0.
  Range.prototype.getClientRects = vi.fn(
    () => [{ left: 10, top: 20, width: 30, height: 12 }] as unknown as DOMRectList
  )
})

describe('Textebene', () => {
  it('gibt den Seitentext zur Auswahl aus', async () => {
    const { getByTestId } = render(<Textebene index={0} />)
    await waitFor(() => {
      expect(getByTestId('textebene-1').querySelectorAll('span')).toHaveLength(2)
    })
    expect(getByTestId('textebene-1').textContent).toContain('Wasser')
  })

  it('zeichnet ohne Treffer keine Markierung', async () => {
    const { getByTestId, queryAllByTestId } = render(<Textebene index={0} />)
    await waitFor(() => {
      expect(getByTestId('textebene-1').querySelectorAll('span')).toHaveLength(2)
    })
    expect(queryAllByTestId('treffer')).toHaveLength(0)
  })

  // Der Treffer laeuft ueber zwei Elemente - genau der Fall, den die Suche
  // erst moeglich macht.
  it('markiert einen Treffer ueber Elementgrenzen hinweg', async () => {
    // Der Begriff muss gesetzt sein: die Ebene rechnet die Rechtecke aus dem
    // DOM-Text neu, weil pdf.js beim Rendern andere Elemente erzeugt als
    // getTextContent liefert.
    useSuche.setState({
      begriff: 'Wasserzeichen',
      ergebnisse: [{ seite: 1, treffer: [{ von: 5, bis: 18 }] }],
      gesamt: 1,
      aktuell: 1
    })
    const { queryAllByTestId } = render(<Textebene index={0} />)
    await waitFor(() => {
      expect(queryAllByTestId('treffer-aktiv').length).toBeGreaterThan(0)
    })
  })

  // Liegt der gewaehlte Treffer auf einer anderen Seite, wird der Treffer hier
  // markiert, aber nicht hervorgehoben.
  it('hebt nur den gewaehlten Treffer hervor', async () => {
    useSuche.setState({
      begriff: 'Wasserzeichen',
      ergebnisse: [
        { seite: 1, treffer: [{ von: 5, bis: 18 }] },
        { seite: 2, treffer: [{ von: 0, bis: 13 }] }
      ],
      gesamt: 2,
      aktuell: 2
    })
    const { queryAllByTestId } = render(<Textebene index={0} />)
    await waitFor(() => {
      expect(queryAllByTestId('treffer').length).toBeGreaterThan(0)
    })
    expect(queryAllByTestId('treffer-aktiv')).toHaveLength(0)
  })
  /**
   * Der Container traegt die *ungedrehte* Seitengroesse und die Drehung als
   * Attribut - pdf.js legt seine Spans in ungedrehten Seitenkoordinaten ab,
   * die Drehung leistet die CSS-Regel dazu. Faellt eines von beiden weg,
   * steht die Textebene wieder waagerecht ueber einer gedrehten Seite.
   */
  it('gibt dem Container die ungedrehte Groesse und die Drehung', async () => {
    useDokument.setState({ rotation: 90 })
    const { getByTestId } = render(<Textebene index={0} />)
    await waitFor(() => {
      expect(getByTestId('textebene-1').querySelectorAll('span')).toHaveLength(2)
    })
    const behaelter = getByTestId('textebene-1')
    expect(behaelter.getAttribute('data-drehung')).toBe('90')
    expect(behaelter.style.width).toBe('595px')
    expect(behaelter.style.height).toBe('842px')
  })

  it('zeigt nichts ohne Dokument', () => {
    useDokument.setState({ dokument: null })
    const { getByTestId } = render(<Textebene index={0} />)
    expect(getByTestId('textebene-1').querySelectorAll('span')).toHaveLength(0)
  })
})
