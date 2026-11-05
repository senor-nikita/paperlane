import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
  TextLayer: class {}
}))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useSuche, leereTextCache, flacherTreffer } =
  await import('../../src/renderer/src/suche-store')

/** Seitentext: der Suchbegriff steht auf jeder zweiten Seite zweimal. */
function fakeDokument(seiten: number) {
  return {
    numPages: seiten,
    getPage: vi.fn((nummer: number) =>
      Promise.resolve({
        getTextContent: () =>
          Promise.resolve({
            items:
              nummer % 2 === 0
                ? [{ str: 'Hier Wasser', hasEOL: false }, { str: 'zeichen und Wasserzeichen' }]
                : [{ str: 'nichts besonderes' }]
          })
      })
    )
  }
}

beforeEach(() => {
  leereTextCache()
  useSuche.getState().zuruecksetzen()
  useDokument.setState({ seitenzahl: 4, aktuelleSeite: 1, pfad: 'C:/a.pdf' })
})

describe('Suche', () => {
  it('findet Treffer ueber alle Seiten und zaehlt sie', async () => {
    useDokument.setState({ dokument: fakeDokument(4) as never })
    useSuche.getState().setzeBegriff('Wasserzeichen')
    await useSuche.getState().starte()
    // Seiten 2 und 4, je zwei Treffer.
    expect(useSuche.getState().gesamt).toBe(4)
    expect(useSuche.getState().ergebnisse.map((e) => e.seite)).toEqual([2, 4])
    expect(useSuche.getState().aktuell).toBe(1)
    expect(useSuche.getState().laeuft).toBe(false)
  })

  it('meldet ein Dokument ohne durchsuchbaren Text', async () => {
    useDokument.setState({
      dokument: {
        numPages: 2,
        getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) })
      } as never,
      seitenzahl: 2
    })
    useSuche.getState().setzeBegriff('egal')
    await useSuche.getState().starte()
    expect(useSuche.getState().hatDurchsuchbarenText).toBe(false)
    expect(useSuche.getState().gesamt).toBe(0)
  })

  it('liefert bei leerem Begriff nichts', async () => {
    useDokument.setState({ dokument: fakeDokument(4) as never })
    useSuche.getState().setzeBegriff('')
    await useSuche.getState().starte()
    expect(useSuche.getState().gesamt).toBe(0)
  })

  it('blaettert zyklisch durch die Treffer', async () => {
    useDokument.setState({ dokument: fakeDokument(4) as never })
    useSuche.getState().setzeBegriff('Wasserzeichen')
    await useSuche.getState().starte()
    useSuche.getState().weiter(1)
    expect(useSuche.getState().aktuell).toBe(2)
    useSuche.getState().weiter(-1)
    expect(useSuche.getState().aktuell).toBe(1)
    useSuche.getState().weiter(-1)
    expect(useSuche.getState().aktuell).toBe(4)
  })

  it('beachtet die Option fuer ganze Woerter', async () => {
    useDokument.setState({ dokument: fakeDokument(4) as never })
    useSuche.getState().setzeBegriff('Wasser')
    await useSuche.getState().starte()
    const ohne = useSuche.getState().gesamt
    useSuche.getState().setzeOptionen({ nurGanzeWoerter: true })
    await useSuche.getState().starte()
    expect(useSuche.getState().gesamt).toBeLessThan(ohne)
  })
})

describe('flacherTreffer', () => {
  const ergebnisse = [
    {
      seite: 3,
      treffer: [
        { von: 0, bis: 3 },
        { von: 10, bis: 13 }
      ]
    },
    { seite: 7, treffer: [{ von: 5, bis: 8 }] }
  ]

  it.each([
    [1, 3],
    [2, 3],
    [3, 7]
  ])('findet Treffer %i auf Seite %i', (index, seite) => {
    expect(flacherTreffer(ergebnisse, index)?.seite).toBe(seite)
  })

  it('liefert null ausserhalb des Bereichs', () => {
    expect(flacherTreffer(ergebnisse, 99)).toBeNull()
    expect(flacherTreffer(ergebnisse, 0)).toBeNull()
  })
})
