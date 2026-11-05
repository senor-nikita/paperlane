import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationsAuftrag, MutationsErgebnis } from '../../src/shared/ipc'
import type { TextBericht } from '../../src/shared/mutation'

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
const { Textbearbeitungsebene } =
  await import('../../src/renderer/src/viewer/Textbearbeitungsebene')
const { Werkzeugleiste } = await import('../../src/renderer/src/schale/Werkzeugleiste')
const { useBefehle } = await import('../../src/renderer/src/schale/befehle')

/**
 * S6.6b im Renderer: Klickflaechen je Zeile, Eingabefeld an Ort und Stelle,
 * Ersetzen/Loeschen/Abbrechen, der Hinweis zur Schrift nach dem Anwenden,
 * Werkzeug und Kuerzel. Zoom 2 - Pixel und Punkte sollen nicht verwechselt
 * werden.
 */
const PFAD = 'C:\\dokumente\\brief.pdf'
const dokumentMutieren = vi.fn<(auftrag: MutationsAuftrag) => Promise<MutationsErgebnis>>()
const uebernimm = vi.fn<(...args: unknown[]) => Promise<void>>()

const ITEMS = [
  { str: 'Sehr geehrte', transform: [12, 0, 0, 12, 72, 700], width: 70 },
  { str: 'Damen', transform: [12, 0, 0, 12, 145, 700], width: 35 },
  { str: 'Zweite Zeile', transform: [12, 0, 0, 12, 72, 680], width: 60 },
  { hasEOL: true, type: 'beginMarkedContent' }
]

function ergebnis(bericht?: TextBericht): MutationsErgebnis {
  return {
    art: 'angewendet',
    dokument: { pfad: PFAD, name: 'brief.pdf', bytes: new Uint8Array([1]) },
    dauerMs: 5,
    stand: { vorher: 0, nachher: 1 },
    ...(bericht === undefined ? {} : { bericht })
  }
}

beforeEach(() => {
  dokumentMutieren.mockReset().mockResolvedValue(ergebnis({ schrift: 'original' }))
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
  useBearbeitung.setState({ werkzeug: 'textBearbeiten', ausgewaehlt: null, anwendenAuf: null })
  useDokument.setState({
    ladeZustand: 'bereit',
    pfad: PFAD,
    name: 'brief.pdf',
    verschluesselt: false,
    seitenzahl: 1,
    aktuelleSeite: 1,
    zoom: 2,
    rotation: 0,
    passung: 'frei',
    hinweis: null,
    uebernimm,
    dokument: {
      getPage: () =>
        Promise.resolve({
          view: [0, 0, 600, 800],
          rotate: 0,
          getTextContent: () => Promise.resolve({ items: ITEMS })
        })
    } as never
  })
})

describe('Textbearbeitungsebene', () => {
  it('existiert nur mit dem Werkzeug Text bearbeiten', async () => {
    useBearbeitung.setState({ werkzeug: 'auswahl' })
    const { rerender } = render(<Textbearbeitungsebene index={0} />)
    expect(screen.queryByTestId('textbearbeitung-1')).toBeNull()
    act(() => {
      useBearbeitung.setState({ werkzeug: 'textBearbeiten' })
    })
    rerender(<Textbearbeitungsebene index={0} />)
    expect(await screen.findByTestId('textbearbeitung-1')).toBeTruthy()
  })

  it('legt je Zeile eine Klickflaeche an der richtigen Stelle an', async () => {
    render(<Textbearbeitungsebene index={0} />)
    const erste = await screen.findByTestId('textzeile-1-0')
    expect(erste.getAttribute('aria-label')).toBe('Zeile bearbeiten: Sehr geehrte Damen')
    // x 72 pt * 2; oben: Grundlinie 700 + 12 pt -> 800 - 712 = 88 pt * 2.
    expect(erste.style.left).toBe('144px')
    expect(erste.style.top).toBe('176px')
    expect(erste.style.width).toBe(String((180 - 72) * 2) + 'px')
    expect(screen.getByTestId('textzeile-1-1').getAttribute('aria-label')).toBe(
      'Zeile bearbeiten: Zweite Zeile'
    )
  })

  it('Enter ersetzt: Mutation mit Zeile und Text, Hinweis nennt die Originalschrift', async () => {
    render(<Textbearbeitungsebene index={0} />)
    fireEvent.click(await screen.findByTestId('textzeile-1-0'))
    const feld = screen.getByTestId('textzeile-eingabe')
    expect(feld).toHaveProperty('value', 'Sehr geehrte Damen')
    expect(document.activeElement).toBe(feld)
    fireEvent.change(feld, { target: { value: 'Liebe Damen' } })
    fireEvent.keyDown(feld, { key: 'Enter' })
    await waitFor(() => {
      expect(dokumentMutieren).toHaveBeenCalledTimes(1)
    })
    const auftrag = dokumentMutieren.mock.calls[0]?.[0]
    expect(auftrag?.mutation).toMatchObject({
      art: 'textErsetzen',
      seite: 1,
      text: 'Liebe Damen',
      zeile: { text: 'Sehr geehrte Damen', grundlinie: 700, von: 72, winkel: 0 }
    })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toBe(
        'Zeile ersetzen (Seite 1): angewendet – Originalschrift benutzt. Noch nicht gespeichert.'
      )
    })
    expect(useHistorie.getState().vergangenheit.at(-1)?.beschreibung).toBe(
      'Zeile ersetzen (Seite 1)'
    )
    expect(screen.queryByTestId('textzeile-eingabe')).toBeNull()
  })

  it('Ersatzschrift wird im Hinweis und im Historieneintrag markiert', async () => {
    dokumentMutieren.mockResolvedValue(
      ergebnis({ schrift: 'ersatz', ersatzschrift: 'Helvetica', grund: 'Glyph fehlt: 7' })
    )
    render(<Textbearbeitungsebene index={0} />)
    fireEvent.click(await screen.findByTestId('textzeile-1-1'))
    const feld = screen.getByTestId('textzeile-eingabe')
    fireEvent.change(feld, { target: { value: 'Zeile 7' } })
    fireEvent.keyDown(feld, { key: 'Enter' })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toContain(
        'Ersatzschrift Helvetica benutzt – Originalschrift reicht nicht: Glyph fehlt: 7'
      )
    })
    expect(useHistorie.getState().vergangenheit.at(-1)?.beschreibung).toBe(
      'Zeile ersetzen (Seite 1) (Ersatzschrift)'
    )
  })

  it('Entf auf dem ganz markierten Text loescht die Zeile', async () => {
    dokumentMutieren.mockResolvedValue(ergebnis({ schrift: 'keine' }))
    render(<Textbearbeitungsebene index={0} />)
    fireEvent.click(await screen.findByTestId('textzeile-1-1'))
    fireEvent.keyDown(screen.getByTestId('textzeile-eingabe'), { key: 'Delete' })
    await waitFor(() => {
      expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toMatchObject({ text: '' })
    })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toContain('Zeile löschen (Seite 1): angewendet')
    })
  })

  it('leer und Enter loescht ebenfalls', async () => {
    render(<Textbearbeitungsebene index={0} />)
    fireEvent.click(await screen.findByTestId('textzeile-1-1'))
    const feld = screen.getByTestId('textzeile-eingabe')
    fireEvent.change(feld, { target: { value: '' } })
    fireEvent.keyDown(feld, { key: 'Enter' })
    await waitFor(() => {
      expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toMatchObject({ text: '' })
    })
  })

  it('Entf mitten im Text loescht nur ein Zeichen; Esc, Blur und Unveraendert tun nichts', async () => {
    render(<Textbearbeitungsebene index={0} />)
    fireEvent.click(await screen.findByTestId('textzeile-1-1'))
    const feld = screen.getByTestId('textzeile-eingabe')
    if (feld instanceof HTMLInputElement) feld.setSelectionRange(2, 2)
    fireEvent.keyDown(feld, { key: 'Delete' })
    fireEvent.keyDown(feld, { key: 'a' })
    expect(screen.getByTestId('textzeile-eingabe')).toBeTruthy()
    fireEvent.keyDown(feld, { key: 'Escape' })
    expect(screen.queryByTestId('textzeile-eingabe')).toBeNull()
    // Escape bleibt im Feld und wechselt nicht nebenbei das Werkzeug.
    expect(useBearbeitung.getState().werkzeug).toBe('textBearbeiten')

    fireEvent.click(screen.getByTestId('textzeile-1-1'))
    fireEvent.blur(screen.getByTestId('textzeile-eingabe'))
    expect(screen.queryByTestId('textzeile-eingabe')).toBeNull()

    fireEvent.click(screen.getByTestId('textzeile-1-1'))
    fireEvent.keyDown(screen.getByTestId('textzeile-eingabe'), { key: 'Enter' })
    expect(dokumentMutieren).not.toHaveBeenCalled()
  })

  it('Ablehnung: der Grund steht im Hinweis', async () => {
    dokumentMutieren.mockResolvedValue({
      art: 'abgelehnt',
      grund: 'Die Aenderung liess sich nicht anwenden: Nicht bearbeitbar: Type3-Schrift X.'
    })
    render(<Textbearbeitungsebene index={0} />)
    fireEvent.click(await screen.findByTestId('textzeile-1-0'))
    const feld = screen.getByTestId('textzeile-eingabe')
    fireEvent.change(feld, { target: { value: 'x' } })
    fireEvent.keyDown(feld, { key: 'Enter' })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toContain('Type3-Schrift')
    })
    expect(uebernimm).not.toHaveBeenCalled()
  })

  it('meldet einen Lesefehler, ohne zu stuerzen', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useDokument.setState({
      dokument: { getPage: () => Promise.reject(new Error('kaputt')) } as never
    })
    render(<Textbearbeitungsebene index={0} />)
    await waitFor(() => {
      expect(fehler).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('textzeile-1-0')).toBeNull()
    fehler.mockRestore()
  })
})

describe('Werkzeug und Kuerzel', () => {
  function Huelle(): React.JSX.Element {
    useBefehle({ seite: createRef<HTMLInputElement>(), suche: createRef<HTMLInputElement>() })
    return <div />
  }

  it('Strg+Umschalt+L waehlt das Werkzeug, die Leiste zeigt den Hinweis', () => {
    useBearbeitung.setState({ werkzeug: 'auswahl' })
    render(
      <>
        <Huelle />
        <Werkzeugleiste />
      </>
    )
    expect(screen.queryByTestId('textbearbeitung-hinweis')).toBeNull()
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true, bubbles: true })
      )
    })
    expect(useBearbeitung.getState().werkzeug).toBe('textBearbeiten')
    expect(screen.getByTestId('werkzeug-textBearbeiten').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('textbearbeitung-hinweis').textContent).toContain('Ersatzschrift')
  })
})
