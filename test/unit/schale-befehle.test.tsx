import { render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useAnnotationen } = await import('../../src/renderer/src/annotations-store')
const { erstelleAnnotation } = await import('../../src/renderer/src/annotationsbefehle')
const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
const { useHistorie } = await import('../../src/renderer/src/historie')
const { erzeugeNotiz, setzeKennungszaehlerZurueck } =
  await import('../../src/renderer/src/viewer/erzeugen')
const { useBefehle } = await import('../../src/renderer/src/schale/befehle')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { setzeSperreZurueck } = await import('../../src/renderer/src/schale/speichern')
const { useDokumentwerkzeuge } =
  await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
const { verschluesseltText } = await import('../../src/shared/errors')

/**
 * Die Befehle, die S2.2 hinzufuegt.
 *
 * Geprueft ueber echte Tastendruecke am Fenster: genau den Weg nimmt auch das
 * Anwendungsmenue, denn beides laeuft durch dieselbe Funktion (ADR 0002).
 */
const VORGABEN = { autor: 'Testautor', farbe: '#ffd400', strichstaerke: 2 }

function Huelle(): React.JSX.Element {
  useBefehle({ seite: createRef<HTMLInputElement>(), suche: createRef<HTMLInputElement>() })
  return <div />
}

function taste(key: string, zusatz: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...zusatz }))
}

beforeEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  setzeKennungszaehlerZurueck()
  useHistorie.getState().leere()
  useAnnotationen.getState().vergiss()
  useAnnotationen.setState({ proSeite: { 1: [] } })
  useBearbeitung.setState({ werkzeug: 'auswahl', ausgewaehlt: null, anwendenAuf: null })
})

function mitNotiz(): string {
  const notiz = erzeugeNotiz(1, { x: 100, y: 700 }, VORGABEN)
  erstelleAnnotation(notiz)
  return notiz.id
}

/**
 * Die vier Speicherbefehle aus S2.3a und S3.2 — jeder landet in der
 * Bruecke, ueber die Tasten genauso wie ueber das Menue.
 */
describe('Speicherbefehle', () => {
  const dokumentSpeichern = vi.fn()
  const dokumentGeaendert = vi.fn()
  const formularFdfExportieren = vi.fn()

  beforeEach(() => {
    dokumentSpeichern.mockReset().mockResolvedValue({ art: 'abgebrochen' })
    dokumentGeaendert.mockReset().mockResolvedValue(undefined)
    formularFdfExportieren.mockReset().mockResolvedValue({ art: 'abgebrochen' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        dokumentSpeichern,
        dokumentGeaendert,
        formularFdfExportieren,
        beiEreignis: () => () => {}
      }
    })
    useDokument.setState({
      pfad: 'C:\\dokumente\\bericht.pdf',
      name: 'bericht.pdf',
      verschluesselt: false
    })
    setzeSperreZurueck()
  })

  it('speichert mit Strg+S und unter neuem Namen mit Strg+Umschalt+S', async () => {
    mitNotiz()
    render(<Huelle />)
    taste('s', { ctrlKey: true })
    await vi.waitFor(() => {
      expect(dokumentSpeichern).toHaveBeenCalledTimes(1)
    })
    // 'gleich': das Ziel ist die Quelle. 'neu': null, der Main fragt nach dem Ort.
    expect(dokumentSpeichern.mock.calls[0]?.[0]).toMatchObject({
      ziel: 'C:\\dokumente\\bericht.pdf',
      flachlegen: false
    })

    taste('S', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => {
      expect(dokumentSpeichern).toHaveBeenCalledTimes(2)
    })
    expect(dokumentSpeichern.mock.calls[1]?.[0]).toMatchObject({ ziel: null, flachlegen: false })
  })

  it('legt mit Strg+Umschalt+F flach', async () => {
    render(<Huelle />)
    taste('F', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => {
      expect(dokumentSpeichern).toHaveBeenCalledTimes(1)
    })
    expect(dokumentSpeichern.mock.calls[0]?.[0]).toMatchObject({ flachlegen: true })
  })

  it('exportiert mit Strg+Umschalt+E die Formulardaten', async () => {
    render(<Huelle />)
    taste('E', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => {
      expect(formularFdfExportieren).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Befehle aus S2.2', () => {
  // Der uebliche Ausweg aus einem Modus.
  it('bringt Escape zurueck zum Auswahlwerkzeug', () => {
    useBearbeitung.getState().setzeWerkzeug('freihand')
    render(<Huelle />)
    taste('Escape')
    expect(useBearbeitung.getState().werkzeug).toBe('auswahl')
  })

  it('nimmt mit Strg+Z zurueck und wiederholt mit Strg+Y', () => {
    const id = mitNotiz()
    render(<Huelle />)

    taste('z', { ctrlKey: true })
    expect(useAnnotationen.getState().finde(id)).toBeNull()

    taste('y', { ctrlKey: true })
    expect(useAnnotationen.getState().finde(id)).not.toBeNull()
  })

  it('loescht mit Entf die ausgewaehlte Anmerkung', () => {
    const id = mitNotiz()
    useBearbeitung.getState().waehle(id)
    render(<Huelle />)

    taste('Delete')
    expect(useAnnotationen.getState().finde(id)).toBeNull()
    expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
  })

  it('tut bei Entf ohne Auswahl nichts', () => {
    mitNotiz()
    render(<Huelle />)
    taste('Delete')
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(1)
  })

  /**
   * Die Markup-Befehle setzen nur den Auftrag; ausgefuehrt wird er von der
   * Ebene der jeweiligen Seite — nur die weiss, welchen Teil der Auswahl sie
   * traegt.
   */
  it.each([
    ['h', 'markieren'],
    ['u', 'unterstreichen'],
    ['d', 'durchstreichen']
  ])('traegt mit Strg+Umschalt+%s den Auftrag "%s" ein', (key, erwartet) => {
    render(<Huelle />)
    taste(key, { ctrlKey: true, shiftKey: true })
    expect(useBearbeitung.getState().anwendenAuf).toBe(erwartet)
  })
})

/**
 * Die Dokumentwerkzeuge (S4.2a, S4.2b) oeffnen ihr Feld ueber denselben Weg;
 * ohne geoeffnetes Dokument gibt es statt des Feldes einen Hinweis.
 */
describe('Dokumentwerkzeuge', () => {
  const dokumenteWaehlen = vi.fn()

  beforeEach(async () => {
    const { useDokumentwerkzeuge } =
      await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
    useDokumentwerkzeuge.setState({ offen: null, quellen: [], laeuft: false })
    dokumenteWaehlen.mockReset().mockResolvedValue(null)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { dokumenteWaehlen, beiEreignis: () => () => {} }
    })
    useDokument.setState({ ladeZustand: 'bereit', hinweis: null })
  })

  it('oeffnet mit Strg+Umschalt+P den PNG-Export und mit Strg+Umschalt+T das Teilen', async () => {
    const { useDokumentwerkzeuge } =
      await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
    render(<Huelle />)
    taste('p', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBe('png')
    taste('t', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBe('teilen')
    taste('m', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBe('zusammenfuehren')
    taste('p', { ctrlKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBe('drucken')
  })

  it('verlangt fuer Export und Teilen ein geoeffnetes Dokument', async () => {
    const { useDokumentwerkzeuge } =
      await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
    useDokument.setState({ ladeZustand: 'leer' })
    render(<Huelle />)
    taste('p', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useDokument.getState().hinweis).toMatch(/Exportieren muss ein Dokument/)
    taste('t', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useDokument.getState().hinweis).toMatch(/Teilen muss ein Dokument/)
  })

  // S5.2a: F1 und Strg+, schalten um - ein zweiter Druck schliesst wieder,
  // sonst muesste man zum Zumachen zur Maus greifen. Escape schliesst ein
  // offenes Feld, bevor es das Zeichenwerkzeug zuruecksetzt.
  it.each([
    ['F1', 'kuerzel', {}],
    [',', 'einstellungen', { ctrlKey: true }]
  ] as const)('schaltet mit %s das Feld %s um', async (key, feld, zusatz) => {
    const { useDokumentwerkzeuge } =
      await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')
    render(<Huelle />)
    taste(key, zusatz)
    expect(useDokumentwerkzeuge.getState().offen).toBe(feld)
    taste(key, zusatz)
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()

    taste(key, zusatz)
    useBearbeitung.setState({ werkzeug: 'notiz' })
    taste('Escape')
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useBearbeitung.getState().werkzeug).toBe('notiz')
    taste('Escape')
    expect(useBearbeitung.getState().werkzeug).toBe('auswahl')
  })
})

/**
 * Drucken, Teilen und Zusammenfuehren schreiben das Dokument ueber pdf-lib
 * neu - bei einem passwortgeschuetzten gesperrt wie Speichern, mit dem Grund
 * als Hinweis statt eines Fehlers hinterher.
 */
describe('verschluesselte Dokumente', () => {
  const dokumenteWaehlen = vi.fn()

  beforeEach(() => {
    dokumenteWaehlen.mockReset().mockResolvedValue(null)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { dokumenteWaehlen, beiEreignis: () => () => {} }
    })
    useDokumentwerkzeuge.getState().schliesse()
    useDokument.setState({
      pfad: 'C:\dokumente\geheim.pdf',
      name: 'geheim.pdf',
      seitenzahl: 3,
      ladeZustand: 'bereit',
      verschluesselt: true,
      hinweis: null
    })
  })

  it('oeffnet weder Drucken noch Teilen und nennt den Grund', () => {
    render(<Huelle />)
    taste('p', { ctrlKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useDokument.getState().hinweis).toBe(verschluesseltText())

    useDokument.setState({ hinweis: null })
    taste('T', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(useDokument.getState().hinweis).toBe(verschluesseltText())
  })

  it('nimmt das Dokument nicht in die Zusammenfuehren-Liste', async () => {
    render(<Huelle />)
    taste('M', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => {
      expect(dokumenteWaehlen).toHaveBeenCalledTimes(1)
    })
    expect(useDokumentwerkzeuge.getState().offen).toBe('zusammenfuehren')
    expect(useDokumentwerkzeuge.getState().quellen).toEqual([])
    expect(useDokument.getState().hinweis).toBe(verschluesseltText())
  })

  it('oeffnet beides fuer ein unverschluesseltes Dokument', () => {
    useDokument.setState({ verschluesselt: false })
    render(<Huelle />)
    taste('T', { ctrlKey: true, shiftKey: true })
    expect(useDokumentwerkzeuge.getState().offen).toBe('teilen')
    expect(useDokument.getState().hinweis).toBeNull()
  })
})
