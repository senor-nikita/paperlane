import { render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtrahierAuftrag, ExtrahierErgebnis } from '../../src/shared/ipc'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useBefehle } = await import('../../src/renderer/src/schale/befehle')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useDokumentwerkzeuge } =
  await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
const { useSeitenauswahl } = await import('../../src/renderer/src/seitenauswahl-store')
const { useUebersicht } = await import('../../src/renderer/src/uebersicht-store')
const { vergissVorgaenge } = await import('../../src/renderer/src/vorgaenge')
const { KACHEL_MAX, KACHEL_MIN } = await import('../../src/renderer/src/viewer/raster')

/** Die Befehle aus S6.2 ueber echte Tastendruecke, wie auch das Menue sie ausloest. */
function Huelle(): React.JSX.Element {
  useBefehle({ seite: createRef<HTMLInputElement>(), suche: createRef<HTMLInputElement>() })
  return <div />
}

function taste(key: string, zusatz: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...zusatz }))
}

const seitenExtrahieren = vi.fn<(auftrag: ExtrahierAuftrag) => Promise<ExtrahierErgebnis>>()

beforeEach(() => {
  seitenExtrahieren.mockReset().mockResolvedValue({ art: 'abgebrochen' })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { seitenExtrahieren, beiEreignis: () => () => {} }
  })
  vergissVorgaenge()
  useSeitenauswahl.getState().leere()
  useUebersicht.setState({ offen: false })
  useDokumentwerkzeuge.getState().schliesse()
  useDokument.setState({
    ladeZustand: 'bereit',
    pfad: 'C:\\a.pdf',
    verschluesselt: false,
    seitenzahl: 5,
    aktuelleSeite: 3,
    hinweis: null
  })
})

describe('Befehl seitenuebersicht', () => {
  it('schaltet die Uebersicht mit Strg+Umschalt+O ein und aus', () => {
    render(<Huelle />)
    taste('O', { ctrlKey: true, shiftKey: true })
    expect(useUebersicht.getState().offen).toBe(true)
    taste('O', { ctrlKey: true, shiftKey: true })
    expect(useUebersicht.getState().offen).toBe(false)
  })

  it('verlangt ein geoeffnetes Dokument', () => {
    useDokument.setState({ ladeZustand: 'leer' })
    render(<Huelle />)
    taste('O', { ctrlKey: true, shiftKey: true })
    expect(useUebersicht.getState().offen).toBe(false)
    expect(useDokument.getState().hinweis).not.toBeNull()
  })

  it('schliesst mit Escape - aber erst ein offenes Feld', () => {
    useUebersicht.setState({ offen: true })
    useDokumentwerkzeuge.getState().oeffne('png')
    render(<Huelle />)
    taste('Escape')
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useUebersicht.getState().offen).toBe(true)
    taste('Escape')
    expect(useUebersicht.getState().offen).toBe(false)
  })
})

describe('Befehl seitenExtrahieren', () => {
  it('extrahiert mit Strg+Umschalt+K die aktuelle Seite', async () => {
    render(<Huelle />)
    taste('K', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => {
      expect(seitenExtrahieren.mock.calls[0]?.[0].seiten).toEqual([3])
    })
  })

  it('extrahiert die Auswahl, wenn es eine gibt', async () => {
    useSeitenauswahl.getState().setze([4, 1])
    render(<Huelle />)
    taste('K', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => {
      expect(seitenExtrahieren.mock.calls[0]?.[0].seiten).toEqual([1, 4])
    })
  })

  it('verlangt ein geoeffnetes Dokument', () => {
    useDokument.setState({ ladeZustand: 'leer' })
    render(<Huelle />)
    taste('K', { ctrlKey: true, shiftKey: true })
    expect(seitenExtrahieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).not.toBeNull()
  })
})

describe('useUebersicht', () => {
  it('begrenzt die Kachelgroesse und ignoriert Unsinn', () => {
    const { setzeKachelBreite } = useUebersicht.getState()
    setzeKachelBreite(10)
    expect(useUebersicht.getState().kachelBreite).toBe(KACHEL_MIN)
    setzeKachelBreite(9999)
    expect(useUebersicht.getState().kachelBreite).toBe(KACHEL_MAX)
    setzeKachelBreite(Number.NaN)
    expect(useUebersicht.getState().kachelBreite).toBe(KACHEL_MAX)
    setzeKachelBreite(201.4)
    expect(useUebersicht.getState().kachelBreite).toBe(201)
  })
})
