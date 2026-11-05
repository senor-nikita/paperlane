import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BilderWahlErgebnis, BildPdfErgebnis, Bildquelle } from '../../src/shared/ipc'

/**
 * Das Feld "Aus Bildern erstellen" (S6.4): Liste, Reihenfolge, Optionen und
 * die beiden Ausloeser (Hinzufuegen, Erstellen). Die Normalisierung selbst hat
 * ihren eigenen Test (`bilderzupdf-logik.test.ts`); hier zaehlt, was das
 * Feld anzeigt und ausloest.
 */

vi.mock('../../src/renderer/src/tabs-store', () => ({
  useTabs: { getState: () => ({ oeffneUeberPfad: vi.fn().mockResolvedValue(null) }) }
}))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { BilderZuPdf } = await import('../../src/renderer/src/schale/BilderZuPdf')
const { useBilderZuPdf } = await import('../../src/renderer/src/schale/bilderzupdf-logik')

const bilderWaehlen = vi.fn<(pfade: string[] | null) => Promise<BilderWahlErgebnis>>()
const bilderZuPdf = vi.fn<(a: unknown) => Promise<BildPdfErgebnis>>()

function quelle(name: string): Bildquelle {
  return { name, format: 'png', bytes: new Uint8Array([1]) }
}

const istGesperrt = (id: string): boolean => screen.getByTestId(id).hasAttribute('disabled')

beforeEach(() => {
  bilderWaehlen.mockReset()
  bilderZuPdf.mockReset().mockResolvedValue({ art: 'abgebrochen' })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { bilderWaehlen, bilderZuPdf }
  })
  useBilderZuPdf.setState({
    offen: false,
    eintraege: [],
    seitengroesse: 'bild',
    ausrichtung: 'auto',
    randMm: 10,
    laeuft: false
  })
  useDokument.setState({ hinweis: null })
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width: 10, height: 5, close: vi.fn() }))
  )
  const zeichenkontext = vi.fn((): unknown => ({ drawImage: vi.fn() }))
  HTMLCanvasElement.prototype.getContext =
    zeichenkontext as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,AAEC')
})

describe('BilderZuPdf', () => {
  it('zeigt nichts, solange das Feld geschlossen ist', () => {
    render(<BilderZuPdf />)
    expect(screen.queryByTestId('bilder-zu-pdf')).toBeNull()
  })

  it('zeigt den leeren Zustand, solange keine Bilder gewaehlt sind', () => {
    act(() => {
      useBilderZuPdf.getState().oeffne()
    })
    render(<BilderZuPdf />)
    expect(screen.getByTestId('bilder-zu-pdf')).not.toBeNull()
    expect(screen.getByTestId('bilder-zu-pdf-leer')).not.toBeNull()
    expect(istGesperrt('bilder-zu-pdf-ausfuehren')).toBe(true)
  })

  it('listet Bilder, erlaubt Umsortieren und Entfernen, sperrt Erstellen bis normalisiert', async () => {
    bilderWaehlen.mockResolvedValue({
      art: 'gewaehlt',
      bilder: [quelle('a.png'), quelle('b.png')],
      abgelehnt: []
    })
    act(() => {
      useBilderZuPdf.getState().oeffne()
    })
    render(<BilderZuPdf />)

    fireEvent.click(screen.getByTestId('bilder-zu-pdf-hinzufuegen'))

    await waitFor(() => {
      expect(screen.getByTestId('bilder-zu-pdf-eintrag-1').textContent).toContain('a.png')
    })
    await waitFor(() => {
      expect(screen.getByTestId('bilder-zu-pdf-eintrag-1').textContent).toContain('bereit')
    })
    expect(screen.getByTestId('bilder-zu-pdf-eintrag-2').textContent).toContain('b.png')

    // Nach oben/unten tauscht die Reihenfolge.
    fireEvent.click(screen.getByTestId('bilder-zu-pdf-runter-1'))
    expect(screen.getByTestId('bilder-zu-pdf-eintrag-1').textContent).toContain('b.png')

    fireEvent.click(screen.getByTestId('bilder-zu-pdf-entfernen-1'))
    expect(screen.queryByTestId('bilder-zu-pdf-eintrag-2')).toBeNull()
    expect(screen.getByTestId('bilder-zu-pdf-eintrag-1').textContent).toContain('a.png')

    expect(istGesperrt('bilder-zu-pdf-ausfuehren')).toBe(false)
  })

  it('Seitengroesse "wie das Bild" sperrt Ausrichtung und Rand; A4 gibt sie frei', () => {
    act(() => {
      useBilderZuPdf.getState().oeffne()
    })
    render(<BilderZuPdf />)
    expect(istGesperrt('bilder-zu-pdf-ausrichtung')).toBe(true)
    expect(istGesperrt('bilder-zu-pdf-rand')).toBe(true)

    fireEvent.change(screen.getByTestId('bilder-zu-pdf-seitengroesse'), {
      target: { value: 'a4' }
    })
    expect(useBilderZuPdf.getState().seitengroesse).toBe('a4')
    expect(istGesperrt('bilder-zu-pdf-ausrichtung')).toBe(false)

    fireEvent.change(screen.getByTestId('bilder-zu-pdf-ausrichtung'), {
      target: { value: 'quer' }
    })
    expect(useBilderZuPdf.getState().ausrichtung).toBe('quer')

    fireEvent.change(screen.getByTestId('bilder-zu-pdf-rand'), { target: { value: '25' } })
    expect(useBilderZuPdf.getState().randMm).toBe(25)
  })

  it('ein negativer oder ungueltiger Rand wird ignoriert', () => {
    act(() => {
      useBilderZuPdf.getState().oeffne()
      useBilderZuPdf.getState().setzeSeitengroesse('a4')
    })
    render(<BilderZuPdf />)
    fireEvent.change(screen.getByTestId('bilder-zu-pdf-rand'), { target: { value: '-5' } })
    expect(useBilderZuPdf.getState().randMm).toBe(10)
  })

  it('Abbrechen schliesst das Feld', () => {
    act(() => {
      useBilderZuPdf.getState().oeffne()
    })
    render(<BilderZuPdf />)
    fireEvent.click(screen.getByTestId('bilder-zu-pdf-abbrechen'))
    expect(useBilderZuPdf.getState().offen).toBe(false)
  })

  it('Erstellen ruft den Main mit dem gewaehlten Auftrag auf', async () => {
    bilderZuPdf.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\bilder.pdf',
      name: 'bilder.pdf',
      seiten: 1
    })
    act(() => {
      useBilderZuPdf.setState({
        offen: true,
        eintraege: [
          {
            id: 1,
            name: 'a.png',
            seite: { format: 'png', bytes: new Uint8Array([1]), breitePx: 4, hoehePx: 4 },
            fehler: null
          }
        ]
      })
    })
    render(<BilderZuPdf />)
    fireEvent.click(screen.getByTestId('bilder-zu-pdf-ausfuehren'))
    await waitFor(() => {
      expect(bilderZuPdf).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toContain('bilder.pdf')
    })
  })

  it('ein fehlerhaftes Bild zeigt seine Meldung statt "bereit"', () => {
    act(() => {
      useBilderZuPdf.setState({
        offen: true,
        eintraege: [{ id: 1, name: 'a.png', seite: null, fehler: 'kaputt' }]
      })
    })
    render(<BilderZuPdf />)
    expect(screen.getByTestId('bilder-zu-pdf-eintrag-1').textContent).toContain('kaputt')
    expect(istGesperrt('bilder-zu-pdf-ausfuehren')).toBe(true)
  })
})
