import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Dokumentquelle,
  DruckAntwort,
  TeilErgebnis,
  ZusammenfuehrErgebnis
} from '../../src/shared/ipc'
import { alsTasten, beschreibeBefehl, KUERZEL } from '../../src/shared/tastatur'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

// Der Export selbst (Canvas, pdf.js) hat seinen eigenen Test; hier zaehlt,
// was das Feld ihm uebergibt.
const exportierePng = vi.fn<(a: { seiten: number[]; dpi: number }) => Promise<void>>()
vi.mock('../../src/renderer/src/png-export', () => ({
  exportierePng: (a: { seiten: number[]; dpi: number }) => exportierePng(a)
}))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { useFormular } = await import('../../src/renderer/src/formular-store')
const { Dokumentwerkzeuge } = await import('../../src/renderer/src/schale/Dokumentwerkzeuge')
const {
  beginneZusammenfuehren,
  brichDruckAb,
  druckeDokument,
  teileDokument,
  useDokumentwerkzeuge
} = await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')

/**
 * Zusammenfuehren und Teilen im Renderer (S4.2a): die Reihenfolgeliste, die
 * Bereichseingabe mit Live-Pruefung, und was zum Main geht.
 */
const dokumenteWaehlen = vi.fn<() => Promise<Dokumentquelle[] | null>>()
const dokumenteZusammenfuehren =
  vi.fn<(a: { quellen: string[] }) => Promise<ZusammenfuehrErgebnis>>()
const dokumentTeilen = vi.fn<(a: unknown) => Promise<TeilErgebnis>>()
const dokumentOeffnePfad = vi.fn()
const dokumentDrucken = vi.fn<(a: unknown) => Promise<DruckAntwort>>()
const druckAbbrechen = vi.fn<() => Promise<boolean>>()

const Q = (name: string, seiten: number): Dokumentquelle => ({
  pfad: 'C:\\d\\' + name,
  name,
  seiten
})

beforeEach(() => {
  dokumenteWaehlen.mockReset()
  dokumenteZusammenfuehren.mockReset()
  dokumentTeilen.mockReset()
  dokumentOeffnePfad.mockReset().mockResolvedValue({ ok: false, grund: 'Attrappe' })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dokumenteWaehlen,
      dokumenteZusammenfuehren,
      dokumentTeilen,
      dokumentOeffnePfad,
      dokumentDrucken,
      druckAbbrechen
    }
  })
  exportierePng.mockReset().mockResolvedValue(undefined)
  dokumentDrucken.mockReset().mockResolvedValue({ art: 'abgebrochen' })
  druckAbbrechen.mockReset().mockResolvedValue(true)
  useDokumentwerkzeuge.setState({
    offen: null,
    quellen: [],
    laeuft: false,
    fortschritt: null,
    druckphase: null
  })
  useDokument.setState({
    ladeZustand: 'bereit',
    pfad: 'C:\\d\\offen.pdf',
    name: 'offen.pdf',
    seitenzahl: 6,
    hinweis: null
  })
})

describe('Zusammenfuehren', () => {
  it('beginnt mit dem offenen Dokument und haengt die gewaehlten an', async () => {
    dokumenteWaehlen.mockResolvedValue([Q('b.pdf', 3), Q('offen.pdf', 6), Q('c.pdf', 1)])
    await beginneZusammenfuehren()
    const { offen, quellen } = useDokumentwerkzeuge.getState()
    expect(offen).toBe('zusammenfuehren')
    // Das offene Dokument nur einmal, auch wenn es erneut gewaehlt wurde.
    expect(quellen.map((q) => q.name)).toEqual(['offen.pdf', 'b.pdf', 'c.pdf'])
  })

  it('laesst die Reihenfolge aendern und Eintraege entfernen', () => {
    useDokumentwerkzeuge.setState({
      offen: 'zusammenfuehren',
      quellen: [Q('a.pdf', 1), Q('b.pdf', 2), Q('c.pdf', 3)]
    })
    render(<Dokumentwerkzeuge />)
    expect(screen.getByTestId('zusammenfuehren-ausfuehren').textContent).toContain('6 Seiten')
    expect(screen.getByTestId('zusammenfuehren-hoch-1').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('zusammenfuehren-runter-1'))
    expect(useDokumentwerkzeuge.getState().quellen.map((q) => q.name)).toEqual([
      'b.pdf',
      'a.pdf',
      'c.pdf'
    ])
    fireEvent.click(screen.getByTestId('zusammenfuehren-hoch-3'))
    expect(useDokumentwerkzeuge.getState().quellen.map((q) => q.name)).toEqual([
      'b.pdf',
      'c.pdf',
      'a.pdf'
    ])
    fireEvent.click(screen.getByTestId('zusammenfuehren-entfernen-2'))
    expect(useDokumentwerkzeuge.getState().quellen.map((q) => q.name)).toEqual(['b.pdf', 'a.pdf'])
  })

  it('schickt die Pfade in Listenreihenfolge, oeffnet das Ergebnis und nennt Umbenennungen', async () => {
    useDokumentwerkzeuge.setState({
      offen: 'zusammenfuehren',
      quellen: [Q('b.pdf', 2), Q('a.pdf', 1)]
    })
    dokumenteZusammenfuehren.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\d\\zusammen.pdf',
      name: 'zusammen.pdf',
      seiten: 3,
      umbenannt: [{ von: 'person', nach: 'person_2' }]
    })
    render(<Dokumentwerkzeuge />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('zusammenfuehren-ausfuehren'))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    })
    expect(dokumenteZusammenfuehren).toHaveBeenCalledWith({
      quellen: ['C:\\d\\b.pdf', 'C:\\d\\a.pdf']
    })
    expect(dokumentOeffnePfad).toHaveBeenCalledWith('C:\\d\\zusammen.pdf')
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toMatch(/person → person_2/)
    })
  })

  it('sperrt den Knopf unter zwei Dokumenten und zeigt eine Ablehnung', async () => {
    useDokumentwerkzeuge.setState({ offen: 'zusammenfuehren', quellen: [Q('a.pdf', 1)] })
    render(<Dokumentwerkzeuge />)
    expect(screen.getByTestId('zusammenfuehren-ausfuehren').hasAttribute('disabled')).toBe(true)
    act(() => {
      useDokumentwerkzeuge.setState({ quellen: [Q('a.pdf', 1), Q('b.pdf', 1)] })
    })
    dokumenteZusammenfuehren.mockResolvedValue({ art: 'abgelehnt', grund: 'nicht gewaehlt' })
    await act(async () => {
      fireEvent.click(screen.getByTestId('zusammenfuehren-ausfuehren'))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toBe('nicht gewaehlt')
    })
    expect(useDokumentwerkzeuge.getState().offen).toBe('zusammenfuehren')
  })
})

/**
 * S5.2a, Aufgabe 1: die Uebersicht entsteht aus der Kuerzel-Map und nicht aus
 * einer zweiten, abgeschriebenen Liste. Der Test haelt genau das fest - er
 * zaehlt gegen `KUERZEL`, nicht gegen eine erwartete Zeilenzahl.
 */
describe('Kuerzeluebersicht', () => {
  it('zeigt jedes Kuerzel der zentralen Map in Tastenschreibweise', () => {
    useDokumentwerkzeuge.setState({ offen: 'kuerzel' })
    render(<Dokumentwerkzeuge />)

    for (const kuerzel of KUERZEL) {
      const zeile = screen.getByTestId('kuerzel-' + kuerzel.befehl)
      expect(zeile.textContent).toContain(beschreibeBefehl(kuerzel.befehl))
      expect(zeile.textContent).toContain(alsTasten(kuerzel.accelerator))
    }
    // Die Electron-Schreibweise taucht in der Anzeige nicht auf.
    expect(screen.getByTestId('kuerzeluebersicht').textContent).not.toContain('CommandOrControl')

    fireEvent.click(screen.getByTestId('kuerzeluebersicht-schliessen'))
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
  })
})

/**
 * S5.2a, Aufgabe 2: die Felder nehmen den Fokus auf und geben ihn zurueck.
 * Ohne das oeffnete ein Kuerzel ein Feld, von dem ein Tastaturnutzer nichts
 * mitbekam - der Fokus blieb am Ausloeser stehen.
 */
describe('Fokus der Felder', () => {
  it('nimmt den Fokus auf, schliesst mit Escape und gibt ihn zurueck', () => {
    const ausloeser = document.createElement('button')
    document.body.appendChild(ausloeser)
    ausloeser.focus()
    expect(document.activeElement).toBe(ausloeser)

    useDokumentwerkzeuge.setState({ offen: 'teilen' })
    const { rerender } = render(<Dokumentwerkzeuge />)

    const feld = screen.getByTestId('teilen')
    expect(document.activeElement).toBe(feld)

    fireEvent.keyDown(feld, { key: 'Escape' })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()

    rerender(<Dokumentwerkzeuge />)
    expect(document.activeElement).toBe(ausloeser)
    ausloeser.remove()
  })

  it('laesst den Fokus stehen, wenn er das Feld zwischendurch verlassen hat', () => {
    const woanders = document.createElement('button')
    document.body.appendChild(woanders)

    useDokumentwerkzeuge.setState({ offen: 'drucken' })
    const { rerender } = render(<Dokumentwerkzeuge />)
    expect(document.activeElement).toBe(screen.getByTestId('drucken'))

    // Der Nutzer klickt bewusst aus dem Feld heraus.
    woanders.focus()
    useDokumentwerkzeuge.setState({ offen: null })
    rerender(<Dokumentwerkzeuge />)

    expect(document.activeElement).toBe(woanders)
    woanders.remove()
  })
})

describe('Teilen', () => {
  it('prueft die Bereiche live und schickt sie geparst zum Main', async () => {
    useDokumentwerkzeuge.setState({ offen: 'teilen' })
    dokumentTeilen.mockResolvedValue({
      art: 'gespeichert',
      verzeichnis: 'C:\\d\\aus',
      dateien: ['x']
    })
    render(<Dokumentwerkzeuge />)
    expect(screen.getByTestId('teilen-ausfuehren').hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByTestId('teilen-bereiche'))
    const eingabe = screen.getByTestId('teilen-bereiche-eingabe')
    fireEvent.change(eingabe, { target: { value: '1-2, 9' } })
    expect(screen.getByTestId('teilen-bereiche-hinweis').textContent).toMatch(/6 Seiten/)
    expect(screen.getByTestId('teilen-ausfuehren').hasAttribute('disabled')).toBe(true)

    fireEvent.change(eingabe, { target: { value: '1-2, 5' } })
    expect(screen.getByTestId('teilen-bereiche-hinweis').textContent).toBe('2 Dateien: 1-2, 5')
    await act(async () => {
      fireEvent.click(screen.getByTestId('teilen-ausfuehren'))
      await Promise.resolve()
    })
    expect(dokumentTeilen).toHaveBeenCalledWith({
      quelle: 'C:\\d\\offen.pdf',
      bereiche: [
        [1, 2],
        [5, 5]
      ]
    })
    await waitFor(() => {
      expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    })
    expect(useDokument.getState().hinweis).toMatch(/1 Datei geschrieben nach/)
  })

  it('teilt nach Seitenzahl: prueft live und schickt die Bereiche', async () => {
    useDokumentwerkzeuge.setState({ offen: 'teilen' })
    dokumentTeilen.mockResolvedValue({ art: 'abgebrochen' })
    render(<Dokumentwerkzeuge />)

    fireEvent.click(screen.getByTestId('teilen-seitenzahl'))
    const eingabe = screen.getByTestId('teilen-seitenzahl-eingabe')
    expect(screen.getByTestId('teilen-ausfuehren').hasAttribute('disabled')).toBe(true)

    // 6 Seiten: "6" und mehr ergaebe nur eine Datei, "0" ist keine Zahl ab 1.
    fireEvent.change(eingabe, { target: { value: '6' } })
    expect(screen.getByTestId('teilen-seitenzahl-hinweis').textContent).toMatch(/kleiner/)
    expect(screen.getByTestId('teilen-ausfuehren').hasAttribute('disabled')).toBe(true)
    fireEvent.change(eingabe, { target: { value: '0' } })
    expect(screen.getByTestId('teilen-ausfuehren').hasAttribute('disabled')).toBe(true)

    fireEvent.change(eingabe, { target: { value: '4' } })
    expect(screen.getByTestId('teilen-seitenzahl-hinweis').textContent).toBe('2 Dateien: 1-4, 5-6')
    await act(async () => {
      fireEvent.click(screen.getByTestId('teilen-ausfuehren'))
      await Promise.resolve()
    })
    expect(dokumentTeilen).toHaveBeenCalledWith({
      quelle: 'C:\\d\\offen.pdf',
      bereiche: [
        [1, 4],
        [5, 6]
      ]
    })
  })

  it('schickt Einzelseiten als Schluesselwort', async () => {
    dokumentTeilen.mockResolvedValue({ art: 'abgebrochen' })
    await teileDokument('einzelseiten')
    expect(dokumentTeilen).toHaveBeenCalledWith({
      quelle: 'C:\\d\\offen.pdf',
      bereiche: 'einzelseiten'
    })
    expect(useDokument.getState().hinweis).toBeNull()
  })
})

describe('PNG-Export (S4.2b)', () => {
  beforeEach(() => {
    useDokument.setState({
      aktuelleSeite: 3,
      rotation: 0,
      seitenGroessen: [{ breite: 595, hoehe: 842 }]
    })
    useDokumentwerkzeuge.setState({ offen: 'png' })
  })

  it('zeigt die Pixelmasse zur Aufloesung und exportiert die aktuelle Seite', async () => {
    render(<Dokumentwerkzeuge />)
    expect(screen.getByTestId('png-masse').textContent).toBe('1239 × 1754 Pixel')
    fireEvent.change(screen.getByTestId('png-dpi'), { target: { value: '300' } })
    expect(screen.getByTestId('png-masse').textContent).toBe('2479 × 3508 Pixel')
    await act(async () => {
      fireEvent.click(screen.getByTestId('png-ausfuehren'))
      await Promise.resolve()
    })
    expect(exportierePng).toHaveBeenCalledWith({ seiten: [3], dpi: 300 })
  })

  it('sagt vorher, wenn die Aufloesung ueber der Canvas-Grenze liegt', () => {
    render(<Dokumentwerkzeuge />)
    fireEvent.change(screen.getByTestId('png-dpi'), { target: { value: '2000' } })
    expect(screen.getByTestId('png-masse').textContent).toMatch(
      /Höchstens 1401 DPI .*16384 Pixel je Kante.*begrenzt/
    )
    expect(screen.getByTestId('png-ausfuehren').hasAttribute('disabled')).toBe(false)
    // Die gedrehte Ansicht rechnet mit der gedrehten Seite.
    act(() => {
      useDokument.setState({ rotation: 90 })
    })
    fireEvent.change(screen.getByTestId('png-dpi'), { target: { value: '150' } })
    expect(screen.getByTestId('png-masse').textContent).toBe('1754 × 1239 Pixel')
  })

  it('sperrt den Knopf bei unbrauchbarer DPI und bei ungueltigen Bereichen', async () => {
    render(<Dokumentwerkzeuge />)
    fireEvent.change(screen.getByTestId('png-dpi'), { target: { value: '5' } })
    expect(screen.getByTestId('png-masse').textContent).toMatch(/Ganze Zahl zwischen 18 und 2400/)
    expect(screen.getByTestId('png-ausfuehren').hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByTestId('png-dpi'), { target: { value: '72' } })

    fireEvent.click(screen.getByTestId('png-bereiche'))
    const eingabe = screen.getByTestId('png-bereiche-eingabe')
    fireEvent.change(eingabe, { target: { value: '1-2, 9' } })
    expect(screen.getByTestId('png-ausfuehren').hasAttribute('disabled')).toBe(true)
    fireEvent.change(eingabe, { target: { value: '5, 1-2, 2' } })
    // Seiten, nicht Bereiche: doppelte Nennungen ergeben ein Bild.
    expect(screen.getByTestId('png-bereiche-hinweis').textContent).toBe('3 Bilder: 5, 1-2, 2')
    await act(async () => {
      fireEvent.click(screen.getByTestId('png-ausfuehren'))
      await Promise.resolve()
    })
    expect(exportierePng).toHaveBeenCalledWith({ seiten: [1, 2, 5], dpi: 72 })
  })

  it('zeigt den Fortschritt und sperrt waehrenddessen beide Knoepfe', () => {
    useDokumentwerkzeuge.setState({ laeuft: true, fortschritt: { fertig: 1, gesamt: 4 } })
    render(<Dokumentwerkzeuge />)
    expect(screen.getByTestId('png-fortschritt').textContent).toBe('Bild 2 von 4…')
    expect(screen.getByTestId('png-ausfuehren').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('png-abbrechen').hasAttribute('disabled')).toBe(true)
  })
})

describe('Drucken (S4.3)', () => {
  beforeEach(() => {
    useDokument.setState({ aktuelleSeite: 2 })
    useDokumentwerkzeuge.setState({ offen: 'drucken' })
  })

  it('schickt Optionen und Ziel zum Main und meldet das Ergebnis', async () => {
    dokumentDrucken.mockResolvedValue({
      art: 'gespeichert',
      pfad: 'C:\\d\\offen-druck.pdf',
      name: 'offen-druck.pdf',
      seiten: 2
    })
    render(<Dokumentwerkzeuge />)
    fireEvent.click(screen.getByTestId('drucken-bereiche'))
    fireEvent.change(screen.getByTestId('drucken-bereiche-eingabe'), {
      target: { value: '1-2, 4' }
    })
    fireEvent.change(screen.getByTestId('drucken-ausrichtung'), { target: { value: 'quer' } })
    fireEvent.click(screen.getByTestId('drucken-anpassen'))
    fireEvent.click(screen.getByTestId('drucken-kommentare'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('drucken-datei'))
      await Promise.resolve()
    })
    expect(dokumentDrucken).toHaveBeenCalledWith({
      quelle: 'C:\\d\\offen.pdf',
      optionen: {
        seiten: [
          [1, 2],
          [4, 4]
        ],
        ausrichtung: 'quer',
        anpassen: false,
        kommentare: false
      },
      ziel: 'datei',
      aenderungen: { neue: [], geaendert: [], geloescht: [] },
      formularwerte: {}
    })
    await waitFor(() => {
      expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    })
    expect(useDokument.getState().hinweis).toBe('Als PDF gedruckt: offen-druck.pdf (2 Seiten).')
  })

  it('druckt die aktuelle Seite an den Drucker', async () => {
    dokumentDrucken.mockResolvedValue({ art: 'gedruckt' })
    render(<Dokumentwerkzeuge />)
    fireEvent.click(screen.getByTestId('drucken-aktuelle'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('drucken-drucker'))
      await Promise.resolve()
    })
    const auftrag = dokumentDrucken.mock.calls[0]?.[0] as {
      optionen: { seiten: unknown }
      ziel: string
    }
    expect(auftrag.optionen.seiten).toEqual([[2, 2]])
    expect(auftrag.ziel).toBe('drucker')
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toBe('Druckauftrag übergeben.')
    })
  })

  it('zeigt die Phase, sperrt die Knoepfe und laesst abbrechen', async () => {
    useDokumentwerkzeuge.setState({ laeuft: true, druckphase: 'laden' })
    render(<Dokumentwerkzeuge />)
    expect(screen.getByTestId('drucken-phase').textContent).toBe('Vorlage wird geladen…')
    expect(screen.getByTestId('drucken-drucker').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('drucken-datei').hasAttribute('disabled')).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByTestId('drucken-abbrechen'))
      await Promise.resolve()
    })
    expect(druckAbbrechen).toHaveBeenCalledTimes(1)
    // Ohne laufenden Druck schliesst Abbrechen das Feld.
    act(() => {
      useDokumentwerkzeuge.setState({ laeuft: false, druckphase: null })
    })
    fireEvent.click(screen.getByTestId('drucken-abbrechen'))
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
  })

  it('sperrt bei ungueltigen Bereichen und nennt eine Ablehnung', async () => {
    dokumentDrucken.mockResolvedValue({ art: 'abgelehnt', grund: 'Kein Drucker.' })
    render(<Dokumentwerkzeuge />)
    fireEvent.click(screen.getByTestId('drucken-bereiche'))
    fireEvent.change(screen.getByTestId('drucken-bereiche-eingabe'), { target: { value: '9' } })
    expect(screen.getByTestId('drucken-drucker').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('drucken-alle'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('drucken-drucker'))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(useDokument.getState().hinweis).toBe('Kein Drucker.')
    })
    expect(useDokumentwerkzeuge.getState().offen).toBe('drucken')
  })

  it('nimmt geaenderte Formularwerte mit und faengt Fehler der Bruecke', async () => {
    useFormular.setState({
      werte: { name: 'Neu', ort: 'Gleich' },
      ursprung: { name: 'Alt', ort: 'Gleich' }
    })
    dokumentDrucken.mockRejectedValue(new Error('Bruecke tot'))
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await druckeDokument(
      { seiten: 'alle', ausrichtung: 'auto', anpassen: true, kommentare: true },
      'drucker'
    )
    const auftrag = dokumentDrucken.mock.calls[0]?.[0] as { formularwerte: Record<string, unknown> }
    expect(auftrag.formularwerte).toEqual({ name: 'Neu' })
    expect(useDokument.getState().hinweis).toBe('Das Dokument ließ sich nicht drucken.')
    const { laeuft, druckphase } = useDokumentwerkzeuge.getState()
    expect([laeuft, druckphase]).toEqual([false, null])
    // Abbrechen ohne Bruecke oder mit Fehler wirft nicht.
    druckAbbrechen.mockRejectedValue(new Error('weg'))
    await brichDruckAb()
    expect(fehler).toHaveBeenCalledTimes(2)
    fehler.mockRestore()
    useFormular.setState({ werte: {}, ursprung: {} })
  })
})
