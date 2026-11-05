import type { PDFDocumentProxy } from 'pdfjs-dist'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { alleAnnotationen, useAnnotationen } from '../../src/renderer/src/annotations-store'
import type { Annotation } from '../../src/shared/annotations'

/**
 * Der Zwischenspeicher der Annotationen (S2.1).
 *
 * pdf.js wird hier nicht gebraucht: der Store spricht nur mit einem Objekt,
 * das `getPage` kann. Dass die echte Bibliothek dieselben Felder liefert,
 * belegt der E2E-Test — die eine Aussage ersetzt die andere nicht.
 */
function markierung(seite: number): Record<string, unknown> {
  return {
    id: 'a' + String(seite),
    subtype: 'Highlight',
    rect: [70, 752, 340, 782],
    contentsObj: { str: 'Anmerkung auf Seite ' + String(seite) }
  }
}

interface Attrappe {
  dokument: PDFDocumentProxy
  aufrufe: () => number[]
}

function fakeDokument(
  proSeite: (seite: number) => unknown[] | Promise<unknown[]> = (seite) => [markierung(seite)]
): Attrappe {
  const aufrufe: number[] = []
  const dokument = {
    getPage: (seite: number) =>
      Promise.resolve({
        getAnnotations: () => {
          aufrufe.push(seite)
          return Promise.resolve(proSeite(seite))
        }
      })
  }
  return { dokument: dokument as unknown as PDFDocumentProxy, aufrufe: () => [...aufrufe] }
}

beforeEach(() => {
  useAnnotationen.getState().vergiss()
})

describe('ladeSeite', () => {
  it('legt die Annotationen einer Seite ab', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 2)
    expect(useAnnotationen.getState().proSeite[2]).toHaveLength(1)
    expect(useAnnotationen.getState().proSeite[2]?.[0]).toMatchObject({ id: 'a2', seite: 2 })
  })

  // Die Ebene und die Liste fragen dieselbe Seite an; zweimal zu lesen hiesse,
  // den Worker doppelt zu beschaeftigen, den die Hauptansicht braucht.
  it('liest eine bereits gelesene Seite nicht erneut', async () => {
    const { dokument, aufrufe } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    expect(aufrufe()).toEqual([1])
  })

  // Eine Seite ohne Anmerkungen und eine Seite, deren Anmerkungen nicht lesbar
  // waren, sehen in der Anzeige gleich aus - im Protokoll nicht.
  it('meldet einen Lesefehler und merkt sich die Seite als leer', async () => {
    const meldung = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { dokument } = fakeDokument(() => Promise.reject(new Error('kaputt')))
    await useAnnotationen.getState().ladeSeite(dokument, 3)
    expect(useAnnotationen.getState().proSeite[3]).toEqual([])
    expect(meldung).toHaveBeenCalled()
    meldung.mockRestore()
  })

  // Sonst zeigte die Liste die Anmerkungen der zuletzt geoeffneten Datei.
  it('raeumt den Speicher, wenn ein anderes Dokument kommt', async () => {
    const erstes = fakeDokument()
    await useAnnotationen.getState().ladeSeite(erstes.dokument, 1)
    const zweites = fakeDokument()
    await useAnnotationen.getState().ladeSeite(zweites.dokument, 2)
    expect(useAnnotationen.getState().proSeite[1]).toBeUndefined()
    expect(useAnnotationen.getState().proSeite[2]).toBeDefined()
  })
})

describe('ladeAlles', () => {
  it('liest jede Seite und meldet sich dann als vollstaendig', async () => {
    const { dokument, aufrufe } = fakeDokument()
    await useAnnotationen.getState().ladeAlles(dokument, 3)
    expect(aufrufe()).toEqual([1, 2, 3])
    expect(useAnnotationen.getState().vollstaendig).toBe(true)
    expect(useAnnotationen.getState().laeuft).toBe(false)
  })

  it('uebernimmt bereits gelesene Seiten, statt sie erneut zu holen', async () => {
    const { dokument, aufrufe } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 2)
    await useAnnotationen.getState().ladeAlles(dokument, 3)
    expect(aufrufe()).toEqual([2, 1, 3])
  })

  it('laeuft kein zweites Mal, wenn schon alles gelesen ist', async () => {
    const { dokument, aufrufe } = fakeDokument()
    await useAnnotationen.getState().ladeAlles(dokument, 2)
    await useAnnotationen.getState().ladeAlles(dokument, 2)
    expect(aufrufe()).toEqual([1, 2])
  })

  it('meldet einen Fehlschlag sichtbar, statt still leer zu bleiben', async () => {
    const meldung = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { dokument } = fakeDokument((seite) =>
      seite === 2 ? Promise.reject(new Error('kaputt')) : [markierung(seite)]
    )
    await useAnnotationen.getState().ladeAlles(dokument, 3)
    expect(useAnnotationen.getState().fehler).not.toBeNull()
    expect(useAnnotationen.getState().vollstaendig).toBe(false)
    expect(useAnnotationen.getState().laeuft).toBe(false)
    expect(meldung).toHaveBeenCalled()
    meldung.mockRestore()
  })
})

describe('vergiss', () => {
  it('leert den Speicher', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeAlles(dokument, 2)
    useAnnotationen.getState().vergiss()
    expect(useAnnotationen.getState().proSeite).toEqual({})
    expect(useAnnotationen.getState().vollstaendig).toBe(false)
  })
})

/** Eine Annotation ohne Umweg ueber pdf.js — fuer die Faelle ohne Lesevorgang. */
function gemacht(id: string, seite: number): Annotation {
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
    inhalt: '',
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: null
  }
}

/**
 * Der Schnappschuss, aus dem S2.3a den Aenderungssatz ableitet.
 *
 * Die Aussage in einem Satz: was gelesen wurde, hat einen Ursprung — und nur
 * was einen Ursprung hat, wird beim Speichern angefasst.
 */
describe('urspruenglich', () => {
  it('haelt beim Lesen denselben Stand wie der Zwischenspeicher', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 2)
    const { proSeite, urspruenglich } = useAnnotationen.getState()
    expect(urspruenglich[2]).toEqual(proSeite[2])
  })

  it('fuellt sich auch beim Lesen des ganzen Dokuments', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeAlles(dokument, 3)
    expect(Object.keys(useAnnotationen.getState().urspruenglich)).toEqual(['1', '2', '3'])
  })

  /**
   * Eine Seite, deren Anmerkungen sich nicht lesen liessen, bekommt **keinen**
   * Ursprung. Sonst ginge ein leerer Zwischenspeicher beim Speichern als "im
   * Dokument stand hier nichts" durch und loeschte, was dort steht.
   */
  it('bekommt nach einem Lesefehler keinen Eintrag', async () => {
    const meldung = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { dokument } = fakeDokument(() => Promise.reject(new Error('kaputt')))
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    expect(useAnnotationen.getState().proSeite[1]).toEqual([])
    expect(useAnnotationen.getState().urspruenglich[1]).toBeUndefined()
    meldung.mockRestore()
  })

  it('bleibt beim Einfuegen auf einer gelesenen Seite stehen', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    const vorher = useAnnotationen.getState().urspruenglich[1]
    useAnnotationen.getState().fuegeEin(gemacht('neu-1', 1))
    expect(useAnnotationen.getState().urspruenglich[1]).toBe(vorher)
    expect(useAnnotationen.getState().proSeite[1]).toHaveLength(2)
  })

  /**
   * Wer zeichnet, bevor die Seite fertig gelesen ist, darf seine Anmerkung
   * nicht verlieren: ohne Ursprung faende `sammleAenderungen` die Seite nicht.
   */
  it('legt beim Einfuegen auf einer ungelesenen Seite einen leeren Ursprung an', () => {
    useAnnotationen.getState().fuegeEin(gemacht('neu-1', 5))
    expect(useAnnotationen.getState().urspruenglich[5]).toEqual([])
    expect(useAnnotationen.getState().proSeite[5]).toHaveLength(1)
  })

  it('vergisst beide Ablagen beim Dokumentwechsel', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    useAnnotationen.getState().vergiss()
    expect(useAnnotationen.getState().urspruenglich).toEqual({})
  })
})

describe('merkeGespeichert', () => {
  it('macht den aktuellen Stand zum neuen Ursprung', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    useAnnotationen.getState().fuegeEin(gemacht('neu-1', 1))

    useAnnotationen.getState().merkeGespeichert()

    const { proSeite, urspruenglich } = useAnnotationen.getState()
    expect(urspruenglich[1]).toEqual(proSeite[1])
  })

  // Was nie gelesen wurde, war am Speichern nicht beteiligt.
  it('nimmt keine ungelesene Seite in den Ursprung auf', async () => {
    const { dokument } = fakeDokument()
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    useAnnotationen.setState({ proSeite: { ...useAnnotationen.getState().proSeite, 9: [] } })

    useAnnotationen.getState().merkeGespeichert()

    expect(useAnnotationen.getState().urspruenglich[9]).toBeUndefined()
  })
})

describe('alleAnnotationen', () => {
  it('gibt die Annotationen in Seitenreihenfolge zurueck', async () => {
    const { dokument } = fakeDokument()
    // Absichtlich in verkehrter Reihenfolge gelesen.
    await useAnnotationen.getState().ladeSeite(dokument, 3)
    await useAnnotationen.getState().ladeSeite(dokument, 1)
    expect(
      alleAnnotationen(useAnnotationen.getState().proSeite).map((eintrag) => eintrag.seite)
    ).toEqual([1, 3])
  })

  it('liefert fuer nichts eine leere Liste', () => {
    expect(alleAnnotationen({})).toEqual([])
  })
})
