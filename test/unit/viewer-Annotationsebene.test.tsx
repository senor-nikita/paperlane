import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useAnnotationen } = await import('../../src/renderer/src/annotations-store')
const { Annotationsebene } = await import('../../src/renderer/src/viewer/Annotationsebene')

const A4 = { breite: 595, hoehe: 842 }

const MARKIERUNG = {
  id: 'm1',
  subtype: 'Highlight',
  rect: [70, 712, 340, 782],
  quadPoints: Float32Array.from([
    70, 782, 340, 782, 70, 752, 340, 752, 70, 742, 200, 742, 70, 712, 200, 712
  ]),
  color: Uint8ClampedArray.from([255, 255, 0]),
  contentsObj: { str: 'Vorhandene Markierung' }
}

const NOTIZ = {
  id: 'n1',
  subtype: 'Text',
  rect: [500, 750, 524, 774],
  titleObj: { str: 'Testautor' },
  contentsObj: { str: 'Vorhandene Notiz' }
}

const INTERNER_LINK = {
  id: 'l1',
  subtype: 'Link',
  rect: [70, 694, 250, 716],
  dest: [{ num: 5, gen: 0 }, { name: 'XYZ' }, 0, 400, null]
}

const EXTERNER_LINK = {
  id: 'l2',
  subtype: 'Link',
  rect: [70, 654, 220, 676],
  unsafeUrl: 'https://example.org/'
}

const DATEI_LINK = {
  id: 'l3',
  subtype: 'Link',
  rect: [70, 614, 220, 636],
  unsafeUrl: 'file:///C:/Windows/win.ini'
}

function setzeDokument(annotationen: unknown[]): void {
  useDokument.setState({
    ladeZustand: 'bereit',
    seitenzahl: 2,
    aktuelleSeite: 1,
    zoom: 1,
    rotation: 0,
    passung: 'frei',
    sprungZiel: null,
    sprungAnteil: null,
    hinweis: null,
    seitenGroessen: [A4, A4],
    dokument: {
      getPage: () =>
        Promise.resolve({
          view: [0, 0, 595, 842],
          getAnnotations: () => Promise.resolve(annotationen)
        }),
      getPageIndex: () => Promise.resolve(1),
      getDestination: () => Promise.resolve(null)
    } as never
  })
}

function stubBruecke(externOeffnen: () => Promise<unknown>): void {
  Object.defineProperty(window, 'api', { configurable: true, value: { externOeffnen } })
}

beforeEach(() => {
  useAnnotationen.getState().vergiss()
  stubBruecke(() => Promise.resolve({ art: 'geoeffnet' }))
})

describe('Annotationsebene', () => {
  /**
   * Das Exit-Kriterium des Schritts: jede Annotation erscheint **genau einmal**.
   * Zusammen mit `annotationMode: DISABLE` (Guard-Test) ist damit
   * ausgeschlossen, dass eine Annotation zweimal auf der Seite landet — einmal
   * von pdf.js in die Canvas gemalt, einmal von dieser Ebene.
   */
  it('zeichnet jede Annotation genau einmal', async () => {
    setzeDokument([MARKIERUNG, NOTIZ, INTERNER_LINK, EXTERNER_LINK])
    render(<Annotationsebene index={0} />)
    await waitFor(() => {
      expect(screen.getByTestId('annotation-m1')).not.toBeNull()
    })
    for (const kennung of ['m1', 'n1', 'l1', 'l2']) {
      expect(screen.getAllByTestId('annotation-' + kennung)).toHaveLength(1)
    }
  })

  // Ein Rechteck je Textzeile: ein einziges ueber den ganzen Bereich waere bei
  // einer mehrzeiligen Markierung falsch.
  it('gibt einer zweizeiligen Markierung zwei Streifen', async () => {
    setzeDokument([MARKIERUNG])
    render(<Annotationsebene index={0} />)
    const flaeche = await screen.findByTestId('annotation-m1')
    expect(flaeche.querySelectorAll('div')).toHaveLength(2)
  })

  it('legt die Markierung an die Stelle, die das Dokument nennt', async () => {
    setzeDokument([MARKIERUNG])
    render(<Annotationsebene index={0} />)
    const flaeche = await screen.findByTestId('annotation-m1')
    // Rect 70..340 waagerecht, Oberkante 782 von 842 Punkten Seitenhoehe.
    expect(flaeche.style.left).toBe('70px')
    expect(flaeche.style.top).toBe('60px')
  })

  it('waechst mit dem Zoom', async () => {
    setzeDokument([MARKIERUNG])
    useDokument.setState({ zoom: 2 })
    render(<Annotationsebene index={0} />)
    const flaeche = await screen.findByTestId('annotation-m1')
    expect(flaeche.style.left).toBe('140px')
    expect(flaeche.style.top).toBe('120px')
  })

  // `intent: 'display'` sortiert versteckte Annotationen zwar schon in pdf.js
  // aus; die Ebene verlaesst sich nicht darauf.
  it('zeichnet versteckte Annotationen nicht', async () => {
    setzeDokument([MARKIERUNG, { ...NOTIZ, annotationFlags: 2 }])
    render(<Annotationsebene index={0} />)
    await screen.findByTestId('annotation-m1')
    expect(screen.queryByTestId('annotation-n1')).toBeNull()
  })

  it('zeichnet unbekannte Subtypen nicht', async () => {
    setzeDokument([MARKIERUNG, { id: 'p1', subtype: 'Popup', rect: [0, 0, 10, 10] }])
    render(<Annotationsebene index={0} />)
    await screen.findByTestId('annotation-m1')
    expect(screen.queryByTestId('annotation-p1')).toBeNull()
  })

  // Ohne das endete die Textauswahl aus S1.4 unter jeder Markierung.
  it('laesst Zeigereignisse durch', async () => {
    setzeDokument([MARKIERUNG])
    render(<Annotationsebene index={0} />)
    const ebene = await screen.findByTestId('annotationsebene-1')
    expect(ebene.className).toBe('annotationsebene')
  })
})

describe('Annotationsebene — die uebrigen Typen', () => {
  /**
   * Jeder im Plan genannte Subtyp bekommt seine eigene Darstellung. Ohne
   * diesen Test faellt erst in S2.2 auf, dass eine Durchstreichung als
   * Unterstreichung gezeichnet wurde.
   */
  it.each([
    ['Underline', 'u1'],
    ['StrikeOut', 's1'],
    ['Square', 'q1'],
    ['Circle', 'c1'],
    ['Stamp', 'st1'],
    ['Ink', 'i1']
  ])('zeichnet %s', async (subtype, id) => {
    setzeDokument([
      {
        id,
        subtype,
        rect: [70, 700, 340, 760],
        quadPoints:
          subtype === 'Underline' || subtype === 'StrikeOut'
            ? Float32Array.from([70, 760, 340, 760, 70, 700, 340, 700])
            : undefined,
        inkLists:
          subtype === 'Ink' ? [Float32Array.from([70, 700, 200, 760, 340, 700])] : undefined,
        color: Uint8ClampedArray.from([200, 0, 0])
      }
    ])
    render(<Annotationsebene index={0} />)
    expect(await screen.findByTestId('annotation-' + id)).not.toBeNull()
  })

  // Unterstreichung und Durchstreichung liegen im selben Rechteck, aber nicht
  // auf derselben Hoehe - sonst waeren sie nicht zu unterscheiden.
  it('legt die Durchstreichung hoeher als die Unterstreichung', async () => {
    const strich = {
      rect: [70, 700, 340, 760],
      quadPoints: Float32Array.from([70, 760, 340, 760, 70, 700, 340, 700])
    }
    setzeDokument([
      { ...strich, id: 'u1', subtype: 'Underline' },
      { ...strich, id: 's1', subtype: 'StrikeOut' }
    ])
    render(<Annotationsebene index={0} />)
    const unterstrichen = (await screen.findByTestId('annotation-u1')).querySelector('div')
    const durchgestrichen = screen.getByTestId('annotation-s1').querySelector('div')
    expect(Number.parseFloat(unterstrichen?.style.top ?? '0')).toBeGreaterThan(
      Number.parseFloat(durchgestrichen?.style.top ?? '0')
    )
  })

  it('macht aus einer Ellipse einen runden Rahmen', async () => {
    setzeDokument([{ id: 'c1', subtype: 'Circle', rect: [70, 700, 340, 760] }])
    render(<Annotationsebene index={0} />)
    const rahmen = (await screen.findByTestId('annotation-c1')).querySelector('div')
    expect(rahmen?.style.borderRadius).toBe('50%')
  })

  it('zeichnet einen Freihandzug als Pfad in Bildschirmkoordinaten', async () => {
    setzeDokument([
      {
        id: 'i1',
        subtype: 'Ink',
        rect: [70, 700, 340, 760],
        inkLists: [Float32Array.from([70, 760, 340, 700])]
      }
    ])
    render(<Annotationsebene index={0} />)
    const pfad = (await screen.findByTestId('annotation-i1')).querySelector('polyline')
    // Huelle beginnt bei (70, 82); die Punkte liegen relativ dazu.
    expect(pfad?.getAttribute('points')).toBe('0,0 270,60')
  })

  // Ohne Appearance-Stream ist der Inhalt alles, was ein Stempel hergibt.
  it('beschriftet einen Stempel mit seinem Inhalt', async () => {
    setzeDokument([
      { id: 'st1', subtype: 'Stamp', rect: [70, 700, 340, 760], contentsObj: { str: 'Geprueft' } }
    ])
    render(<Annotationsebene index={0} />)
    expect((await screen.findByTestId('annotation-st1')).textContent).toBe('Geprueft')
  })

  /**
   * S3.2: ein Stempel mit Bild zeigt das Bild — ohne Rahmen und ohne Text.
   * Das Bild kommt nicht aus dem Dokument (dort laege es im /AP, den diese
   * Ebene nicht liest), sondern aus dem Modell einer neu gesetzten Signatur.
   */
  it('zeigt bei einem Stempel mit Bild das Bild statt des Textes', async () => {
    setzeDokument([])
    const url = 'data:image/png;base64,iVBORw0KGgo='
    render(<Annotationsebene index={0} />)
    await screen.findByTestId('annotationsebene-1')
    // Nach dem Laden einfuegen, wie es die Bearbeitungsebene tut - vorher
    // wuerde das Lesen der (leeren) Seite den Eintrag ueberschreiben.
    useAnnotationen.getState().fuegeEin({
      id: 'sig1',
      seite: 1,
      typ: 'Stamp',
      subtyp: 'Stamp',
      rect: [70, 700, 220, 750],
      quadPoints: null,
      striche: null,
      farbe: null,
      strichstaerke: null,
      opazitaet: 1,
      autor: 'Testautor',
      inhalt: 'Signatur (Bild)',
      erstellt: null,
      geaendert: null,
      versteckt: false,
      ziel: null,
      bild: url,
      roh: null
    })
    const eintrag = await screen.findByTestId('annotation-sig1')
    const bild = eintrag.querySelector('img')
    expect(bild).not.toBeNull()
    expect(bild?.getAttribute('src')).toBe(url)
    expect(bild?.getAttribute('alt')).toBe('Signatur (Bild)')
    expect(eintrag.textContent).toBe('')
  })

  /**
   * S6.11: bis dahin kannte die Anzeige `/FreeText` nicht - der Text war nur
   * im Eingabekasten zu sehen und verschwand mit dem Verlassen des Feldes.
   * Solange der Kasten offen ist, bleibt die Anzeige verborgen.
   */
  it('zeigt den Text einer FreeText und verbirgt ihn, solange der Kasten offen ist', async () => {
    const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
    setzeDokument([])
    render(<Annotationsebene index={0} />)
    await screen.findByTestId('annotationsebene-1')
    useAnnotationen.getState().fuegeEin({
      id: 'ft1',
      seite: 1,
      typ: 'FreeText',
      subtyp: 'FreeText',
      rect: [70, 700, 300, 740],
      quadPoints: null,
      striche: null,
      farbe: { r: 200, g: 0, b: 0 },
      strichstaerke: null,
      opazitaet: 1,
      autor: 'Testautor',
      inhalt: 'Zeile eins\nZeile zwei',
      erstellt: null,
      geaendert: null,
      versteckt: false,
      ziel: null,
      roh: null,
      schriftFamilie: 'Times',
      schriftGroesse: 12,
      schriftFett: true,
      schriftKursiv: true,
      ausrichtung: 'mitte'
    })
    const anzeige = await screen.findByTestId('freitext-anzeige-ft1')
    expect(anzeige.textContent).toBe('Zeile eins\nZeile zwei')
    expect(anzeige.style.whiteSpace).toBe('pre-wrap')
    expect(anzeige.style.fontWeight).toBe('700')
    expect(anzeige.style.fontStyle).toBe('italic')
    expect(anzeige.style.textAlign).toBe('center')
    expect(anzeige.style.color).toBe('rgb(200, 0, 0)')
    expect(anzeige.style.visibility).toBe('visible')

    useBearbeitung.getState().oeffneFreitext('ft1')
    await waitFor(() => {
      expect(screen.getByTestId('freitext-anzeige-ft1').style.visibility).toBe('hidden')
    })
    useBearbeitung.getState().oeffneFreitext(null)
  })

  it('beschriftet einen Stempel ohne Inhalt neutral', async () => {
    setzeDokument([{ id: 'st2', subtype: 'Stamp', rect: [70, 700, 340, 760] }])
    render(<Annotationsebene index={0} />)
    expect((await screen.findByTestId('annotation-st2')).textContent).toBe('Stempel')
  })

  it('bleibt leer, wenn die Seite keine brauchbaren Masse liefert', async () => {
    useDokument.setState({
      dokument: {
        getPage: () => Promise.resolve({ getAnnotations: () => Promise.resolve([MARKIERUNG]) })
      } as never
    })
    render(<Annotationsebene index={0} />)
    const ebene = await screen.findByTestId('annotationsebene-1')
    await waitFor(() => {
      expect(useAnnotationen.getState().proSeite[1]).toBeDefined()
    })
    expect(ebene.children).toHaveLength(0)
  })
})

describe('Annotationsebene — Verweise', () => {
  it('springt bei einem internen Verweis an die aufgeloeste Stelle', async () => {
    setzeDokument([INTERNER_LINK])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-link-l1'))
    await waitFor(() => {
      expect(useDokument.getState().sprungZiel).toBe(2)
    })
    // XYZ mit oben = 400 auf einer 842 Punkt hohen Seite.
    expect(useDokument.getState().sprungAnteil).toBeCloseTo((842 - 400) / 842, 3)
  })

  it('reicht einen externen Verweis an den Main-Prozess', async () => {
    const externOeffnen = vi.fn(() => Promise.resolve({ art: 'geoeffnet' }))
    stubBruecke(externOeffnen)
    setzeDokument([EXTERNER_LINK])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-link-l2'))
    await waitFor(() => {
      expect(externOeffnen).toHaveBeenCalledWith('https://example.org/')
    })
  })

  /**
   * Das Ziel geht **ungeprueft** an den Main-Prozess. Wuerde der Renderer
   * schon filtern, verschwaende ein `file:`-Verweis lautlos, statt sichtbar
   * abgelehnt zu werden — genau das verlangt das Exit-Kriterium.
   */
  it('reicht auch ein file-Ziel weiter und meldet die Ablehnung', async () => {
    const externOeffnen = vi.fn(() =>
      Promise.resolve({
        art: 'abgelehnt',
        grund: 'Verweise vom Typ "file" werden nicht geoeffnet.'
      })
    )
    stubBruecke(externOeffnen)
    setzeDokument([DATEI_LINK])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-link-l3'))
    await waitFor(() => {
      expect(externOeffnen).toHaveBeenCalledWith('file:///C:/Windows/win.ini')
    })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toContain('file')
    })
  })

  it('nennt das Ziel im Namen der Schaltflaeche', async () => {
    setzeDokument([EXTERNER_LINK, INTERNER_LINK])
    render(<Annotationsebene index={0} />)
    const extern = await screen.findByTestId('annotation-link-l2')
    expect(extern.getAttribute('aria-label')).toBe('Verweis auf https://example.org/')
    expect(screen.getByTestId('annotation-link-l1').getAttribute('aria-label')).toBe(
      'Verweis im Dokument'
    )
  })
})

describe('Annotationsebene — Notizen', () => {
  it('klappt eine Notiz auf und wieder zu', async () => {
    setzeDokument([NOTIZ])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-notiz-n1'))

    const zettel = screen.getByTestId('annotation-notizzettel-n1')
    expect(zettel.textContent).toContain('Testautor')
    expect(zettel.textContent).toContain('Vorhandene Notiz')

    fireEvent.click(screen.getByTestId('annotation-notiz-schliessen-n1'))
    expect(screen.queryByTestId('annotation-notizzettel-n1')).toBeNull()
  })

  // Der Zettel geht auf, ohne dass der Fokus wandert; ohne Live-Region
  // bekaeme ein Screenreader-Nutzer davon nichts mit.
  it('sagt den Zettel als Live-Region an', async () => {
    setzeDokument([NOTIZ])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-notiz-n1'))
    expect(screen.getByTestId('annotation-notizzettel-n1').getAttribute('role')).toBe('status')
  })

  // Entf im Zettel: ohne Zeichen zum Loeschen nimmt es die ganze Notiz weg,
  // sonst loescht es wie gewohnt ein Zeichen.
  it('loescht die Notiz mit Entf, wenn die Einfuegemarke am Ende des Textes steht', async () => {
    // Die Auswahl ist global: ein Vortest laesst "n1" gewaehlt, und der Klick
    // klappte den Zettel dann wieder zu.
    const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
    useBearbeitung.getState().waehle(null)
    setzeDokument([NOTIZ])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-notiz-n1'))

    const eingabe = screen.getByTestId<HTMLTextAreaElement>('annotation-notiz-eingabe-n1')
    eingabe.setSelectionRange(eingabe.value.length, eingabe.value.length)
    fireEvent.keyDown(eingabe, { key: 'Delete' })

    expect(useAnnotationen.getState().finde('n1')).toBeNull()
    expect(screen.queryByTestId('annotation-notizzettel-n1')).toBeNull()
  })

  it('laesst die Notiz bei Entf stehen, wenn noch Text rechts der Einfuegemarke steht', async () => {
    const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
    useBearbeitung.getState().waehle(null)
    setzeDokument([NOTIZ])
    render(<Annotationsebene index={0} />)
    fireEvent.click(await screen.findByTestId('annotation-notiz-n1'))

    const eingabe = screen.getByTestId<HTMLTextAreaElement>('annotation-notiz-eingabe-n1')
    eingabe.setSelectionRange(0, 0)
    fireEvent.keyDown(eingabe, { key: 'Delete' })

    expect(useAnnotationen.getState().finde('n1')).not.toBeNull()
    expect(screen.getByTestId('annotation-notizzettel-n1')).toBeTruthy()
  })
})
