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
const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
const { useFormular } = await import('../../src/renderer/src/formular-store')
const { useHistorie } = await import('../../src/renderer/src/historie')
const { setzeKennungszaehlerZurueck } = await import('../../src/renderer/src/viewer/erzeugen')
const { wandleAnnotationen } = await import('../../src/renderer/src/viewer/annotationen')
const { Bearbeitungsebene } = await import('../../src/renderer/src/viewer/Bearbeitungsebene')

/**
 * Die Bearbeitungsebene (S2.2).
 *
 * jsdom liefert fuer `getBoundingClientRect` lauter Nullen — Zeigerkoordinaten
 * entsprechen hier also unmittelbar den Seitenkoordinaten. Bei Zoom 1 und der
 * A4-MediaBox heisst das: Bildschirm y = 842 − PDF y.
 *
 * Was jsdom nicht kann, prueft der E2E-Test: echtes Layout, echte Textauswahl,
 * echtes Ziehen.
 */
const A4 = { breite: 595, hoehe: 842 }

/**
 * Die Bearbeitungsebene liest nicht selbst: gefuellt wird der Speicher von der
 * Anzeigeebene (S2.1). Im Test uebernimmt das diese Funktion.
 */
function setzeDokument(annotationen: unknown[] = []): void {
  useAnnotationen.setState({ proSeite: { 1: wandleAnnotationen(annotationen, 1) } })
  useDokument.setState({
    ladeZustand: 'bereit',
    seitenzahl: 1,
    aktuelleSeite: 1,
    zoom: 1,
    rotation: 0,
    passung: 'frei',
    seitenGroessen: [A4],
    dokument: {
      getPage: () =>
        Promise.resolve({
          view: [0, 0, 595, 842],
          getAnnotations: () => Promise.resolve(annotationen)
        })
    } as never
  })
}

beforeEach(() => {
  // jsdom kennt die Zeigererfassung nicht; sie ist fuer die Logik unerheblich.
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  setzeKennungszaehlerZurueck()
  useHistorie.getState().leere()
  useAnnotationen.getState().vergiss()
  useFormular.getState().vergiss()
  useBearbeitung.setState({
    werkzeug: 'auswahl',
    farbe: '#ffd400',
    strichstaerke: 2,
    autor: 'Testautor',
    stempel: 'Geprueft',
    signaturBild: null,
    ausgewaehlt: null,
    anwendenAuf: null
  })
  setzeDokument()
})

/** Rendert und wartet, bis die Ebene ihre Seitenmasse hat. */
async function zeichenflaeche(): Promise<HTMLElement> {
  render(<Bearbeitungsebene index={0} />)
  return screen.findByTestId('zeichenflaeche-1')
}

describe('Bearbeitungsebene — Flaechen', () => {
  /**
   * Die Bedingung dafuer, dass die Textauswahl aus S1.4 weiter funktioniert:
   * die Zeichenflaeche gibt es nur fuer die Werkzeuge, die sie brauchen.
   */
  it.each([
    ['auswahl', false],
    ['markieren', false],
    ['unterstreichen', false],
    ['durchstreichen', false],
    ['notiz', true],
    ['text', true],
    ['stempel', true],
    ['freihand', true],
    // Ohne Bild gibt es nichts zu setzen: die Textauswahl bleibt frei.
    ['signatur', false]
  ])('zeigt beim Werkzeug %s die Zeichenflaeche: %s', async (werkzeug, erwartet) => {
    useBearbeitung.setState({ werkzeug: werkzeug as never })
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('bearbeitungsebene-1')
    expect(screen.queryByTestId('zeichenflaeche-1') !== null).toBe(erwartet)
  })

  it('zeigt beim Signaturwerkzeug die Zeichenflaeche, sobald ein Bild da ist', async () => {
    useBearbeitung.setState({ werkzeug: 'signatur', signaturBild: SIGNATUR })
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('bearbeitungsebene-1')
    expect(screen.queryByTestId('zeichenflaeche-1')).not.toBeNull()
  })
})

const SIGNATUR = { url: 'data:image/png;base64,iVBORw0KGgo=', breite: 300, hoehe: 100 }

/** Ein Signaturfeld auf Seite 1, wie die Formularebene es in den Speicher legt. */
function mitSignaturfeld(rect: readonly [number, number, number, number]): void {
  useFormular.setState({
    proSeite: {
      1: [
        {
          id: '9R',
          name: 'unterschrift',
          art: 'signatur',
          seite: 1,
          rect,
          schreibgeschuetzt: false,
          pflicht: false,
          versteckt: false,
          maxLaenge: null,
          mehrzeilig: false,
          passwort: false,
          exportwert: null,
          optionen: [],
          kombiniert: false,
          mehrfach: false,
          format: null,
          ausgangswert: '',
          hilfetext: null
        }
      ]
    }
  })
}

/**
 * Die grafische Signatur (S3.2, Aufgabe 4): ein Klick setzt das Bild — frei
 * an der Stelle, oder in ein Signaturfeld eingepasst, wenn der Klick eines
 * trifft. Das Feld selbst bleibt unangetastet.
 */
describe('Bearbeitungsebene — Signatur', () => {
  it('setzt die Signatur frei an der angeklickten Stelle, Hoehe aus dem Bild', async () => {
    useBearbeitung.setState({ werkzeug: 'signatur', signaturBild: SIGNATUR })
    const flaeche = await zeichenflaeche()
    // Bildschirm y = 142 entspricht PDF y = 700.
    fireEvent.click(flaeche, { clientX: 100, clientY: 142 })

    const angelegte = useAnnotationen.getState().proSeite[1] ?? []
    expect(angelegte).toHaveLength(1)
    const signatur = angelegte[0]
    expect(signatur?.typ).toBe('Stamp')
    expect(signatur?.bild).toBe(SIGNATUR.url)
    expect(signatur?.rect[0]).toBeCloseTo(100, 6)
    expect(signatur?.rect[3]).toBeCloseTo(700, 6)
    // Breite 150 bei Verhaeltnis 3:1 -> Hoehe 50.
    expect((signatur?.rect[2] ?? 0) - (signatur?.rect[0] ?? 0)).toBeCloseTo(150, 6)
    expect((signatur?.rect[3] ?? 0) - (signatur?.rect[1] ?? 0)).toBeCloseTo(50, 6)
  })

  it('passt die Signatur in ein getroffenes Signaturfeld ein', async () => {
    mitSignaturfeld([100, 500, 300, 600])
    useBearbeitung.setState({ werkzeug: 'signatur', signaturBild: SIGNATUR })
    const flaeche = await zeichenflaeche()
    // PDF (200, 550) liegt im Feld; Bildschirm y = 842 - 550 = 292.
    fireEvent.click(flaeche, { clientX: 200, clientY: 292 })

    const signatur = (useAnnotationen.getState().proSeite[1] ?? [])[0]
    // Feld 200x100, Bild 3:1 -> 200x66.67, senkrecht mittig.
    expect(signatur?.rect[0]).toBeCloseTo(100, 6)
    expect(signatur?.rect[2]).toBeCloseTo(300, 6)
    expect(signatur?.rect[1]).toBeCloseTo(500 + (100 - 200 / 3) / 2, 6)
    expect(signatur?.rect[3]).toBeCloseTo(600 - (100 - 200 / 3) / 2, 6)
    // Das Feld selbst ist unveraendert: keine Formularaenderung.
    expect(Object.keys(useFormular.getState().werte)).toHaveLength(0)
  })

  it('setzt neben dem Feld frei, nicht ins Feld', async () => {
    mitSignaturfeld([100, 500, 300, 600])
    useBearbeitung.setState({ werkzeug: 'signatur', signaturBild: SIGNATUR })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 400, clientY: 292 })
    const signatur = (useAnnotationen.getState().proSeite[1] ?? [])[0]
    expect(signatur?.rect[0]).toBeCloseTo(400, 6)
  })

  it('tut ohne Bild nichts', async () => {
    useBearbeitung.setState({ werkzeug: 'signatur', signaturBild: null })
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('bearbeitungsebene-1')
    expect(screen.queryByTestId('zeichenflaeche-1')).toBeNull()
    expect(useAnnotationen.getState().proSeite[1] ?? []).toHaveLength(0)
  })
})

describe('Bearbeitungsebene — Erstellen', () => {
  it('setzt eine Notiz an die angeklickte Stelle', async () => {
    useBearbeitung.setState({ werkzeug: 'notiz' })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 100, clientY: 142 })

    const angelegte = useAnnotationen.getState().proSeite[1] ?? []
    expect(angelegte).toHaveLength(1)
    expect(angelegte[0]?.typ).toBe('Text')
    // Bildschirm y = 142 entspricht PDF y = 700.
    expect(angelegte[0]?.rect[3]).toBeCloseTo(700, 6)
    expect(angelegte[0]?.rect[0]).toBeCloseTo(100, 6)
    expect(angelegte[0]?.autor).toBe('Testautor')
  })

  /**
   * Seit S6.9: die neue Notiz wird ausgewaehlt, damit ihr Zettel aufgeht und
   * das Textfeld den Fokus hat - wie beim Freitext. Das Werkzeug kehrt zur
   * Auswahl zurueck; sonst laege die Zeichenflaeche ueber dem Zettel.
   */
  it('waehlt die neue Notiz aus und kehrt zur Auswahl zurueck', async () => {
    useBearbeitung.setState({ werkzeug: 'notiz' })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 10, clientY: 10 })
    const [neu] = useAnnotationen.getState().proSeite[1] ?? []
    expect(useBearbeitung.getState().ausgewaehlt).toBe(neu?.id)
    expect(useBearbeitung.getState().werkzeug).toBe('auswahl')
  })

  it('setzt einen Stempel mit dem gewaehlten Text', async () => {
    useBearbeitung.setState({ werkzeug: 'stempel', stempel: 'Vertraulich' })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 50, clientY: 442 })

    const angelegte = useAnnotationen.getState().proSeite[1] ?? []
    expect(angelegte[0]?.typ).toBe('Stamp')
    expect(angelegte[0]?.inhalt).toBe('Vertraulich')
  })

  it('traegt jedes Erstellen in die Historie ein', async () => {
    useBearbeitung.setState({ werkzeug: 'notiz' })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 10, clientY: 10 })
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(0)
  })

  /**
   * S6.5, Aufgabe 1: Klick setzt ein `/FreeText`-Feld und waehlt es sofort
   * aus — anders als bei der Notiz, weil hier direkt weitergetippt wird.
   */
  it('setzt ein FreeText-Feld, waehlt es aus und wechselt ins Auswahlwerkzeug', async () => {
    useBearbeitung.setState({ werkzeug: 'text' })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 100, clientY: 142 })

    const angelegte = useAnnotationen.getState().proSeite[1] ?? []
    expect(angelegte).toHaveLength(1)
    expect(angelegte[0]?.typ).toBe('FreeText')
    expect(angelegte[0]?.schriftFamilie).toBe('Helvetica')
    expect(useBearbeitung.getState().werkzeug).toBe('auswahl')
    expect(useBearbeitung.getState().ausgewaehlt).toBe(angelegte[0]?.id)
  })
})

/**
 * Der Eingabekasten aus Freitextfeld.tsx (S6.5, Aufgabe 1).
 *
 * Ueber die volle Bearbeitungsebene und nicht isoliert: die Aufrufstelle
 * entscheidet, wann der Kasten ueberhaupt erscheint (Erzeugen, Doppelklick),
 * und genau dieses Zusammenspiel ist hier die Aussage.
 */
describe('Bearbeitungsebene — FreeText bearbeiten', () => {
  async function neuesFeld(): Promise<string> {
    useBearbeitung.setState({ werkzeug: 'text' })
    const flaeche = await zeichenflaeche()
    fireEvent.click(flaeche, { clientX: 100, clientY: 142 })
    return (useAnnotationen.getState().proSeite[1] ?? [])[0]?.id ?? ''
  }

  it('zeigt den Kasten sofort nach dem Erzeugen und uebernimmt Tastatureingaben', async () => {
    const id = await neuesFeld()
    const kasten = await screen.findByTestId('freitextfeld-' + id)
    fireEvent.change(kasten, { target: { value: 'Größe: 10€' } })
    // Waehrend des Tippens: Live-Vorschau im Speicher, aber noch kein
    // Historienschritt (siehe Freitextfeld.tsx).
    expect(useAnnotationen.getState().finde(id)?.inhalt).toBe('Größe: 10€')
    expect(useHistorie.getState().vergangenheit).toHaveLength(1) // nur das Erstellen

    fireEvent.blur(kasten)
    expect(useHistorie.getState().vergangenheit).toHaveLength(2)
    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().finde(id)?.inhalt).toBe('')
  })

  // Seit S6.12 hebt Escape auch die Auswahl auf: "fertig" statt "halb offen".
  it('schliesst den Kasten mit Escape und hebt die Auswahl auf', async () => {
    const id = await neuesFeld()
    const kasten = await screen.findByTestId('freitextfeld-' + id)
    fireEvent.keyDown(kasten, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('freitextfeld-' + id)).toBeNull()
    })
    expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
  })

  it('oeffnet den Kasten erneut per Doppelklick auf die Greifflaeche', async () => {
    const id = await neuesFeld()
    fireEvent.keyDown(await screen.findByTestId('freitextfeld-' + id), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('freitextfeld-' + id)).toBeNull()
    })
    fireEvent.doubleClick(screen.getByTestId('greifflaeche-' + id))
    expect(await screen.findByTestId('freitextfeld-' + id)).not.toBeNull()
  })

  it('spiegelt Schriftgroesse und Ausrichtung in den CSS-Eigenschaften des Kastens', async () => {
    const id = await neuesFeld()
    const vorhanden = useAnnotationen.getState().finde(id)
    if (vorhanden === null) throw new Error('Annotation nicht gefunden')
    useAnnotationen.getState().ersetze({
      ...vorhanden,
      schriftGroesse: 20,
      ausrichtung: 'rechts',
      schriftFett: true
    })
    const kasten = await screen.findByTestId('freitextfeld-' + id)
    expect(kasten.style.fontSize).toBe('20px')
    expect(kasten.style.textAlign).toBe('right')
    expect(kasten.style.fontWeight).toBe('700')
  })
})

describe('Bearbeitungsebene — Freihand', () => {
  it('zeichnet erst eine Vorschau und legt beim Loslassen eine Annotation an', async () => {
    useBearbeitung.setState({ werkzeug: 'freihand' })
    const flaeche = await zeichenflaeche()

    fireEvent.pointerDown(flaeche, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(flaeche, { clientX: 40, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(flaeche, { clientX: 90, clientY: 30, pointerId: 1 })

    // Noch keine Annotation: erst beim Loslassen wird eine daraus.
    expect(screen.getByTestId('freihand-vorschau-1')).not.toBeNull()
    expect(useAnnotationen.getState().proSeite[1] ?? []).toHaveLength(0)

    fireEvent.pointerUp(flaeche, { clientX: 90, clientY: 30, pointerId: 1 })
    const angelegte = useAnnotationen.getState().proSeite[1] ?? []
    expect(angelegte).toHaveLength(1)
    expect(angelegte[0]?.typ).toBe('Ink')
    expect(angelegte[0]?.strichstaerke).toBe(2)
    expect(screen.queryByTestId('freihand-vorschau-1')).toBeNull()
  })

  it('verwirft einen Zug aus einem einzigen Punkt', async () => {
    useBearbeitung.setState({ werkzeug: 'freihand' })
    const flaeche = await zeichenflaeche()
    fireEvent.pointerDown(flaeche, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(flaeche, { clientX: 10, clientY: 10, pointerId: 1 })
    expect(useAnnotationen.getState().proSeite[1] ?? []).toHaveLength(0)
  })
})

describe('Bearbeitungsebene — Auswahl', () => {
  const NOTIZ = {
    id: 'n1',
    subtype: 'Text',
    rect: [100, 676, 124, 700],
    titleObj: { str: 'Testautor' }
  }
  const MARKIERUNG = {
    id: 'm1',
    subtype: 'Highlight',
    rect: [70, 752, 340, 782],
    quadPoints: Float32Array.from([70, 782, 340, 782, 70, 752, 340, 752])
  }

  /**
   * Markierungen liegen ueber Text. Haetten sie eine Klickflaeche, waere der
   * Text darunter nicht mehr mit der Maus auszuwaehlen — sie werden ueber die
   * Anmerkungsliste ausgewaehlt.
   */
  it('gibt nur gegenstaendlichen Anmerkungen eine Greifflaeche', async () => {
    setzeDokument([NOTIZ, MARKIERUNG])
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('greifflaeche-n1')
    expect(screen.queryByTestId('greifflaeche-m1')).toBeNull()
  })

  // Eine Klickflaeche haben Markierungen nicht - ausgewaehlt wird per Klick in
  // die Markierung, solange dabei kein Text markiert wird.
  describe('Markierung per Klick auswaehlen', () => {
    const ZWEITE = {
      id: 'm2',
      subtype: 'Underline',
      rect: [70, 752, 340, 782],
      quadPoints: Float32Array.from([70, 782, 340, 782, 70, 752, 340, 752])
    }

    /**
     * Ein Quadrat in der Ecke, weit weg von allen Klicks: es bekommt eine
     * Greifflaeche, sobald die Ebene ihre Seitenmatrix hat - und erst dann
     * haengt auch der Klick-Listener. Ohne zu warten, kam der Klick manchmal
     * zu frueh an (unsicherer Test).
     */
    const PROBE = { id: 'probe', subtype: 'Square', rect: [5, 5, 25, 25] }
    const mitProbe = (annotationen: unknown[]): void => {
      setzeDokument([...annotationen, PROBE])
    }

    /** Ein Mausklick auf die Seite an einer Stelle (jsdom: Client = Seitenkoordinaten). */
    async function klicke(x: number, y: number, zusatz: MouseEventInit = {}): Promise<HTMLElement> {
      // Im Zeichenmodus gibt es keine Greifflaechen; dort steht die Zeichenflaeche bereit.
      await screen.findByTestId(
        useBearbeitung.getState().werkzeug === 'auswahl' ? 'greifflaeche-probe' : 'zeichenflaeche-1'
      )
      const ebene = await screen.findByTestId('bearbeitungsebene-1')
      fireEvent.click(ebene, { clientX: x, clientY: y, button: 0, detail: 1, ...zusatz })
      return ebene
    }

    it('waehlt die Markierung aus und oeffnet die Werkzeugleiste', async () => {
      mitProbe([MARKIERUNG])
      render(<Bearbeitungsebene index={0} />)
      // Bildschirm y = 842 - PDF y: die Markierung liegt bei y 60 bis 90.
      await klicke(100, 75)

      expect(useBearbeitung.getState().ausgewaehlt).toBe('m1')
      expect(useBearbeitung.getState().leisteOffen).toBe(true)
      // Ein Rahmen, aber keine Eckanfasser: eine Markierung folgt dem Text.
      const rahmen = await screen.findByTestId('auswahlrahmen-m1')
      expect(rahmen.querySelectorAll('div')).toHaveLength(0)
    })

    it('waehlt die oberste, wenn sich Markierungen ueberlappen', async () => {
      mitProbe([MARKIERUNG, ZWEITE])
      render(<Bearbeitungsebene index={0} />)
      await klicke(100, 75)
      expect(useBearbeitung.getState().ausgewaehlt).toBe('m2')
    })

    it('trifft innen am unteren Rand, aber nicht deutlich darunter', async () => {
      mitProbe([MARKIERUNG])
      render(<Bearbeitungsebene index={0} />)
      await klicke(100, 100)
      expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
      await klicke(100, 88)
      expect(useBearbeitung.getState().ausgewaehlt).toBe('m1')
    })

    it('waehlt nichts aus, wenn der Klick neben der Markierung liegt', async () => {
      useBearbeitung.setState({ leisteOffen: false })
      mitProbe([MARKIERUNG])
      render(<Bearbeitungsebene index={0} />)
      await klicke(500, 400)
      expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
      expect(useBearbeitung.getState().leisteOffen).toBe(false)
    })

    it('waehlt nichts aus, solange Text markiert ist', async () => {
      mitProbe([MARKIERUNG])
      render(<Bearbeitungsebene index={0} />)
      const echt = window.getSelection.bind(window)
      window.getSelection = () => ({ isCollapsed: false }) as Selection
      try {
        await klicke(100, 75)
      } finally {
        window.getSelection = echt
      }
      expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
    })

    it('ignoriert Klicks ohne Zeiger (Tastatur) und andere Maustasten', async () => {
      mitProbe([MARKIERUNG])
      render(<Bearbeitungsebene index={0} />)
      await klicke(100, 75, { detail: 0 })
      await klicke(100, 75, { button: 2 })
      expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
    })

    it('ist im Zeichenmodus aus', async () => {
      mitProbe([MARKIERUNG])
      useBearbeitung.setState({ werkzeug: 'freihand' })
      render(<Bearbeitungsebene index={0} />)
      await klicke(100, 75)
      expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
    })

    it('ueberlaesst Bedienelemente und Anmerkungen ihren eigenen Klicks', async () => {
      mitProbe([MARKIERUNG])
      render(<Bearbeitungsebene index={0} />)
      const ebene = await screen.findByTestId('bearbeitungsebene-1')
      const knopf = document.createElement('button')
      ebene.parentElement?.appendChild(knopf)
      fireEvent.click(knopf, { clientX: 100, clientY: 75, button: 0, detail: 1 })
      expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
    })
  })

  it('gibt im Zeichenmodus gar keine Greifflaeche', async () => {
    setzeDokument([NOTIZ])
    useBearbeitung.setState({ werkzeug: 'freihand' })
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('zeichenflaeche-1')
    expect(screen.queryByTestId('greifflaeche-n1')).toBeNull()
  })

  // Im Zeichenmodus haette der Rahmen keine Aufgabe und laege bloss im Weg.
  it('zeigt den Auswahlrahmen nur im Auswahlwerkzeug', async () => {
    setzeDokument([NOTIZ])
    useBearbeitung.setState({ werkzeug: 'notiz', ausgewaehlt: 'n1' })
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('zeichenflaeche-1')
    expect(screen.queryByTestId('auswahlrahmen-n1')).toBeNull()
  })

  it('waehlt beim Zeigerdruck aus und zeigt den Rahmen mit vier Griffen', async () => {
    setzeDokument([NOTIZ])
    render(<Bearbeitungsebene index={0} />)
    const greif = await screen.findByTestId('greifflaeche-n1')
    fireEvent.pointerDown(greif, { clientX: 110, clientY: 150, pointerId: 1 })

    expect(useBearbeitung.getState().ausgewaehlt).toBe('n1')
    const rahmen = await screen.findByTestId('auswahlrahmen-n1')
    expect(rahmen.querySelectorAll('div')).toHaveLength(4)
  })

  it('verschiebt beim Ziehen und macht daraus genau einen Historienschritt', async () => {
    setzeDokument([NOTIZ])
    render(<Bearbeitungsebene index={0} />)
    const greif = await screen.findByTestId('greifflaeche-n1')

    fireEvent.pointerDown(greif, { clientX: 100, clientY: 142, pointerId: 1 })
    fireEvent.pointerMove(greif, { clientX: 130, clientY: 142, pointerId: 1 })
    fireEvent.pointerMove(greif, { clientX: 160, clientY: 162, pointerId: 1 })
    fireEvent.pointerUp(greif, { clientX: 160, clientY: 162, pointerId: 1 })

    const bewegt = useAnnotationen.getState().finde('n1')
    expect(bewegt?.rect[0]).toBeCloseTo(160, 6)
    // Sechzig Zwischenschritte in der Historie waeren unbrauchbar.
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)

    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().finde('n1')?.rect[0]).toBeCloseTo(100, 6)
  })

  it('aendert ueber einen Griff die Groesse', async () => {
    setzeDokument([NOTIZ])
    useBearbeitung.setState({ ausgewaehlt: 'n1' })
    render(<Bearbeitungsebene index={0} />)
    const griff = await screen.findByTestId('griff-rechtsUnten-n1')

    fireEvent.pointerDown(griff, { clientX: 124, clientY: 166, pointerId: 1 })
    fireEvent.pointerMove(griff, { clientX: 200, clientY: 240, pointerId: 1 })
    fireEvent.pointerUp(griff, { clientX: 200, clientY: 240, pointerId: 1 })

    const veraendert = useAnnotationen.getState().finde('n1')
    expect((veraendert?.rect[2] ?? 0) - (veraendert?.rect[0] ?? 0)).toBeGreaterThan(24)
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
  })
})

describe('Bearbeitungsebene — Markup aus dem Kontextmenue', () => {
  /**
   * Ohne Textauswahl gibt es nichts zu markieren. Der Befehl darf dann nichts
   * anlegen und muss sich trotzdem zuruecksetzen, sonst bliebe er haengen.
   */
  it('setzt den Befehl zurueck, auch wenn nichts ausgewaehlt ist', async () => {
    render(<Bearbeitungsebene index={0} />)
    await screen.findByTestId('bearbeitungsebene-1')
    useBearbeitung.getState().wendeAn('markieren')
    await waitFor(() => {
      expect(useBearbeitung.getState().anwendenAuf).toBeNull()
    })
    expect(useAnnotationen.getState().proSeite[1] ?? []).toHaveLength(0)
  })
})

// S6.9: die Werkzeugleiste ist zu, bis jemand "Bearbeiten" drueckt.
describe('Bearbeiten-Schalter', () => {
  it('oeffnet die Leiste mit jedem Werkzeug ausser der Auswahl', () => {
    useBearbeitung.setState({ leisteOffen: false, werkzeug: 'auswahl' })
    useBearbeitung.getState().setzeWerkzeug('auswahl')
    expect(useBearbeitung.getState().leisteOffen).toBe(false)
    useBearbeitung.getState().setzeWerkzeug('zuschneiden')
    expect(useBearbeitung.getState().leisteOffen).toBe(true)
  })

  it('kehrt beim Schliessen zur Auswahl zurueck', () => {
    useBearbeitung.setState({ leisteOffen: true, werkzeug: 'freihand', ausgewaehlt: 'x' })
    useBearbeitung.getState().schalteLeiste()
    expect(useBearbeitung.getState()).toMatchObject({
      leisteOffen: false,
      werkzeug: 'auswahl',
      ausgewaehlt: null
    })
    useBearbeitung.getState().schalteLeiste()
    expect(useBearbeitung.getState().leisteOffen).toBe(true)
  })
})
