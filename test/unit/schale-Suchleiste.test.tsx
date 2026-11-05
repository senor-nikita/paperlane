import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useSuche } = await import('../../src/renderer/src/suche-store')
const { Suchleiste } = await import('../../src/renderer/src/schale/Suchleiste')

/**
 * Die Bedienelemente der Suche.
 *
 * Bis zur Aufteilung von App.tsx steckten sie in der Schale und waren nur per
 * E2E abgedeckt; das Coverage-Gate hat die Luecke sichtbar gemacht, als die
 * Suchleiste eine eigene Datei bekam. Der Sprung zum gewaehlten Treffer war
 * damit ueberhaupt nicht unit-geprueft.
 */
const attrappen = {
  setzeBegriff: vi.fn(),
  setzeOptionen: vi.fn(),
  starte: vi.fn(() => Promise.resolve()),
  weiter: vi.fn()
}

function feld(): ReturnType<typeof createRef<HTMLInputElement>> {
  return createRef<HTMLInputElement>()
}

beforeEach(() => {
  for (const attrappe of Object.values(attrappen)) attrappe.mockClear()
  useSuche.setState({
    begriff: 'Rechnung',
    optionen: { achteAufGrossschreibung: false, nurGanzeWoerter: false },
    ergebnisse: [],
    gesamt: 0,
    aktuell: 0,
    laeuft: false,
    ...attrappen
  })
  useDokument.setState({ seitenzahl: 5, aktuelleSeite: 1, sprungZiel: null, sprungAnteil: null })
})

describe('Suchleiste', () => {
  it('reicht die Eingabe an den Suchspeicher', () => {
    render(<Suchleiste feldRef={feld()} />)
    fireEvent.change(screen.getByTestId('such-eingabe'), { target: { value: 'Vertrag' } })
    expect(attrappen.setzeBegriff).toHaveBeenCalledWith('Vertrag')
  })

  it('startet die Suche mit der Eingabetaste', () => {
    render(<Suchleiste feldRef={feld()} />)
    fireEvent.keyDown(screen.getByTestId('such-eingabe'), { key: 'Enter' })
    expect(attrappen.starte).toHaveBeenCalled()
  })

  it('startet die Suche ueber den Knopf', () => {
    render(<Suchleiste feldRef={feld()} />)
    fireEvent.click(screen.getByRole('button', { name: 'suchen' }))
    expect(attrappen.starte).toHaveBeenCalled()
  })

  it.each([
    ['nächster', 1],
    ['vorheriger', -1]
  ])('blaettert mit "%s" in den Treffern', (beschriftung, richtung) => {
    render(<Suchleiste feldRef={feld()} />)
    fireEvent.click(screen.getByRole('button', { name: beschriftung }))
    expect(attrappen.weiter).toHaveBeenCalledWith(richtung)
  })

  it.each([
    ['option-grossschreibung', 'achteAufGrossschreibung'],
    ['option-ganze-woerter', 'nurGanzeWoerter']
  ])('schaltet die Option %s um', (kennung, schluessel) => {
    render(<Suchleiste feldRef={feld()} />)
    fireEvent.click(screen.getByTestId(kennung))
    expect(attrappen.setzeOptionen).toHaveBeenCalledWith({ [schluessel]: true })
  })

  it.each([
    ['sucht …', { laeuft: true, gesamt: 0, aktuell: 0 }],
    ['keine Treffer', { laeuft: false, gesamt: 0, aktuell: 0 }],
    ['2 von 7', { laeuft: false, gesamt: 7, aktuell: 2 }]
  ])('zeigt "%s" an', (erwartet, zustand) => {
    useSuche.setState(zustand)
    render(<Suchleiste feldRef={feld()} />)
    expect(screen.getByTestId('treffer-anzeige').textContent).toBe(erwartet)
  })

  /**
   * Der Sprung zum gewaehlten Treffer. Ohne ihn zaehlte die Anzeige zwar
   * weiter, das Dokument bliebe aber stehen — die Suche waere eine reine
   * Statistik.
   */
  it('springt zur Seite des gewaehlten Treffers', async () => {
    render(<Suchleiste feldRef={feld()} />)
    useSuche.setState({
      ergebnisse: [
        { seite: 2, treffer: [{ von: 0, bis: 4 }] },
        { seite: 4, treffer: [{ von: 10, bis: 14 }] }
      ],
      gesamt: 2,
      aktuell: 2
    })
    await waitFor(() => {
      expect(useDokument.getState().sprungZiel).toBe(4)
    })
  })

  it('springt nicht, solange kein Treffer gewaehlt ist', () => {
    render(<Suchleiste feldRef={feld()} />)
    useSuche.setState({ ergebnisse: [{ seite: 2, treffer: [{ von: 0, bis: 4 }] }], gesamt: 1 })
    expect(useDokument.getState().sprungZiel).toBeNull()
  })
})
