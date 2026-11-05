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
const { Sidebar, wandleGliederung } = await import('../../src/renderer/src/viewer/Sidebar')

const A4 = { breite: 595, hoehe: 842 }

/** Eine Anmerkung, wie sie `getAnnotations` liefert. */
const ANMERKUNG = {
  id: 'a1',
  subtype: 'Highlight',
  rect: [70, 752, 340, 782],
  contentsObj: { str: 'Vorhandene Markierung' }
}

const GLIEDERUNG = [
  {
    title: 'Kapitel 1',
    dest: [{ num: 1, gen: 0 }, { name: 'XYZ' }, 0, 842, null],
    items: [{ title: 'Abschnitt 1.1', dest: 'benannt', items: [] }]
  },
  { title: 'Kapitel 2', dest: [{ num: 4, gen: 0 }, { name: 'FitH' }, 400], items: [] }
]

function setzeDokument(gliederung: unknown): void {
  useDokument.setState({
    ladeZustand: 'bereit',
    seitenzahl: 4,
    aktuelleSeite: 1,
    sprungZiel: null,
    sprungAnteil: null,
    zoom: 1,
    rotation: 0,
    passung: 'frei',
    sidebarSichtbar: true,
    seitenGroessen: Array.from({ length: 4 }, () => A4),
    dokument: {
      getOutline: () => Promise.resolve(gliederung),
      getPage: (seite: number) =>
        Promise.resolve({
          view: [0, 0, 595, 842],
          getViewport: () => ({ width: 595, height: 842 }),
          render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
          // Nur Seite zwei traegt eine Anmerkung: so belegt der Sprungtest,
          // dass die Liste die richtige Seite nennt und nicht die erstbeste.
          getAnnotations: () => Promise.resolve(seite === 2 ? [ANMERKUNG] : [])
        }),
      getPageIndex: () => Promise.resolve(3),
      getDestination: () => Promise.resolve([{ num: 3, gen: 0 }, { name: 'FitH' }, 400])
    } as never
  })
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({})
  ) as unknown as HTMLCanvasElement['getContext']
  useAnnotationen.getState().vergiss()
})

describe('wandleGliederung', () => {
  it('uebernimmt Titel, Ziel und Kinder', () => {
    expect(wandleGliederung(GLIEDERUNG)[0]).toMatchObject({
      titel: 'Kapitel 1',
      kinder: [{ titel: 'Abschnitt 1.1', ziel: 'benannt', kinder: [] }]
    })
  })

  // Das Feld kommt aus einem fremden Dokument. Ein Eintrag ohne Titel waere
  // eine leere, nicht anklickbare Zeile.
  it('uebergeht Eintraege ohne Titel', () => {
    expect(wandleGliederung([{ title: '   ', dest: null }, { dest: null }, 42, null])).toEqual([])
  })

  it('liefert fuer alles Untaugliche eine leere Liste', () => {
    expect(wandleGliederung(null)).toEqual([])
    expect(wandleGliederung('Gliederung')).toEqual([])
  })
})

describe('Sidebar', () => {
  // Aufgabe 3 des Schritts: fehlt die Gliederung, wird der Bereich sauber
  // ausgeblendet statt leer angezeigt.
  it('zeigt ohne Gliederung keinen Reiter', async () => {
    setzeDokument(null)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('miniaturen')).not.toBeNull()
    })
    expect(screen.queryByTestId('reiter-gliederung')).toBeNull()
  })

  it('zeigt bei leerer Gliederung ebenfalls keinen Reiter', async () => {
    setzeDokument([])
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('miniaturen')).not.toBeNull()
    })
    expect(screen.queryByTestId('reiter-gliederung')).toBeNull()
  })

  /**
   * S5.2a, Aufgabe 1: die Reiterleiste ist **eine** Station der Tabfolge,
   * gewaehlt wird darin mit den Pfeilen. Ohne das muesste sich jeder
   * Tastaturnutzer durch alle Reiter tabben, und `aria-selected` stuende an
   * Knoepfen, die gar keine Reiter sind.
   */
  it('wechselt den Reiter mit den Pfeiltasten und fuehrt genau einen Tabstopp', async () => {
    setzeDokument(GLIEDERUNG)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-gliederung')).not.toBeNull()
    })

    const miniaturen = screen.getByTestId('reiter-miniaturen')
    const gliederung = screen.getByTestId('reiter-gliederung')
    const anmerkungen = screen.getByTestId('reiter-anmerkungen')

    expect(miniaturen.getAttribute('role')).toBe('tab')
    expect(miniaturen.getAttribute('aria-selected')).toBe('true')
    expect(miniaturen.getAttribute('tabindex')).toBe('0')
    expect(gliederung.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(miniaturen, { key: 'ArrowRight' })
    expect(gliederung.getAttribute('aria-selected')).toBe('true')
    expect(gliederung.getAttribute('tabindex')).toBe('0')
    expect(screen.getByTestId('gliederung-eintrag-0').textContent).toBe('Kapitel 1')

    // Ende springt an den letzten Reiter, Pos1 zurueck an den ersten.
    fireEvent.keyDown(gliederung, { key: 'End' })
    expect(anmerkungen.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(anmerkungen, { key: 'Home' })
    expect(miniaturen.getAttribute('aria-selected')).toBe('true')

    // Links vom ersten Reiter laeuft die Auswahl um.
    fireEvent.keyDown(miniaturen, { key: 'ArrowLeft' })
    expect(anmerkungen.getAttribute('aria-selected')).toBe('true')
    // Rechts vom letzten ebenso.
    fireEvent.keyDown(anmerkungen, { key: 'ArrowRight' })
    expect(miniaturen.getAttribute('aria-selected')).toBe('true')

    // Eine Taste ohne Bedeutung laesst die Auswahl stehen.
    fireEvent.keyDown(miniaturen, { key: 'a' })
    expect(miniaturen.getAttribute('aria-selected')).toBe('true')
  })

  it('benennt den Bereich nach dem aktiven Reiter', async () => {
    setzeDokument(null)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('miniaturen')).not.toBeNull()
    })
    const reiter = screen.getByTestId('reiter-miniaturen')
    const bereich = reiter.closest('aside')?.querySelector('[role="tabpanel"]')
    expect(bereich?.getAttribute('aria-labelledby')).toBe(reiter.id)
    expect(reiter.getAttribute('aria-controls')).toBe(bereich?.id)
  })

  it('bietet die Gliederung als zweiten Bereich an', async () => {
    setzeDokument(GLIEDERUNG)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-gliederung')).not.toBeNull()
    })
    // Miniaturen bleiben der Anfangsbereich.
    expect(screen.queryByTestId('gliederung')).toBeNull()

    fireEvent.click(screen.getByTestId('reiter-gliederung'))
    expect(screen.getByTestId('gliederung-eintrag-0').textContent).toBe('Kapitel 1')
    expect(screen.queryByTestId('miniaturen')).toBeNull()
  })

  it('klappt Unterpunkte auf und zu', async () => {
    setzeDokument(GLIEDERUNG)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-gliederung')).not.toBeNull()
    })
    fireEvent.click(screen.getByTestId('reiter-gliederung'))

    // Der erste Zweig ist zu Beginn offen.
    expect(screen.getByTestId('gliederung-eintrag-0.0').textContent).toBe('Abschnitt 1.1')
    fireEvent.click(screen.getByTestId('gliederung-klappe-0'))
    expect(screen.queryByTestId('gliederung-eintrag-0.0')).toBeNull()
  })

  /**
   * Der Bereich "Anmerkungen" haengt nicht am Vorhandensein einer Gliederung:
   * er gehoert zu jedem Dokument, auch wenn die Liste am Ende leer bleibt.
   */
  it('bietet die Anmerkungen auch ohne Gliederung an', async () => {
    setzeDokument(null)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-anmerkungen')).not.toBeNull()
    })
    expect(screen.getByTestId('reiter-miniaturen')).not.toBeNull()
    expect(screen.queryByTestId('reiter-gliederung')).toBeNull()
  })

  it('zeigt die Anmerkungen des Dokuments erst, wenn der Bereich geoeffnet wird', async () => {
    setzeDokument(null)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('miniaturen')).not.toBeNull()
    })
    // Vor dem Wechsel wird nichts gelesen - das Budget aus S1.2 haengt daran.
    expect(useAnnotationen.getState().vollstaendig).toBe(false)

    fireEvent.click(screen.getByTestId('reiter-anmerkungen'))
    const eintrag = await screen.findByTestId('annotationsliste-a1')
    expect(eintrag.textContent).toContain('Vorhandene Markierung')
    expect(eintrag.textContent).toContain('S. 2')
  })

  it('springt beim Klick auf eine Anmerkung an ihre Stelle', async () => {
    setzeDokument(null)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-anmerkungen')).not.toBeNull()
    })
    fireEvent.click(screen.getByTestId('reiter-anmerkungen'))
    fireEvent.click(await screen.findByTestId('annotationsliste-a1'))

    expect(useDokument.getState().sprungZiel).toBe(2)
    // Oberkante 782 auf einer 842 Punkt hohen Seite.
    expect(useDokument.getState().sprungAnteil).toBeCloseTo((842 - 782) / 842, 3)
  })

  it('sagt es, wenn das Dokument keine Anmerkungen enthaelt', async () => {
    setzeDokument(null)
    // Nur Seite eins, und die traegt in der Attrappe keine Anmerkung.
    useDokument.setState({ seitenzahl: 1 })
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-anmerkungen')).not.toBeNull()
    })
    fireEvent.click(screen.getByTestId('reiter-anmerkungen'))
    await waitFor(() => {
      expect(screen.getByTestId('annotationsliste-stand').textContent).toContain(
        'keine Anmerkungen'
      )
    })
  })

  it('springt beim Klick an die aufgeloeste Stelle', async () => {
    setzeDokument(GLIEDERUNG)
    render(<Sidebar />)
    await waitFor(() => {
      expect(screen.getByTestId('reiter-gliederung')).not.toBeNull()
    })
    fireEvent.click(screen.getByTestId('reiter-gliederung'))
    fireEvent.click(screen.getByTestId('gliederung-eintrag-1'))

    // getPageIndex liefert 3, FitH 400 auf einer 842 Punkt hohen Seite.
    await waitFor(() => {
      expect(useDokument.getState().sprungZiel).toBe(4)
    })
    expect(useDokument.getState().sprungAnteil).toBeCloseTo(0.525, 3)
  })
})
