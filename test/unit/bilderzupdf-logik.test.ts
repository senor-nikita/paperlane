import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BilderWahlErgebnis, BildPdfErgebnis, Bildquelle } from '../../src/shared/ipc'

/**
 * "Aus Bildern erstellen" im Renderer (S6.4): Store-Verhalten, Normalisierung
 * (EXIF/Canvas ueber gestellte Attrappen von `createImageBitmap`/Canvas - ein
 * echter Bitmap-Dekoder gehoert in die E2E-Strecke, hier zaehlt, was diese
 * Anwendung daraus macht) und was zum Main geht.
 */

const oeffneUeberPfad = vi.fn<(pfad: string) => Promise<string | null>>()
vi.mock('../../src/renderer/src/tabs-store', () => ({
  useTabs: { getState: () => ({ oeffneUeberPfad }) }
}))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const {
  useBilderZuPdf,
  bytesVonDataUrl,
  normalisiereBild,
  vorschlagsname,
  sindNurBilder,
  bilderHinzufuegen,
  beginneBilderZuPdf,
  erzeugeBilderPdf
} = await import('../../src/renderer/src/schale/bilderzupdf-logik')

const bilderWaehlen = vi.fn<(pfade: string[] | null) => Promise<BilderWahlErgebnis>>()
const bilderZuPdf = vi.fn<(a: unknown) => Promise<BildPdfErgebnis>>()

function quelle(name: string, format: Bildquelle['format'] = 'png'): Bildquelle {
  return { name, format, bytes: new Uint8Array([1, 2, 3]) }
}

beforeEach(() => {
  bilderWaehlen.mockReset()
  bilderZuPdf.mockReset()
  oeffneUeberPfad.mockReset().mockResolvedValue(null)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { bilderWaehlen, bilderZuPdf }
  })
  useBilderZuPdf.setState({
    offen: false,
    eintraege: [],
    seitengroesse: 'bild',
    ausrichtung: 'auto',
    randMm: 10,
    laeuft: false
  })
  useDokument.setState({ hinweis: null })

  // Attrappen fuer EXIF/Canvas - ein echtes Bitmap braucht einen Browser.
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width: 12, height: 8, close: vi.fn() }))
  )
  vi.stubGlobal(
    'atob',
    vi.fn((b64: string) => Buffer.from(b64, 'base64').toString('binary'))
  )
  const zeichenkontext = vi.fn((): unknown => ({ drawImage: vi.fn() }))
  HTMLCanvasElement.prototype.getContext =
    zeichenkontext as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,AAEC')
})

describe('bytesVonDataUrl', () => {
  it('zerlegt eine data-URL in Bytes', () => {
    expect(bytesVonDataUrl('data:image/png;base64,AAEC')).toEqual(new Uint8Array([0, 1, 2]))
  })
  it('lehnt eine Nicht-data-URL ab', () => {
    expect(() => bytesVonDataUrl('nicht-data-url')).toThrow()
  })
})

describe('vorschlagsname', () => {
  it('nimmt den Namen des ersten Bilds ohne Endung', () => {
    expect(vorschlagsname([{ id: 1, name: 'urlaub.jpg', seite: null, fehler: null }])).toBe(
      'urlaub'
    )
  })
  it('haengt "und-weitere" an, wenn mehrere Bilder dabei sind', () => {
    expect(
      vorschlagsname([
        { id: 1, name: 'a.png', seite: null, fehler: null },
        { id: 2, name: 'b.png', seite: null, fehler: null }
      ])
    ).toBe('a-und-weitere')
  })
  it('faellt auf "bilder" zurueck, wenn nichts da ist', () => {
    expect(vorschlagsname([])).toBe('bilder')
  })
})

describe('sindNurBilder', () => {
  it('erkennt eine reine Bildliste', () => {
    expect(sindNurBilder(['a.png', 'b.JPG', 'c.webp', 'd.gif', 'e.bmp'])).toBe(true)
  })
  it('lehnt eine gemischte oder leere Liste ab', () => {
    expect(sindNurBilder(['a.png', 'b.pdf'])).toBe(false)
    expect(sindNurBilder([])).toBe(false)
    expect(sindNurBilder(['ohne-endung'])).toBe(false)
  })
})

describe('normalisiereBild', () => {
  it('wendet EXIF/Canvas an und liefert PNG fuer ein Nicht-JPEG', async () => {
    const seite = await normalisiereBild(quelle('a.png', 'png'))
    expect(seite).toEqual({
      format: 'png',
      bytes: new Uint8Array([0, 1, 2]),
      breitePx: 12,
      hoehePx: 8
    })
  })
  it('behaelt JPEG als Zielformat', async () => {
    const seite = await normalisiereBild(quelle('a.jpg', 'jpeg'))
    expect(seite.format).toBe('jpeg')
  })
})

describe('bilderHinzufuegen', () => {
  it('bricht ab, wenn der Dialog abgebrochen wurde', async () => {
    bilderWaehlen.mockResolvedValue({ art: 'abgebrochen' })
    await bilderHinzufuegen(null)
    expect(useBilderZuPdf.getState().eintraege).toEqual([])
  })

  it('meldet eine Ablehnung als Hinweis', async () => {
    bilderWaehlen.mockResolvedValue({ art: 'abgelehnt', grund: 'zu gross' })
    await bilderHinzufuegen(null)
    expect(useDokument.getState().hinweis).toBe('zu gross')
  })

  it('fuegt gewaehlte Bilder hinzu und normalisiert sie', async () => {
    bilderWaehlen.mockResolvedValue({
      art: 'gewaehlt',
      bilder: [quelle('a.png'), quelle('b.jpg', 'jpeg')],
      abgelehnt: [{ name: 'c.tiff', grund: 'unbekanntes Format' }]
    })
    await bilderHinzufuegen(['a.png', 'b.jpg', 'c.tiff'])
    const { eintraege } = useBilderZuPdf.getState()
    expect(eintraege.map((e) => e.name)).toEqual(['a.png', 'b.jpg'])
    expect(eintraege.every((e) => e.seite !== null)).toBe(true)
    expect(useDokument.getState().hinweis).toContain('c.tiff')
  })

  it('traegt einen Fehler ein, wenn die Normalisierung scheitert', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('kaputt')))
    )
    bilderWaehlen.mockResolvedValue({ art: 'gewaehlt', bilder: [quelle('a.png')], abgelehnt: [] })
    await bilderHinzufuegen(null)
    const eintrag = useBilderZuPdf.getState().eintraege[0]
    expect(eintrag?.fehler).toContain('a.png')
    expect(eintrag?.seite).toBeNull()
  })

  it('tut nichts ohne Bruecke', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: undefined })
    await bilderHinzufuegen(null)
    expect(bilderWaehlen).not.toHaveBeenCalled()
  })
})

describe('beginneBilderZuPdf', () => {
  it('oeffnet das Feld und startet die Auswahl', async () => {
    bilderWaehlen.mockResolvedValue({ art: 'abgebrochen' })
    await beginneBilderZuPdf()
    expect(useBilderZuPdf.getState().offen).toBe(true)
    expect(bilderWaehlen).toHaveBeenCalledWith(null)
  })
})

describe('erzeugeBilderPdf', () => {
  function bereiterEintrag(name: string) {
    return {
      id: 1,
      name,
      seite: { format: 'png' as const, bytes: new Uint8Array([1]), breitePx: 2, hoehePx: 2 },
      fehler: null
    }
  }

  it('meldet einen Hinweis ohne normalisierte Bilder', async () => {
    useBilderZuPdf.setState({ eintraege: [{ id: 1, name: 'a.png', seite: null, fehler: null }] })
    await erzeugeBilderPdf()
    expect(bilderZuPdf).not.toHaveBeenCalled()
    expect(useDokument.getState().hinweis).toMatch(/normalisiert/)
  })

  it('baut den Auftrag, oeffnet das Ergebnis und schliesst das Feld', async () => {
    useBilderZuPdf.setState({ eintraege: [bereiterEintrag('a.png')] })
    bilderZuPdf.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\a.pdf',
      name: 'a.pdf',
      seiten: 1
    })
    await erzeugeBilderPdf()
    expect(bilderZuPdf).toHaveBeenCalledWith(
      expect.objectContaining({ seitengroesse: 'bild', ausrichtung: 'auto', randMm: 10 })
    )
    expect(oeffneUeberPfad).toHaveBeenCalledWith('C:\\a.pdf')
    expect(useBilderZuPdf.getState().offen).toBe(false)
    expect(useDokument.getState().hinweis).toContain('a.pdf')
  })

  it('meldet eine Ablehnung des Main', async () => {
    useBilderZuPdf.setState({ eintraege: [bereiterEintrag('a.png')] })
    bilderZuPdf.mockResolvedValue({ art: 'abgelehnt', grund: 'kaputt' })
    await erzeugeBilderPdf()
    expect(useDokument.getState().hinweis).toBe('kaputt')
  })

  it('laesst das Feld bei Abbruch offen', async () => {
    useBilderZuPdf.setState({ eintraege: [bereiterEintrag('a.png')], offen: true })
    bilderZuPdf.mockResolvedValue({ art: 'abgebrochen' })
    await erzeugeBilderPdf()
    expect(useBilderZuPdf.getState().offen).toBe(true)
  })
})

describe('useBilderZuPdf Store', () => {
  it('liefert Ids in Eingabereihenfolge, `null` fuer bereits vorhandene Namen (Review H1)', () => {
    const store = useBilderZuPdf.getState()
    const erste = store.fuegeHinzu([quelle('a.png')])
    expect(erste).toEqual([expect.any(Number)])
    const zweite = store.fuegeHinzu([quelle('a.png'), quelle('b.png'), quelle('c.png')])
    // a.png steht schon in der Liste -> null an Index 0, echte Ids an 1 und 2.
    expect(zweite[0]).toBeNull()
    expect(typeof zweite[1]).toBe('number')
    expect(typeof zweite[2]).toBe('number')
    const eintraege = useBilderZuPdf.getState().eintraege
    expect(eintraege.find((e) => e.name === 'b.png')?.id).toBe(zweite[1])
    expect(eintraege.find((e) => e.name === 'c.png')?.id).toBe(zweite[2])
  })

  it('ordnet bei ueberlappender Liste jedes normalisierte Bild seinem eigenen Eintrag zu (Review H1)', async () => {
    // a.png ist schon in der Liste; b.png und c.png sind neu. Vor dem Fix
    // wurden die IDs der gefilterten Liste ueber den Index der ungefilterten
    // Quellliste zugeordnet - b.png bekam dann a.pngs Bild, c.png fiel weg.
    useBilderZuPdf.setState({
      eintraege: [{ id: 1, name: 'a.png', seite: null, fehler: null }]
    })
    let breite = 100
    vi.mocked(createImageBitmap).mockImplementation(() => {
      breite += 1
      return Promise.resolve({ width: breite, height: 8, close: vi.fn() })
    })
    bilderWaehlen.mockResolvedValue({
      art: 'gewaehlt',
      bilder: [quelle('a.png'), quelle('b.png'), quelle('c.png')],
      abgelehnt: []
    })
    await bilderHinzufuegen(['a.png', 'b.png', 'c.png'])
    const { eintraege } = useBilderZuPdf.getState()
    expect(eintraege.map((e) => e.name)).toEqual(['a.png', 'b.png', 'c.png'])
    const alt = eintraege.find((e) => e.name === 'a.png')
    const b = eintraege.find((e) => e.name === 'b.png')
    const c = eintraege.find((e) => e.name === 'c.png')
    // Das alte a.png bleibt unveraendert (nicht neu normalisiert).
    expect(alt?.seite).toBeNull()
    // b.png und c.png tragen je ihr eigenes normalisiertes Bild, keins fehlt.
    expect(b?.seite?.breitePx).toBe(101)
    expect(c?.seite?.breitePx).toBe(102)
  })

  it('fuegt ohne Duplikate hinzu, verschiebt und entfernt', () => {
    const store = useBilderZuPdf.getState()
    store.fuegeHinzu([quelle('a.png'), quelle('b.png')])
    store.fuegeHinzu([quelle('b.png'), quelle('c.png')])
    expect(useBilderZuPdf.getState().eintraege.map((e) => e.name)).toEqual([
      'a.png',
      'b.png',
      'c.png'
    ])
    useBilderZuPdf.getState().verschiebe(0, 1)
    expect(useBilderZuPdf.getState().eintraege.map((e) => e.name)).toEqual([
      'b.png',
      'a.png',
      'c.png'
    ])
    useBilderZuPdf.getState().entferne(1)
    expect(useBilderZuPdf.getState().eintraege.map((e) => e.name)).toEqual(['b.png', 'c.png'])
  })

  it('ignoriert ein Verschieben ueber den Rand hinaus', () => {
    useBilderZuPdf.getState().fuegeHinzu([quelle('a.png')])
    useBilderZuPdf.getState().verschiebe(0, -1)
    expect(useBilderZuPdf.getState().eintraege.map((e) => e.name)).toEqual(['a.png'])
  })

  it('oeffnet und schliesst, schliessen leert die Liste', () => {
    useBilderZuPdf.getState().fuegeHinzu([quelle('a.png')])
    useBilderZuPdf.getState().oeffne()
    expect(useBilderZuPdf.getState().offen).toBe(true)
    useBilderZuPdf.getState().schliesse()
    expect(useBilderZuPdf.getState().offen).toBe(false)
    expect(useBilderZuPdf.getState().eintraege).toEqual([])
  })

  it('setzt Seitengroesse, Ausrichtung, Rand und Laeuft', () => {
    const store = useBilderZuPdf.getState()
    store.setzeSeitengroesse('a4')
    store.setzeAusrichtung('quer')
    store.setzeRandMm(15)
    store.setzeLaeuft(true)
    const s = useBilderZuPdf.getState()
    expect(s.seitengroesse).toBe('a4')
    expect(s.ausrichtung).toBe('quer')
    expect(s.randMm).toBe(15)
    expect(s.laeuft).toBe(true)
  })
})
