import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useTabs, setzeTabsZurueck } = await import('../../src/renderer/src/tabs-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useAnnotationen } = await import('../../src/renderer/src/annotations-store')
const { Tableiste } = await import('../../src/renderer/src/schale/Tableiste')
const { useBefehle } = await import('../../src/renderer/src/schale/befehle')
const { beginneVorgang, vergissVorgaenge } = await import('../../src/renderer/src/vorgaenge')

/**
 * Die Tab-Leiste (S6.1b). Die Aktionen des Tab-Stores werden ersetzt: was
 * Wechseln und Schliessen mit den Stores tun, prueft tabs-store.test.ts;
 * hier zaehlt, dass die Leiste sie richtig ausloest und richtig zeigt.
 */
const wechsle = vi.fn<(id: string) => boolean>(() => true)
const schliesse = vi.fn<(id: string) => Promise<boolean>>(() => Promise.resolve(true))
const naechster = vi.fn<(richtung: 1 | -1) => boolean>(() => true)

function tab(
  nummer: number,
  name = 'dokument-' + String(nummer) + '.pdf'
): {
  id: string
  pfad: string
  name: string
  verschwunden: boolean
} {
  return { id: 'tab-' + String(nummer), pfad: 'C:\\akten\\' + name, name, verschwunden: false }
}

function mitTabs(anzahl: number, aktiv = 1): void {
  useTabs.setState({
    tabs: Array.from({ length: anzahl }, (_, i) => tab(i + 1)),
    aktiv: anzahl === 0 ? null : 'tab-' + String(aktiv),
    staende: {},
    wechsle,
    schliesse,
    naechster
  })
}

/** Die echten Aktionen - `mitTabs` ersetzt sie, jeder Test beginnt wieder mit ihnen. */
const ECHT = (({ wechsle: w, schliesse: s, naechster: n }) => ({
  wechsle: w,
  schliesse: s,
  naechster: n
}))(useTabs.getState())

beforeEach(() => {
  setzeTabsZurueck()
  useTabs.setState(ECHT)
  vergissVorgaenge()
  wechsle.mockClear()
  schliesse.mockClear()
  naechster.mockClear()
  useAnnotationen.getState().vergiss()
  useDokument.setState({ ladeZustand: 'leer', hinweis: null })
})

describe('Tableiste', () => {
  it('erscheint erst mit einem offenen Tab', () => {
    mitTabs(0)
    const { container } = render(<Tableiste />)
    expect(container.innerHTML).toBe('')
  })

  it('zeigt die Reiter als tablist mit dem aktiven als ausgewaehlt', () => {
    mitTabs(3, 2)
    render(<Tableiste />)
    expect(screen.getByRole('tablist', { name: 'Offene Dokumente' })).toBeDefined()
    const reiter = screen.getAllByRole('tab')
    expect(reiter.map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    // Nur der aktive steht in der Tabfolge (roving tabIndex).
    expect(reiter.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
    expect(screen.getByTestId('tab-2').textContent).toContain('dokument-2.pdf')
  })

  it('kuerzt lange Namen und nennt den vollen im title', () => {
    const lang = 'ein-sehr-langer-dateiname-der-nicht-in-den-reiter-passt-2026.pdf'
    useTabs.setState({ tabs: [tab(1, lang)], aktiv: 'tab-1', staende: {} })
    render(<Tableiste />)
    const reiter = screen.getByTestId('tab-1')
    expect(reiter.getAttribute('title')).toBe(lang)
    expect(reiter.style.maxWidth).not.toBe('')
  })

  it('markiert einen Tab mit ungespeicherten Aenderungen', () => {
    useTabs.setState({
      tabs: [tab(1), tab(2)],
      aktiv: 'tab-1',
      // Nur `geaendert` wird hier gelesen; der Rest der Momentaufnahme zaehlt nicht.
      staende: { 'tab-2': { geaendert: true } as never }
    })
    render(<Tableiste />)
    expect(screen.queryByTestId('tab-geaendert-1')).toBeNull()
    expect(screen.getByTestId('tab-geaendert-2').textContent).toBe('*')
    // Angesagt wird ein Wort, nicht der Stern.
    expect(screen.getByTestId('tab-2').textContent).toContain('(ungespeichert)')
  })

  it('wechselt per Klick', () => {
    mitTabs(2, 1)
    render(<Tableiste />)
    fireEvent.click(screen.getByTestId('tab-2'))
    expect(wechsle).toHaveBeenCalledWith('tab-2')
  })

  it('schliesst ueber den Knopf und per Mittelklick', () => {
    mitTabs(3, 1)
    render(<Tableiste />)
    const knopf = screen.getByRole('button', { name: 'dokument-2.pdf schließen' })
    expect(knopf.getAttribute('data-testid')).toBe('tab-schliessen-2')
    fireEvent.click(knopf)
    expect(schliesse).toHaveBeenCalledWith('tab-2')

    fireEvent(screen.getByTestId('tab-3'), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(schliesse).toHaveBeenCalledWith('tab-3')
    // Ein Mittelklick wechselt nicht.
    expect(wechsle).not.toHaveBeenCalled()
  })

  it('bewegt den Fokus mit Pfeilen, Pos1 und Ende, ohne zu aktivieren', () => {
    mitTabs(3, 1)
    render(<Tableiste />)
    const erster = screen.getByTestId('tab-1')
    erster.focus()

    fireEvent.keyDown(erster, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByTestId('tab-2'))
    expect(screen.getByTestId('tab-2').tabIndex).toBe(0)
    expect(screen.getByTestId('tab-1').tabIndex).toBe(-1)

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByTestId('tab-3'))
    // Rechts vom letzten geht es zum ersten.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByTestId('tab-1'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByTestId('tab-3'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByTestId('tab-1'))

    // Manuelle Aktivierung: bewegt ist nur der Fokus.
    expect(wechsle).not.toHaveBeenCalled()
  })

  // Pos1 und Ende sind im Fenster Kuerzel fuer Anfang und Ende des Dokuments.
  it('laesst Pos1 und Ende nicht bis zum Fenster durch', () => {
    mitTabs(2, 1)
    const imFenster = vi.fn()
    window.addEventListener('keydown', imFenster)
    try {
      render(<Tableiste />)
      fireEvent.keyDown(screen.getByTestId('tab-1'), { key: 'End' })
      expect(imFenster).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', imFenster)
    }
  })

  it('gibt den Tabstopp nach einem Wechsel dem aktiven Reiter', () => {
    mitTabs(3, 1)
    render(<Tableiste />)
    screen.getByTestId('tab-1').focus()
    fireEvent.keyDown(screen.getByTestId('tab-1'), { key: 'ArrowRight' })
    act(() => {
      useTabs.setState({ aktiv: 'tab-3' })
    })
    expect(screen.getByTestId('tab-3').tabIndex).toBe(0)
    expect(screen.getByTestId('tab-2').tabIndex).toBe(-1)
  })
})

/**
 * Die Tab-Befehle ueber echte Tastendruecke - denselben Weg nimmt das Menue
 * (ADR 0002).
 */
describe('Tab-Kuerzel', () => {
  function Huelle(): React.JSX.Element {
    useBefehle({ seite: createRef<HTMLInputElement>(), suche: createRef<HTMLInputElement>() })
    return <div />
  }

  function taste(key: string, zusatz: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...zusatz }))
  }

  beforeEach(() => {
    Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  })

  it('schliesst mit Strg+W den aktiven Tab', () => {
    mitTabs(2, 2)
    render(<Huelle />)
    taste('w', { ctrlKey: true })
    expect(schliesse).toHaveBeenCalledWith('tab-2')
  })

  it('tut bei Strg+W ohne Tab nichts', () => {
    mitTabs(0)
    render(<Huelle />)
    taste('w', { ctrlKey: true })
    expect(schliesse).not.toHaveBeenCalled()
  })

  it('wechselt mit Strg+Tab und Strg+Bild-ab vor, mit Umschalt bzw. Bild-auf zurueck', () => {
    mitTabs(3, 1)
    render(<Huelle />)
    taste('Tab', { ctrlKey: true })
    taste('PageDown', { ctrlKey: true })
    expect(naechster.mock.calls).toEqual([[1], [1]])
    taste('Tab', { ctrlKey: true, shiftKey: true })
    taste('PageUp', { ctrlKey: true })
    expect(naechster.mock.calls.slice(2)).toEqual([[-1], [-1]])
  })

  // Die echten Store-Aktionen: gesperrt heisst Hinweis, nicht stilles Nichts.
  it('nennt den Sperrgrund, statt still nichts zu tun', () => {
    setzeTabsZurueck()
    useTabs.setState({
      tabs: [tab(1), tab(2)],
      aktiv: 'tab-1',
      staende: { 'tab-2': { geaendert: false } as never }
    })
    render(<Huelle />)
    beginneVorgang('speichern')
    taste('Tab', { ctrlKey: true })
    expect(useTabs.getState().aktiv).toBe('tab-1')
    expect(useDokument.getState().hinweis).toContain('gespeichert')
  })
})
