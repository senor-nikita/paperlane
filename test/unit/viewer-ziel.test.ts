import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { deuteAusrichtung, loeseZielAuf } from '../../src/renderer/src/viewer/ziel'

const HOEHE = 800

/** pdf.js liefert den Zielnamen als Objekt; roh gelesen steht er als Zeichenkette. */
const art = (name: string): { name: string } => ({ name })

describe('deuteAusrichtung', () => {
  it('deutet XYZ mit Position und Zoom', () => {
    // Oben = 600 Punkte von unten, also ein Viertel unter der Oberkante.
    expect(deuteAusrichtung([art('XYZ'), 0, 600, 2], HOEHE)).toEqual({
      anteilVonOben: 0.25,
      zoom: 2
    })
  })

  // Der haeufigste Fall im Feld: XYZ ohne Werte. Er darf nicht als Sprung auf
  // den Seitenanfang durchgehen, sondern nennt schlicht keine Position.
  it('deutet XYZ ohne Werte als Ziel ohne Position', () => {
    expect(deuteAusrichtung([art('XYZ'), null, null, null], HOEHE)).toEqual({
      anteilVonOben: null,
      zoom: null
    })
  })

  it('behandelt Zoom 0 als "behalten"', () => {
    expect(deuteAusrichtung([art('XYZ'), 0, 800, 0], HOEHE).zoom).toBeNull()
  })

  it('deutet FitH ueber die Oberkante', () => {
    expect(deuteAusrichtung([art('FitH'), 400], HOEHE)).toEqual({ anteilVonOben: 0.5, zoom: null })
  })

  it('deutet FitBH wie FitH', () => {
    expect(deuteAusrichtung([art('FitBH'), 400], HOEHE).anteilVonOben).toBe(0.5)
  })

  // FitR nennt ein Rechteck; die Oberkante steht an vierter Stelle. Wer hier
  // den falschen Index nimmt, landet am unteren Seitenrand.
  it('deutet FitR ueber die Oberkante des Rechtecks', () => {
    expect(deuteAusrichtung([art('FitR'), 50, 100, 400, 200], HOEHE)).toEqual({
      anteilVonOben: 0.75,
      zoom: null
    })
  })

  it.each([['Fit'], ['FitB'], ['FitV'], ['FitBV']])('deutet %s als Seitenanfang', (name) => {
    expect(deuteAusrichtung([art(name)], HOEHE).anteilVonOben).toBe(0)
  })

  it('nimmt den Namen auch als blosse Zeichenkette', () => {
    expect(deuteAusrichtung(['FitH', 400], HOEHE).anteilVonOben).toBe(0.5)
  })

  // Ein unbekanntes Ziel soll die Seite trotzdem anspringen - das ist deutlich
  // besser als ein toter Verweis.
  it('liefert bei unbekannter Art keine Position, statt zu werfen', () => {
    expect(deuteAusrichtung([art('FitXYZ'), 1], HOEHE)).toEqual({
      anteilVonOben: null,
      zoom: null
    })
    expect(deuteAusrichtung([], HOEHE).anteilVonOben).toBeNull()
  })

  it('begrenzt Positionen ausserhalb der Seite', () => {
    expect(deuteAusrichtung([art('FitH'), 5000], HOEHE).anteilVonOben).toBe(0)
    expect(deuteAusrichtung([art('FitH'), -5000], HOEHE).anteilVonOben).toBe(1)
  })
})

interface FakeTeile {
  getDestination?: (name: string) => Promise<unknown[] | null>
  getPageIndex?: (ref: unknown) => Promise<number>
}

function fakeDokument(teile: FakeTeile = {}): PDFDocumentProxy {
  return {
    getDestination: vi.fn(teile.getDestination ?? (() => Promise.resolve(null))),
    getPageIndex: vi.fn(teile.getPageIndex ?? (() => Promise.resolve(2))),
    getPage: vi.fn(() => Promise.resolve({ view: [0, 0, 595, HOEHE] }))
  } as unknown as PDFDocumentProxy
}

describe('loeseZielAuf', () => {
  it('loest ein explizites Ziel mit Seitenreferenz auf', async () => {
    const dokument = fakeDokument()
    const position = await loeseZielAuf(dokument, [{ num: 9, gen: 0 }, art('FitH'), 400])
    expect(position).toEqual({ seite: 3, anteilVonOben: 0.5, zoom: null })
  })

  it('loest ein benanntes Ziel ueber die Namenstabelle auf', async () => {
    const dokument = fakeDokument({
      getDestination: (name) =>
        Promise.resolve(
          name === 'kapitel-zwei' ? [{ num: 9, gen: 0 }, art('XYZ'), 0, 600, null] : null
        )
    })
    const position = await loeseZielAuf(dokument, 'kapitel-zwei')
    expect(position).toEqual({ seite: 3, anteilVonOben: 0.25, zoom: null })
  })

  it('liefert null fuer ein benanntes Ziel, das das Dokument nicht kennt', async () => {
    expect(await loeseZielAuf(fakeDokument(), 'gibt-es-nicht')).toBeNull()
  })

  // Manche Dokumente nennen die Seite als blosse Nummer statt als Referenz.
  it('nimmt eine Seitennummer statt einer Referenz', async () => {
    const dokument = fakeDokument()
    const position = await loeseZielAuf(dokument, [0, art('Fit')])
    expect(position?.seite).toBe(1)
  })

  it('liefert null, wenn die Seitenreferenz ins Leere zeigt', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dokument = fakeDokument({ getPageIndex: () => Promise.reject(new Error('kaputt')) })
    expect(await loeseZielAuf(dokument, [{ num: 99, gen: 0 }, art('Fit')])).toBeNull()
    expect(fehler).toHaveBeenCalled()
    fehler.mockRestore()
  })

  it.each([[null], [undefined], [42], [[]]])('liefert null fuer %o', async (ziel) => {
    expect(await loeseZielAuf(fakeDokument(), ziel)).toBeNull()
  })
})
