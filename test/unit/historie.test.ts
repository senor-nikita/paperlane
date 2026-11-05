import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../src/shared/annotations'
import { useAnnotationen } from '../../src/renderer/src/annotations-store'
import {
  erstelleAnnotation,
  loescheAnnotation,
  veraendereAnnotation
} from '../../src/renderer/src/annotationsbefehle'
import { istMarkupWerkzeug, useBearbeitung } from '../../src/renderer/src/bearbeitung-store'
import { MAX_SCHRITTE, useHistorie } from '../../src/renderer/src/historie'
import {
  aendere,
  erzeugeMarkup,
  erzeugeNotiz,
  setzeKennungszaehlerZurueck
} from '../../src/renderer/src/viewer/erzeugen'

/**
 * Die gemeinsame Historie und die drei Aenderungen, die durch sie laufen
 * (S2.2, Aufgabe 7).
 *
 * **Eine** Historie, nicht eine je Bereich: Strg+Z ist ein Befehl an die
 * Anwendung, nicht an ein Fenster darin. Zwei konkurrierende Stapel sind
 * Risiko R7 im Plan.
 */
const VORGABEN = { autor: 'Testautor', farbe: '#ffd400', strichstaerke: 2 }

function notiz(seite = 1, x = 100): Annotation {
  return erzeugeNotiz(seite, { x, y: 700 }, VORGABEN)
}

function markierung(seite = 1): Annotation {
  return erzeugeMarkup(
    'Highlight',
    seite,
    [70, 782, 340, 782, 70, 752, 340, 752],
    VORGABEN
  ) as Annotation
}

beforeEach(() => {
  setzeKennungszaehlerZurueck()
  useHistorie.getState().leere()
  useAnnotationen.getState().vergiss()
  useBearbeitung.getState().waehle(null)
  useBearbeitung.getState().setzeWerkzeug('auswahl')
  // Zwei gelesene, aber leere Seiten: sonst weiss der Speicher nicht, dass es
  // die Seiten gibt, und `ersetze` findet nichts zum Ersetzen.
  useAnnotationen.setState({ proSeite: { 1: [], 2: [] } })
})

describe('Historie', () => {
  it('merkt einen Schritt und nimmt ihn zurueck', () => {
    const rueck = vi.fn()
    useHistorie.getState().merke({ beschreibung: 'Test', ruecknehmen: rueck, wiederholen: vi.fn() })
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    useHistorie.getState().rueckgaengig()
    expect(rueck).toHaveBeenCalledTimes(1)
    expect(useHistorie.getState().vergangenheit).toHaveLength(0)
    expect(useHistorie.getState().zukunft).toHaveLength(1)
  })

  it('wiederholt einen zurueckgenommenen Schritt', () => {
    const wieder = vi.fn()
    useHistorie
      .getState()
      .merke({ beschreibung: 'Test', ruecknehmen: vi.fn(), wiederholen: wieder })
    useHistorie.getState().rueckgaengig()
    useHistorie.getState().wiederholen()
    expect(wieder).toHaveBeenCalledTimes(1)
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    expect(useHistorie.getState().zukunft).toHaveLength(0)
  })

  // Der Normalfall jeder Historie: eine neue Aenderung macht die Zukunft
  // ungueltig.
  it('verwirft die Zukunft, sobald etwas Neues geschieht', () => {
    useHistorie.getState().merke({ beschreibung: 'A', ruecknehmen: vi.fn(), wiederholen: vi.fn() })
    useHistorie.getState().rueckgaengig()
    expect(useHistorie.getState().zukunft).toHaveLength(1)
    useHistorie.getState().merke({ beschreibung: 'B', ruecknehmen: vi.fn(), wiederholen: vi.fn() })
    expect(useHistorie.getState().zukunft).toHaveLength(0)
  })

  /**
   * S4.1: eine Mutation ist ein asynchroner Schritt. Solange er laeuft, ist
   * die Historie beschaeftigt und nimmt keinen weiteren Befehl an; erst nach
   * der Erledigung wandert der Schritt zwischen den Stapeln.
   */
  it('wartet auf einen asynchronen Schritt und sperrt derweil', async () => {
    let freigeben: () => void = () => {}
    const ruecknehmen = vi.fn(
      () =>
        new Promise<void>((aufloesen) => {
          freigeben = aufloesen
        })
    )
    const wiederholen = vi.fn(() => Promise.resolve())
    useHistorie.getState().merke({ beschreibung: 'Seite loeschen', ruecknehmen, wiederholen })
    useHistorie.getState().rueckgaengig()
    expect(useHistorie.getState().beschaeftigt).toBe(true)
    // Noch nicht verschoben - und ein zweites Rueckgaengig tut nichts.
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    useHistorie.getState().rueckgaengig()
    expect(ruecknehmen).toHaveBeenCalledTimes(1)
    freigeben()
    await vi.waitFor(() => {
      expect(useHistorie.getState().beschaeftigt).toBe(false)
    })
    expect(useHistorie.getState().vergangenheit).toHaveLength(0)
    expect(useHistorie.getState().zukunft).toHaveLength(1)

    useHistorie.getState().wiederholen()
    await vi.waitFor(() => {
      expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    })
    expect(wiederholen).toHaveBeenCalledTimes(1)
  })

  it('laesst die Stapel stehen, wenn ein asynchroner Schritt scheitert', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {})
    useHistorie.getState().merke({
      beschreibung: 'Seite loeschen',
      ruecknehmen: () => Promise.reject(new Error('Stand weg')),
      wiederholen: () => Promise.resolve()
    })
    useHistorie.getState().rueckgaengig()
    await vi.waitFor(() => {
      expect(useHistorie.getState().beschaeftigt).toBe(false)
    })
    expect(useHistorie.getState().vergangenheit).toHaveLength(1)
    expect(useHistorie.getState().zukunft).toHaveLength(0)
    fehler.mockRestore()
  })

  it('tut nichts, wenn es nichts zurueckzunehmen gibt', () => {
    expect(() => {
      useHistorie.getState().rueckgaengig()
      useHistorie.getState().wiederholen()
    }).not.toThrow()
  })

  // Unbegrenzt hiesse, jede geloeschte Annotation bis zum Programmende im
  // Speicher zu halten.
  it('haelt hoechstens MAX_SCHRITTE Schritte', () => {
    for (let i = 0; i < MAX_SCHRITTE + 20; i++) {
      useHistorie
        .getState()
        .merke({ beschreibung: String(i), ruecknehmen: vi.fn(), wiederholen: vi.fn() })
    }
    expect(useHistorie.getState().vergangenheit).toHaveLength(MAX_SCHRITTE)
    // Der aelteste faellt heraus, der juengste bleibt.
    expect(useHistorie.getState().vergangenheit[MAX_SCHRITTE - 1]?.beschreibung).toBe(
      String(MAX_SCHRITTE + 19)
    )
  })
})

describe('erstelleAnnotation', () => {
  it('legt sie ab und traegt einen benannten Schritt ein', () => {
    erstelleAnnotation(notiz())
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(1)
    expect(useHistorie.getState().vergangenheit[0]?.beschreibung).toBe('Notiz erstellt')
  })

  it('nimmt das Erstellen zurueck und stellt es wieder her', () => {
    erstelleAnnotation(notiz())
    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(0)
    useHistorie.getState().wiederholen()
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(1)
  })

  // Der Rahmen staende sonst um etwas, das es nicht mehr gibt.
  it('hebt die Auswahl auf, wenn die zurueckgenommene Annotation gewaehlt war', () => {
    const neu = notiz()
    erstelleAnnotation(neu)
    useBearbeitung.getState().waehle(neu.id)
    useHistorie.getState().rueckgaengig()
    expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
  })
})

describe('veraendereAnnotation', () => {
  it('ersetzt sie und laesst sich zurueckdrehen', () => {
    const neu = notiz()
    erstelleAnnotation(neu)
    veraendereAnnotation(neu, aendere(neu, { inhalt: 'Rueckfrage' }))
    expect(useAnnotationen.getState().finde(neu.id)?.inhalt).toBe('Rueckfrage')

    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().finde(neu.id)?.inhalt).toBe('')
    useHistorie.getState().wiederholen()
    expect(useAnnotationen.getState().finde(neu.id)?.inhalt).toBe('Rueckfrage')
  })

  it('ersetzt an derselben Stelle, statt anzuhaengen', () => {
    const erste = notiz(1, 100)
    const zweite = notiz(1, 300)
    erstelleAnnotation(erste)
    erstelleAnnotation(zweite)
    veraendereAnnotation(erste, aendere(erste, { inhalt: 'geaendert' }))
    expect(useAnnotationen.getState().proSeite[1]?.map((eintrag) => eintrag.id)).toEqual([
      erste.id,
      zweite.id
    ])
  })
})

describe('loescheAnnotation', () => {
  it('entfernt sie und stellt sie an ihrer Stelle wieder her', () => {
    const erste = notiz(1, 100)
    const zweite = notiz(1, 200)
    const dritte = notiz(1, 300)
    erstelleAnnotation(erste)
    erstelleAnnotation(zweite)
    erstelleAnnotation(dritte)

    loescheAnnotation(zweite)
    expect(useAnnotationen.getState().proSeite[1]?.map((eintrag) => eintrag.id)).toEqual([
      erste.id,
      dritte.id
    ])

    // Die Reihenfolge entscheidet, was beim Ueberlappen oben liegt.
    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().proSeite[1]?.map((eintrag) => eintrag.id)).toEqual([
      erste.id,
      zweite.id,
      dritte.id
    ])
  })

  it('nimmt die Auswahl mit', () => {
    const neu = notiz()
    erstelleAnnotation(neu)
    useBearbeitung.getState().waehle(neu.id)
    loescheAnnotation(neu)
    expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
  })

  it('laesst sich wiederholen', () => {
    const neu = notiz()
    erstelleAnnotation(neu)
    loescheAnnotation(neu)
    useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().finde(neu.id)).not.toBeNull()
    useHistorie.getState().wiederholen()
    expect(useAnnotationen.getState().finde(neu.id)).toBeNull()
  })
})

/**
 * Exit-Kriterium des Schritts: Undo und Redo bleiben ueber mindestens zwanzig
 * Operationen korrekt. Geprueft mit gemischten Aenderungen, weil ein Stapel aus
 * lauter gleichen Schritten die interessanten Fehler nicht zeigt.
 */
describe('Undo und Redo ueber viele Operationen', () => {
  it('faehrt fuenfundzwanzig gemischte Schritte vor und wieder zurueck', () => {
    const angelegte: Annotation[] = []
    for (let i = 0; i < 25; i++) {
      if (i % 3 === 0 && angelegte.length > 0) {
        const ziel = angelegte[angelegte.length - 1] as Annotation
        const aktuell = useAnnotationen.getState().finde(ziel.id)
        if (aktuell !== null) {
          veraendereAnnotation(aktuell, aendere(aktuell, { inhalt: 'Nr ' + String(i) }))
        }
        continue
      }
      const neu = i % 2 === 0 ? notiz(1, i * 10) : markierung(2)
      erstelleAnnotation(neu)
      angelegte.push(neu)
    }

    const nachher = JSON.stringify(useAnnotationen.getState().proSeite)
    expect(useHistorie.getState().vergangenheit).toHaveLength(25)

    // Ganz zurueck: beide Seiten stehen wieder leer.
    for (let i = 0; i < 25; i++) useHistorie.getState().rueckgaengig()
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(0)
    expect(useAnnotationen.getState().proSeite[2]).toHaveLength(0)
    expect(useHistorie.getState().vergangenheit).toHaveLength(0)

    // Und wieder vor: Zustand identisch zum Ausgangspunkt.
    for (let i = 0; i < 25; i++) useHistorie.getState().wiederholen()
    expect(JSON.stringify(useAnnotationen.getState().proSeite)).toBe(nachher)
    expect(useHistorie.getState().zukunft).toHaveLength(0)
  })
})

describe('Bearbeitungszustand', () => {
  it('erkennt die Werkzeuge, die aus einer Textauswahl arbeiten', () => {
    expect(istMarkupWerkzeug('markieren')).toBe(true)
    expect(istMarkupWerkzeug('unterstreichen')).toBe(true)
    expect(istMarkupWerkzeug('durchstreichen')).toBe(true)
    expect(istMarkupWerkzeug('auswahl')).toBe(false)
    expect(istMarkupWerkzeug('freihand')).toBe(false)
  })

  // Der Rahmen um eine Annotation waere sonst der einzige sichtbare Rest eines
  // Modus, den es nicht mehr gibt.
  it('hebt die Auswahl beim Werkzeugwechsel auf', () => {
    useBearbeitung.getState().waehle('irgendwas')
    useBearbeitung.getState().setzeWerkzeug('freihand')
    expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
    expect(useBearbeitung.getState().werkzeug).toBe('freihand')
  })

  it('merkt sich ein sofort anzuwendendes Markup und vergisst es wieder', () => {
    useBearbeitung.getState().wendeAn('unterstreichen')
    expect(useBearbeitung.getState().anwendenAuf).toBe('unterstreichen')
    useBearbeitung.getState().angewendet()
    expect(useBearbeitung.getState().anwendenAuf).toBeNull()
  })
})
