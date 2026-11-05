import { fireEvent, render, screen } from '@testing-library/react'
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
const { erzeugeFreitext, erzeugeNotiz, setzeKennungszaehlerZurueck } =
  await import('../../src/renderer/src/viewer/erzeugen')
const { Werkzeugleiste } = await import('../../src/renderer/src/schale/Werkzeugleiste')
const { Verlaufsknoepfe } = await import('../../src/renderer/src/schale/Verlaufsknoepfe')

/**
 * Die Werkzeugleiste (S2.2, Aufgaben 1 und 6).
 *
 * Sie ist die einzige Stelle, an der Farbe, Staerke und Deckkraft zugleich auf
 * das naechste **und** auf das ausgewaehlte Objekt wirken — genau das wird hier
 * geprueft.
 */
const VORGABEN = { autor: 'Testautor', farbe: '#ffd400', strichstaerke: 2 }

const settingsSet = vi.fn(() => Promise.resolve({}))

beforeEach(() => {
  settingsSet.mockClear()
  Object.defineProperty(window, 'api', { configurable: true, value: { settingsSet } })
  setzeKennungszaehlerZurueck()
  useHistorie.getState().leere()
  useAnnotationen.getState().vergiss()
  useAnnotationen.setState({ proSeite: { 1: [] } })
  useBearbeitung.setState({
    werkzeug: 'auswahl',
    farbe: '#ffd400',
    strichstaerke: 2,
    stempel: 'Geprueft',
    signaturBild: null,
    ausgewaehlt: null
  })
})

function mitNotiz(): string {
  const notiz = erzeugeNotiz(1, { x: 100, y: 700 }, VORGABEN)
  erstelleAnnotation(notiz)
  useBearbeitung.getState().waehle(notiz.id)
  return notiz.id
}

describe('Werkzeugleiste', () => {
  it('zeigt alle neun Werkzeuge', () => {
    render(<Werkzeugleiste />)
    for (const werkzeug of [
      'auswahl',
      'markieren',
      'unterstreichen',
      'durchstreichen',
      'notiz',
      'text',
      'freihand',
      'stempel',
      'signatur'
    ]) {
      expect(screen.getByTestId('werkzeug-' + werkzeug)).not.toBeNull()
    }
  })

  /**
   * S3.2, Aufgabe 4: das Signaturwerkzeug ohne Bild oeffnet das Feld von
   * selbst; mit Bild bleibt es zu und zeigt eine Vorschau. Ohne dieses
   * Verhalten klickte man auf die Seite, und nichts geschaehe.
   */
  it('oeffnet das Signaturfeld, wenn noch kein Bild da ist', () => {
    render(<Werkzeugleiste />)
    expect(screen.queryByTestId('signaturfeld')).toBeNull()
    fireEvent.click(screen.getByTestId('werkzeug-signatur'))
    expect(screen.getByTestId('signaturfeld')).not.toBeNull()
    expect(screen.getByTestId('signatur-hinweis').textContent).toMatch(/keine kryptografische/)
    expect(screen.getByTestId('werkzeug-signatur-stand').textContent).toMatch(/Noch kein/)
    // Abbrechen schliesst; das Werkzeug bleibt gewaehlt.
    fireEvent.click(screen.getByTestId('signatur-abbrechen'))
    expect(screen.queryByTestId('signaturfeld')).toBeNull()
    expect(useBearbeitung.getState().werkzeug).toBe('signatur')
  })

  it('zeigt mit Bild die Vorschau und laesst es aendern', () => {
    useBearbeitung.setState({
      signaturBild: { url: 'data:image/png;base64,iVBORw0KGgo=', breite: 3, hoehe: 1 }
    })
    render(<Werkzeugleiste />)
    fireEvent.click(screen.getByTestId('werkzeug-signatur'))
    expect(screen.queryByTestId('signaturfeld')).toBeNull()
    expect(screen.getByTestId('werkzeug-signatur-vorschau').getAttribute('src')).toContain(
      'data:image/png'
    )
    fireEvent.click(screen.getByTestId('werkzeug-signatur-aendern'))
    expect(screen.getByTestId('signaturfeld')).not.toBeNull()
    // Ein anderes Werkzeug schliesst das Feld.
    fireEvent.click(screen.getByTestId('werkzeug-auswahl'))
    expect(screen.queryByTestId('signaturfeld')).toBeNull()
  })

  // Ohne sichtbaren Modus waere nach dem naechsten Klick unklar, warum eine
  // Notiz statt einer Markierung entstand.
  it('macht den aktiven Modus sichtbar', () => {
    render(<Werkzeugleiste />)
    expect(screen.getByTestId('werkzeug-auswahl').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('werkzeug-freihand'))
    expect(useBearbeitung.getState().werkzeug).toBe('freihand')
    expect(screen.getByTestId('werkzeug-freihand').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('werkzeug-auswahl').getAttribute('aria-pressed')).toBe('false')
  })

  it('bietet die Stempeltexte nur beim Stempelwerkzeug an', () => {
    render(<Werkzeugleiste />)
    expect(screen.queryByTestId('werkzeug-stempeltext')).toBeNull()
    fireEvent.click(screen.getByTestId('werkzeug-stempel'))
    expect(screen.getByTestId('werkzeug-stempeltext')).not.toBeNull()
  })

  it('uebernimmt einen anderen Stempeltext', () => {
    useBearbeitung.setState({ werkzeug: 'stempel' })
    render(<Werkzeugleiste />)
    fireEvent.change(screen.getByTestId('werkzeug-stempeltext'), { target: { value: 'Entwurf' } })
    expect(useBearbeitung.getState().stempel).toBe('Entwurf')
  })

  it('setzt Farbe und Staerke als Vorgabe und sichert sie', () => {
    render(<Werkzeugleiste />)
    fireEvent.change(screen.getByTestId('werkzeug-farbe'), { target: { value: '#ff0000' } })
    expect(useBearbeitung.getState().farbe).toBe('#ff0000')
    expect(settingsSet).toHaveBeenCalledWith({
      annotationen: { farbe: '#ff0000', strichstaerke: 2 }
    })

    fireEvent.change(screen.getByTestId('werkzeug-staerke'), { target: { value: '5' } })
    expect(useBearbeitung.getState().strichstaerke).toBe(5)
  })

  // Zwei Farbwaehler nebeneinander waeren die Alternative gewesen.
  it('faerbt zugleich die ausgewaehlte Anmerkung um', () => {
    const id = mitNotiz()
    render(<Werkzeugleiste />)
    fireEvent.change(screen.getByTestId('werkzeug-farbe'), { target: { value: '#0000ff' } })
    expect(useAnnotationen.getState().finde(id)?.farbe).toEqual({ r: 0, g: 0, b: 255 })
    expect(useHistorie.getState().vergangenheit).toHaveLength(2)
  })

  it('zeigt Deckkraft und Loeschen erst mit einer Auswahl', () => {
    render(<Werkzeugleiste />)
    expect(screen.queryByTestId('werkzeug-loeschen')).toBeNull()
    expect(screen.queryByTestId('werkzeug-opazitaet')).toBeNull()
  })

  it('aendert die Deckkraft der Auswahl', () => {
    const id = mitNotiz()
    render(<Werkzeugleiste />)
    fireEvent.change(screen.getByTestId('werkzeug-opazitaet'), { target: { value: '0.5' } })
    expect(useAnnotationen.getState().finde(id)?.opazitaet).toBe(0.5)
  })

  it('loescht die ausgewaehlte Anmerkung', () => {
    const id = mitNotiz()
    render(<Werkzeugleiste />)
    fireEvent.click(screen.getByTestId('werkzeug-loeschen'))
    expect(useAnnotationen.getState().finde(id)).toBeNull()
    expect(useBearbeitung.getState().ausgewaehlt).toBeNull()
  })
})

/**
 * S6.5: die Schriftregler erscheinen nur bei einer ausgewaehlten `/FreeText`
 * — bei jedem anderen Typ (hier: Notiz) waeren sie ohne Wirkung und stuenden
 * nur im Weg.
 */
describe('Werkzeugleiste — FreeText', () => {
  function mitFreitext(): string {
    const neu = erzeugeFreitext(1, { x: 100, y: 700 }, VORGABEN)
    erstelleAnnotation(neu)
    useBearbeitung.getState().waehle(neu.id)
    return neu.id
  }

  it('zeigt Schriftregler nur bei FreeText, nicht bei einer Notiz', () => {
    mitNotiz()
    render(<Werkzeugleiste />)
    expect(screen.queryByTestId('werkzeug-schriftfamilie')).toBeNull()
  })

  it('aendert Familie, Groesse, Stil und Ausrichtung der Auswahl', () => {
    const id = mitFreitext()
    render(<Werkzeugleiste />)
    fireEvent.change(screen.getByTestId('werkzeug-schriftfamilie'), {
      target: { value: 'Times' }
    })
    fireEvent.change(screen.getByTestId('werkzeug-schriftgroesse'), { target: { value: '20' } })
    fireEvent.click(screen.getByTestId('werkzeug-fett'))
    fireEvent.click(screen.getByTestId('werkzeug-kursiv'))
    fireEvent.change(screen.getByTestId('werkzeug-ausrichtung'), { target: { value: 'mitte' } })

    const annotation = useAnnotationen.getState().finde(id)
    expect(annotation?.schriftFamilie).toBe('Times')
    expect(annotation?.schriftGroesse).toBe(20)
    expect(annotation?.schriftFett).toBe(true)
    expect(annotation?.schriftKursiv).toBe(true)
    expect(annotation?.ausrichtung).toBe('mitte')
  })
})

// Seit S6.9 in der Kopfleiste (Verlaufsknoepfe), nicht mehr hinter Bearbeiten.
describe('Verlaufsknoepfe', () => {
  it('sperrt beide Knoepfe, solange nichts geschehen ist', () => {
    render(<Verlaufsknoepfe />)
    expect(screen.getByTestId('rueckgaengig').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('wiederholen').hasAttribute('disabled')).toBe(true)
  })

  // Der Titel nennt, was zurueckgenommen wird - ein Knopf ohne diese Angabe
  // laesst den Nutzer raten.
  it('nennt den naechsten Schritt im Titel', () => {
    mitNotiz()
    render(<Verlaufsknoepfe />)
    expect(screen.getByTestId('rueckgaengig').getAttribute('title')).toContain('Notiz erstellt')
  })

  it('nimmt zurueck und wiederholt', () => {
    const id = mitNotiz()
    render(<Verlaufsknoepfe />)
    fireEvent.click(screen.getByTestId('rueckgaengig'))
    expect(useAnnotationen.getState().finde(id)).toBeNull()
    fireEvent.click(screen.getByTestId('wiederholen'))
    expect(useAnnotationen.getState().finde(id)).not.toBeNull()
  })
})
