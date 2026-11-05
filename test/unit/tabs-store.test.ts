import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../src/shared/annotations'

/**
 * Mehrere Dokumente, eines aktiv (S6.1a). pdf.js wird ersetzt wie im
 * Dokument-Store-Test; geprueft wird, was beim Wechseln, Schliessen und
 * Oeffnen mit den Stores geschieht - dass es im echten Fenster so aussieht,
 * belegen die E2E-Tests.
 */
const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PDFWorker: { create: () => ({ destroy: vi.fn() }) },
  getDocument: getDocumentMock
}))

const { useTabs, setzeTabsZurueck, gleicherPfad, sperrgrund } =
  await import('../../src/renderer/src/tabs-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useAnnotationen } = await import('../../src/renderer/src/annotations-store')
const { useHistorie } = await import('../../src/renderer/src/historie')
const { useMutation } = await import('../../src/renderer/src/mutation-store')
const { erstelleAnnotation } = await import('../../src/renderer/src/annotationsbefehle')
const { beginneVorgang, vergissVorgaenge } = await import('../../src/renderer/src/vorgaenge')
const { merkeLesestelle } = await import('../../src/renderer/src/dokument-store')
const { alsSitzung, stelleSitzungHer } = await import('../../src/renderer/src/schale/sitzung')

interface FakeProxy {
  numPages: number
  cleanup: ReturnType<typeof vi.fn>
  loadingTask: { destroy: ReturnType<typeof vi.fn> }
}

/** Jedes Laden liefert ein eigenes Proxy, damit sich Tabs unterscheiden lassen. */
function naechstesProxy(seiten = 3): FakeProxy {
  const proxy = {
    numPages: seiten,
    getPage: vi.fn(() => Promise.resolve({ getViewport: () => ({ width: 595, height: 842 }) })),
    getMetadata: vi.fn(() => Promise.resolve({ info: {} })),
    getPermissions: vi.fn(() => Promise.resolve(null)),
    cleanup: vi.fn(() => Promise.resolve()),
    loadingTask: { destroy: vi.fn(() => Promise.resolve()) }
  }
  getDocumentMock.mockReturnValueOnce({ promise: Promise.resolve(proxy) })
  return proxy
}

function datei(name: string): { pfad: string; name: string; bytes: Uint8Array } {
  return { pfad: 'C:\\akten\\' + name, name, bytes: new Uint8Array([1]) }
}

function anmerkung(id: string): Annotation {
  return {
    id,
    seite: 1,
    typ: 'Text',
    subtyp: 'Text',
    rect: [10, 20, 30, 40],
    quadPoints: null,
    striche: null,
    farbe: null,
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: '',
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: null
  }
}

const api = {
  dokumentOeffnen: vi.fn(),
  dokumentOeffnePfad: vi.fn(),
  dokumentSchliessen: vi.fn(() => Promise.resolve()),
  tabSchliessenFragen: vi.fn(() => Promise.resolve(false)),
  dokumentGeaendert: vi.fn(() => Promise.resolve())
}

async function oeffne(name: string, seiten = 3): Promise<FakeProxy> {
  const proxy = naechstesProxy(seiten)
  await useTabs.getState().oeffneOderAktiviere(datei(name))
  return proxy
}

function idVon(name: string): string {
  const tab = useTabs.getState().tabs.find((eintrag) => eintrag.name === name)
  if (tab === undefined) throw new Error('kein Tab ' + name)
  return tab.id
}

beforeEach(() => {
  getDocumentMock.mockReset()
  for (const f of Object.values(api)) f.mockClear()
  api.tabSchliessenFragen.mockImplementation(() => Promise.resolve(false))
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  setzeTabsZurueck()
  vergissVorgaenge()
  useDokument.setState({
    ladeZustand: 'leer',
    pfad: null,
    name: null,
    dokument: null,
    seitenzahl: 0,
    hinweis: null
  })
  useAnnotationen.getState().vergiss()
  useHistorie.getState().leere()
  useMutation.setState({ anzahl: 0, laeuft: null, erwarteNeuladen: false })
})

describe('Oeffnen', () => {
  it('oeffnet jedes Dokument in einem eigenen Tab und aktiviert das neue', async () => {
    const a = await oeffne('a.pdf')
    await oeffne('b.pdf')
    const { tabs, aktiv } = useTabs.getState()
    expect(tabs.map((tab) => tab.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(aktiv).toBe(idVon('b.pdf'))
    expect(useDokument.getState().name).toBe('b.pdf')
    // A bleibt geladen - nur seine Seitencaches werden freigegeben.
    expect(a.loadingTask.destroy).not.toHaveBeenCalled()
    expect(a.cleanup).toHaveBeenCalled()
  })

  it('aktiviert einen schon offenen Pfad nur, ohne den Main zu fragen', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    // Andere Schreibweise desselben Windows-Pfads.
    await useTabs.getState().oeffneUeberPfad('c:/AKTEN/A.pdf')
    expect(api.dokumentOeffnePfad).not.toHaveBeenCalled()
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(useTabs.getState().aktiv).toBe(idVon('a.pdf'))
    expect(useDokument.getState().name).toBe('a.pdf')
  })

  it('aktiviert auch, wenn der Main einen offenen Pfad erneut liefert', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    api.dokumentOeffnen.mockResolvedValueOnce(datei('a.pdf'))
    await useTabs.getState().oeffneUeberDialog()
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(useTabs.getState().aktiv).toBe(idVon('a.pdf'))
  })

  it('oeffnet ueber den Dialog und bleibt beim Abbrechen, wie es war', async () => {
    api.dokumentOeffnen.mockResolvedValueOnce(null)
    await useTabs.getState().oeffneUeberDialog()
    expect(useTabs.getState().tabs).toHaveLength(0)
    expect(useDokument.getState().ladeZustand).toBe('leer')

    naechstesProxy(2)
    api.dokumentOeffnen.mockResolvedValueOnce(datei('a.pdf'))
    await useTabs.getState().oeffneUeberDialog()
    expect(useDokument.getState().seitenzahl).toBe(2)
    expect(useTabs.getState().tabs).toHaveLength(1)
  })

  it('verwirft einen Tab, dessen Dokument nicht laedt, und kehrt zum vorigen zurueck', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await oeffne('a.pdf')
    getDocumentMock.mockReturnValueOnce({ promise: Promise.reject(new Error('kaputt')) })
    await useTabs.getState().oeffneOderAktiviere(datei('defekt.pdf'))
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['a.pdf'])
    expect(useDokument.getState().name).toBe('a.pdf')
    expect(useDokument.getState().ladeZustand).toBe('bereit')
    expect(useDokument.getState().hinweis).toContain('defekt.pdf')
    expect(api.dokumentSchliessen).toHaveBeenCalledWith('C:\\akten\\defekt.pdf')
  })
})

describe('Wechseln', () => {
  it('nimmt Anmerkungen mit: in A angelegt, nach B und zurueck noch da', async () => {
    await oeffne('a.pdf')
    erstelleAnnotation(anmerkung('neu-a'))
    await oeffne('b.pdf')
    expect(useAnnotationen.getState().finde('neu-a')).toBeNull()

    expect(useTabs.getState().wechsle(idVon('a.pdf'))).toBe(true)
    expect(useAnnotationen.getState().finde('neu-a')).not.toBeNull()
    // Auch der Ursprung ist zurueck - sonst waere sie beim Speichern keine Aenderung.
    expect(useAnnotationen.getState().urspruenglich[1]).toEqual([])
    expect(useDokument.getState().ladeArt).toBe('tab')
    expect(useDokument.getState().name).toBe('a.pdf')
  })

  it('haelt die Ansicht je Tab', async () => {
    await oeffne('a.pdf', 9)
    useDokument.getState().springeZuSeite(7)
    useDokument.getState().setzeZoom(2)
    await oeffne('b.pdf')
    useTabs.getState().wechsle(idVon('a.pdf'))
    expect(useDokument.getState().aktuelleSeite).toBe(7)
    expect(useDokument.getState().sprungZiel).toBe(7)
    expect(useDokument.getState().zoom).toBe(2)
  })

  // S6.1b, offener Punkt aus S6.1a: nicht nur die Seite, auch die Stelle darin.
  it('haelt die Stelle innerhalb der Seite je Tab', async () => {
    await oeffne('a.pdf', 9)
    useDokument.getState().springeZuSeite(4)
    merkeLesestelle(4, 0.6)
    await oeffne('b.pdf')
    // B hat noch nicht gescrollt: die Stelle von A darf nicht an B haengen.
    merkeLesestelle(1, 0.3)
    useTabs.getState().wechsle(idVon('a.pdf'))
    expect(useDokument.getState().sprungZiel).toBe(4)
    expect(useDokument.getState().sprungAnteil).toBe(0.6)

    useTabs.getState().wechsle(idVon('b.pdf'))
    expect(useDokument.getState().sprungZiel).toBe(1)
    expect(useDokument.getState().sprungAnteil).toBe(0.3)
  })

  it('verwirft eine Stelle, die zu einer anderen Seite gehoert', async () => {
    await oeffne('a.pdf', 9)
    merkeLesestelle(2, 0.5)
    // Die Ansicht hat den Sprung auf Seite 6 noch nicht nachgezogen.
    useDokument.getState().springeZuSeite(6)
    await oeffne('b.pdf')
    useTabs.getState().wechsle(idVon('a.pdf'))
    expect(useDokument.getState().sprungZiel).toBe(6)
    expect(useDokument.getState().sprungAnteil).toBeNull()
  })

  it('Rueckgaengig wirkt nur auf den Tab, in dem der Schritt entstand', async () => {
    await oeffne('a.pdf')
    erstelleAnnotation(anmerkung('neu-a'))
    await oeffne('b.pdf')

    // In B gibt es nichts zurueckzunehmen.
    useHistorie.getState().rueckgaengig()
    useTabs.getState().wechsle(idVon('a.pdf'))
    expect(useAnnotationen.getState().finde('neu-a')).not.toBeNull()

    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().finde('neu-a')).toBeNull()
  })

  it('naechster laeuft reihum', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    await oeffne('c.pdf')
    useTabs.getState().naechster(1)
    expect(useDokument.getState().name).toBe('a.pdf')
    useTabs.getState().naechster(-1)
    expect(useDokument.getState().name).toBe('c.pdf')
  })

  it('ist gesperrt, solange gespeichert wird oder eine Mutation laeuft', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    const b = idVon('b.pdf')

    beginneVorgang('speichern')
    expect(sperrgrund()).not.toBeNull()
    expect(useTabs.getState().wechsle(idVon('a.pdf'))).toBe(false)
    expect(useTabs.getState().aktiv).toBe(b)
    expect(useDokument.getState().hinweis).toContain('gespeichert')
    vergissVorgaenge()

    useMutation.setState({ laeuft: { art: 'seitenLoeschen', seiten: [1] } })
    expect(useTabs.getState().naechster(1)).toBe(false)
    expect(await useTabs.getState().schliesse(b)).toBe(false)
    expect(useTabs.getState().aktiv).toBe(b)
    useMutation.setState({ laeuft: null })

    useHistorie.setState({ beschaeftigt: true })
    expect(useTabs.getState().wechsle(idVon('a.pdf'))).toBe(false)
    useHistorie.setState({ beschaeftigt: false })

    expect(useTabs.getState().wechsle(idVon('a.pdf'))).toBe(true)
  })

  it('zeigt den Hinweis fuer eine verschwundene Datei nur im aktiven Tab', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    useTabs.getState().meldeVerschwunden('C:\\akten\\a.pdf')
    expect(useDokument.getState().hinweis).toBeNull()
    expect(useTabs.getState().tabs.find((tab) => tab.name === 'a.pdf')?.verschwunden).toBe(true)

    useTabs.getState().wechsle(idVon('a.pdf'))
    expect(useDokument.getState().hinweis).toMatch(/gelöscht oder ersetzt/)

    // Unter Windows zaehlt die Schreibweise nicht.
    useDokument.getState().setzeHinweis(null)
    useTabs.getState().meldeVerschwunden('c:/akten/A.PDF')
    expect(useDokument.getState().hinweis).toMatch(/gelöscht oder ersetzt/)
  })
})

describe('Schliessen', () => {
  it('fragt bei Aenderungen nach; bei Abbrechen bleibt der Tab', async () => {
    await oeffne('a.pdf')
    erstelleAnnotation(anmerkung('neu-a'))
    await oeffne('b.pdf')
    const a = idVon('a.pdf')

    expect(await useTabs.getState().schliesse(a)).toBe(false)
    expect(api.tabSchliessenFragen).toHaveBeenCalledWith('a.pdf')
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(api.dokumentSchliessen).not.toHaveBeenCalled()

    api.tabSchliessenFragen.mockResolvedValueOnce(true)
    expect(await useTabs.getState().schliesse(a)).toBe(true)
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['b.pdf'])
    expect(api.dokumentSchliessen).toHaveBeenCalledWith('C:\\akten\\a.pdf')
  })

  it('schliesst ohne Aenderungen ohne Rueckfrage und aktiviert den Nachbarn', async () => {
    const a = await oeffne('a.pdf')
    await oeffne('b.pdf')
    useTabs.getState().wechsle(idVon('a.pdf'))

    expect(await useTabs.getState().schliesse(idVon('a.pdf'))).toBe(true)
    expect(api.tabSchliessenFragen).not.toHaveBeenCalled()
    expect(useTabs.getState().aktiv).toBe(idVon('b.pdf'))
    expect(useDokument.getState().name).toBe('b.pdf')
    expect(a.loadingTask.destroy).toHaveBeenCalled()
  })

  it('der letzte Tab fuehrt zur Startseite, das Fenster bleibt', async () => {
    const a = await oeffne('a.pdf')
    expect(await useTabs.getState().schliesse(idVon('a.pdf'))).toBe(true)
    expect(useTabs.getState().tabs).toEqual([])
    expect(useTabs.getState().aktiv).toBeNull()
    expect(useDokument.getState().ladeZustand).toBe('leer')
    expect(useDokument.getState().dokument).toBeNull()
    expect(a.loadingTask.destroy).toHaveBeenCalled()
    expect(api.dokumentGeaendert).toHaveBeenCalledWith({ pfad: '', geaendert: false })
  })

  it('meldet den leeren Pfad nicht, solange noch ein Tab offen ist', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    await useTabs.getState().schliesse(idVon('b.pdf'))
    expect(api.dokumentGeaendert).not.toHaveBeenCalledWith({ pfad: '', geaendert: false })
  })

  it('laesst den Worker fuer die anderen Tabs stehen', async () => {
    await oeffne('a.pdf')
    await oeffne('b.pdf')
    await useTabs.getState().schliesse(idVon('b.pdf'))
    const worker = (getDocumentMock.mock.calls[0]?.[0] as Record<string, unknown>)['worker']
    await oeffne('c.pdf')
    expect(useDokument.getState().ladeZustand).toBe('bereit')
    expect((getDocumentMock.mock.calls.at(-1)?.[0] as Record<string, unknown>)['worker']).toBe(
      worker
    )
  })
})

describe('Oeffnen ueber Pfad (S6.1b)', () => {
  it('liefert die Ablehnung zurueck, damit mehrere Drops sie sammeln koennen', async () => {
    api.dokumentOeffnePfad.mockResolvedValueOnce({ ok: false, grund: 'Nur PDF: notiz.txt' })
    expect(await useTabs.getState().oeffneUeberPfad('C:\\akten\\notiz.txt')).toBe(
      'Nur PDF: notiz.txt'
    )
    naechstesProxy()
    api.dokumentOeffnePfad.mockResolvedValueOnce({ ok: true, dokument: datei('a.pdf') })
    expect(await useTabs.getState().oeffneUeberPfad('C:\\akten\\a.pdf')).toBeNull()
  })

  it('oeffnet still: kein Hinweis, keine Fehlerseite', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getDocumentMock.mockReturnValueOnce({ promise: Promise.reject(new Error('kaputt')) })
    api.dokumentOeffnePfad.mockResolvedValueOnce({ ok: true, dokument: datei('defekt.pdf') })
    const ausgang = await useTabs.getState().oeffneStill('C:\\akten\\defekt.pdf')
    expect(ausgang.art).toBe('fehler')
    expect(useTabs.getState().tabs).toEqual([])
    expect(useDokument.getState().ladeZustand).toBe('leer')
    expect(useDokument.getState().hinweis).toBeNull()

    api.dokumentOeffnePfad.mockResolvedValueOnce({ ok: false, grund: 'Datei fehlt' })
    expect((await useTabs.getState().oeffneStill('C:\\weg.pdf')).art).toBe('fehler')
    expect(useDokument.getState().hinweis).toBeNull()
  })
})

describe('Sitzung (S6.1b)', () => {
  /** Der Main liefert jeden Pfad der Sitzung, ausser denen in `fehlend`. */
  function mainLiefert(fehlend: string[] = []): void {
    api.dokumentOeffnePfad.mockImplementation((pfad: string) => {
      if (fehlend.includes(pfad)) {
        return Promise.resolve({ ok: false, grund: 'Die Datei wurde nicht gefunden: ' + pfad })
      }
      naechstesProxy()
      const name = pfad.split('\\').pop() ?? pfad
      return Promise.resolve({ ok: true, dokument: { pfad, name, bytes: new Uint8Array([1]) } })
    })
  }

  it('kuerzt auf MAX_SITZUNG_TABS und haelt aktiv im Bereich', () => {
    const tabs = Array.from({ length: 105 }, (_, i) => ({
      id: 'tab-' + String(i),
      pfad: 'C:\\d' + String(i) + '.pdf',
      name: 'd' + String(i) + '.pdf',
      verschwunden: false
    }))
    const sitzung = alsSitzung(tabs, 'tab-3')
    expect(sitzung.tabs).toHaveLength(100)
    expect(sitzung.aktiv).toBe(3)
    // Ein aktiver Tab jenseits der Grenze faellt auf den ersten zurueck.
    expect(alsSitzung(tabs, 'tab-104').aktiv).toBe(0)
    expect(alsSitzung([], null)).toEqual({ tabs: [], aktiv: 0 })
  })

  it('oeffnet die Tabs der Reihe nach und aktiviert den gemerkten', async () => {
    mainLiefert()
    await stelleSitzungHer(
      { tabs: ['C:\\akten\\a.pdf', 'C:\\akten\\b.pdf', 'C:\\akten\\c.pdf'], aktiv: 1 },
      null
    )
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    expect(useTabs.getState().aktiv).toBe(idVon('b.pdf'))
    expect(useDokument.getState().name).toBe('b.pdf')
    // Jeder Pfad lief ueber den Main (Invariante 11).
    expect(api.dokumentOeffnePfad).toHaveBeenCalledTimes(3)
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('ueberspringt eine fehlende Datei still und meldet sie einmal gesammelt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mainLiefert(['C:\\akten\\weg.pdf', 'C:\\akten\\auch-weg.pdf'])
    await stelleSitzungHer(
      {
        tabs: [
          'C:\\akten\\weg.pdf',
          'C:\\akten\\a.pdf',
          'C:\\akten\\auch-weg.pdf',
          'C:\\akten\\b.pdf'
        ],
        aktiv: 1
      },
      null
    )
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(useTabs.getState().aktiv).toBe(idVon('a.pdf'))
    const hinweis = useDokument.getState().hinweis ?? ''
    expect(hinweis).toMatch(/^2 Dokumente der letzten Sitzung/)
    expect(hinweis).toContain('weg.pdf, auch-weg.pdf')
  })

  it('ueberspringt ein Dokument, dessen Passwortabfrage abgebrochen wird, ohne Meldung', async () => {
    mainLiefert()
    // Das erste Dokument verlangt ein Passwort; der Nutzer bricht ab.
    // Wie pdf.js: fragt ueber `onPassword` und scheitert erst, wenn die
    // Aufgabe nach dem Abbruch verworfen wird (Muster aus dokument-store.test).
    getDocumentMock.mockImplementationOnce(() => {
      let ablehnen: (fehler: unknown) => void = () => undefined
      const aufgabe: Record<string, unknown> = {
        destroy: vi.fn(() => {
          ablehnen(new Error('Worker was destroyed'))
          return Promise.resolve()
        })
      }
      aufgabe['promise'] = new Promise((_, verwerfen) => {
        ablehnen = verwerfen
        queueMicrotask(() => {
          const frage = aufgabe['onPassword'] as
            ((weiter: (passwort: string) => void, grund: number) => void) | undefined
          frage?.(() => undefined, 1)
        })
      })
      return aufgabe
    })
    const laeuft = stelleSitzungHer(
      { tabs: ['C:\\akten\\geheim.pdf', 'C:\\akten\\a.pdf'], aktiv: 0 },
      null
    )
    await vi.waitFor(() => {
      expect(useDokument.getState().passwortFrage).not.toBeNull()
    })
    useDokument.getState().beantwortePasswort(null)
    await laeuft
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['a.pdf'])
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('nimmt das Startdokument als weiteren, aktiven Tab dazu', async () => {
    mainLiefert()
    naechstesProxy()
    await stelleSitzungHer(
      { tabs: ['C:\\akten\\a.pdf', 'C:\\akten\\b.pdf'], aktiv: 0 },
      datei('neu.pdf')
    )
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['a.pdf', 'b.pdf', 'neu.pdf'])
    expect(useTabs.getState().aktiv).toBe(idVon('neu.pdf'))
  })

  it('aktiviert das Startdokument nur, wenn es schon in der Sitzung steht', async () => {
    mainLiefert()
    await stelleSitzungHer(
      { tabs: ['C:\\akten\\a.pdf', 'C:\\akten\\b.pdf'], aktiv: 1 },
      datei('a.pdf')
    )
    expect(useTabs.getState().tabs.map((tab) => tab.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(useTabs.getState().aktiv).toBe(idVon('a.pdf'))
  })
})

describe('gleicherPfad', () => {
  it('vergleicht Windows-Pfade ohne Ruecksicht auf Schreibweise und Trenner', () => {
    expect(gleicherPfad('C:\\A\\b.pdf', 'c:/a/B.PDF')).toBe(true)
    expect(gleicherPfad('/home/a.pdf', '/home/A.pdf')).toBe(false)
    expect(gleicherPfad('/home/a.pdf', '/home/a.pdf')).toBe(true)
  })
})
