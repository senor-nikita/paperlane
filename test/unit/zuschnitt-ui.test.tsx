import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationsAuftrag, MutationsErgebnis } from '../../src/shared/ipc'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useHistorie } = await import('../../src/renderer/src/historie')
const { useMutation } = await import('../../src/renderer/src/mutation-store')
const { setzeMutationssperreZurueck } = await import('../../src/renderer/src/mutation')
const { useSeitenauswahl } = await import('../../src/renderer/src/seitenauswahl-store')
const { useZuschnitt } = await import('../../src/renderer/src/zuschnitt-store')
const { hebeZuschnittAuf, schneideZu, zuschnittSeiten } =
  await import('../../src/renderer/src/zuschnitt')
const { Zuschnittebene } = await import('../../src/renderer/src/viewer/Zuschnittebene')
const { Zuschneideleiste } = await import('../../src/renderer/src/schale/Zuschneideleiste')
const { Werkzeugleiste } = await import('../../src/renderer/src/schale/Werkzeugleiste')
const { useBefehle } = await import('../../src/renderer/src/schale/befehle')
const { ausMm } = await import('../../src/renderer/src/viewer/zuschnitt')

/**
 * S6.3 im Renderer: Rahmen aufziehen und an den Griffen ziehen
 * (`Zuschnittebene`), Raender in mm, Ziel, Anwenden und Aufheben
 * (`Zuschneideleiste`), der Befehl mit Kuerzel.
 *
 * jsdom liefert fuer `getBoundingClientRect` lauter Nullen: Zeigerkoordinaten
 * sind hier Seitenpixel. Zoom 2 - damit faellt auf, wenn irgendwo Pixel und
 * Punkte verwechselt werden.
 */
const PFAD = 'C:\\dokumente\\plan.pdf'
const dokumentMutieren = vi.fn<(auftrag: MutationsAuftrag) => Promise<MutationsErgebnis>>()
const uebernimm = vi.fn<(...args: unknown[]) => Promise<void>>()

/** Seite 1 hochkant 600 x 800, Seite 2 mit /Rotate 90, Seite 3 winzig. */
const SEITEN: Record<number, { view: number[]; rotate: number }> = {
  1: { view: [0, 0, 600, 800], rotate: 0 },
  2: { view: [100, 50, 700, 850], rotate: 90 },
  3: { view: [0, 0, 40, 40], rotate: 0 }
}

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  dokumentMutieren.mockReset().mockResolvedValue({
    art: 'angewendet',
    dokument: { pfad: PFAD, name: 'plan.pdf', bytes: new Uint8Array([1]) },
    dauerMs: 5,
    stand: { vorher: 0, nachher: 1 }
  })
  uebernimm.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dokumentMutieren,
      dokumentGeaendert: vi.fn(() => Promise.resolve()),
      beiEreignis: () => () => {}
    }
  })
  setzeMutationssperreZurueck()
  useMutation.setState({ anzahl: 0, laeuft: null, erwarteNeuladen: false, letzteDauerMs: null })
  useHistorie.getState().leere()
  useSeitenauswahl.getState().leere()
  useZuschnitt.setState({ seite: null, mass: null, raender: null, ziel: 'seite' })
  useBearbeitung.setState({ werkzeug: 'zuschneiden', ausgewaehlt: null, anwendenAuf: null })
  useDokument.setState({
    ladeZustand: 'bereit',
    pfad: PFAD,
    name: 'plan.pdf',
    verschluesselt: false,
    seitenzahl: 3,
    aktuelleSeite: 1,
    zoom: 2,
    rotation: 0,
    passung: 'frei',
    hinweis: null,
    uebernimm,
    dokument: {
      getPage: (n: number) => Promise.resolve(SEITEN[n] ?? SEITEN[1])
    } as never
  })
})

function zug(flaeche: HTMLElement, von: [number, number], nach: [number, number]): void {
  fireEvent.pointerDown(flaeche, { button: 0, pointerId: 1, clientX: von[0], clientY: von[1] })
  fireEvent.pointerMove(flaeche, { pointerId: 1, clientX: nach[0], clientY: nach[1] })
  fireEvent.pointerUp(flaeche, { pointerId: 1, clientX: nach[0], clientY: nach[1] })
}

describe('Zuschnittebene', () => {
  it('existiert nur mit dem Werkzeug Zuschneiden', async () => {
    useBearbeitung.setState({ werkzeug: 'auswahl' })
    const { rerender } = render(<Zuschnittebene index={0} />)
    expect(screen.queryByTestId('zuschnittflaeche-1')).toBeNull()
    act(() => {
      useBearbeitung.setState({ werkzeug: 'zuschneiden' })
    })
    rerender(<Zuschnittebene index={0} />)
    expect(await screen.findByTestId('zuschnittflaeche-1')).toBeTruthy()
  })

  it('zieht einen Rahmen auf - Pixel durch Zoom, als Raender in Punkten', async () => {
    render(<Zuschnittebene index={0} />)
    const flaeche = await screen.findByTestId('zuschnittflaeche-1')
    zug(flaeche, [100, 200], [1100, 1400])
    const { seite, raender, mass } = useZuschnitt.getState()
    expect(seite).toBe(1)
    expect(mass).toEqual({ breite: 600, hoehe: 800 })
    expect(raender).toEqual({ links: 50, oben: 100, rechts: 50, unten: 100 })
    const rahmen = screen.getByTestId('zuschnittrahmen-1')
    expect(rahmen.style.left).toBe('100px')
    expect(rahmen.style.width).toBe('1000px')
    expect(screen.getAllByTestId(/^zuschnittgriff-/)).toHaveLength(8)
  })

  it('macht aus einem blossen Klick keinen Rahmen', async () => {
    render(<Zuschnittebene index={0} />)
    const flaeche = await screen.findByTestId('zuschnittflaeche-1')
    zug(flaeche, [100, 200], [101, 201])
    expect(useZuschnitt.getState().raender).toBeNull()
    // Nur die linke Taste.
    fireEvent.pointerDown(flaeche, { button: 2, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(flaeche, { pointerId: 1, clientX: 400, clientY: 400 })
    expect(useZuschnitt.getState().raender).toBeNull()
  })

  it('aendert die Groesse am Griff und verschiebt im Inneren', async () => {
    useZuschnitt
      .getState()
      .setze(1, { breite: 600, hoehe: 800 }, { links: 50, oben: 100, rechts: 50, unten: 100 })
    render(<Zuschnittebene index={0} />)
    const griff = await screen.findByTestId('zuschnittgriff-rechtsUnten')
    fireEvent.pointerDown(griff, { button: 0, pointerId: 1, clientX: 1100, clientY: 1400 })
    fireEvent.pointerMove(griff, { pointerId: 1, clientX: 1080, clientY: 1360 })
    fireEvent.pointerUp(griff, { pointerId: 1 })
    expect(useZuschnitt.getState().raender).toEqual({
      links: 50,
      oben: 100,
      rechts: 60,
      unten: 120
    })
    const rahmen = screen.getByTestId('zuschnittrahmen-1')
    fireEvent.pointerDown(rahmen, { button: 0, pointerId: 1, clientX: 500, clientY: 500 })
    fireEvent.pointerMove(rahmen, { pointerId: 1, clientX: 400, clientY: 500 })
    fireEvent.pointerUp(rahmen, { pointerId: 1 })
    expect(useZuschnitt.getState().raender).toEqual({
      links: 0,
      oben: 100,
      rechts: 110,
      unten: 120
    })
  })

  it('rechnet auf einer gedrehten Seite mit dem gedrehten Mass', async () => {
    render(<Zuschnittebene index={1} />)
    const flaeche = await screen.findByTestId('zuschnittflaeche-2')
    zug(flaeche, [0, 0], [3000, 3000])
    expect(useZuschnitt.getState().mass).toEqual({ breite: 800, hoehe: 600 })
    expect(useZuschnitt.getState().raender).toEqual({ links: 0, oben: 0, rechts: 0, unten: 0 })
  })

  it('zeigt auf anderen Seiten keinen Rahmen', async () => {
    useZuschnitt
      .getState()
      .setze(2, { breite: 800, hoehe: 600 }, { links: 5, oben: 5, rechts: 5, unten: 5 })
    render(<Zuschnittebene index={0} />)
    await screen.findByTestId('zuschnittflaeche-1')
    expect(screen.queryByTestId('zuschnittrahmen-1')).toBeNull()
  })
})

describe('Zuschneideleiste', () => {
  it('sagt, dass ausgeblendete Bereiche in der Datei bleiben', () => {
    render(<Zuschneideleiste />)
    expect(screen.getByTestId('zuschnitt-hinweis').textContent).toBe(
      'Ausgeblendete Bereiche bleiben in der Datei enthalten.'
    )
    expect(screen.getByTestId('zuschnitt-stand').textContent).toContain('aufziehen')
    expect(screen.getByTestId<HTMLInputElement>('zuschnitt-links').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('zuschnitt-anwenden').disabled).toBe(true)
  })

  it('zeigt Raender und Groesse in mm und nimmt getippte Werte an', () => {
    render(<Zuschneideleiste />)
    act(() => {
      useZuschnitt
        .getState()
        .setze(1, { breite: 595.28, hoehe: 841.89 }, { links: 72, oben: 0, rechts: 0, unten: 0 })
    })
    const links = screen.getByTestId<HTMLInputElement>('zuschnitt-links')
    expect(links.value).toBe('25.4')
    expect(screen.getByTestId('zuschnitt-stand').textContent).toBe(
      'Rahmen auf Seite 1: 184,6 × 297 mm'
    )
    fireEvent.change(screen.getByTestId('zuschnitt-unten'), { target: { value: '10,5' } })
    expect(useZuschnitt.getState().raender?.unten).toBeCloseTo(ausMm(10.5), 6)
    // Halb getippt bleibt stehen, bis das Feld verlassen wird.
    fireEvent.change(links, { target: { value: '' } })
    expect(links.value).toBe('')
    fireEvent.blur(links)
    expect(links.value).toBe('25.4')
    // Ueber die Seite hinaus wird begrenzt.
    fireEvent.change(screen.getByTestId('zuschnitt-rechts'), { target: { value: '500' } })
    expect(useZuschnitt.getState().raender?.rechts).toBeCloseTo(595.28 - 72 - 10, 6)
  })

  it('bietet die Auswahl nur mit ausgewaehlten Seiten an', () => {
    render(<Zuschneideleiste />)
    const option = screen.getByRole<HTMLOptionElement>('option', { name: 'Ausgewählte Seiten' })
    expect(option.disabled).toBe(true)
    act(() => {
      useSeitenauswahl.setState({ ausgewaehlt: new Set([2, 3]) })
    })
    expect(option.disabled).toBe(false)
    fireEvent.change(screen.getByTestId('zuschnitt-ziel'), { target: { value: 'auswahl' } })
    expect(useZuschnitt.getState().ziel).toBe('auswahl')
  })

  it('wendet den Rahmen per Knopf als Mutation an und verwirft ihn danach', async () => {
    render(<Zuschneideleiste />)
    act(() => {
      useZuschnitt
        .getState()
        .setze(1, { breite: 600, hoehe: 800 }, { links: 10, oben: 20, rechts: 30, unten: 40 })
    })
    fireEvent.click(screen.getByTestId('zuschnitt-anwenden'))
    await waitFor(() => {
      expect(dokumentMutieren).toHaveBeenCalled()
    })
    expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
      art: 'seitenZuschneiden',
      zuschnitte: [{ seite: 1, rahmen: [10, 40, 570, 780] }]
    })
    await waitFor(() => {
      expect(useZuschnitt.getState().raender).toBeNull()
    })
    expect(useHistorie.getState().vergangenheit.at(-1)?.beschreibung).toBe('Seite 1 zuschneiden')
  })

  it('hebt den Zuschnitt per Knopf auf', async () => {
    render(<Zuschneideleiste />)
    fireEvent.click(screen.getByTestId('zuschnitt-aufheben'))
    await waitFor(() => {
      expect(dokumentMutieren).toHaveBeenCalled()
    })
    expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
      art: 'seitenZuschneiden',
      zuschnitte: [{ seite: 1, rahmen: null }]
    })
  })

  it('verwirft den Rahmen beim Verlassen des Werkzeugs', () => {
    const { unmount } = render(<Zuschneideleiste />)
    act(() => {
      useZuschnitt
        .getState()
        .setze(1, { breite: 600, hoehe: 800 }, { links: 1, oben: 1, rechts: 1, unten: 1 })
    })
    unmount()
    expect(useZuschnitt.getState().raender).toBeNull()
  })

  it('erscheint in der Werkzeugleiste nur mit dem Werkzeug', () => {
    useBearbeitung.setState({ werkzeug: 'auswahl' })
    render(<Werkzeugleiste />)
    expect(screen.queryByTestId('zuschneiden')).toBeNull()
    fireEvent.click(screen.getByTestId('werkzeug-zuschneiden'))
    expect(useBearbeitung.getState().werkzeug).toBe('zuschneiden')
    expect(screen.getByTestId('zuschneiden')).toBeTruthy()
  })
})

describe('zuschnitt.ts', () => {
  it('waehlt die Zielseiten', () => {
    expect(zuschnittSeiten('seite')).toEqual([1])
    useDokument.setState({ aktuelleSeite: 3 })
    useZuschnitt.setState({ seite: 2 })
    expect(zuschnittSeiten('seite')).toEqual([2])
    expect(zuschnittSeiten('alle')).toEqual([1, 2, 3])
    // Ohne Auswahl die Seite des Rahmens.
    expect(zuschnittSeiten('auswahl')).toEqual([2])
    useSeitenauswahl.setState({ ausgewaehlt: new Set([3, 1]) })
    expect(zuschnittSeiten('auswahl')).toEqual([1, 3])
  })

  it('rechnet dieselben Raender fuer alle Seiten je Seite um', async () => {
    useZuschnitt.setState({
      seite: 1,
      mass: { breite: 600, hoehe: 800 },
      raender: { links: 10, oben: 20, rechts: 30, unten: 40 },
      ziel: 'alle'
    })
    useDokument.setState({ seitenzahl: 2 })
    expect(await schneideZu()).toBe(true)
    expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
      art: 'seitenZuschneiden',
      zuschnitte: [
        { seite: 1, rahmen: [10, 40, 570, 780] },
        { seite: 2, rahmen: [120, 60, 660, 820] }
      ]
    })
  })

  it('meldet eine zu kleine Seite, statt halb zuzuschneiden', async () => {
    useZuschnitt.setState({
      seite: 1,
      mass: { breite: 600, hoehe: 800 },
      raender: { links: 10, oben: 20, rechts: 30, unten: 40 },
      ziel: 'alle'
    })
    expect(await schneideZu()).toBe(false)
    expect(dokumentMutieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toBe('Seite 3 ist für diese Ränder zu klein.')
  })

  it('verlangt einen Rahmen und ein Dokument', async () => {
    expect(await schneideZu()).toBe(false)
    expect(useDokument.getState().hinweis).toContain('Rahmen')
    useDokument.setState({ dokument: null })
    expect(await schneideZu()).toBe(false)
  })

  it('behaelt den Rahmen, wenn der Main ablehnt', async () => {
    dokumentMutieren.mockResolvedValue({ art: 'abgelehnt', grund: 'Nein.' })
    useZuschnitt.setState({
      seite: 1,
      mass: { breite: 600, hoehe: 800 },
      raender: { links: 10, oben: 20, rechts: 30, unten: 40 }
    })
    expect(await schneideZu()).toBe(false)
    expect(useZuschnitt.getState().raender).not.toBeNull()
    expect(await hebeZuschnittAuf()).toBe(false)
  })
})

describe('zuschnitt-store', () => {
  it('begrenzt beim Setzen und Aendern, ohne Mass bleibt alles', () => {
    const zustand = useZuschnitt.getState()
    zustand.aendere({ links: 1, oben: 1, rechts: 1, unten: 1 })
    expect(useZuschnitt.getState().raender).toBeNull()
    zustand.setze(1, { breite: 100, hoehe: 100 }, { links: -5, oben: 0, rechts: 200, unten: 0 })
    expect(useZuschnitt.getState().raender).toEqual({ links: 0, oben: 0, rechts: 90, unten: 0 })
    useZuschnitt.getState().verwerfe()
    expect(useZuschnitt.getState().seite).toBeNull()
  })
})

describe('Befehl werkzeugZuschneiden', () => {
  function Huelle(): React.JSX.Element {
    useBefehle({ seite: createRef<HTMLInputElement>(), suche: createRef<HTMLInputElement>() })
    return <div />
  }

  it('waehlt das Werkzeug ueber Strg+Umschalt+B', () => {
    useBearbeitung.setState({ werkzeug: 'auswahl' })
    render(<Huelle />)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true })
    )
    expect(useBearbeitung.getState().werkzeug).toBe('zuschneiden')
    // Escape fuehrt wie bei jedem Werkzeug zurueck zur Auswahl.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(useBearbeitung.getState().werkzeug).toBe('auswahl')
  })
})
