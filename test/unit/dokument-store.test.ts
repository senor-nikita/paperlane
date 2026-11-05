import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * pdf.js wird ersetzt: der echte Worker laesst sich in jsdom nicht starten,
 * und geprueft werden soll die Logik des Stores, nicht die Bibliothek. Dass
 * pdf.js im Produktionsbuild tatsaechlich laedt, belegt der E2E-Test
 * dokument.electron.spec.ts — die eine Aussage ersetzt die andere nicht.
 */
const { getDocumentMock, workerCreate } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
  workerCreate: vi.fn((parameter: { port: unknown }) => ({
    port: parameter.port,
    destroy: vi.fn()
  }))
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PDFWorker: { create: workerCreate },
  getDocument: getDocumentMock
}))

const { useDokument, ladeDokument, leseEinschraenkungen } =
  await import('../../src/renderer/src/dokument-store')
const { PDFJS_HAERTUNG } = await import('../../src/renderer/src/pdf-haertung')

/** Der Store fragt beim Oeffnen die erste Seite nach ihrer Groesse. */
function fakeDokument(seiten: number, zusatz: Record<string, unknown> = {}): unknown {
  return {
    numPages: seiten,
    getPage: vi.fn(() => Promise.resolve({ getViewport: () => ({ width: 595, height: 842 }) })),
    getMetadata: vi.fn(() => Promise.resolve({ info: {} })),
    ...zusatz
  }
}

const DOKUMENT = { pfad: 'C:/x/a.pdf', name: 'a.pdf', bytes: new Uint8Array([1]) }

beforeEach(() => {
  getDocumentMock.mockReset()
  useDokument.setState({
    ladeZustand: 'leer',
    fehler: null,
    pfad: null,
    name: null,
    seitenzahl: 0,
    aktuelleSeite: 1,
    dokument: null,
    passung: 'breite',
    standardPassung: 'breite'
  })
})

describe('ladeDokument', () => {
  it('uebergibt die Haertung an pdf.js (Invariante 6)', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(3)) })
    await ladeDokument(new Uint8Array([1, 2, 3]))
    const argumente = getDocumentMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(argumente['enableScripting']).toBe(PDFJS_HAERTUNG.enableScripting)
    expect(argumente['isEvalSupported']).toBe(PDFJS_HAERTUNG.isEvalSupported)
    expect(argumente['enableXfa']).toBe(PDFJS_HAERTUNG.enableXfa)
  })
})

describe('uebernimm', () => {
  it('setzt Name, Pfad und Seitenzahl bei Erfolg', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(42)) })
    await useDokument.getState().uebernimm({
      pfad: 'C:/x/bericht.pdf',
      name: 'bericht.pdf',
      bytes: new Uint8Array([1])
    })
    const zustand = useDokument.getState()
    expect(zustand.ladeZustand).toBe('bereit')
    expect(zustand.name).toBe('bericht.pdf')
    expect(zustand.pfad).toBe('C:/x/bericht.pdf')
    expect(zustand.seitenzahl).toBe(42)
    expect(zustand.aktuelleSeite).toBe(1)
  })

  it('tut nichts, wenn der Dialog abgebrochen wurde', async () => {
    await useDokument.getState().uebernimm(null)
    expect(useDokument.getState().ladeZustand).toBe('leer')
    expect(getDocumentMock).not.toHaveBeenCalled()
  })

  // Ein beschaedigtes Dokument darf die Oberflaeche nicht leer lassen.
  //
  // Seit S1.5 laeuft der Fehler durch die Taxonomie: im Fenster steht ein Text
  // fuer den Nutzer, nicht die pdf.js-Meldung. Die technische Ursache gehoert
  // ins Protokoll.
  it('meldet einen Ladefehler, statt ihn zu verschlucken', async () => {
    const protokoll = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getDocumentMock.mockReturnValue({ promise: Promise.reject(new Error('kaputt')) })
    await useDokument.getState().uebernimm({
      pfad: 'C:/x/defekt.pdf',
      name: 'defekt.pdf',
      bytes: new Uint8Array([1])
    })
    const zustand = useDokument.getState()
    expect(zustand.ladeZustand).toBe('fehler')
    expect(zustand.fehler).toContain('defekt.pdf')
    expect(zustand.fehler).not.toBe('kaputt')
    expect(zustand.fehlerArt).toBe('unbekannt')
    expect(zustand.dokument).toBeNull()
    expect(zustand.seitenzahl).toBe(0)
    // Verschluckt wird nichts: die Originalmeldung steht im Protokoll.
    expect(protokoll.mock.calls.flat().join(' ')).toContain('kaputt')
    protokoll.mockRestore()
  })

  it('behaelt den Dateinamen auch im Fehlerfall', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.reject(new Error('kaputt')) })
    await useDokument.getState().uebernimm({
      pfad: 'C:/x/defekt.pdf',
      name: 'defekt.pdf',
      bytes: new Uint8Array([1])
    })
    expect(useDokument.getState().name).toBe('defekt.pdf')
  })
})

/**
 * S4.0: das Neuladen nach einer Mutation. Dieselbe Datei in neuer Fassung,
 * die Ansicht bleibt, das alte Proxy wird freigegeben.
 */
describe('uebernimm mit Ansicht (Neuladen nach Mutation)', () => {
  it('stellt Seite, Zoom, Drehung und Passung wieder her und markiert das Laden', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(9)) })
    await useDokument.getState().uebernimm(DOKUMENT, {
      seite: 4,
      zoom: 1.75,
      rotation: 90,
      passung: 'frei'
    })
    const zustand = useDokument.getState()
    expect(zustand.ladeArt).toBe('mutation')
    expect(zustand.seitenzahl).toBe(9)
    expect(zustand.aktuelleSeite).toBe(4)
    expect(zustand.sprungZiel).toBe(4)
    expect(zustand.zoom).toBe(1.75)
    expect(zustand.rotation).toBe(90)
    expect(zustand.passung).toBe('frei')
  })

  it('begrenzt die Seite auf die neue Seitenzahl', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(3)) })
    await useDokument.getState().uebernimm(DOKUMENT, {
      seite: 12,
      zoom: 1,
      rotation: 0,
      passung: 'breite'
    })
    expect(useDokument.getState().aktuelleSeite).toBe(3)
  })

  it('gibt das vorige Dokument frei und laedt ohne Ansicht als Wechsel', async () => {
    const destroy = vi.fn(() => Promise.resolve())
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakeDokument(2, { loadingTask: { destroy } }))
    })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().ladeArt).toBe('wechsel')
    expect(destroy).not.toHaveBeenCalled()

    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(1)) })
    await useDokument.getState().uebernimm(DOKUMENT, {
      seite: 1,
      zoom: 1,
      rotation: 0,
      passung: 'breite'
    })
    // Das alte Proxy hielt den Worker-Speicher; ohne destroy wuechse er mit
    // jeder Mutation um ein Dokument.
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  // S5.2a, Aufgabe 5: die Vorgabe aus den Einstellungen gilt fuer das naechste
  // Dokument, nicht rueckwirkend fuer das offene.
  it('beginnt ein neues Dokument mit der eingestellten Passung', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(2)) })
    await useDokument.getState().uebernimm(DOKUMENT)
    useDokument.getState().setzeStandardPassung('seite')
    expect(useDokument.getState().passung).toBe('breite')

    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(1)) })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().passung).toBe('seite')
  })

  it('stellt beim Neuladen nach einer Mutation die Ansicht statt der Standardpassung her', async () => {
    useDokument.getState().setzeStandardPassung('seite')
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(1)) })
    await useDokument.getState().uebernimm(DOKUMENT, {
      seite: 1,
      zoom: 1,
      rotation: 0,
      passung: 'frei'
    })
    expect(useDokument.getState().passung).toBe('frei')
  })
})

/**
 * S6.1: ein eigener Worker, den die Ladeaufgabe nicht besitzt. Mit dem
 * globalen Port beendete `loadingTask.destroy()` den Worker aller Tabs.
 */
describe('Worker', () => {
  it('gibt jedem Laden denselben ausdruecklichen Worker mit', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(1)) })
    await ladeDokument(new Uint8Array([1]))
    await ladeDokument(new Uint8Array([2]))
    const erster = (getDocumentMock.mock.calls[0]?.[0] as Record<string, unknown>)['worker']
    const zweiter = (getDocumentMock.mock.calls[1]?.[0] as Record<string, unknown>)['worker']
    expect(erster).toBeDefined()
    expect(zweiter).toBe(erster)
    // Einmal angelegt, fuer die ganze Laufzeit.
    expect(workerCreate.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('bleibt nach dem Freigeben eines Dokuments nutzbar', async () => {
    const destroy = vi.fn(() => Promise.resolve())
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakeDokument(2, { loadingTask: { destroy } }))
    })
    await useDokument.getState().uebernimm(DOKUMENT)
    const worker = (getDocumentMock.mock.calls.at(-1)?.[0] as Record<string, unknown>)[
      'worker'
    ] as { destroy: ReturnType<typeof vi.fn> }

    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(1)) })
    await useDokument.getState().uebernimm({ ...DOKUMENT, pfad: 'C:/x/b.pdf', name: 'b.pdf' })

    // Das alte Dokument ist frei, der Worker nicht - und das naechste Laden
    // bekommt ihn wieder.
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(worker.destroy).not.toHaveBeenCalled()
    expect((getDocumentMock.mock.calls.at(-1)?.[0] as Record<string, unknown>)['worker']).toBe(
      worker
    )
    expect(useDokument.getState().ladeZustand).toBe('bereit')
  })
})

describe('Zoom, Passung und Drehung', () => {
  it('setzt einen freien Zoomwert und verlaesst die Passung', () => {
    useDokument.setState({ passung: 'breite' })
    useDokument.getState().setzeZoom(1.75)
    expect(useDokument.getState().zoom).toBe(1.75)
    expect(useDokument.getState().passung).toBe('frei')
  })

  it('begrenzt unsinnige Zoomwerte', () => {
    useDokument.getState().setzeZoom(500)
    expect(useDokument.getState().zoom).toBeLessThanOrEqual(8)
    useDokument.getState().setzeZoom(0)
    expect(useDokument.getState().zoom).toBeGreaterThanOrEqual(0.1)
  })

  it('springt zur naechsten Zoomstufe', () => {
    useDokument.setState({ zoom: 1 })
    useDokument.getState().zoomeStufe(1)
    expect(useDokument.getState().zoom).toBe(1.25)
    useDokument.getState().zoomeStufe(-1)
    expect(useDokument.getState().zoom).toBe(1)
  })

  it('behaelt die Passung, wenn sie gesetzt wird', () => {
    useDokument.getState().setzePassung('seite', 0.8)
    expect(useDokument.getState().passung).toBe('seite')
    expect(useDokument.getState().zoom).toBe(0.8)
  })

  it.each([
    [1, 90],
    [2, 180],
    [4, 0]
  ])('dreht %i mal nach rechts auf %i Grad', (male, erwartet) => {
    useDokument.setState({ rotation: 0 })
    for (let i = 0; i < male; i++) useDokument.getState().drehe(1)
    expect(useDokument.getState().rotation).toBe(erwartet)
  })

  it('dreht nach links ohne negative Werte', () => {
    useDokument.setState({ rotation: 0 })
    useDokument.getState().drehe(-1)
    expect(useDokument.getState().rotation).toBe(270)
  })
})

describe('merkeSeitenGroesse', () => {
  it('traegt eine abweichende Groesse nach', () => {
    useDokument.setState({ seitenGroessen: [{ breite: 595, hoehe: 842 }] })
    useDokument.getState().merkeSeitenGroesse(0, { breite: 300, hoehe: 400 })
    expect(useDokument.getState().seitenGroessen[0]).toEqual({ breite: 300, hoehe: 400 })
  })

  // Ohne diese Pruefung erzeugt jedes Zeichnen einen neuen Zustand und damit
  // eine Endlosschleife aus Neuberechnung und Neuzeichnen.
  it('aendert nichts bei gleicher Groesse', () => {
    const vorher = [{ breite: 595, hoehe: 842 }]
    useDokument.setState({ seitenGroessen: vorher })
    useDokument.getState().merkeSeitenGroesse(0, { breite: 595, hoehe: 842 })
    expect(useDokument.getState().seitenGroessen).toBe(vorher)
  })

  it('ignoriert einen unbekannten Index', () => {
    useDokument.setState({ seitenGroessen: [] })
    useDokument.getState().merkeSeitenGroesse(7, { breite: 1, hoehe: 1 })
    expect(useDokument.getState().seitenGroessen).toEqual([])
  })
})

/**
 * Passwortabfrage und XFA-Erkennung (S1.5).
 *
 * Die Faelle laufen auch als E2E gegen encrypted.pdf und xfa.pdf. Sie stehen
 * hier zusaetzlich, weil Playwright-Laeufe keine Abdeckungsdaten liefern und
 * die Zustandsuebergaenge des Stores sonst ungeprueft blieben.
 */
describe('Passwortgeschuetzte Dokumente', () => {
  /**
   * Eine Ladeaufgabe, die sich wie pdf.js verhaelt: sie fragt ueber
   * `onPassword` nach und laesst ihr Versprechen scheitern, sobald `destroy`
   * gerufen wird. Ohne diesen zweiten Teil bliebe das Versprechen beim Abbruch
   * ewig offen — im Test ein Timeout, in der Anwendung ein haengender Ladebalken.
   */
  function aufgabeMitPasswortfrage(erwartet: string, grund = 1): Record<string, unknown> {
    let ablehnen: (fehler: unknown) => void = () => undefined
    const aufgabe: Record<string, unknown> = {
      destroy: vi.fn(() => {
        ablehnen(new Error('Worker was destroyed'))
        return Promise.resolve()
      })
    }
    aufgabe['promise'] = new Promise((aufloesen, verwerfen) => {
      ablehnen = verwerfen
      queueMicrotask(() => {
        const frage = aufgabe['onPassword'] as
          ((weiter: (passwort: string) => void, grund: number) => void) | undefined
        if (frage === undefined) {
          verwerfen(new Error('pdf.js haette nach dem Passwort gefragt'))
          return
        }
        frage((passwort) => {
          if (passwort === erwartet) aufloesen(fakeDokument(1))
          else verwerfen(new Error('falsches Passwort'))
        }, grund)
      })
    })
    return aufgabe
  }

  it('fragt nach dem Passwort und oeffnet mit der Antwort', async () => {
    getDocumentMock.mockReturnValue(aufgabeMitPasswortfrage('geheim'))
    const laden = useDokument.getState().uebernimm(DOKUMENT)

    await vi.waitFor(() => {
      expect(useDokument.getState().passwortFrage).toEqual({ erneut: false })
    })
    useDokument.getState().beantwortePasswort('geheim')
    await laden

    expect(useDokument.getState().ladeZustand).toBe('bereit')
    expect(useDokument.getState().passwortFrage).toBeNull()
  })

  // Ohne die Unterscheidung wiederholte die Oberflaeche dieselbe Frage
  // kommentarlos.
  it('meldet einen Fehlversuch als solchen', async () => {
    getDocumentMock.mockReturnValue(aufgabeMitPasswortfrage('geheim', 2))
    const laden = useDokument.getState().uebernimm(DOKUMENT)
    await vi.waitFor(() => {
      expect(useDokument.getState().passwortFrage).toEqual({ erneut: true })
    })
    useDokument.getState().beantwortePasswort('geheim')
    await laden
  })

  // Ein Abbruch ist kein Fehler: danach darf keine Fehlermeldung stehen, die
  // niemand verursacht hat.
  it('behandelt den Abbruch als Hinweis, nicht als Fehler', async () => {
    const aufgabe = aufgabeMitPasswortfrage('geheim')
    getDocumentMock.mockReturnValue(aufgabe)
    const laden = useDokument.getState().uebernimm(DOKUMENT)

    await vi.waitFor(() => {
      expect(useDokument.getState().passwortFrage).not.toBeNull()
    })
    useDokument.getState().beantwortePasswort(null)
    await laden

    const zustand = useDokument.getState()
    expect(zustand.ladeZustand).toBe('leer')
    expect(zustand.fehler).toBeNull()
    expect(zustand.hinweis).toMatch(/abgebrochen/)
    expect(aufgabe['destroy']).toHaveBeenCalled()
  })

  it('raeumt die Frage weg, wenn das Laden anders scheitert', async () => {
    const protokoll = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getDocumentMock.mockReturnValue({ promise: Promise.reject(new Error('kaputt')) })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().passwortFrage).toBeNull()
    protokoll.mockRestore()
  })
})

describe('XFA-Erkennung', () => {
  it('erkennt ein reines XFA-Dokument', async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(fakeDokument(1, { isPureXfa: true }))
    })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().istXfa).toBe(true)
  })

  // Der haeufigere Fall: ein Hybrid-Formular mit Ausweichseite. `isPureXfa` ist
  // dort falsch, `/XFA` steht aber im AcroForm.
  it('erkennt XFA am AcroForm-Feld', async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(
        fakeDokument(1, {
          getMetadata: vi.fn(() => Promise.resolve({ info: { IsXFAPresent: true } }))
        })
      )
    })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().istXfa).toBe(true)
  })

  it('meldet ein gewoehnliches Dokument nicht als XFA', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDokument(1)) })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().istXfa).toBe(false)
  })

  // Fehlende Metadaten sind kein Grund, das Oeffnen scheitern zu lassen - aber
  // auch keiner, den Fehlschlag zu verschweigen.
  it('oeffnet auch ohne lesbare Metadaten und protokolliert den Fehlschlag', async () => {
    const protokoll = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(
        fakeDokument(1, { getMetadata: vi.fn(() => Promise.reject(new Error('keine Metadaten'))) })
      )
    })
    await useDokument.getState().uebernimm(DOKUMENT)
    expect(useDokument.getState().ladeZustand).toBe('bereit')
    expect(useDokument.getState().istXfa).toBe(false)
    expect(protokoll).toHaveBeenCalled()
    protokoll.mockRestore()
  })
})

/**
 * D13, entschieden in S2.1: **anzeigen und ignorieren.**
 *
 * Die Flags sind keine Zugriffskontrolle - wer das Dokument oeffnen kann, hat
 * den Schluessel. Der Store liest sie deshalb nur, um sie zu benennen; keine
 * Funktion der Anwendung macht sich von ihnen abhaengig.
 */
describe('Berechtigungsflags', () => {
  it('nennt die Rechte, die der Autor entzogen hat', async () => {
    // Nur Drucken (0x04) ist erlaubt.
    const rechte = await leseEinschraenkungen({
      getPermissions: () => Promise.resolve(new Set([0x04]))
    } as never)
    expect(rechte).not.toContain('Drucken')
    expect(rechte).toContain('Kopieren')
    expect(rechte).toContain('Kommentieren')
  })

  // Ohne /Encrypt-Verzeichnis liefert pdf.js null - dann gibt es nichts zu
  // melden, und die Hinweiszeile bleibt weg.
  it('meldet nichts, wenn das Dokument keine Einschraenkungen nennt', async () => {
    expect(
      await leseEinschraenkungen({ getPermissions: () => Promise.resolve(null) } as never)
    ).toEqual([])
  })

  it('laesst das Oeffnen nicht scheitern, protokolliert den Fehlschlag aber', async () => {
    const protokoll = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rechte = await leseEinschraenkungen({
      getPermissions: () => Promise.reject(new Error('kaputt'))
    } as never)
    expect(rechte).toEqual([])
    expect(protokoll).toHaveBeenCalled()
    protokoll.mockRestore()
  })

  it('traegt die Einschraenkungen beim Oeffnen nach', async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(
        fakeDokument(1, { getPermissions: vi.fn(() => Promise.resolve(new Set([0x04]))) })
      )
    })
    await useDokument.getState().uebernimm(DOKUMENT)
    // Der Zustand "bereit" wartet nicht darauf (Budget aus S1.2).
    expect(useDokument.getState().ladeZustand).toBe('bereit')
    await vi.waitFor(() => {
      expect(useDokument.getState().eingeschraenkteRechte).toContain('Kopieren')
    })
  })
})
