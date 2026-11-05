import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExtrahierAuftrag,
  ExtrahierErgebnis,
  MutationsAuftrag,
  MutationsErgebnis
} from '../../src/shared/ipc'
import { verschluesseltText } from '../../src/shared/errors'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useAnnotationen } = await import('../../src/renderer/src/annotations-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useFormular } = await import('../../src/renderer/src/formular-store')
const { useHistorie } = await import('../../src/renderer/src/historie')
const { useMutation } = await import('../../src/renderer/src/mutation-store')
const { setzeMutationssperreZurueck } = await import('../../src/renderer/src/mutation')
const { vergissVorgaenge, beginneVorgang } = await import('../../src/renderer/src/vorgaenge')
const { extrahiereSeiten } = await import('../../src/renderer/src/extrahieren')

/**
 * Seiten extrahieren im Renderer (S6.2, Aufgabe 3): was zum Main geht, und
 * dass "danach entfernen" erst nach dem Schreiben loescht.
 */
const PFAD = 'C:\\dokumente\\bericht.pdf'
const seitenExtrahieren = vi.fn<(auftrag: ExtrahierAuftrag) => Promise<ExtrahierErgebnis>>()
const dokumentMutieren = vi.fn<(auftrag: MutationsAuftrag) => Promise<MutationsErgebnis>>()
const uebernimm = vi.fn<(...args: unknown[]) => Promise<void>>()
const GESPEICHERT: ExtrahierErgebnis = {
  art: 'gespeichert',
  pfad: 'C:\\dokumente\\bericht-S1-S3.pdf',
  name: 'bericht-S1-S3.pdf',
  seiten: 3
}

beforeEach(() => {
  seitenExtrahieren.mockReset()
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
  useAnnotationen.getState().vergiss()
  useFormular.getState().vergiss()
  useHistorie.getState().leere()
  useDokument.setState({
    ladeZustand: 'bereit',
    pfad: PFAD,
    name: 'bericht.pdf',
    verschluesselt: false,
    seitenzahl: 5,
    aktuelleSeite: 1,
    hinweis: null,
    uebernimm
  })
})

describe('extrahiereSeiten', () => {
  it('schickt Seiten, Quelle und offene Formularwerte zum Main', async () => {
    useFormular.setState({ werte: { name: 'Max' }, ursprung: { name: '' } })
    seitenExtrahieren.mockResolvedValue(GESPEICHERT)

    expect(await extrahiereSeiten([1, 2, 3], false)).toBe(true)

    const auftrag = seitenExtrahieren.mock.calls[0]?.[0]
    expect(auftrag?.quelle).toBe(PFAD)
    expect(auftrag?.seiten).toEqual([1, 2, 3])
    expect(auftrag?.formularwerte).toEqual({ name: 'Max' })
    expect(useDokument.getState().hinweis).toBe('3 Seiten extrahiert: bericht-S1-S3.pdf')
    expect(dokumentMutieren).not.toHaveBeenCalled()
  })

  it('entfernt die Seiten danach, wenn gewuenscht', async () => {
    seitenExtrahieren.mockResolvedValue(GESPEICHERT)
    await extrahiereSeiten([3, 1], true)
    expect(dokumentMutieren.mock.calls[0]?.[0].mutation).toEqual({
      art: 'seitenLoeschen',
      seiten: [1, 3]
    })
  })

  it('entfernt nichts, wenn der Nutzer den Dialog abbricht', async () => {
    seitenExtrahieren.mockResolvedValue({ art: 'abgebrochen' })
    expect(await extrahiereSeiten([1], true)).toBe(false)
    expect(dokumentMutieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('zeigt den Grund einer Ablehnung', async () => {
    seitenExtrahieren.mockResolvedValue({ art: 'abgelehnt', grund: 'Nein.' })
    expect(await extrahiereSeiten([1], true)).toBe(false)
    expect(useDokument.getState().hinweis).toBe('Nein.')
    expect(dokumentMutieren).not.toHaveBeenCalled()
  })

  it('meldet einen Fehler der Bruecke, statt ihn zu verschlucken', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    seitenExtrahieren.mockRejectedValue(new Error('weg'))
    expect(await extrahiereSeiten([1], false)).toBe(false)
    expect(useDokument.getState().hinweis).toBe('Die Seiten ließen sich nicht extrahieren.')
  })

  it('sperrt verschluesselte Dokumente', async () => {
    useDokument.setState({ verschluesselt: true })
    expect(await extrahiereSeiten([1], false)).toBe(false)
    expect(seitenExtrahieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toBe(verschluesseltText())
  })

  it('laesst nicht alle Seiten entfernen', async () => {
    expect(await extrahiereSeiten([1, 2, 3, 4, 5], true)).toBe(false)
    expect(seitenExtrahieren).not.toHaveBeenCalled()
  })

  it('wartet, solange ein anderer Vorgang laeuft', async () => {
    beginneVorgang('drucken')
    expect(await extrahiereSeiten([1], false)).toBe(false)
    expect(seitenExtrahieren).not.toHaveBeenCalled()
  })

  it('tut ohne Seiten nichts', async () => {
    expect(await extrahiereSeiten([], false)).toBe(false)
    expect(seitenExtrahieren).not.toHaveBeenCalled()
  })

  // Review M1: waehrend eine Mutation laeuft oder die Historie beschaeftigt
  // ist, sind die Seitennummern des Renderers nicht verlaesslich - sonst
  // extrahiert/loescht Strg+Umschalt+K die falschen Seiten.
  it('lehnt ab, waehrend eine Mutation laeuft', async () => {
    useMutation.setState({ laeuft: { art: 'seitenLoeschen', seiten: [1] } })
    expect(await extrahiereSeiten([1], false)).toBe(false)
    expect(seitenExtrahieren).not.toHaveBeenCalled()
  })

  it('lehnt ab, waehrend Rueckgaengig/Wiederholen beschaeftigt ist', async () => {
    useHistorie.setState({ beschaeftigt: true })
    expect(await extrahiereSeiten([1], false)).toBe(false)
    expect(seitenExtrahieren).not.toHaveBeenCalled()
  })

  it('meldet, wenn extrahiert aber nicht entfernt werden konnte', async () => {
    seitenExtrahieren.mockResolvedValue(GESPEICHERT)
    // `fuehreMutationAus` lehnt ab, weil inzwischen ein anderer Vorgang lief -
    // simuliert ueber eine Ablehnung des Main statt eines echten Wettlaufs.
    dokumentMutieren.mockResolvedValue({ art: 'abgelehnt', grund: 'Nein.' })
    expect(await extrahiereSeiten([3, 1], true)).toBe(true)
    expect(useDokument.getState().hinweis).toBe(
      'Extrahiert, aber nicht entfernt: bericht-S1-S3.pdf'
    )
  })
})
