import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnwendungsEreignis } from '../../src/shared/ipc'
import { App } from '../../src/renderer/src/App'
import { useDokument } from '../../src/renderer/src/dokument-store'
import { leereTextCache, useSuche } from '../../src/renderer/src/suche-store'
import { setzeTabsZurueck, useTabs } from '../../src/renderer/src/tabs-store'
import { setzeSitzungZurueck } from '../../src/renderer/src/schale/sitzung'

function stubBruecke(ueberschreibungen: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ping: () => Promise.resolve('pong'),
      settingsGet: () => Promise.resolve({ schemaVersion: 1, autorName: 'test' }),
      settingsSet: () => Promise.resolve({ schemaVersion: 1, autorName: 'test' }),
      dokumentOeffnen: () => Promise.resolve(null),
      dokumentBeimStart: () => Promise.resolve(null),
      beiEreignis: () => () => undefined,
      dokumentOeffnePfad: () => Promise.resolve({ ok: false, grund: 'nicht gestubbt' }),
      zuletztGeoeffnet: () => Promise.resolve([]),
      // Ab S2.3a meldet die Schale den Aenderungsstand an den Main-Prozess,
      // sobald sie steht.
      dokumentGeaendert: () => Promise.resolve(),
      dokumentSpeichern: () => Promise.resolve({ art: 'abgebrochen' }),
      pfadVonDatei: () => '',
      ...ueberschreibungen
    }
  })
}

beforeEach(() => {
  useDokument.setState({
    ladeZustand: 'leer',
    fehler: null,
    pfad: null,
    name: null,
    seitenzahl: 0,
    aktuelleSeite: 1,
    dokument: null
  })
  setzeTabsZurueck()
  // Die Wiederherstellung laeuft einmal je Fenster - hier einmal je Test.
  setzeSitzungZurueck()
  stubBruecke()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('zeigt den leeren Zustand ohne Dokument', () => {
    render(<App />)
    expect(screen.getByTestId('dokument-name').textContent).toBe('kein Dokument')
    expect(screen.getByTestId('ansicht').textContent).toContain('Kein Dokument geöffnet')
  })

  it('fragt beim Start nach einem Dokument aus der Befehlszeile', async () => {
    const beimStart = vi.fn(() => Promise.resolve(null))
    stubBruecke({ dokumentBeimStart: beimStart })
    render(<App />)
    await waitFor(() => {
      expect(beimStart).toHaveBeenCalledTimes(1)
    })
  })

  // S6.1b: der Fenstertitel folgt dem aktiven Tab.
  it('nennt im Fenstertitel das Dokument des aktiven Tabs', () => {
    render(<App />)
    expect(document.title).toBe('paperlane')
    act(() => {
      useTabs.setState({
        tabs: [
          { id: 'tab-1', pfad: 'C:/a.pdf', name: 'a.pdf', verschwunden: false },
          { id: 'tab-2', pfad: 'C:/b.pdf', name: 'b.pdf', verschwunden: false }
        ],
        aktiv: 'tab-2'
      })
    })
    expect(document.title).toBe('b.pdf — paperlane')
    expect(screen.getByTestId('tableiste')).not.toBeNull()
    act(() => {
      useTabs.setState({ tabs: [], aktiv: null })
    })
    expect(document.title).toBe('paperlane')
    expect(screen.queryByTestId('tableiste')).toBeNull()
  })

  // Genau der Fall, den guard-build:preload-cjs verhindern soll: das Preload
  // wurde nicht geladen, window.api existiert nicht. Ohne Pruefung wuerde der
  // Zugriff synchron werfen und die Oberflaeche zerstoeren.
  it('zerbricht nicht an einem fehlenden window.api', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    Reflect.deleteProperty(window, 'api')
    render(<App />)
    await waitFor(() => {
      expect(fehler).toHaveBeenCalled()
    })
    expect(screen.getByTestId('dokument-name').textContent).toBe('kein Dokument')
  })

  it('zeigt eine Fehlermeldung, wenn das Laden scheiterte', () => {
    useDokument.setState({ ladeZustand: 'fehler', fehler: 'Datei beschaedigt' })
    render(<App />)
    expect(screen.getByTestId('fehlermeldung').textContent).toContain('Datei beschaedigt')
  })

  it('zeigt Seitenzahl und Dateiname bei geladenem Dokument', () => {
    useDokument.setState({ ladeZustand: 'bereit', name: 'bericht.pdf', seitenzahl: 12 })
    render(<App />)
    expect(screen.getByTestId('seiten-anzeige').textContent).toContain('von 12')
    expect(screen.getByTestId<HTMLInputElement>('seiten-eingabe').value).toBe('1')
    expect(screen.getByTestId('dokument-name').textContent).toBe('bericht.pdf')
  })
})

describe('geheZuSeite', () => {
  it('begrenzt nach unten und oben', () => {
    useDokument.setState({ seitenzahl: 10, aktuelleSeite: 5 })
    useDokument.getState().geheZuSeite(0)
    expect(useDokument.getState().aktuelleSeite).toBe(1)
    useDokument.getState().geheZuSeite(99)
    expect(useDokument.getState().aktuelleSeite).toBe(10)
  })

  it('tut nichts ohne Dokument', () => {
    useDokument.setState({ seitenzahl: 0, aktuelleSeite: 1 })
    useDokument.getState().geheZuSeite(5)
    expect(useDokument.getState().aktuelleSeite).toBe(1)
  })
})

describe('App-Werkzeugleiste bei geladenem Dokument', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({})
    ) as unknown as HTMLCanvasElement['getContext']
    useDokument.setState({
      ladeZustand: 'bereit',
      name: 'bericht.pdf',
      seitenzahl: 10,
      aktuelleSeite: 1,
      zoom: 1,
      rotation: 0,
      passung: 'frei',
      seitenGroessen: Array.from({ length: 10 }, () => ({ breite: 595, hoehe: 842 })),
      dokument: {
        // Die Sidebar fragt beim Mounten die Gliederung ab (S1.3d).
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
  })

  it('zeigt Seitenzahl, Zoom und Dateiname', () => {
    render(<App />)
    expect(screen.getByTestId('seiten-anzeige').textContent).toContain('von 10')
    expect(screen.getByTestId<HTMLInputElement>('zoom-anzeige').value).toBe('100 %')
    expect(screen.getByTestId('dokument-name').textContent).toBe('bericht.pdf')
  })

  it('blaettert vor und zurueck', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'vor' }))
    expect(useDokument.getState().aktuelleSeite).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'zurück' }))
    expect(useDokument.getState().aktuelleSeite).toBe(1)
  })

  it('aendert den Zoom ueber die Knoepfe', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'größer' }))
    expect(useDokument.getState().zoom).toBe(1.25)
    fireEvent.click(screen.getByRole('button', { name: 'kleiner' }))
    expect(useDokument.getState().zoom).toBe(1)
  })

  it('dreht in beide Richtungen', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'rechts drehen' }))
    expect(useDokument.getState().rotation).toBe(90)
    fireEvent.click(screen.getByRole('button', { name: 'links drehen' }))
    expect(useDokument.getState().rotation).toBe(0)
  })

  it('schaltet die Passung um', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /^Seite$/ }))
    expect(useDokument.getState().passung).toBe('seite')
  })

  it('blendet die Miniaturen ueber den Knopf und F4 aus', () => {
    useDokument.setState({ sidebarSichtbar: true })
    render(<App />)
    expect(screen.queryByTestId('miniaturen')).not.toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-schalter'))
    expect(useDokument.getState().sidebarSichtbar).toBe(false)
    expect(screen.queryByTestId('miniaturen')).toBeNull()

    fireEvent.keyDown(window, { key: 'F4' })
    expect(useDokument.getState().sidebarSichtbar).toBe(true)
  })

  it('oeffnet ueber den Knopf ein Dokument', async () => {
    const oeffnen = vi.fn(() => Promise.resolve(null))
    stubBruecke({ dokumentOeffnen: oeffnen })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei öffnen' }))
    await waitFor(() => {
      expect(oeffnen).toHaveBeenCalled()
    })
  })
})

describe('Seitennavigation und Kuerzel', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({})
    ) as unknown as HTMLCanvasElement['getContext']
    useDokument.setState({
      ladeZustand: 'bereit',
      name: 'bericht.pdf',
      pfad: null,
      seitenzahl: 50,
      aktuelleSeite: 1,
      zoom: 1,
      rotation: 0,
      passung: 'frei',
      sprungZiel: null,
      seitenGroessen: Array.from({ length: 50 }, () => ({ breite: 595, hoehe: 842 })),
      dokument: {
        // Die Sidebar fragt beim Mounten die Gliederung ab (S1.3d).
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
  })

  it('springt ueber das Eingabefeld zur Seite', () => {
    render(<App />)
    const feld = screen.getByTestId<HTMLInputElement>('seiten-eingabe')
    fireEvent.change(feld, { target: { value: '17' } })
    fireEvent.keyDown(feld, { key: 'Enter' })
    expect(useDokument.getState().aktuelleSeite).toBe(17)
    // sprungZiel wird von der Ansicht sofort verbraucht und geleert - sonst
    // liesse sich dieselbe Seite kein zweites Mal anspringen.
  })

  it('setzt eine unsinnige Eingabe zurueck, statt zu springen', () => {
    render(<App />)
    const feld = screen.getByTestId<HTMLInputElement>('seiten-eingabe')
    fireEvent.change(feld, { target: { value: 'abc' } })
    fireEvent.blur(feld)
    expect(useDokument.getState().aktuelleSeite).toBe(1)
    expect(feld.value).toBe('1')
  })

  it('begrenzt eine zu grosse Eingabe auf die letzte Seite', () => {
    render(<App />)
    const feld = screen.getByTestId<HTMLInputElement>('seiten-eingabe')
    fireEvent.change(feld, { target: { value: '9999' } })
    fireEvent.keyDown(feld, { key: 'Enter' })
    expect(useDokument.getState().aktuelleSeite).toBe(50)
  })

  it('springt ueber Anfang und Ende', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ende' }))
    expect(useDokument.getState().aktuelleSeite).toBe(50)
    fireEvent.click(screen.getByRole('button', { name: 'Anfang' }))
    expect(useDokument.getState().aktuelleSeite).toBe(1)
  })

  it.each([
    ['PageDown', {}, 2],
    ['End', {}, 50],
    ['Home', {}, 1]
  ])('reagiert auf %s', (key, zusatz, erwartet) => {
    render(<App />)
    fireEvent.keyDown(window, { key, ...zusatz })
    expect(useDokument.getState().aktuelleSeite).toBe(erwartet)
  })

  it('zoomt und dreht ueber Kuerzel', () => {
    render(<App />)
    fireEvent.keyDown(window, { key: '+', ctrlKey: true })
    expect(useDokument.getState().zoom).toBe(1.25)
    fireEvent.keyDown(window, { key: '0', ctrlKey: true })
    expect(useDokument.getState().zoom).toBe(1)
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
    expect(useDokument.getState().rotation).toBe(90)
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true, shiftKey: true })
    expect(useDokument.getState().rotation).toBe(0)
  })

  // Sonst laesst sich im Eingabefeld keine Seitenzahl mehr tippen.
  it('laesst Zifferntasten im Eingabefeld durch', () => {
    render(<App />)
    const feld = screen.getByTestId<HTMLInputElement>('seiten-eingabe')
    fireEvent.keyDown(feld, { key: '1' })
    expect(useDokument.getState().zoom).toBe(1)
    expect(useDokument.getState().passung).toBe('frei')
  })
})

describe('Menuebefehle', () => {
  /** Faengt den Rueckruf ab, den App beim Preload anmeldet. */
  function fangeRueckruf(): { rufe: (befehl: AnwendungsEreignis) => void; abmelden: () => void } {
    let angemeldet: ((befehl: AnwendungsEreignis) => void) | null = null
    const abmelden = vi.fn()
    stubBruecke({
      beiEreignis: (rueckruf: (befehl: AnwendungsEreignis) => void) => {
        angemeldet = rueckruf
        return abmelden
      }
    })
    return {
      rufe: (befehl) => {
        if (angemeldet === null) throw new Error('App hat sich nicht angemeldet')
        act(() => {
          ;(angemeldet as unknown as (b: AnwendungsEreignis) => void)(befehl)
        })
      },
      abmelden
    }
  }

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({})
    ) as unknown as HTMLCanvasElement['getContext']
    useDokument.setState({
      ladeZustand: 'bereit',
      name: 'bericht.pdf',
      pfad: null,
      seitenzahl: 10,
      aktuelleSeite: 1,
      zoom: 1,
      rotation: 0,
      passung: 'frei',
      seitenGroessen: Array.from({ length: 10 }, () => ({ breite: 595, hoehe: 842 })),
      dokument: {
        // Die Sidebar fragt beim Mounten die Gliederung ab (S1.3d).
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
            // Die Suche nach der Auswahl laeuft wirklich los; ohne Textinhalt
            // liefe sie in eine unbehandelte Ablehnung.
            getTextContent: () =>
              Promise.resolve({ items: [{ str: 'zweite Rechnung', hasEOL: false }] })
          })
      } as never
    })
    leereTextCache()
    useSuche.getState().zuruecksetzen()
  })

  // Menue und Kuerzel muessen denselben Weg nehmen; zwei Ausfuehrungspfade
  // driften auseinander (ADR 0002).
  it('fuehrt einen Menuebefehl wie das Kuerzel aus', () => {
    const kanal = fangeRueckruf()
    render(<App />)
    kanal.rufe({ art: 'befehl', befehl: 'zoomGroesser' })
    expect(useDokument.getState().zoom).toBe(1.25)
    kanal.rufe({ art: 'befehl', befehl: 'ende' })
    expect(useDokument.getState().aktuelleSeite).toBe(10)
  })

  it('uebernimmt die Auswahl aus dem Kontextmenue als Suchbegriff', () => {
    const kanal = fangeRueckruf()
    render(<App />)
    kanal.rufe({ art: 'sucheNachAuswahl', text: 'zweite\n  Rechnung ' })
    // Umbrueche werden eingeebnet: der Seitentext kennt dort nur ein
    // Leerzeichen (viewer/suche.ts).
    expect(useSuche.getState().begriff).toBe('zweite Rechnung')
    expect(screen.getByTestId<HTMLInputElement>('such-eingabe').value).toBe('zweite Rechnung')
  })

  it('ignoriert eine Auswahl aus reinem Leerraum', () => {
    const kanal = fangeRueckruf()
    render(<App />)
    kanal.rufe({ art: 'sucheNachAuswahl', text: '  \n ' })
    expect(useSuche.getState().begriff).toBe('')
  })

  // Ohne Abmeldung sammelt sich bei jedem Neuaufbau ein weiterer Zuhoerer an,
  // und ein Menueklick loeste den Befehl mehrfach aus.
  it('meldet den Zuhoerer beim Abbau wieder ab', () => {
    const kanal = fangeRueckruf()
    const { unmount } = render(<App />)
    unmount()
    expect(kanal.abmelden).toHaveBeenCalled()
  })
})

describe('Zuletzt geoeffnet und Drag & Drop', () => {
  /** Eine Ablage, wie sie ein Drop mitbringt. */
  function ablage(dateiname: string): DataTransfer {
    const datei = new File(['%PDF'], dateiname, { type: 'application/pdf' })
    return {
      files: Object.assign([datei], { item: () => datei })
    } as unknown as DataTransfer
  }

  it('zeigt die zuletzt geoeffneten Dokumente im leeren Zustand', async () => {
    stubBruecke({
      zuletztGeoeffnet: () =>
        Promise.resolve([
          { pfad: 'C:/a.pdf', name: 'a.pdf', existiert: true },
          { pfad: 'C:/weg.pdf', name: 'weg.pdf', existiert: false }
        ])
    })
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('zuletzt-a.pdf')).not.toBeNull()
    })
    // Nicht mehr vorhandene Dateien bleiben sichtbar, aber nicht anklickbar.
    // Sie kommentarlos zu verschlucken liesse den Nutzer im Unklaren.
    expect(screen.getByTestId<HTMLButtonElement>('zuletzt-weg.pdf').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('zuletzt-a.pdf').disabled).toBe(false)
  })

  it('oeffnet ein Dokument aus der Liste', async () => {
    const oeffne = vi.fn(() => Promise.resolve({ ok: false as const, grund: 'egal' }))
    stubBruecke({
      dokumentOeffnePfad: oeffne,
      zuletztGeoeffnet: () =>
        Promise.resolve([{ pfad: 'C:/a.pdf', name: 'a.pdf', existiert: true }])
    })
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('zuletzt-a.pdf')).not.toBeNull()
    })
    fireEvent.click(screen.getByTestId('zuletzt-a.pdf'))
    await waitFor(() => {
      expect(oeffne).toHaveBeenCalledWith('C:/a.pdf')
    })
  })

  // Exit-Kriterium: der Drop einer Nicht-PDF-Datei erzeugt eine Meldung statt
  // eines Fehlers - das offene Dokument bleibt stehen.
  it('meldet einen abgelehnten Drop, ohne den Zustand zu zerstoeren', async () => {
    stubBruecke({
      pfadVonDatei: () => 'C:/notiz.txt',
      dokumentOeffnePfad: () =>
        Promise.resolve({ ok: false as const, grund: 'Nur PDF-Dokumente lassen sich oeffnen' })
    })
    render(<App />)
    fireEvent.drop(screen.getByTestId('fenster'), { dataTransfer: ablage('notiz.txt') })
    await waitFor(() => {
      expect(screen.getByTestId('hinweis').textContent).toContain('Nur PDF-Dokumente')
    })
    expect(useDokument.getState().ladeZustand).not.toBe('fehler')
  })

  it('reicht den Pfad einer fallengelassenen Datei an den Main-Prozess', async () => {
    const oeffne = vi.fn(() => Promise.resolve({ ok: false as const, grund: 'egal' }))
    stubBruecke({ pfadVonDatei: () => 'C:/bericht.pdf', dokumentOeffnePfad: oeffne })
    render(<App />)
    fireEvent.drop(screen.getByTestId('fenster'), { dataTransfer: ablage('bericht.pdf') })
    await waitFor(() => {
      expect(oeffne).toHaveBeenCalledWith('C:/bericht.pdf')
    })
  })

  // S6.1: mehrere Dateien ergeben mehrere Tabs - jede geht einzeln und der
  // Reihe nach durch die Pruefung im Main.
  it('reicht jede von mehreren fallengelassenen Dateien weiter', async () => {
    const oeffne = vi.fn<(pfad: string) => Promise<{ ok: false; grund: string }>>(() =>
      Promise.resolve({ ok: false as const, grund: 'egal' })
    )
    stubBruecke({
      pfadVonDatei: (datei: File) => 'C:/' + datei.name,
      dokumentOeffnePfad: oeffne
    })
    render(<App />)
    const dateien = ['a.pdf', 'b.pdf'].map(
      (name) => new File(['%PDF'], name, { type: 'application/pdf' })
    )
    const ablageMehrerer = {
      files: Object.assign(dateien, { item: (i: number) => dateien[i] ?? null })
    } as unknown as DataTransfer
    fireEvent.drop(screen.getByTestId('fenster'), { dataTransfer: ablageMehrerer })
    await waitFor(() => {
      expect(oeffne.mock.calls.map((aufruf) => aufruf[0])).toEqual(['C:/a.pdf', 'C:/b.pdf'])
    })
  })

  // S6.1b: jede Ablehnung bleibt stehen - nicht nur die letzte.
  it('sammelt die Meldungen mehrerer fallengelassener Dateien', async () => {
    stubBruecke({
      pfadVonDatei: (datei: File) => 'C:/' + datei.name,
      dokumentOeffnePfad: (pfad: string) =>
        Promise.resolve({ ok: false as const, grund: 'Abgelehnt: ' + pfad + '.' })
    })
    render(<App />)
    const dateien = ['a.txt', 'b.txt'].map((name) => new File(['x'], name))
    const ablageMehrerer = {
      files: Object.assign(dateien, { item: (i: number) => dateien[i] ?? null })
    } as unknown as DataTransfer
    fireEvent.drop(screen.getByTestId('fenster'), { dataTransfer: ablageMehrerer })
    await waitFor(() => {
      expect(screen.getByTestId('hinweis').textContent).toContain('Abgelehnt: C:/a.txt.')
    })
    expect(screen.getByTestId('hinweis').textContent).toContain('Abgelehnt: C:/b.txt.')
  })

  // Aus dem Browser gezogene Inhalte tragen keinen Dateipfad; `File.path` gibt
  // es seit Electron 32 nicht mehr.
  it('meldet eine Ablage ohne Dateipfad', async () => {
    stubBruecke({ pfadVonDatei: () => '' })
    render(<App />)
    fireEvent.drop(screen.getByTestId('fenster'), { dataTransfer: ablage('bild.png') })
    await waitFor(() => {
      expect(screen.getByTestId('hinweis').textContent).toContain('keine Datei')
    })
  })

  it('oeffnet ein Dokument, das das Betriebssystem uebergibt', async () => {
    const oeffne = vi.fn(() => Promise.resolve({ ok: false as const, grund: 'egal' }))
    let angemeldet: ((ereignis: AnwendungsEreignis) => void) | null = null
    stubBruecke({
      dokumentOeffnePfad: oeffne,
      beiEreignis: (rueckruf: (ereignis: AnwendungsEreignis) => void) => {
        angemeldet = rueckruf
        return () => undefined
      }
    })
    render(<App />)
    act(() => {
      ;(angemeldet as unknown as (e: AnwendungsEreignis) => void)({
        art: 'dokumentAusSystem',
        pfad: 'C:/aus-dem-system.pdf'
      })
    })
    await waitFor(() => {
      expect(oeffne).toHaveBeenCalledWith('C:/aus-dem-system.pdf')
    })
  })
})

describe('Fehler- und Randfaelle', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({})
    ) as unknown as HTMLCanvasElement['getContext']
  })

  // Fall 2: die Abfrage muss sagen, dass das letzte Passwort falsch war -
  // sonst wiederholt sie dieselbe Frage kommentarlos.
  it('fragt nach dem Passwort und meldet einen Fehlversuch', () => {
    useDokument.setState({ passwortFrage: { erneut: false } })
    const { rerender } = render(<App />)
    expect(screen.getByTestId('passwort-abfrage').textContent).toMatch(/passwortgeschützt/)

    act(() => {
      useDokument.setState({ passwortFrage: { erneut: true } })
    })
    rerender(<App />)
    expect(screen.getByTestId('passwort-abfrage').textContent).toMatch(/war falsch/)
  })

  it('schliesst die Abfrage nach der Eingabe', () => {
    useDokument.setState({ passwortFrage: { erneut: false } })
    render(<App />)
    fireEvent.change(screen.getByTestId('passwort-feld'), { target: { value: 'geheim' } })
    fireEvent.click(screen.getByTestId('passwort-ok'))
    expect(useDokument.getState().passwortFrage).toBeNull()
    expect(screen.queryByTestId('passwort-abfrage')).toBeNull()
  })

  it('laesst sich abbrechen', () => {
    useDokument.setState({ passwortFrage: { erneut: false } })
    render(<App />)
    fireEvent.click(screen.getByTestId('passwort-abbrechen'))
    expect(useDokument.getState().passwortFrage).toBeNull()
  })

  // Das Passwortfeld darf seinen Inhalt nicht preisgeben.
  it('zeigt das Passwort nicht im Klartext', () => {
    useDokument.setState({ passwortFrage: { erneut: false } })
    render(<App />)
    expect(screen.getByTestId<HTMLInputElement>('passwort-feld').type).toBe('password')
  })

  // Fall 7: ohne Hinweis saehe der Nutzer eine scheinbar leere, korrekt
  // geladene Seite.
  it('weist auf ein XFA-Formular hin', () => {
    useDokument.setState({
      ladeZustand: 'bereit',
      name: 'formular.pdf',
      seitenzahl: 1,
      istXfa: true,
      seitenGroessen: [{ breite: 595, hoehe: 842 }],
      dokument: {
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
    render(<App />)
    expect(screen.getByTestId('xfa-hinweis').textContent).toMatch(/XFA/)
  })

  it('zeigt keinen XFA-Hinweis bei einem gewoehnlichen Dokument', () => {
    useDokument.setState({ ladeZustand: 'bereit', istXfa: false, seitenzahl: 1 })
    render(<App />)
    expect(screen.queryByTestId('xfa-hinweis')).toBeNull()
  })

  // Fall 1 und 3: die Meldung nennt den Ausweg, und die Anwendung bleibt
  // bedienbar - der Knopf zum Oeffnen ist weiterhin da.
  it('bleibt nach einem Ladefehler bedienbar', () => {
    useDokument.setState({
      ladeZustand: 'fehler',
      fehler: 'kaputt.pdf: Das Dokument ist beschaedigt. Waehlen Sie ein anderes Dokument.',
      fehlerArt: 'beschaedigt'
    })
    render(<App />)
    expect(screen.getByTestId('fehlermeldung').textContent).toMatch(/anderes Dokument/)
    expect(screen.getByRole('button', { name: 'Datei öffnen' })).not.toBeNull()
  })

  // Fall 4: die geladenen Seiten bleiben lesbar, deshalb nur ein Hinweis und
  // kein Fehlerzustand.
  it('meldet eine verschwundene Datei, ohne die Ansicht zu raeumen', async () => {
    let angemeldet: ((ereignis: AnwendungsEreignis) => void) | null = null
    stubBruecke({
      beiEreignis: (rueckruf: (ereignis: AnwendungsEreignis) => void) => {
        angemeldet = rueckruf
        return () => undefined
      }
    })
    useDokument.setState({
      ladeZustand: 'bereit',
      pfad: 'C:\\x.pdf',
      name: 'bericht.pdf',
      seitenzahl: 1,
      seitenGroessen: [{ breite: 595, hoehe: 842 }],
      dokument: {
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
    // Seit S6.1 gehoert die Meldung zu einem Tab; der Hinweis erscheint, weil
    // es der aktive ist.
    useTabs.setState({
      tabs: [{ id: 'tab-x', pfad: 'C:\\x.pdf', name: 'bericht.pdf', verschwunden: false }],
      aktiv: 'tab-x'
    })
    render(<App />)
    act(() => {
      ;(angemeldet as unknown as (e: AnwendungsEreignis) => void)({
        art: 'dokumentVerschwunden',
        pfad: 'C:\\x.pdf'
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('hinweis').textContent).toMatch(/gelöscht oder ersetzt/)
    })
    expect(useDokument.getState().ladeZustand).toBe('bereit')
  })
})

/**
 * Live-Regionen (Gate Phase 1).
 *
 * Diese Texte erscheinen oder aendern sich, ohne dass der Fokus wandert. Ohne
 * Live-Region bekommt ein Screenreader-Nutzer nichts davon mit. Weil
 * eslint-plugin-jsx-a11y die ESLint-Version dieses Projekts nicht unterstuetzt,
 * haelt dieser Test die Rollen fest - sonst faellt ihr Verschwinden niemandem
 * auf.
 */
describe('Ansagen fuer Screenreader', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({})
    ) as unknown as HTMLCanvasElement['getContext']
  })

  it('sagt einen Hinweis an', () => {
    useDokument.setState({ hinweis: 'Die Datei wurde geloescht.' })
    render(<App />)
    expect(screen.getByTestId('hinweis').getAttribute('role')).toBe('alert')
  })

  // Beim erneuten Fragen liegt der Fokus schon im Feld; ohne eigene
  // Live-Region wuesste der Nutzer nicht, warum das Dokument nicht aufgeht.
  it('sagt einen Passwort-Fehlversuch an', () => {
    useDokument.setState({ passwortFrage: { erneut: true } })
    render(<App />)
    const fehler = screen.getByTestId('passwort-fehler')
    expect(fehler.getAttribute('role')).toBe('alert')
    expect(fehler.textContent).toMatch(/war falsch/)
  })

  it('kuendigt beim ersten Fragen keinen Fehlversuch an', () => {
    useDokument.setState({ passwortFrage: { erneut: false } })
    render(<App />)
    expect(screen.queryByTestId('passwort-fehler')).toBeNull()
  })

  it('sagt den XFA-Hinweis an', () => {
    useDokument.setState({
      ladeZustand: 'bereit',
      seitenzahl: 1,
      istXfa: true,
      seitenGroessen: [{ breite: 595, hoehe: 842 }],
      dokument: {
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
    render(<App />)
    expect(screen.getByTestId('xfa-hinweis').getAttribute('role')).toBe('status')
  })

  it('sagt das Suchergebnis an', () => {
    useDokument.setState({
      ladeZustand: 'bereit',
      seitenzahl: 1,
      istXfa: false,
      seitenGroessen: [{ breite: 595, hoehe: 842 }],
      dokument: {
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
    render(<App />)
    expect(screen.getByTestId('treffer-anzeige').getAttribute('role')).toBe('status')
  })
})

describe('Leseposition', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({})
    ) as unknown as HTMLCanvasElement['getContext']
  })

  it('stellt die gemerkte Stelle wieder her', async () => {
    stubBruecke({
      settingsGet: () =>
        Promise.resolve({
          schemaVersion: 2,
          autorName: 'test',
          fenster: { breite: 1, hoehe: 1, x: null, y: null, maximiert: false },
          zuletztGelesen: { 'C:/bericht.pdf': { seite: 23, zoom: 1.5 } }
        })
    })
    useDokument.setState({
      ladeZustand: 'bereit',
      pfad: 'C:/bericht.pdf',
      name: 'bericht.pdf',
      seitenzahl: 50,
      aktuelleSeite: 1,
      seitenGroessen: Array.from({ length: 50 }, () => ({ breite: 595, hoehe: 842 })),
      dokument: {
        // Die Sidebar fragt beim Mounten die Gliederung ab (S1.3d).
        getOutline: () => Promise.resolve(null),
        getPage: () =>
          Promise.resolve({
            getViewport: () => ({ width: 595, height: 842 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
          })
      } as never
    })
    render(<App />)
    await waitFor(() => {
      expect(useDokument.getState().aktuelleSeite).toBe(23)
    })
    expect(useDokument.getState().zoom).toBe(1.5)
  })
})

/**
 * D13, entschieden in S2.1: **anzeigen und ignorieren.**
 *
 * Die Zeile nennt den Wunsch des Autors und sagt zugleich, dass die Anwendung
 * sich nicht danach richtet. Beides gehoert zusammen: nur den Wunsch zu nennen
 * liesse den Nutzer glauben, das Kopieren sei gesperrt; nur zu ignorieren
 * verschwiege, dass der Autor etwas anderes vorgesehen hatte.
 */
describe('Berechtigungsflags', () => {
  it('nennt die Einschraenkungen des Autors und die eigene Haltung dazu', () => {
    useDokument.setState({
      ladeZustand: 'bereit',
      seitenzahl: 1,
      eingeschraenkteRechte: ['Kopieren', 'Drucken']
    })
    render(<App />)
    const zeile = screen.getByTestId('rechte-hinweis')
    expect(zeile.textContent).toContain('Kopieren, Drucken')
    expect(zeile.textContent).toMatch(/richtet sich aber nicht danach/)
  })

  it('zeigt nichts, wenn das Dokument keine Einschraenkungen nennt', () => {
    useDokument.setState({ ladeZustand: 'bereit', seitenzahl: 1, eingeschraenkteRechte: [] })
    render(<App />)
    expect(screen.queryByTestId('rechte-hinweis')).toBeNull()
  })

  // Die Zeile erscheint, ohne dass der Fokus wandert; ohne Live-Region
  // bekaeme ein Screenreader-Nutzer davon nichts mit.
  it('sagt die Zeile als Live-Region an', () => {
    useDokument.setState({
      ladeZustand: 'bereit',
      seitenzahl: 1,
      eingeschraenkteRechte: ['Kopieren']
    })
    render(<App />)
    expect(screen.getByTestId('rechte-hinweis').getAttribute('role')).toBe('status')
  })
})
