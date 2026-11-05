import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExtrahierAuftrag,
  ExtrahierErgebnis,
  MutationsAuftrag,
  MutationsErgebnis
} from '../../src/shared/ipc'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useMutation } = await import('../../src/renderer/src/mutation-store')
const { setzeMutationssperreZurueck } = await import('../../src/renderer/src/mutation')
const { useSeitenauswahl } = await import('../../src/renderer/src/seitenauswahl-store')
const { useUebersicht } = await import('../../src/renderer/src/uebersicht-store')
const { vergissVorgaenge } = await import('../../src/renderer/src/vorgaenge')
const { Seitenuebersicht } = await import('../../src/renderer/src/viewer/Seitenuebersicht')

/**
 * Die Seitenuebersicht (S6.2) ohne pdf.js: Kacheln, Tastatur, Verschieben
 * und Extrahieren bis zur Bruecke. Gezeichnet wird nichts - das Dokument ist
 * `null`, die Kacheln bleiben leer, ihre Lage und Bedienung sind da.
 */
const PFAD = 'C:\\dokumente\\bericht.pdf'
const A4 = { breite: 595, hoehe: 842 }
const seitenExtrahieren = vi.fn<(auftrag: ExtrahierAuftrag) => Promise<ExtrahierErgebnis>>()
const dokumentMutieren = vi.fn<(auftrag: MutationsAuftrag) => Promise<MutationsErgebnis>>()
const uebernimm = vi.fn<(...args: unknown[]) => Promise<void>>()

beforeEach(() => {
  seitenExtrahieren.mockReset().mockResolvedValue({ art: 'abgebrochen' })
  dokumentMutieren.mockReset().mockResolvedValue({
    art: 'angewendet',
    dokument: { pfad: PFAD, name: 'bericht.pdf', bytes: new Uint8Array([1]) },
    dauerMs: 5,
    stand: { vorher: 0, nachher: 1 }
  })
  uebernimm.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      seitenExtrahieren,
      dokumentMutieren,
      dokumentGeaendert: vi.fn(() => Promise.resolve())
    }
  })
  vergissVorgaenge()
  setzeMutationssperreZurueck()
  useMutation.setState({ anzahl: 0, laeuft: null, erwarteNeuladen: false, letzteDauerMs: null })
  useSeitenauswahl.getState().leere()
  useUebersicht.setState({ offen: true, kachelBreite: 180 })
  useDokument.setState({
    ladeZustand: 'bereit',
    dokument: null,
    pfad: PFAD,
    name: 'bericht.pdf',
    verschluesselt: false,
    seitenzahl: 6,
    seitenGroessen: Array.from({ length: 6 }, () => A4),
    aktuelleSeite: 1,
    rotation: 0,
    hinweis: null,
    uebernimm
  })
})

function raster(): HTMLElement {
  return screen.getByTestId('uebersicht-raster')
}

describe('Seitenuebersicht', () => {
  it('zeigt jede Seite als Kachel und nimmt den Fokus', () => {
    render(<Seitenuebersicht />)
    for (let s = 1; s <= 6; s++) expect(screen.getByTestId('kachel-' + String(s))).toBeTruthy()
    expect(document.activeElement).toBe(raster())
  })

  it('stellt die Kacheln nebeneinander', () => {
    render(<Seitenuebersicht />)
    const eins = screen.getByTestId('kachel-1')
    const zwei = screen.getByTestId('kachel-2')
    expect(eins.style.top).toBe(zwei.style.top)
    expect(eins.style.left).not.toBe(zwei.style.left)
  })

  it('bewegt die aktive Seite mit den Pfeiltasten und waehlt sie', () => {
    render(<Seitenuebersicht />)
    fireEvent.keyDown(raster(), { key: 'ArrowRight' })
    expect(useDokument.getState().aktuelleSeite).toBe(2)
    expect([...useSeitenauswahl.getState().ausgewaehlt]).toEqual([2])
    fireEvent.keyDown(raster(), { key: 'End' })
    expect(useDokument.getState().aktuelleSeite).toBe(6)
  })

  it('erweitert die Auswahl mit Umschalt und waehlt mit Strg+A alles', () => {
    render(<Seitenuebersicht />)
    fireEvent.keyDown(raster(), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(raster(), { key: 'ArrowRight', shiftKey: true })
    expect([...useSeitenauswahl.getState().ausgewaehlt].sort()).toEqual([1, 2, 3])
    fireEvent.keyDown(raster(), { key: 'a', ctrlKey: true })
    expect(useSeitenauswahl.getState().ausgewaehlt.size).toBe(6)
  })

  it('nimmt die aktive Seite mit der Leertaste dazu', () => {
    render(<Seitenuebersicht />)
    fireEvent.keyDown(raster(), { key: ' ' })
    expect([...useSeitenauswahl.getState().ausgewaehlt]).toEqual([1])
  })

  it('verschiebt die Auswahl mit Strg+Pfeil und behaelt sie gewaehlt', async () => {
    useSeitenauswahl.getState().setze([2, 3])
    render(<Seitenuebersicht />)
    await act(async () => {
      fireEvent.keyDown(raster(), { key: 'ArrowRight', ctrlKey: true })
      await Promise.resolve()
    })
    expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
      art: 'seitenAnordnen',
      reihenfolge: [1, 4, 2, 3, 5, 6]
    })
    await vi.waitFor(() => {
      expect([...useSeitenauswahl.getState().ausgewaehlt]).toEqual([3, 4])
    })
  })

  it('loescht die Auswahl mit Entf', async () => {
    useSeitenauswahl.getState().setze([2])
    render(<Seitenuebersicht />)
    await act(async () => {
      fireEvent.keyDown(raster(), { key: 'Delete' })
      await Promise.resolve()
    })
    expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
      art: 'seitenLoeschen',
      seiten: [2]
    })
  })

  it('schliesst mit Escape, Eingabe und Fertig', () => {
    const { unmount } = render(<Seitenuebersicht />)
    fireEvent.keyDown(raster(), { key: 'Escape' })
    expect(useUebersicht.getState().offen).toBe(false)
    useUebersicht.getState().oeffne()
    fireEvent.keyDown(raster(), { key: 'Enter' })
    expect(useUebersicht.getState().offen).toBe(false)
    useUebersicht.getState().oeffne()
    fireEvent.click(screen.getByTestId('uebersicht-schliessen'))
    expect(useUebersicht.getState().offen).toBe(false)
    unmount()
  })

  it('extrahiert einen getippten Bereich als Seitenliste', async () => {
    render(<Seitenuebersicht />)
    fireEvent.change(screen.getByTestId('uebersicht-bereich'), { target: { value: '1-3, 5' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('uebersicht-extrahieren'))
      await Promise.resolve()
    })
    expect(seitenExtrahieren.mock.calls[0]?.[0].seiten).toEqual([1, 2, 3, 5])
  })

  it('extrahiert ohne Bereich die Auswahl', async () => {
    useSeitenauswahl.getState().setze([4, 2])
    render(<Seitenuebersicht />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('uebersicht-extrahieren'))
      await Promise.resolve()
    })
    expect(seitenExtrahieren.mock.calls[0]?.[0].seiten).toEqual([2, 4])
  })

  it('zeigt einen ungueltigen Bereich an, statt zu extrahieren', () => {
    render(<Seitenuebersicht />)
    fireEvent.change(screen.getByTestId('uebersicht-bereich'), { target: { value: '9' } })
    fireEvent.click(screen.getByTestId('uebersicht-extrahieren'))
    expect(screen.getByTestId('uebersicht-fehler').textContent).not.toBe('')
    expect(seitenExtrahieren).not.toHaveBeenCalled()
  })

  it('entfernt nach dem Extrahieren, wenn angehakt', async () => {
    seitenExtrahieren.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\x.pdf',
      name: 'x.pdf',
      seiten: 1
    })
    render(<Seitenuebersicht />)
    fireEvent.click(screen.getByTestId('uebersicht-entfernen'))
    fireEvent.change(screen.getByTestId('uebersicht-bereich'), { target: { value: '4' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('uebersicht-extrahieren'))
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
        art: 'seitenLoeschen',
        seiten: [4]
      })
    })
  })

  it('aendert die Kachelgroesse ueber den Regler', () => {
    render(<Seitenuebersicht />)
    fireEvent.change(screen.getByTestId('uebersicht-groesse'), { target: { value: '300' } })
    expect(useUebersicht.getState().kachelBreite).toBe(300)
  })
})
