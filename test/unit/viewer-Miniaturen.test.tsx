import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))
const mutation = vi.hoisted(() => ({
  ordneSeitenAn: vi.fn<(reihenfolge: readonly number[]) => Promise<boolean>>(() =>
    Promise.resolve(true)
  ),
  loescheSeiten: vi.fn<(seiten: readonly number[]) => Promise<boolean>>(() =>
    Promise.resolve(true)
  ),
  dreheSeiten: vi.fn<(seiten: readonly number[], grad: number) => Promise<boolean>>(() =>
    Promise.resolve(true)
  )
}))
vi.mock('../../src/renderer/src/mutation', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/mutation')>()),
  ordneSeitenAn: mutation.ordneSeitenAn,
  loescheSeiten: mutation.loescheSeiten,
  dreheSeiten: mutation.dreheSeiten
}))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useSeitenauswahl } = await import('../../src/renderer/src/seitenauswahl-store')
const { Miniaturen, MINIATUR_BREITE } = await import('../../src/renderer/src/viewer/Miniaturen')

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
  mutation.ordneSeitenAn.mockClear()
  mutation.loescheSeiten.mockClear()
  mutation.dreheSeiten.mockClear()
  useSeitenauswahl.getState().leere()
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({})
  ) as unknown as HTMLCanvasElement['getContext']
  useDokument.setState({
    ladeZustand: 'bereit',
    dokument: { getPage: vi.fn(() => Promise.resolve(fakeSeite())) } as never,
    seitenzahl: 200,
    aktuelleSeite: 1,
    sprungZiel: null,
    zoom: 1,
    rotation: 0,
    passung: 'frei',
    sidebarSichtbar: true,
    seitenGroessen: Array.from({ length: 200 }, () => A4)
  })
})

describe('Miniaturen', () => {
  // Dieselbe Regel wie in der Hauptansicht: 200 Seiten, aber nur eine Handvoll
  // Miniaturen im DOM. Ohne das kostet eine Sidebar mehr als die Ansicht.
  it('haelt nur wenige Miniaturen im DOM', () => {
    const { container } = render(<Miniaturen />)
    const anzahl = container.querySelectorAll('canvas').length
    expect(anzahl).toBeGreaterThan(0)
    expect(anzahl).toBeLessThanOrEqual(10)
  })

  it('gibt dem Scrollbereich die Hoehe aller Miniaturen', () => {
    const { getByTestId } = render(<Miniaturen />)
    const hoehe = parseInt(
      (getByTestId('miniaturen').firstElementChild as HTMLElement).style.height,
      10
    )
    // 200 Miniaturen sind deutlich hoeher als ein Sichtfenster, aber viel
    // niedriger als die Seiten in voller Groesse.
    expect(hoehe).toBeGreaterThan(5000)
    expect(hoehe).toBeLessThan(150000)
  })

  it('markiert die aktuelle Seite', () => {
    const { getByTestId } = render(<Miniaturen />)
    expect(getByTestId('miniatur-1').getAttribute('aria-current')).toBe('page')
    expect(getByTestId('miniatur-2').getAttribute('aria-current')).toBeNull()
  })

  // Exit-Kriterium des Schritts: der Klick landet auf der richtigen Seite.
  it('springt beim Klick auf die angeklickte Seite', () => {
    const { getByTestId } = render(<Miniaturen />)
    fireEvent.click(getByTestId('miniatur-3'))
    expect(useDokument.getState().aktuelleSeite).toBe(3)
    expect(useDokument.getState().sprungZiel).toBe(3)
  })

  /**
   * S4.1, Aufgabe 1: Mehrfachauswahl wie im Dateimanager, Seitenwerkzeuge
   * darueber, Neuanordnen per Ziehen.
   */
  it('waehlt mit Klick, Strg+Klick und Umschalt+Klick', () => {
    const { getByTestId } = render(<Miniaturen />)
    fireEvent.click(getByTestId('miniatur-2'))
    expect([...useSeitenauswahl.getState().ausgewaehlt]).toEqual([2])
    expect(getByTestId('miniatur-2').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(getByTestId('miniatur-4'), { ctrlKey: true })
    expect([...useSeitenauswahl.getState().ausgewaehlt].sort()).toEqual([2, 4])
    fireEvent.click(getByTestId('miniatur-4'), { ctrlKey: true })
    expect([...useSeitenauswahl.getState().ausgewaehlt]).toEqual([2])
    fireEvent.click(getByTestId('miniatur-5'), { shiftKey: true })
    // Der Anker wandert mit Strg+Klick (zuletzt Seite 4): Umschalt+Klick waehlt 4..5.
    expect([...useSeitenauswahl.getState().ausgewaehlt].sort()).toEqual([4, 5])
    expect(getByTestId('seitenwerkzeuge-stand').textContent).toBe('2 gewählt')
    fireEvent.click(getByTestId('seitenauswahl-aufheben'))
    expect(useSeitenauswahl.getState().ausgewaehlt.size).toBe(0)
    expect(getByTestId('seitenwerkzeuge-stand').textContent).toBe('aktuelle Seite')
  })

  it('wendet die Seitenwerkzeuge auf die Auswahl an, sonst auf die aktuelle Seite', () => {
    const { getByTestId } = render(<Miniaturen />)
    fireEvent.click(getByTestId('seiten-drehen-rechts'))
    expect(mutation.dreheSeiten).toHaveBeenLastCalledWith([1], 90)
    fireEvent.click(getByTestId('miniatur-3'))
    fireEvent.click(getByTestId('miniatur-5'), { ctrlKey: true })
    fireEvent.click(getByTestId('seiten-drehen-links'))
    expect(mutation.dreheSeiten).toHaveBeenLastCalledWith([3, 5], 270)
    fireEvent.click(getByTestId('seiten-loeschen'))
    expect(mutation.loescheSeiten).toHaveBeenLastCalledWith([3, 5])
  })

  it('ordnet per Ziehen neu an - die Auswahl gemeinsam, vor oder nach dem Ziel', () => {
    const { getByTestId } = render(<Miniaturen />)
    const daten = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    // Seite 4 auf die obere Haelfte von Seite 2 ziehen: davor.
    fireEvent.dragStart(getByTestId('miniatur-4'), { dataTransfer: daten })
    fireEvent.dragOver(getByTestId('miniatur-2'), { dataTransfer: daten, clientY: 0 })
    expect(getByTestId('miniatur-2').getAttribute('data-ablage')).toBe('davor')
    fireEvent.drop(getByTestId('miniatur-2'), { dataTransfer: daten, clientY: 0 })
    const reihenfolge = mutation.ordneSeitenAn.mock.calls[0]?.[0]
    expect(reihenfolge?.slice(0, 5)).toEqual([1, 4, 2, 3, 5])
    expect(reihenfolge).toHaveLength(200)

    // Ohne Aenderung keine Mutation: Seite 2 vor Seite 2.
    mutation.ordneSeitenAn.mockClear()
    fireEvent.dragStart(getByTestId('miniatur-2'), { dataTransfer: daten })
    fireEvent.drop(getByTestId('miniatur-2'), { dataTransfer: daten, clientY: 0 })
    expect(mutation.ordneSeitenAn).not.toHaveBeenCalled()
  })

  // Eigene, kleinere Aufloesung ist die erste Aufgabe des Schritts: der Zoom
  // leitet sich aus der Miniaturbreite ab (120 von 595 Punkt), nicht aus dem
  // Zoom der Hauptansicht.
  it('zeichnet die Miniaturen in eigener, kleiner Aufloesung', async () => {
    useDokument.setState({ zoom: 4 })
    const { getByTestId } = render(<Miniaturen />)
    const canvas = getByTestId('miniatur-canvas-1')
    await waitFor(() => {
      expect(canvas.style.width).toBe(String(MINIATUR_BREITE) + 'px')
    })
  })
})
