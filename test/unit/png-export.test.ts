import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PngSchreibErgebnis, PngZielErgebnis } from '../../src/shared/ipc'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useDokumentwerkzeuge } =
  await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
const { beschreibeErgebnis, exportierePng, renderePng } =
  await import('../../src/renderer/src/png-export')

/**
 * PNG-Export im Renderer (S4.2b): Canvas-Renderpfad mit Haertung, Drehung
 * wie angezeigt, Begrenzung an der Canvas-Kante, und der Ablauf gegen den
 * Main - erst die Ziele, dann je Bild die Bytes.
 */
const PNG_KOPF = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A4 hochkant mit `/Rotate 90`: pdf.js liefert die Masse bereits gedreht. */
function fakeDokument(rotate = 0) {
  const seite = {
    rotate,
    getViewport: vi.fn(({ scale, rotation }: { scale: number; rotation: number }) => {
      const quer = rotation % 180 !== 0
      return { width: (quer ? 842 : 595) * scale, height: (quer ? 595 : 842) * scale }
    }),
    render: vi.fn<
      (auftrag: { annotationMode: number }) => { promise: Promise<void>; cancel: () => void }
    >(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  }
  return { seite, dokument: { getPage: vi.fn(() => Promise.resolve(seite)) } }
}

const pngZieleWaehlen = vi.fn<(a: unknown) => Promise<PngZielErgebnis>>()
const pngSchreiben =
  vi.fn<(a: { pfad: string; bytes: Uint8Array }) => Promise<PngSchreibErgebnis>>()

beforeEach(() => {
  // jsdom hat kein Canvas: Kontext und PNG-Kodierung werden nachgestellt,
  // die Masse des Canvas bleiben echt.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    fillStyle: ''
  })) as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toBlob = function (rueckruf: BlobCallback): void {
    rueckruf(new Blob([new Uint8Array([...PNG_KOPF, this.width % 256, this.height % 256])]))
  }
  pngZieleWaehlen.mockReset()
  pngSchreiben.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { pngZieleWaehlen, pngSchreiben }
  })
  useDokumentwerkzeuge.setState({ offen: 'png', laeuft: false, fortschritt: null })
  useDokument.setState({ pfad: 'C:\\d\\offen.pdf', rotation: 0, hinweis: null })
})

describe('renderePng', () => {
  it('zeichnet mit der Haertung in der Pixelgroesse zur DPI und gibt PNG-Bytes zurueck', async () => {
    const { dokument, seite } = fakeDokument()
    const bild = await renderePng(dokument as never, 1, 300, 0)
    expect([bild.breite, bild.hoehe]).toEqual([2479, 3508])
    expect(bild.dpi).toBe(300)
    expect(bild.begrenzt).toBe(false)
    expect([...bild.bytes.slice(0, 8)]).toEqual(PNG_KOPF)
    const auftrag = seite.render.mock.calls[0]?.[0] as { annotationMode: number }
    expect(auftrag.annotationMode).toBe(0)
  })

  it('dreht wie angezeigt: Seitendrehung plus Ansichtsdrehung', async () => {
    const { dokument, seite } = fakeDokument(90)
    const bild = await renderePng(dokument as never, 1, 72, 90)
    // 90 + 90 = 180: wieder hochkant.
    expect([bild.breite, bild.hoehe]).toEqual([595, 842])
    const argumente = seite.getViewport.mock.calls.at(-1)?.[0] as { rotation: number }
    expect(argumente.rotation).toBe(180)
  })

  it('begrenzt die Aufloesung an der Canvas-Kante statt ein leeres Bild zu liefern', async () => {
    const { dokument } = fakeDokument()
    const bild = await renderePng(dokument as never, 1, 5000, 0)
    expect(bild.begrenzt).toBe(true)
    expect(bild.dpi).toBe(1401)
    expect(bild.hoehe).toBeLessThanOrEqual(16384)
    expect(bild.hoehe).toBeGreaterThan(16000)
  })
})

describe('exportierePng', () => {
  it('holt die Ziele, schreibt je Seite ein Bild und meldet das Ergebnis', async () => {
    const { dokument } = fakeDokument()
    useDokument.setState({ dokument: dokument as never })
    pngZieleWaehlen.mockResolvedValue({
      art: 'freigegeben',
      ziele: [
        { seite: 1, pfad: 'C:\\d\\aus\\offen-S1.png' },
        { seite: 2, pfad: 'C:\\d\\aus\\offen-S2.png' }
      ]
    })
    pngSchreiben.mockImplementation(({ pfad }) => Promise.resolve({ art: 'geschrieben', pfad }))
    await exportierePng({ seiten: [1, 2], dpi: 72 })
    expect(pngZieleWaehlen).toHaveBeenCalledWith({ quelle: 'C:\\d\\offen.pdf', seiten: [1, 2] })
    expect(pngSchreiben).toHaveBeenCalledTimes(2)
    const erstes = pngSchreiben.mock.calls[0]?.[0]
    expect(erstes?.pfad).toBe('C:\\d\\aus\\offen-S1.png')
    expect([...(erstes?.bytes.slice(0, 8) ?? [])]).toEqual(PNG_KOPF)
    expect(useDokument.getState().hinweis).toBe('2 Bilder geschrieben nach C:\\d\\aus\\.')
    const { offen, laeuft, fortschritt } = useDokumentwerkzeuge.getState()
    expect([offen, laeuft, fortschritt]).toEqual([null, false, null])
  })

  it('rendert nichts, wenn der Dialog abgebrochen wird, und nennt Ablehnungen', async () => {
    const { dokument, seite } = fakeDokument()
    useDokument.setState({ dokument: dokument as never })
    pngZieleWaehlen.mockResolvedValue({ art: 'abgebrochen' })
    await exportierePng({ seiten: [1], dpi: 150 })
    expect(seite.render).not.toHaveBeenCalled()
    expect(useDokumentwerkzeuge.getState().offen).toBe('png')

    pngZieleWaehlen.mockResolvedValue({ art: 'freigegeben', ziele: [{ seite: 1, pfad: 'x.png' }] })
    pngSchreiben.mockResolvedValue({ art: 'abgelehnt', grund: 'Die Daten sind kein PNG.' })
    await exportierePng({ seiten: [1], dpi: 150 })
    expect(useDokument.getState().hinweis).toBe('Die Daten sind kein PNG.')
    expect(useDokumentwerkzeuge.getState().laeuft).toBe(false)
  })

  it('sagt im Hinweis, wenn die Aufloesung begrenzt wurde', async () => {
    const { dokument } = fakeDokument()
    useDokument.setState({ dokument: dokument as never })
    pngZieleWaehlen.mockResolvedValue({
      art: 'freigegeben',
      ziele: [{ seite: 1, pfad: 'C:\\d\\offen-S1.png' }]
    })
    pngSchreiben.mockImplementation(({ pfad }) => Promise.resolve({ art: 'geschrieben', pfad }))
    await exportierePng({ seiten: [1], dpi: 2400 })
    expect(useDokument.getState().hinweis).toBe(
      'Bild geschrieben: offen-S1.png. Die Auflösung wurde auf 1401 DPI begrenzt: ' +
        'ein Canvas darf höchstens 16384 Pixel je Kante haben.'
    )
  })
})

describe('beschreibeErgebnis', () => {
  it('nennt eine Datei beim Namen und mehrere mit ihrem Ordner', () => {
    expect(beschreibeErgebnis(['C:\\d\\a-S1.png'], null)).toBe('Bild geschrieben: a-S1.png.')
    expect(beschreibeErgebnis(['/tmp/aus/a-S1.png', '/tmp/aus/a-S2.png'], null)).toBe(
      '2 Bilder geschrieben nach /tmp/aus/.'
    )
  })
})
