import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationsAuftrag, MutationsErgebnis, StandErgebnis } from '../../src/shared/ipc'
import type { Annotation } from '../../src/shared/annotations'

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
const { fuehreMutationAus, loescheAktuelleSeite, setzeMutationssperreZurueck } =
  await import('../../src/renderer/src/mutation')
const { useAnzahlAenderungen } = await import('../../src/renderer/src/schale/speichern')
const { useAufraeumenBeiWechsel } = await import('../../src/renderer/src/schale/sitzung')
const { beginneVorgang, vergissVorgaenge } = await import('../../src/renderer/src/vorgaenge')

/**
 * Die Mutationspipeline im Renderer (S4.0).
 *
 * `uebernimm` wird hier ersetzt: es ist im Dokument-Store-Test geprueft, und
 * hier geht es um das, was die Pipeline **um** das Neuladen herum tut - was
 * sie zum Main schickt, wie sie die Ansicht wiederherstellt, wie der Zaehler
 * das Neuladen ueberlebt und wie eine Ablehnung ankommt.
 */
const PFAD = 'C:\\dokumente\\bericht.pdf'
const dokumentMutieren = vi.fn<(auftrag: MutationsAuftrag) => Promise<MutationsErgebnis>>()
const dokumentStandHerstellen =
  vi.fn<(auftrag: { quelle: string; stand: number }) => Promise<StandErgebnis>>()
const STAND = { vorher: 0, nachher: 1 }
const NEU = { pfad: PFAD, name: 'bericht.pdf', bytes: new Uint8Array([1]) }
const uebernimm = vi.fn<(...args: unknown[]) => Promise<void>>()

function annotation(id: string, seite: number): Annotation {
  return {
    id,
    seite,
    typ: 'Text',
    subtyp: 'Text',
    rect: [10, 20, 30, 40],
    quadPoints: null,
    striche: null,
    farbe: null,
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: 'offen',
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: null
  }
}

beforeEach(() => {
  dokumentMutieren.mockReset()
  // Stand 0 ist die Datei auf der Platte (sauber), jeder andere ein ungespeicherter.
  dokumentStandHerstellen
    .mockReset()
    .mockImplementation(({ stand }: { stand: number }) =>
      Promise.resolve({ art: 'hergestellt', dokument: NEU, sauber: stand === 0 })
    )
  uebernimm.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dokumentMutieren,
      dokumentStandHerstellen,
      dokumentGeaendert: vi.fn(() => Promise.resolve())
    }
  })
  setzeMutationssperreZurueck()
  vergissVorgaenge()
  useMutation.setState({ anzahl: 0, laeuft: null, erwarteNeuladen: false, letzteDauerMs: null })
  useAnnotationen.getState().vergiss()
  useFormular.getState().vergiss()
  useHistorie.getState().leere()
  useDokument.setState({
    ladeZustand: 'bereit',
    pfad: PFAD,
    name: 'bericht.pdf',
    verschluesselt: false,
    seitenzahl: 10,
    aktuelleSeite: 6,
    zoom: 1.5,
    rotation: 90,
    passung: 'frei',
    hinweis: null,
    uebernimm
  })
})

describe('fuehreMutationAus', () => {
  it('schickt Mutation, offene Anmerkungen und Formularwerte zum Main', async () => {
    useAnnotationen.setState({
      urspruenglich: { 1: [annotation('10R', 1)] },
      proSeite: { 1: [annotation('10R', 1), annotation('neu-1', 1)] }
    })
    useFormular.setState({ werte: { name: 'Max' }, ursprung: { name: '' } })
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 42,
      stand: STAND
    })

    expect(await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [2] })).toBe(true)

    const auftrag = dokumentMutieren.mock.calls[0]?.[0]
    expect(auftrag?.quelle).toBe(PFAD)
    expect(auftrag?.mutation).toEqual({ art: 'seitenLoeschen', seiten: [2] })
    expect(auftrag?.aenderungen.neue.map((a) => a.id)).toEqual(['neu-1'])
    expect(auftrag?.formularwerte).toEqual({ name: 'Max' })
  })

  // Review M1: waehrend Extrahieren (oder Speichern/Drucken/Word) im Main
  // liest, sind die Seitennummern des Renderers noch die alten - eine
  // Mutation dazwischen darf nicht "still" ueber einen falschen Stand laufen.
  it('lehnt ab, waehrend ein anderer Vorgang laeuft', async () => {
    beginneVorgang('extrahieren')
    expect(await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [2] })).toBe(false)
    expect(dokumentMutieren).not.toHaveBeenCalled()
  })

  it('laedt neu und stellt die Ansicht mit der nachgerueckten Seite wieder her', async () => {
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 42,
      stand: STAND
    })
    await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [2] })
    expect(uebernimm).toHaveBeenCalledWith(NEU, {
      // Seite 6 war es, Seite 2 fiel weg: jetzt Seite 5.
      seite: 5,
      zoom: 1.5,
      rotation: 90,
      passung: 'frei'
    })
    const stand = useMutation.getState()
    expect(stand.anzahl).toBe(1)
    expect(stand.laeuft).toBeNull()
    expect(stand.erwarteNeuladen).toBe(false)
    expect(stand.letzteDauerMs).toBe(42)
    expect(useDokument.getState().hinweis).toMatch(/Noch nicht gespeichert/)
  })

  it('zaehlt die Mutation als offene Aenderung', async () => {
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 1,
      stand: STAND
    })
    function Anzeige(): React.JSX.Element {
      return <span data-testid="anzahl">{useAnzahlAenderungen()}</span>
    }
    render(<Anzeige />)
    expect(screen.getByTestId('anzahl').textContent).toBe('0')
    await act(async () => {
      await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [1] })
    })
    expect(screen.getByTestId('anzahl').textContent).toBe('1')
    act(() => {
      useMutation.getState().merkeGespeichert()
    })
    expect(screen.getByTestId('anzahl').textContent).toBe('0')
  })

  it('ueberlebt das Aufraeumen beim Neuladen, faellt aber beim Wechsel', async () => {
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 1,
      stand: STAND
    })
    function Huelle(): React.JSX.Element {
      useAufraeumenBeiWechsel()
      return <div />
    }
    render(<Huelle />)
    // Waehrend der Mutation ist das Neuladen angekuendigt: der Zaehler bleibt.
    uebernimm.mockImplementation(() => {
      useDokument.setState({ ladeNummer: useDokument.getState().ladeNummer + 1 })
      return Promise.resolve()
    })
    await act(async () => {
      await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [1] })
    })
    expect(useMutation.getState().anzahl).toBe(1)
    // Ein echter Wechsel raeumt ihn weg.
    act(() => {
      useDokument.setState({ ladeNummer: useDokument.getState().ladeNummer + 1 })
    })
    expect(useMutation.getState().anzahl).toBe(0)
  })

  it('zeigt eine Ablehnung als Hinweis und laedt nicht neu', async () => {
    dokumentMutieren.mockResolvedValue({
      art: 'abgelehnt',
      grund: 'Die letzte Seite laesst sich nicht loeschen.'
    })
    expect(await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [1] })).toBe(false)
    expect(uebernimm).not.toHaveBeenCalled()
    expect(useMutation.getState().anzahl).toBe(0)
    expect(useMutation.getState().laeuft).toBeNull()
    expect(useDokument.getState().hinweis).toMatch(/letzte Seite/)
  })

  it('faengt einen Fehlschlag der Bruecke ab', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {})
    dokumentMutieren.mockRejectedValue(new Error('kaputt'))
    expect(await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [1] })).toBe(false)
    expect(useDokument.getState().hinweis).toMatch(/nicht anwenden/)
    expect(useMutation.getState().laeuft).toBeNull()
    fehler.mockRestore()
  })

  it('lehnt bei verschluesselten Dokumenten ab und laesst keine zweite zugleich zu', async () => {
    useDokument.setState({ verschluesselt: true })
    expect(await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [1] })).toBe(false)
    expect(dokumentMutieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toMatch(/Passwortgeschützte/)

    useDokument.setState({ verschluesselt: false, hinweis: null })
    let freigeben: (e: MutationsErgebnis) => void = () => {}
    dokumentMutieren.mockReturnValue(
      new Promise<MutationsErgebnis>((aufloesen) => {
        freigeben = aufloesen
      })
    )
    const erste = fuehreMutationAus({ art: 'seitenLoeschen', seiten: [1] })
    expect(await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [2] })).toBe(false)
    freigeben({ art: 'angewendet', dokument: NEU, dauerMs: 1, stand: STAND })
    expect(await erste).toBe(true)
    expect(dokumentMutieren).toHaveBeenCalledTimes(1)
  })
})

describe('loescheAktuelleSeite', () => {
  it('loescht die aktuelle Seite', async () => {
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 1,
      stand: STAND
    })
    await loescheAktuelleSeite()
    expect(dokumentMutieren.mock.calls[0]?.[0]?.mutation).toEqual({
      art: 'seitenLoeschen',
      seiten: [6]
    })
  })

  it('weist die letzte Seite ab, ohne den Main zu fragen', async () => {
    useDokument.setState({ seitenzahl: 1, aktuelleSeite: 1 })
    expect(await loescheAktuelleSeite()).toBe(false)
    expect(dokumentMutieren).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toMatch(/letzte Seite/)
  })
})

/**
 * S4.1, Aufgabe 2: die Mutation steht in der gemeinsamen Historie.
 * Rueckgaengig stellt den Stand vorher her und spielt die damals offenen
 * Anmerkungen wieder ein; Wiederholen stellt den Stand nachher her.
 */
describe('Historie einer Mutation', () => {
  it('traegt einen Schritt ein und zaehlt beim Rueckgaengig herunter', async () => {
    useAnnotationen.setState({
      urspruenglich: { 1: [annotation('10R', 1)] },
      proSeite: { 1: [annotation('10R', 1), annotation('neu-1', 1)] }
    })
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 1,
      stand: STAND
    })
    await fuehreMutationAus({ art: 'seitenLoeschen', seiten: [2] })
    const historie = useHistorie.getState()
    expect(historie.vergangenheit).toHaveLength(1)
    expect(historie.vergangenheit[0]?.beschreibung).toBe('Seite 2 löschen')
    expect(useMutation.getState().anzahl).toBe(1)

    // Nach dem Neuladen kennt der Store die Anmerkung als Bestand (leer hier,
    // weil uebernimm eine Attrappe ist) - das Rueckgaengig muss sie wieder
    // als offene Aenderung einspielen.
    useAnnotationen.getState().vergiss()
    useDokument.setState({
      dokument: {
        getPage: () => Promise.resolve({ getAnnotations: () => Promise.resolve([]) })
      } as never
    })
    useHistorie.getState().rueckgaengig()
    await vi.waitFor(() => {
      expect(useHistorie.getState().beschaeftigt).toBe(false)
      expect(useHistorie.getState().vergangenheit).toHaveLength(0)
    })
    expect(dokumentStandHerstellen).toHaveBeenCalledWith({ quelle: PFAD, stand: 0 })
    // Die Ansicht von vorher, nicht die nachher.
    expect(uebernimm).toHaveBeenLastCalledWith(NEU, {
      seite: 6,
      zoom: 1.5,
      rotation: 90,
      passung: 'frei'
    })
    expect(useMutation.getState().anzahl).toBe(0)
    // Die offene Anmerkung ist wieder da - als offene Aenderung.
    const nachher = useAnnotationen.getState()
    expect(nachher.proSeite[1]?.map((a) => a.id)).toContain('neu-1')
    expect(nachher.urspruenglich[1]?.map((a) => a.id)).not.toContain('neu-1')

    // Wiederholen: Stand nachher, Zaehler wieder 1.
    useHistorie.getState().wiederholen()
    await vi.waitFor(() => {
      expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    })
    expect(dokumentStandHerstellen).toHaveBeenLastCalledWith({ quelle: PFAD, stand: 1 })
    expect(useMutation.getState().anzahl).toBe(1)
  })

  it('laesst den Schritt stehen, wenn der Stand nicht mehr verfuegbar ist', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {})
    dokumentMutieren.mockResolvedValue({
      art: 'angewendet',
      dokument: NEU,
      dauerMs: 1,
      stand: STAND
    })
    await fuehreMutationAus({ art: 'seitenDrehen', seiten: [1], grad: 90 })
    dokumentStandHerstellen.mockResolvedValue({ art: 'abgelehnt', grund: 'nicht mehr verfuegbar' })
    useHistorie.getState().rueckgaengig()
    await vi.waitFor(() => {
      expect(useHistorie.getState().beschaeftigt).toBe(false)
    })
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    expect(useDokument.getState().hinweis).toMatch(/nicht mehr verfuegbar/)
    fehler.mockRestore()
  })
})
