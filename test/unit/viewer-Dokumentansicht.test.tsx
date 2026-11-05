import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { Dokumentansicht } = await import('../../src/renderer/src/viewer/Dokumentansicht')

const A4 = { breite: 595, hoehe: 842 }

function fakeSeite() {
  return {
    getViewport: vi.fn(({ scale = 1 }: { scale?: number }) => ({
      width: 595 * scale,
      height: 842 * scale
    })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  }
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({})
  ) as unknown as HTMLCanvasElement['getContext']
  useDokument.setState({
    ladeZustand: 'bereit',
    dokument: { getPage: vi.fn(() => Promise.resolve(fakeSeite())) } as never,
    seitenzahl: 200,
    aktuelleSeite: 1,
    zoom: 1,
    rotation: 0,
    passung: 'frei',
    seitenGroessen: Array.from({ length: 200 }, () => A4)
  })
})

describe('Dokumentansicht', () => {
  // Der Kern der Virtualisierung: 200 Seiten, aber nur eine Handvoll im DOM.
  it('haelt nur wenige Seiten im DOM', () => {
    const { container } = render(<Dokumentansicht />)
    expect(container.querySelectorAll('canvas').length).toBeLessThanOrEqual(8)
    expect(container.querySelectorAll('canvas').length).toBeGreaterThan(0)
  })

  it('gibt dem Scrollbereich die volle Hoehe aller Seiten', () => {
    const { getByTestId } = render(<Dokumentansicht />)
    const flaeche = getByTestId('seitenflaeche')
    const hoehe = parseInt(flaeche.style.height, 10)
    // 200 Seiten a 842 Punkt plus Abstaende - deutlich mehr als ein Sichtfenster.
    expect(hoehe).toBeGreaterThan(150000)
  })

  it('zeigt beim Scrollen andere Seiten und fuehrt die Seitenzahl mit', async () => {
    const { getByTestId, container } = render(<Dokumentansicht />)
    expect(container.querySelector('[data-testid="seite-1"]')).not.toBeNull()

    const behaelter = getByTestId('ansicht')
    Object.defineProperty(behaelter, 'scrollTop', { value: 50_000, writable: true })
    fireEvent.scroll(behaelter)

    await waitFor(() => {
      expect(container.querySelector('[data-testid="seite-1"]')).toBeNull()
    })
    expect(useDokument.getState().aktuelleSeite).toBeGreaterThan(50)
    expect(container.querySelectorAll('canvas').length).toBeLessThanOrEqual(8)
  })

  // Strg + Mausrad zoomt stufenlos; ohne Strg bleibt das Rad beim Scrollen.
  describe('Strg + Mausrad', () => {
    it('vergroessert beim Drehen nach oben, stufenlos und ueber die Zoomleiter hinaus', async () => {
      const { getByTestId } = render(<Dokumentansicht />)
      fireEvent.wheel(getByTestId('ansicht'), { ctrlKey: true, deltaY: -100 })
      await waitFor(() => {
        expect(useDokument.getState().zoom).toBeGreaterThan(1)
      })
      const zoom = useDokument.getState().zoom
      // Keine der festen Stufen (1, 1,25, 1,5): stufenlos.
      expect([1, 1.25, 1.5]).not.toContain(zoom)
      expect(zoom).toBeCloseTo(Math.exp(0.15), 5)
      expect(useDokument.getState().passung).toBe('frei')
    })

    it('verkleinert beim Drehen nach unten', async () => {
      const { getByTestId } = render(<Dokumentansicht />)
      fireEvent.wheel(getByTestId('ansicht'), { ctrlKey: true, deltaY: 100 })
      await waitFor(() => {
        expect(useDokument.getState().zoom).toBeLessThan(1)
      })
    })

    it('fasst mehrere Ereignisse eines Bildes zu einem Schritt zusammen', async () => {
      const { getByTestId } = render(<Dokumentansicht />)
      const ansicht = getByTestId('ansicht')
      fireEvent.wheel(ansicht, { ctrlKey: true, deltaY: -50 })
      fireEvent.wheel(ansicht, { ctrlKey: true, deltaY: -50 })
      await waitFor(() => {
        expect(useDokument.getState().zoom).toBeGreaterThan(1)
      })
      expect(useDokument.getState().zoom).toBeCloseTo(Math.exp(0.15), 5)
    })

    it('laesst das Rad ohne Strg in Ruhe', async () => {
      const { getByTestId } = render(<Dokumentansicht />)
      const ereignis = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
      getByTestId('ansicht').dispatchEvent(ereignis)
      await new Promise((aufloesen) => setTimeout(aufloesen, 50))
      expect(useDokument.getState().zoom).toBe(1)
      expect(ereignis.defaultPrevented).toBe(false)
    })

    it('haelt das Ereignis fuer den Browser zurueck, damit nicht die Seite mitzoomt', () => {
      const { getByTestId } = render(<Dokumentansicht />)
      const ereignis = new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -100,
        bubbles: true,
        cancelable: true
      })
      getByTestId('ansicht').dispatchEvent(ereignis)
      expect(ereignis.defaultPrevented).toBe(true)
    })

    it('begrenzt den Zoom nach oben und nach unten', async () => {
      const { getByTestId } = render(<Dokumentansicht />)
      const ansicht = getByTestId('ansicht')
      fireEvent.wheel(ansicht, { ctrlKey: true, deltaY: -5000 })
      await waitFor(() => {
        expect(useDokument.getState().zoom).toBe(8)
      })
      fireEvent.wheel(ansicht, { ctrlKey: true, deltaY: 50000 })
      await waitFor(() => {
        expect(useDokument.getState().zoom).toBe(0.1)
      })
    })
  })

  it('rechnet die Passung Breite aus', async () => {
    useDokument.setState({ passung: 'breite' })
    render(<Dokumentansicht />)
    await waitFor(() => {
      expect(useDokument.getState().zoom).not.toBe(1)
    })
  })

  it('kommt mit einem leeren Dokument zurecht', () => {
    useDokument.setState({ seitenGroessen: [], seitenzahl: 0 })
    const { container } = render(<Dokumentansicht />)
    expect(container.querySelectorAll('canvas').length).toBe(0)
  })
})
