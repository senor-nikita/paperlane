import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { Signaturfeld } = await import('../../src/renderer/src/schale/Signaturfeld')

/**
 * Das Signaturfeld (S3.2, Aufgabe 4).
 *
 * jsdom hat keine Leinwand: `getContext('2d')` liefert null, also laesst sich
 * das Zeichnen hier nicht pruefen — das tut der E2E-Lauf mit echten
 * Zeigerbewegungen. Hier geht es um den Weg ueber "Bild laden": die Bruecke,
 * die Ablehnung als Hinweis, das Uebernehmen in den Store.
 */
const URL_PNG = 'data:image/png;base64,iVBORw0KGgo='
const bildLaden = vi.fn()

/** jsdom laedt keine Data-URLs; die Attrappe meldet feste Masse. */
class BildAttrappe {
  naturalWidth = 300
  naturalHeight = 100
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_wert: string) {
    queueMicrotask(() => this.onload?.())
  }
}

/**
 * jsdom hat keinen 2D-Kontext. Diese Attrappe zeichnet nicht, sondern
 * protokolliert nur, was gezeichnet wuerde — genug, um den Weg vom Zeiger
 * bis zum beschnittenen PNG zu pruefen. `toDataURL` liefert eine feste URL.
 */
function kontextAttrappe(): { anweisungen: string[]; installiere: () => void } {
  const anweisungen: string[] = []
  const kontext = {
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    scale: (): void => {
      anweisungen.push('scale')
    },
    beginPath: (): void => {
      anweisungen.push('beginPath')
    },
    moveTo: (x: number, y: number): void => {
      anweisungen.push('moveTo ' + String(x) + ',' + String(y))
    },
    lineTo: (x: number, y: number): void => {
      anweisungen.push('lineTo ' + String(Math.round(x)) + ',' + String(y))
    },
    stroke: (): void => {
      anweisungen.push('stroke')
    },
    clearRect: (): void => {
      anweisungen.push('clearRect')
    },
    drawImage: (...args: unknown[]): void => {
      anweisungen.push('drawImage ' + args.slice(1, 5).map(String).join(','))
    }
  }
  return {
    anweisungen,
    installiere: () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        kontext as unknown as CanvasRenderingContext2D
      )
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/png;base64,Z2V6ZWljaG5ldA=='
      )
    }
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  bildLaden.mockReset()
  Object.defineProperty(window, 'api', { configurable: true, value: { bildLaden } })
  vi.stubGlobal('Image', BildAttrappe)
  useBearbeitung.setState({ signaturBild: null })
  useDokument.setState({ hinweis: null })
})

describe('Signaturfeld', () => {
  it('sagt, was das Bild ist und was nicht', () => {
    render(<Signaturfeld onFertig={() => {}} />)
    expect(screen.getByTestId('signatur-hinweis').textContent).toMatch(
      /keine kryptografische Signatur/
    )
  })

  it('laesst ohne Inhalt weder uebernehmen noch leeren', () => {
    render(<Signaturfeld onFertig={() => {}} />)
    expect(screen.getByTestId('signatur-uebernehmen').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('signatur-leeren').hasAttribute('disabled')).toBe(true)
  })

  it('laedt ein Bild ueber die Bruecke, misst es und uebernimmt es in den Store', async () => {
    bildLaden.mockResolvedValueOnce({ art: 'geladen', url: URL_PNG })
    const fertig = vi.fn()
    render(<Signaturfeld onFertig={fertig} />)
    fireEvent.click(screen.getByTestId('signatur-laden'))
    const vorschau = await screen.findByTestId('signatur-vorschau')
    expect(vorschau.getAttribute('src')).toBe(URL_PNG)
    // Die Leinwand ist weg: ein geladenes Bild ersetzt die Zeichnung.
    expect(screen.queryByTestId('signatur-zeichenflaeche')).toBeNull()

    fireEvent.click(screen.getByTestId('signatur-uebernehmen'))
    expect(useBearbeitung.getState().signaturBild).toEqual({
      url: URL_PNG,
      breite: 300,
      hoehe: 100
    })
    expect(fertig).toHaveBeenCalledTimes(1)
  })

  it('zeigt eine Ablehnung des Main als Hinweis und behaelt den Zustand', async () => {
    bildLaden.mockResolvedValueOnce({
      art: 'abgelehnt',
      grund: 'Die Datei ist weder ein PNG noch ein JPEG.'
    })
    render(<Signaturfeld onFertig={() => {}} />)
    fireEvent.click(screen.getByTestId('signatur-laden'))
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toMatch(/weder ein PNG/)
    })
    expect(screen.queryByTestId('signatur-vorschau')).toBeNull()
    expect(useBearbeitung.getState().signaturBild).toBeNull()
  })

  it('macht aus einem abgebrochenen Dialog keine Meldung', async () => {
    bildLaden.mockResolvedValueOnce({ art: 'abgebrochen' })
    render(<Signaturfeld onFertig={() => {}} />)
    fireEvent.click(screen.getByTestId('signatur-laden'))
    await waitFor(() => {
      expect(bildLaden).toHaveBeenCalledTimes(1)
    })
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('leert ein geladenes Bild wieder', async () => {
    bildLaden.mockResolvedValueOnce({ art: 'geladen', url: URL_PNG })
    render(<Signaturfeld onFertig={() => {}} />)
    fireEvent.click(screen.getByTestId('signatur-laden'))
    await screen.findByTestId('signatur-vorschau')
    fireEvent.click(screen.getByTestId('signatur-leeren'))
    expect(screen.queryByTestId('signatur-vorschau')).toBeNull()
    expect(screen.getByTestId('signatur-zeichenflaeche')).not.toBeNull()
    expect(screen.getByTestId('signatur-uebernehmen').hasAttribute('disabled')).toBe(true)
  })

  it('zeichnet mit dem Zeiger und uebernimmt den beschnittenen Ausschnitt', () => {
    const { anweisungen, installiere } = kontextAttrappe()
    installiere()
    const fertig = vi.fn()
    render(<Signaturfeld onFertig={fertig} />)
    const leinwand = screen.getByTestId('signatur-zeichenflaeche')
    // jsdom: getBoundingClientRect ist 0, Zeigerkoordinaten sind Leinwandkoordinaten.
    leinwand.setPointerCapture = vi.fn()

    fireEvent.pointerDown(leinwand, { clientX: 50, clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(leinwand, { clientX: 150, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(leinwand, { pointerId: 1 })
    // Nach dem Loslassen bewegt nichts mehr den Stift.
    fireEvent.pointerMove(leinwand, { clientX: 400, clientY: 130, pointerId: 1 })

    expect(anweisungen).toContain('moveTo 50,40')
    expect(anweisungen).toContain('lineTo 150,90')
    expect(anweisungen).not.toContain('lineTo 400,130')
    expect(screen.getByTestId('signatur-uebernehmen').hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByTestId('signatur-uebernehmen'))
    const bild = useBearbeitung.getState().signaturBild
    expect(bild?.url).toBe('data:image/png;base64,Z2V6ZWljaG5ldA==')
    // Beschnitten auf den Strichbereich (50..150 x 40..90) plus 8 Punkte Rand.
    expect(bild?.breite).toBe(116)
    expect(bild?.hoehe).toBe(66)
    expect(anweisungen.some((a) => a.startsWith('drawImage 42,32,116,66'))).toBe(true)
    expect(fertig).toHaveBeenCalledTimes(1)
  })

  it('leert eine Zeichnung und sperrt Uebernehmen wieder', () => {
    const { anweisungen, installiere } = kontextAttrappe()
    installiere()
    render(<Signaturfeld onFertig={() => {}} />)
    const leinwand = screen.getByTestId('signatur-zeichenflaeche')
    leinwand.setPointerCapture = vi.fn()
    fireEvent.pointerDown(leinwand, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(leinwand, { pointerId: 1 })
    fireEvent.click(screen.getByTestId('signatur-leeren'))
    expect(anweisungen).toContain('clearRect')
    expect(screen.getByTestId('signatur-uebernehmen').hasAttribute('disabled')).toBe(true)
  })

  it('meldet ein Bild, das sich nicht dekodieren laesst', async () => {
    class Kaputt extends BildAttrappe {
      override set src(_wert: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('Image', Kaputt)
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {})
    bildLaden.mockResolvedValueOnce({ art: 'geladen', url: URL_PNG })
    render(<Signaturfeld onFertig={() => {}} />)
    fireEvent.click(screen.getByTestId('signatur-laden'))
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toMatch(/nicht laden/)
    })
    expect(screen.queryByTestId('signatur-vorschau')).toBeNull()
    fehler.mockRestore()
  })

  it('tut ohne Bruecke beim Laden nichts', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: undefined })
    render(<Signaturfeld onFertig={() => {}} />)
    fireEvent.click(screen.getByTestId('signatur-laden'))
    expect(bildLaden).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('schliesst mit Abbrechen, ohne etwas zu uebernehmen', () => {
    const fertig = vi.fn()
    render(<Signaturfeld onFertig={fertig} />)
    fireEvent.click(screen.getByTestId('signatur-abbrechen'))
    expect(fertig).toHaveBeenCalledTimes(1)
    expect(useBearbeitung.getState().signaturBild).toBeNull()
  })
})
