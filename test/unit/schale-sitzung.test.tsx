import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useTabs, setzeTabsZurueck } = await import('../../src/renderer/src/tabs-store')
const { useStartdokument, useSitzungSichern, setzeSitzungZurueck, SICHERN_NACH_MS } =
  await import('../../src/renderer/src/schale/sitzung')

/**
 * Das Sichern der Sitzung (S6.1b): verzoegert bei jeder Aenderung der Tabs,
 * sofort beim Entladen, und erst, wenn die letzte Sitzung wiederhergestellt
 * ist. Das Wiederherstellen selbst prueft tabs-store.test.ts mit echtem Store.
 */
function Huelle(): React.JSX.Element {
  useStartdokument()
  useSitzungSichern()
  return <div />
}

const settingsSet = vi.fn<(patch: unknown) => Promise<unknown>>(() => Promise.resolve({}))

function bruecke(settingsGet: () => Promise<unknown>): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      settingsGet,
      settingsSet,
      dokumentBeimStart: () => Promise.resolve(null),
      dokumentOeffnePfad: () => Promise.resolve({ ok: false, grund: 'nicht gestubbt' })
    }
  })
}

function tabs(...namen: string[]): void {
  useTabs.setState({
    tabs: namen.map((name, i) => ({
      id: 'tab-' + String(i + 1),
      pfad: 'C:\\akten\\' + name,
      name,
      verschwunden: false
    })),
    aktiv: namen.length === 0 ? null : 'tab-' + String(namen.length)
  })
}

beforeEach(() => {
  setzeTabsZurueck()
  setzeSitzungZurueck()
  settingsSet.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSitzungSichern', () => {
  it('sichert nach der Wiederherstellung verzoegert und beim Entladen sofort', async () => {
    bruecke(() => Promise.resolve({ sitzung: { tabs: [], aktiv: 0 } }))
    render(<Huelle />)
    // Nach der Wiederherstellung einmal der Stand, wie er dann ist.
    await waitFor(() => {
      expect(settingsSet).toHaveBeenCalledWith({ sitzung: { tabs: [], aktiv: 0 } })
    })
    settingsSet.mockClear()

    vi.useFakeTimers()
    act(() => {
      tabs('a.pdf', 'b.pdf')
    })
    vi.advanceTimersByTime(SICHERN_NACH_MS - 1)
    expect(settingsSet).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(settingsSet).toHaveBeenCalledWith({
      sitzung: { tabs: ['C:\\akten\\a.pdf', 'C:\\akten\\b.pdf'], aktiv: 1 }
    })

    // Das Fenster schliesst, bevor die Verzoegerung um ist.
    settingsSet.mockClear()
    act(() => {
      useTabs.setState({ aktiv: 'tab-1' })
    })
    window.dispatchEvent(new Event('beforeunload'))
    expect(settingsSet).toHaveBeenCalledWith({
      sitzung: { tabs: ['C:\\akten\\a.pdf', 'C:\\akten\\b.pdf'], aktiv: 0 }
    })
  })

  // Eine halb geoeffnete Sitzung darf die vollstaendige nicht ueberschreiben.
  it('sichert nichts, solange die Wiederherstellung laeuft', () => {
    vi.useFakeTimers()
    bruecke(() => new Promise(() => undefined))
    render(<Huelle />)
    act(() => {
      tabs('a.pdf')
    })
    vi.advanceTimersByTime(SICHERN_NACH_MS * 2)
    window.dispatchEvent(new Event('beforeunload'))
    expect(settingsSet).not.toHaveBeenCalled()
  })

  it('nimmt eine kaputte oder fehlende Sitzung als leer', async () => {
    bruecke(() => Promise.resolve({ sitzung: { tabs: 'kein Array', aktiv: 7 } }))
    render(<Huelle />)
    await waitFor(() => {
      expect(settingsSet).toHaveBeenCalledWith({ sitzung: { tabs: [], aktiv: 0 } })
    })
    expect(useTabs.getState().tabs).toEqual([])
  })
})
