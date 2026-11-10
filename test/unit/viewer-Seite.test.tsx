import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { Seite } = await import('../../src/renderer/src/viewer/Seite')
const { RenderQueue } = await import('../../src/renderer/src/viewer/renderqueue')

const PLATZ = { index: 0, oben: 0, breite: 595, hoehe: 842 }

function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({})
  ) as unknown as HTMLCanvasElement['getContext']
}

function fakeSeite(abbruch: () => void) {
  return {
    getViewport: vi.fn(({ scale = 1 }: { scale?: number }) => ({
      width: 595 * scale,
      height: 842 * scale
    })),
    // Ohne Unterschriftsfelder: die Seite hat nur eine Annotationsliste.
    getAnnotations: vi.fn(() => Promise.resolve([] as unknown[])),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: abbruch }))
  }
}

beforeEach(() => {
  stubCanvas()
  useDokument.setState({ zoom: 1, rotation: 0, seitenGroessen: [{ breite: 595, hoehe: 842 }] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Seite', () => {
  it('zeichnet und setzt die Canvas-Masse', async () => {
    const seite = fakeSeite(vi.fn())
    useDokument.setState({ dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never })
    const { getByTestId } = render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
    await waitFor(() => {
      expect(seite.render).toHaveBeenCalledTimes(1)
    })
    const canvas = getByTestId('seiten-canvas-1') as HTMLCanvasElement
    expect(canvas.width).toBeGreaterThan(100)
    // S5.2a, Aufgabe 4: das Bild hat Rolle und Namen fuer Screenreader.
    expect(canvas.getAttribute('role')).toBe('img')
    expect(canvas.getAttribute('aria-label')).toBe('Seite 1')
  })

  // Befund vom 2026-11-10: ein mit einem anderen Programm signiertes Formular
  // zeigte die Unterschrift nicht. `annotationMode: DISABLE` malt kein
  // Unterschriftsfeld, und die Formularebene setzt nur eine leere Flaeche
  // darueber. Die Seite holt das Aussehen jetzt in einem zweiten Durchgang nach.
  describe('Unterschriften', () => {
    const unterschrift = {
      subtype: 'Widget',
      fieldType: 'Sig',
      hasAppearance: true,
      rect: [50, 100, 150, 150]
    }

    function seiteMitUnterschrift(
      zweiterDurchgang: () => { promise: Promise<void>; cancel: () => void }
    ) {
      const render = vi
        .fn()
        .mockReturnValueOnce({ promise: Promise.resolve(), cancel: vi.fn() })
        .mockImplementation(zweiterDurchgang)
      const blick = {
        width: 595,
        height: 842,
        offsetX: 0,
        offsetY: 0,
        // pdf.js 6: nur noch die Matrix, y' = 842 - y.
        transform: [1, 0, 0, -1, 0, 842],
        clone: vi.fn(() => ({ art: 'ausschnitt' }))
      }
      return {
        getViewport: vi.fn(() => blick),
        getAnnotations: vi.fn(() => Promise.resolve([unterschrift])),
        render
      }
    }

    it('zeichnet das Aussehen einer Unterschrift im Modus ENABLE_FORMS nach', async () => {
      const drawImage = vi.fn()
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        drawImage
      })) as unknown as HTMLCanvasElement['getContext']
      const seite = seiteMitUnterschrift(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
      useDokument.setState({ dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never })
      render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
      await waitFor(() => {
        expect(drawImage).toHaveBeenCalledTimes(1)
      })
      // Erst die Seite selbst mit DISABLE, dann das Rechteck des Feldes mit
      // ENABLE_FORMS (2).
      expect(seite.render).toHaveBeenCalledTimes(2)
      expect(seite.render.mock.calls[0]?.[0]).toMatchObject({ annotationMode: 0 })
      expect(seite.render.mock.calls[1]?.[0]).toMatchObject({ annotationMode: 2 })
    })

    it('laesst die Seite stehen, wenn das Nachzeichnen scheitert', async () => {
      const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        drawImage: vi.fn()
      })) as unknown as HTMLCanvasElement['getContext']
      const seite = seiteMitUnterschrift(() => ({
        promise: Promise.reject(new Error('kaputt')),
        cancel: vi.fn()
      }))
      useDokument.setState({ dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never })
      const { queryByTestId } = render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
      await waitFor(() => {
        expect(fehler).toHaveBeenCalledWith(
          expect.stringContaining('Unterschriften'),
          expect.any(Error)
        )
      })
      // Die Unterschrift fehlt, die Seite bleibt lesbar und gilt nicht als kaputt.
      expect(queryByTestId('seite-kaputt-1')).toBeNull()
    })

    it('meldet einen abgebrochenen Auftrag nicht als Fehler', async () => {
      const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        drawImage: vi.fn()
      })) as unknown as HTMLCanvasElement['getContext']
      const abbruch = Object.assign(new Error('abgebrochen'), {
        name: 'RenderingCancelledException'
      })
      const seite = seiteMitUnterschrift(() => ({
        promise: Promise.reject(abbruch),
        cancel: vi.fn()
      }))
      useDokument.setState({ dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never })
      render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
      await waitFor(() => {
        expect(seite.render).toHaveBeenCalledTimes(2)
      })
      await Promise.resolve()
      // Die Attrappe hat kein `getTextContent`; die Textebene daneben meldet
      // das selbst. Hier zaehlt nur die Meldung zu den Unterschriften.
      expect(fehler).not.toHaveBeenCalledWith(
        expect.stringContaining('Unterschriften'),
        expect.anything()
      )
    })
  })

  it('gibt die Drehung an getViewport weiter, nicht an CSS', async () => {
    const seite = fakeSeite(vi.fn())
    useDokument.setState({
      dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never,
      rotation: 90
    })
    render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
    await waitFor(() => {
      expect(seite.render).toHaveBeenCalled()
    })
    const argumente = seite.getViewport.mock.calls.at(-1)?.[0] as { rotation?: number }
    expect(argumente.rotation).toBe(90)
  })

  // Befund vor S4.2b: `rotation` an getViewport ersetzt die Seitendrehung
  // (`/Rotate`), statt sie zu ergaenzen. Eine quer gespeicherte Seite muss
  // deshalb mit ihrer eigenen Drehung plus der Ansichtsdrehung gezeichnet
  // werden - sonst erschiene sie hochkant, und S4.1 "dauerhaft drehen" waere
  // im eigenen Viewer unsichtbar.
  it('rechnet die Seitendrehung aus dem Dokument hinzu', async () => {
    const seite = { ...fakeSeite(vi.fn()), rotate: 90 }
    useDokument.setState({
      dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never,
      rotation: 90
    })
    render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
    await waitFor(() => {
      expect(seite.render).toHaveBeenCalled()
    })
    const argumente = seite.getViewport.mock.calls.at(-1)?.[0] as { rotation?: number }
    expect(argumente.rotation).toBe(180)
  })

  it('traegt die echte Seitengroesse nach', async () => {
    const seite = fakeSeite(vi.fn())
    seite.getViewport = vi.fn(() => ({ width: 300, height: 400 }))
    useDokument.setState({ dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never })
    render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
    await waitFor(() => {
      expect(useDokument.getState().seitenGroessen[0]).toEqual({ breite: 300, hoehe: 400 })
    })
  })

  // Ein bereits fertiger Auftrag wird zu Recht nicht mehr abgebrochen.
  // Geprueft gehoert der noch laufende: sonst arbeitet pdf.js beim Scrollen
  // Seiten ab, die laengst aus dem Sichtfenster sind.
  it('bricht einen noch laufenden Auftrag beim Abbauen ab', async () => {
    const abbruch = vi.fn()
    const seite = fakeSeite(abbruch)
    // Ein Auftrag, der nie fertig wird.
    seite.render = vi.fn(() => ({ promise: new Promise<void>(() => undefined), cancel: abbruch }))
    useDokument.setState({ dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } as never })
    const { unmount } = render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
    await waitFor(() => {
      expect(seite.render).toHaveBeenCalled()
    })
    unmount()
    expect(abbruch).toHaveBeenCalled()
  })
  it('tut nichts ohne Dokument', () => {
    useDokument.setState({ dokument: null })
    const { getByTestId } = render(<Seite platz={PLATZ} queue={new RenderQueue()} />)
    expect(getByTestId('seite-1')).toBeDefined()
  })
})
