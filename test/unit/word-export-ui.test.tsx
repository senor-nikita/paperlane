import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeicherErgebnis, WordAuftrag } from '../../src/shared/ipc'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useDokumentwerkzeuge } =
  await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
const { Dokumentwerkzeuge } = await import('../../src/renderer/src/schale/Dokumentwerkzeuge')
const { useBefehle } = await import('../../src/renderer/src/schale/befehle')
const { brichWordExportAb, exportiereWord } =
  await import('../../src/renderer/src/schale/word-export-logik')
const { hatTextebene, pngAusBild, MAX_BILD_KANTE } =
  await import('../../src/renderer/src/word-extraktion')
const { laufenderVorgang, vergissVorgaenge } = await import('../../src/renderer/src/vorgaenge')

/**
 * PDF nach Word im Renderer (S6.7): das Feld mit den Grenzen vorab, der
 * Hinweis ohne Textebene, Fortschritt und Abbruch, der Weg ueber Kuerzel und
 * Menue - und die Umwandlung der pdf.js-Bilder in PNG. jsdom hat kein Canvas;
 * Kontext und Kodierung sind nachgestellt wie im PNG-Export-Test.
 */

interface FakeItem {
  str: string
  transform: number[]
  width: number
  fontName: string
}

/** Ein Dokument, dessen Seiten je einen Text tragen (leer = Scan). */
function fakeDokument(texte: string[], warte?: Promise<void>) {
  const seiten = texte.map((text) => ({
    view: [0, 0, 595, 842],
    commonObjs: { has: () => false, get: vi.fn() },
    objs: { get: vi.fn() },
    getOperatorList: vi.fn(async () => {
      if (warte !== undefined) await warte
      return { fnArray: [], argsArray: [] }
    }),
    getTextContent: vi.fn(() =>
      Promise.resolve({
        items: [
          { type: 'beginMarkedContent' },
          { str: text, transform: [11, 0, 0, 11, 72, 700], width: 100, fontName: 'f1' }
        ] as (FakeItem | { type: string })[],
        styles: { f1: { fontFamily: 'sans-serif' } }
      })
    )
  }))
  return {
    numPages: seiten.length,
    getPage: vi.fn((nummer: number) => Promise.resolve(seiten[nummer - 1]))
  }
}

const wordExportieren = vi.fn<(auftrag: WordAuftrag) => Promise<SpeicherErgebnis>>()

function Huelle(): React.JSX.Element {
  useBefehle({ seite: createRef<HTMLInputElement>(), suche: createRef<HTMLInputElement>() })
  return <Dokumentwerkzeuge />
}

beforeEach(() => {
  wordExportieren.mockReset()
  vergissVorgaenge()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { wordExportieren, beiEreignis: () => () => undefined }
  })
  useDokumentwerkzeuge.setState({ offen: null, laeuft: false, fortschritt: null })
  useDokument.setState({
    pfad: 'C:\\d\\bericht.pdf',
    ladeZustand: 'bereit',
    seitenzahl: 2,
    hinweis: null,
    dokument: fakeDokument(['Hallo', 'Welt']) as unknown as ReturnType<
      typeof useDokument.getState
    >['dokument']
  })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    createImageData: (b: number, h: number) => ({ data: new Uint8ClampedArray(b * h * 4) })
  })) as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toBlob = function (rueckruf: BlobCallback): void {
    rueckruf(new Blob([new Uint8Array([0x89, 0x50, this.width % 256, this.height % 256])]))
  }
})

describe('Befehl und Feld', () => {
  it('oeffnet das Feld ueber Strg+Umschalt+J und nennt die Grenzen', async () => {
    render(<Huelle />)
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'J', ctrlKey: true, shiftKey: true, bubbles: true })
      )
    })
    expect(useDokumentwerkzeuge.getState().offen).toBe('word')
    expect(screen.getByTestId('word-grenzen').textContent).toMatch(/Tabellen.*Texterkennung/s)
    expect(screen.getByTestId('word-ausfuehren').textContent).toBe('Exportieren… (2 Seiten)')
    // Die Pruefung auf eine Textebene findet Text: kein Hinweis.
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('word-kein-text')).toBeNull()
  })

  it('sagt ohne Dokument, dass eines offen sein muss', () => {
    useDokument.setState({ ladeZustand: 'leer' })
    render(<Huelle />)
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, shiftKey: true, bubbles: true })
      )
    })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useDokument.getState().hinweis).toBe('Zum Exportieren muss ein Dokument geöffnet sein.')
  })

  it('warnt vorab, wenn das Dokument keine Textebene hat', async () => {
    useDokument.setState({
      dokument: fakeDokument(['', ' ']) as unknown as ReturnType<
        typeof useDokument.getState
      >['dokument']
    })
    useDokumentwerkzeuge.setState({ offen: 'word' })
    render(<Dokumentwerkzeuge />)
    expect(await screen.findByTestId('word-kein-text')).toBeTruthy()
  })

  it('exportiert mit und ohne Seitenumbruch und meldet das Ergebnis', async () => {
    wordExportieren.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\d\\bericht.docx',
      name: 'bericht.docx'
    })
    useDokumentwerkzeuge.setState({ offen: 'word' })
    render(<Dokumentwerkzeuge />)
    fireEvent.click(screen.getByTestId('word-seitenumbruch'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('word-ausfuehren'))
      await vi.waitFor(() => {
        expect(useDokument.getState().hinweis).not.toBeNull()
      })
    })
    expect(useDokument.getState().hinweis).toBe('Als Word-Dokument exportiert: bericht.docx.')
    const auftrag = wordExportieren.mock.calls[0]?.[0]
    expect(auftrag?.seitenumbruch).toBe(false)
    expect(auftrag?.quelle).toBe('C:\\d\\bericht.pdf')
    expect(auftrag?.seiten.map((s) => s.bloecke.length)).toEqual([1, 1])
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useDokumentwerkzeuge.getState().laeuft).toBe(false)
  })

  it('schliesst mit Abbrechen, solange nichts laeuft', () => {
    useDokumentwerkzeuge.setState({ offen: 'word' })
    render(<Dokumentwerkzeuge />)
    fireEvent.click(screen.getByTestId('word-abbrechen'))
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
  })
})

describe('exportiereWord', () => {
  it('zeigt den Fortschritt und bricht auf Wunsch ab, ohne den Main zu fragen', async () => {
    let freigeben: () => void = () => undefined
    const warte = new Promise<void>((erfuelle) => {
      freigeben = erfuelle
    })
    useDokument.setState({
      dokument: fakeDokument(['a', 'b', 'c'], warte) as unknown as ReturnType<
        typeof useDokument.getState
      >['dokument']
    })
    useDokumentwerkzeuge.setState({ offen: 'word' })
    render(<Dokumentwerkzeuge />)
    let lauf: Promise<void> = Promise.resolve()
    act(() => {
      lauf = exportiereWord({ seitenumbruch: true })
    })
    expect(await screen.findByTestId('word-fortschritt')).toHaveProperty(
      'textContent',
      'Seite 1 von 3 wird gelesen…'
    )
    expect(laufenderVorgang()).toBe('word')
    fireEvent.click(screen.getByTestId('word-abbrechen'))
    await act(async () => {
      freigeben()
      await lauf
    })
    expect(wordExportieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toBe('Der Export nach Word wurde abgebrochen.')
    expect(laufenderVorgang()).toBeNull()
    expect(useDokumentwerkzeuge.getState().fortschritt).toBeNull()
  })

  it('zeigt die Ablehnung des Main und laesst das Feld offen', async () => {
    wordExportieren.mockResolvedValue({ art: 'abgelehnt', grund: 'Nein.' })
    useDokumentwerkzeuge.setState({ offen: 'word' })
    await exportiereWord({ seitenumbruch: true })
    expect(useDokument.getState().hinweis).toBe('Nein.')
    expect(useDokumentwerkzeuge.getState().offen).toBe('word')
  })

  it('bleibt still, wenn der Dialog abgebrochen wird', async () => {
    wordExportieren.mockResolvedValue({ art: 'abgebrochen' })
    await exportiereWord({ seitenumbruch: true })
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('faengt Fehler ab', async () => {
    wordExportieren.mockRejectedValue(new Error('weg'))
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await exportiereWord({ seitenumbruch: true })
    expect(useDokument.getState().hinweis).toBe(
      'Das Dokument ließ sich nicht als Word-Dokument exportieren.'
    )
    konsole.mockRestore()
  })

  it('tut nichts ohne Dokument oder waehrend eines Laufs', async () => {
    useDokumentwerkzeuge.setState({ laeuft: true })
    await exportiereWord({ seitenumbruch: true })
    useDokumentwerkzeuge.setState({ laeuft: false })
    useDokument.setState({ dokument: null })
    await exportiereWord({ seitenumbruch: true })
    expect(wordExportieren).not.toHaveBeenCalled()
    brichWordExportAb()
  })

  // Review L2: endet waehrend des seitenweisen Lesens eine Mutation, gibt
  // `uebernimm` das alte pdf.js-Proxy frei - der Export scheitert dann mit
  // einer allgemeinen Fehlermeldung statt eines klaren Hinweises. Erst nach
  // der Mutation (oder Rueckgaengig/Wiederholen) exportieren.
  it('wartet, solange eine Mutation laeuft', async () => {
    const { useMutation } = await import('../../src/renderer/src/mutation-store')
    useMutation.setState({ laeuft: { art: 'seitenLoeschen', seiten: [1] } })
    await exportiereWord({ seitenumbruch: true })
    expect(wordExportieren).not.toHaveBeenCalled()
    useMutation.setState({ laeuft: null, anzahl: 0, erwarteNeuladen: false, letzteDauerMs: null })
  })

  it('wartet, solange Rueckgaengig/Wiederholen beschaeftigt ist', async () => {
    const { useHistorie } = await import('../../src/renderer/src/historie')
    useHistorie.setState({ beschaeftigt: true })
    await exportiereWord({ seitenumbruch: true })
    expect(wordExportieren).not.toHaveBeenCalled()
    useHistorie.setState({ beschaeftigt: false })
  })
})

describe('hatTextebene', () => {
  it('sucht bis zur ersten Seite mit Text', async () => {
    const dokument = fakeDokument(['', 'Text', 'mehr'])
    expect(await hatTextebene(dokument as never)).toBe(true)
    expect(dokument.getPage).toHaveBeenCalledTimes(2)
    expect(await hatTextebene(fakeDokument(['', '']) as never)).toBe(false)
    expect(await hatTextebene(fakeDokument(['']) as never, () => true)).toBe(true)
  })
})

describe('pngAusBild', () => {
  it('wandelt Rohdaten ueber ImageData', async () => {
    const png = await pngAusBild({ width: 2, height: 1, kind: 2, data: new Uint8Array(6) })
    expect(png).toEqual(new Uint8Array([0x89, 0x50, 2, 1]))
  })

  it('verkleinert grosse Bilder auf die Hoechstkante', async () => {
    const png = await pngAusBild({
      width: MAX_BILD_KANTE * 2,
      height: 4,
      kind: 3,
      data: new Uint8Array(MAX_BILD_KANTE * 2 * 4 * 4)
    })
    expect(png).toEqual(new Uint8Array([0x89, 0x50, MAX_BILD_KANTE % 256, 2]))
  })

  it('zeichnet eine Bitmap direkt', async () => {
    const png = await pngAusBild({ width: 3, height: 3, bitmap: { width: 3, height: 3 } })
    expect(png).toEqual(new Uint8Array([0x89, 0x50, 3, 3]))
  })

  it('liefert null fuer Unbrauchbares', async () => {
    expect(await pngAusBild({ width: 0, height: 1 })).toBeNull()
    expect(await pngAusBild({ width: 1, height: 1, kind: 9, data: new Uint8Array(3) })).toBeNull()
    expect(await pngAusBild({ width: 1, height: 1, kind: 2, data: [1, 2, 3] })).toBeNull()
  })
})
