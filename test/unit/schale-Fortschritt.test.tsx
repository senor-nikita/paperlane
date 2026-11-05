import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useMutation } = await import('../../src/renderer/src/mutation-store')
const { Fortschritt, SCHWELLE_MS } = await import('../../src/renderer/src/schale/Fortschritt')

/** S4.0, Aufgabe 5: die Anzeige erscheint erst ab der Schwellendauer. */
beforeEach(() => {
  vi.useFakeTimers()
  useMutation.setState({ anzahl: 0, laeuft: null, erwarteNeuladen: false, letzteDauerMs: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Fortschritt', () => {
  it('zeigt nichts, solange keine Mutation laeuft', () => {
    render(<Fortschritt />)
    expect(screen.queryByTestId('mutation-fortschritt')).toBeNull()
  })

  it('erscheint erst nach der Schwelle und nennt die Mutation', () => {
    render(<Fortschritt />)
    act(() => {
      useMutation.getState().beginne({ art: 'seitenLoeschen', seiten: [3] })
    })
    expect(screen.queryByTestId('mutation-fortschritt')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(SCHWELLE_MS + 1)
    })
    expect(screen.getByTestId('mutation-fortschritt').textContent).toContain('Seite 3 löschen')
  })

  it('bleibt aus, wenn die Mutation vor der Schwelle fertig ist', () => {
    render(<Fortschritt />)
    act(() => {
      useMutation.getState().beginne({ art: 'seitenLoeschen', seiten: [3] })
      vi.advanceTimersByTime(SCHWELLE_MS - 50)
      useMutation.getState().beende(true, 120)
      vi.advanceTimersByTime(SCHWELLE_MS)
    })
    expect(screen.queryByTestId('mutation-fortschritt')).toBeNull()
  })
})
