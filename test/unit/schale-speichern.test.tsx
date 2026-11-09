import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../src/shared/annotations'
import type { FdfAuftrag, SpeicherAuftrag, SpeicherErgebnis } from '../../src/shared/ipc'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useAnnotationen } = await import('../../src/renderer/src/annotations-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useFormular } = await import('../../src/renderer/src/formular-store')
const { exportiereFdf, speichere, setzeSperreZurueck, useAenderungen, useMeldeAenderungen } =
  await import('../../src/renderer/src/schale/speichern')

/**
 * Die Renderer-Seite des Speicherns (S2.3a).
 *
 * Geprueft wird, was hier tatsaechlich entschieden wird: welcher Auftrag
 * entsteht, was mit den drei Antworten des Main-Prozesses geschieht und ob der
 * Aenderungsstand danach stimmt. Die Pfadpruefung, die Signaturwarnung und das
 * atomare Schreiben liegen im Main und haben ihre eigenen Tests.
 */
const QUELLE = 'C:\\dokumente\\bericht.pdf'

function annotation(teile: Partial<Annotation> & Pick<Annotation, 'id' | 'seite'>): Annotation {
  return {
    typ: 'Highlight',
    subtyp: 'Highlight',
    rect: [10, 20, 30, 40],
    quadPoints: null,
    striche: null,
    farbe: { r: 255, g: 212, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: '',
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: { pdfjs: 'Datensatz' },
    ...teile
  }
}

const dokumentSpeichern = vi.fn<(auftrag: SpeicherAuftrag) => Promise<SpeicherErgebnis>>()
const dokumentGeaendert = vi.fn<(meldung: { pfad: string; geaendert: boolean }) => Promise<void>>()
const formularFdfExportieren = vi.fn<(auftrag: FdfAuftrag) => Promise<SpeicherErgebnis>>()

function setzeApi(vorhanden = true): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: vorhanden ? { dokumentSpeichern, dokumentGeaendert, formularFdfExportieren } : undefined
  })
}

/** Ein Formular mit einem geaenderten und einem unveraenderten Feld. */
function mitFormularaenderung(): void {
  useFormular.setState({
    werte: { 'person.name': 'Max Muster', land: 'Schweiz' },
    ursprung: { 'person.name': '', land: 'Schweiz' }
  })
}

/** Ein geoeffnetes Dokument mit einer gelesenen Seite und einer Aenderung. */
function mitEinerAenderung(): void {
  useAnnotationen.setState({
    urspruenglich: { 1: [annotation({ id: '10R', seite: 1 })] },
    proSeite: {
      1: [annotation({ id: '10R', seite: 1 }), annotation({ id: 'neu-1', seite: 1 })]
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setzeSperreZurueck()
  setzeApi()
  dokumentGeaendert.mockResolvedValue(undefined)
  useAnnotationen.getState().vergiss()
  useFormular.getState().vergiss()
  useDokument.setState({ pfad: QUELLE, name: 'bericht.pdf', verschluesselt: false, hinweis: null })
})

/**
 * S3.2: Formularwerte reisen mit — aber nur die geaenderten — und gelten nach
 * dem Speichern als gesichert. Das Flachlegen laedt die Datei neu, weil der
 * Store danach Felder haelt, die es nicht mehr gibt.
 */
describe('speichere mit Formular (S3.2)', () => {
  it('schickt nur die geaenderten Felder mit und markiert sie danach als gesichert', async () => {
    mitFormularaenderung()
    dokumentSpeichern.mockResolvedValue({ art: 'gespeichert', pfad: QUELLE, name: 'bericht.pdf' })

    await speichere('gleich')

    const auftrag = dokumentSpeichern.mock.calls[0]?.[0]
    expect(auftrag?.formularwerte).toEqual({ 'person.name': 'Max Muster' })
    expect(auftrag?.flachlegen).toBe(false)
    expect(useFormular.getState().ursprung['person.name']).toBe('Max Muster')
    expect(useDokument.getState().hinweis).toMatch(/Gespeichert/)
  })

  it('legt flach, meldet es und laedt die Datei neu', async () => {
    // Neu geladen wird im selben Tab (S6.1), nicht in einem neuen.
    const ladePfadNeu = vi.fn<(pfad: string) => Promise<void>>().mockResolvedValue(undefined)
    useDokument.setState({ ladePfadNeu })
    dokumentSpeichern.mockResolvedValue({ art: 'gespeichert', pfad: QUELLE, name: 'bericht.pdf' })

    // Flachlegen ohne offene Aenderungen ist erlaubt: es ist selbst die Aenderung.
    await speichere('gleich', { flachlegen: true })

    expect(dokumentSpeichern.mock.calls[0]?.[0]?.flachlegen).toBe(true)
    expect(useDokument.getState().hinweis).toMatch(/Festgeschrieben/)
    expect(ladePfadNeu).toHaveBeenCalledWith(QUELLE)
  })
})

/** S3.2, Aufgabe 3: der FDF-Export ueber die Bruecke und seine drei Antworten. */
describe('exportiereFdf', () => {
  it('schickt Quelle und geaenderte Werte und meldet den Erfolg', async () => {
    mitFormularaenderung()
    formularFdfExportieren.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\dokumente\\bericht.fdf',
      name: 'bericht.fdf'
    })
    await exportiereFdf()
    expect(formularFdfExportieren).toHaveBeenCalledWith({
      quelle: QUELLE,
      formularwerte: { 'person.name': 'Max Muster' }
    })
    expect(useDokument.getState().hinweis).toBe('Formulardaten exportiert: bericht.fdf')
  })

  it('meldet eine Ablehnung mit ihrem Grund', async () => {
    formularFdfExportieren.mockResolvedValue({ art: 'abgelehnt', grund: 'Kein Formular.' })
    await exportiereFdf()
    expect(useDokument.getState().hinweis).toBe('Kein Formular.')
  })

  it('sagt nach einem Abbruch nichts', async () => {
    formularFdfExportieren.mockResolvedValue({ art: 'abgebrochen' })
    await exportiereFdf()
    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('faengt einen Fehlschlag der Bruecke ab', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {})
    formularFdfExportieren.mockRejectedValue(new Error('kaputt'))
    await exportiereFdf()
    expect(useDokument.getState().hinweis).toMatch(/nicht exportieren/)
    fehler.mockRestore()
  })

  it('tut ohne Dokument oder ohne Bruecke nichts Schaedliches', async () => {
    useDokument.setState({ pfad: null })
    await exportiereFdf()
    expect(useDokument.getState().hinweis).toMatch(/kein Dokument/)
    expect(formularFdfExportieren).not.toHaveBeenCalled()

    setzeApi(false)
    useDokument.setState({ pfad: QUELLE, hinweis: null })
    await exportiereFdf()
    expect(useDokument.getState().hinweis).toBeNull()
  })
})

describe('speichere', () => {
  it('schickt den abgeleiteten Aenderungssatz an den Main-Prozess', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({
      art: 'gespeichert',
      pfad: QUELLE,
      name: 'bericht.pdf'
    })

    await speichere('gleich')

    expect(dokumentSpeichern).toHaveBeenCalledTimes(1)
    const auftrag = dokumentSpeichern.mock.calls[0]?.[0]
    expect(auftrag?.quelle).toBe(QUELLE)
    expect(auftrag?.ziel).toBe(QUELLE)
    expect(auftrag?.aenderungen.neue.map((eintrag) => eintrag.id)).toEqual(['neu-1'])
  })

  /**
   * `roh` ist pdf.js' Lesart des Dictionaries und gehoert dem Renderer. Ueber
   * IPC waere es Ballast — und ein `Float32Array` im strukturierten Klon eine
   * unnoetige Fehlerquelle.
   */
  it('schickt die Rohdaten von pdf.js nicht mit', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({ art: 'gespeichert', pfad: QUELLE, name: 'bericht.pdf' })

    await speichere('gleich')

    expect(dokumentSpeichern.mock.calls[0]?.[0].aenderungen.neue[0]?.roh).toBeNull()
    // Im Store bleibt der Datensatz stehen.
    expect(useAnnotationen.getState().proSeite[1]?.[1]?.roh).toEqual({ pdfjs: 'Datensatz' })
  })

  it('laesst den Main nach dem Ort fragen, wenn unter neuem Namen gespeichert wird', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\anderswo\\kopie.pdf',
      name: 'kopie.pdf'
    })

    await speichere('neu')

    expect(dokumentSpeichern.mock.calls[0]?.[0].ziel).toBeNull()
    // Das Dokument lebt unter dem neuen Namen weiter.
    expect(useDokument.getState().pfad).toBe('C:\\anderswo\\kopie.pdf')
    expect(useDokument.getState().name).toBe('kopie.pdf')
  })

  it('gilt danach als gesichert', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({ art: 'gespeichert', pfad: QUELLE, name: 'bericht.pdf' })

    await speichere('gleich')

    const { proSeite, urspruenglich } = useAnnotationen.getState()
    expect(urspruenglich[1]).toEqual(proSeite[1])
  })

  it('schreibt ohne Aenderungen nicht in die Datei zurueck', async () => {
    useAnnotationen.setState({
      urspruenglich: { 1: [annotation({ id: '10R', seite: 1 })] },
      proSeite: { 1: [annotation({ id: '10R', seite: 1 })] }
    })

    await speichere('gleich')

    expect(dokumentSpeichern).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toMatch(/nichts zu speichern/)
  })

  // Eine Kopie an einen anderen Ort ist auch ohne Aenderungen ein sinnvoller
  // Wunsch.
  it('erlaubt "Speichern unter" ohne Aenderungen', async () => {
    useAnnotationen.setState({ urspruenglich: { 1: [] }, proSeite: { 1: [] } })
    dokumentSpeichern.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\anderswo\\kopie.pdf',
      name: 'kopie.pdf'
    })

    await speichere('neu')

    expect(dokumentSpeichern).toHaveBeenCalledTimes(1)
  })

  it('meldet eine Ablehnung mit ihrem Grund', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({ art: 'abgelehnt', grund: 'Keine Freigabe.' })

    await speichere('gleich')

    expect(useDokument.getState().hinweis).toBe('Keine Freigabe.')
    // Nichts gilt als gesichert, was nicht geschrieben wurde.
    expect(useAnnotationen.getState().urspruenglich[1]).toHaveLength(1)
  })

  // Wer selbst abbricht, braucht keine Erklaerung.
  it('sagt nach einem Abbruch nichts', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({ art: 'abgebrochen' })

    await speichere('neu')

    expect(useDokument.getState().hinweis).toBeNull()
  })

  it('faengt einen Fehlschlag der Bruecke ab', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockRejectedValue(new Error('IPC kaputt'))
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await speichere('gleich')

    expect(useDokument.getState().hinweis).toMatch(/nicht speichern/)
    expect(konsole).toHaveBeenCalled()
    konsole.mockRestore()
  })

  it('tut ohne geoeffnetes Dokument nichts', async () => {
    useDokument.setState({ pfad: null })
    await speichere('gleich')
    expect(dokumentSpeichern).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toMatch(/kein Dokument/)
  })

  it('tut ohne Bruecke nichts', async () => {
    setzeApi(false)
    mitEinerAenderung()
    await speichere('gleich')
    expect(dokumentSpeichern).not.toHaveBeenCalled()
  })

  /** Zwei Laeufe zugleich schrieben uebereinander. */
  it('laesst keinen zweiten Lauf zu, solange einer offen ist', async () => {
    mitEinerAenderung()
    let loese: (ergebnis: SpeicherErgebnis) => void = () => undefined
    dokumentSpeichern.mockReturnValue(
      new Promise<SpeicherErgebnis>((auf) => {
        loese = auf
      })
    )

    const erster = speichere('gleich')
    await speichere('gleich')
    expect(dokumentSpeichern).toHaveBeenCalledTimes(1)

    loese({ art: 'gespeichert', pfad: QUELLE, name: 'bericht.pdf' })
    await erster
  })
})

/** Der Aenderungsstand, den die Kopfleiste anzeigt und der Main braucht. */
function Anzeige(): React.JSX.Element {
  const aenderungen = useAenderungen()
  useMeldeAenderungen()
  return (
    <span data-testid="stand">
      {aenderungen.neue.length}/{aenderungen.geaendert.length}/{aenderungen.geloescht.length}
    </span>
  )
}

describe('useAenderungen und useMeldeAenderungen', () => {
  it('zaehlt die offenen Aenderungen', () => {
    mitEinerAenderung()
    render(<Anzeige />)
    expect(screen.getByTestId('stand').textContent).toBe('1/0/0')
  })

  it('meldet dem Main-Prozess, dass etwas offen ist', () => {
    mitEinerAenderung()
    render(<Anzeige />)
    expect(dokumentGeaendert).toHaveBeenCalledWith(expect.objectContaining({ geaendert: true }))
  })

  it('meldet einen sauberen Stand als sauber', () => {
    useAnnotationen.setState({ urspruenglich: { 1: [] }, proSeite: { 1: [] } })
    render(<Anzeige />)
    expect(dokumentGeaendert).toHaveBeenCalledWith(expect.objectContaining({ geaendert: false }))
  })

  it('kommt ohne Bruecke aus', () => {
    setzeApi(false)
    mitEinerAenderung()
    expect(() => render(<Anzeige />)).not.toThrow()
  })

  // S6.1: der Main haelt den Stand je Pfad. Ein leerer Pfad hiesse "alle
  // zuruecksetzen" und wuerde die Aenderungen anderer Tabs verschweigen.
  it('meldet je Pfad und ohne Pfad gar nicht', () => {
    useDokument.setState({ pfad: null })
    mitEinerAenderung()
    const { rerender } = render(<Anzeige />)
    expect(dokumentGeaendert).not.toHaveBeenCalled()

    act(() => {
      useDokument.setState({ pfad: 'C:/b.pdf' })
    })
    rerender(<Anzeige />)
    expect(dokumentGeaendert).toHaveBeenLastCalledWith({ pfad: 'C:/b.pdf', geaendert: true })
  })

  it('setzt nach "Speichern unter" den alten Pfad im Main zurueck', async () => {
    mitEinerAenderung()
    dokumentSpeichern.mockResolvedValue({ art: 'gespeichert', pfad: 'C:/neu.pdf', name: 'neu.pdf' })
    await speichere('neu')
    expect(dokumentGeaendert).toHaveBeenCalledWith({ pfad: QUELLE, geaendert: false })
  })
})
