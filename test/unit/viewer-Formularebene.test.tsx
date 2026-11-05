import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { geaenderteFelder, useFormular } = await import('../../src/renderer/src/formular-store')
const { Formularebene, skriptHinweis } = await import('../../src/renderer/src/viewer/Formularebene')

/**
 * Die Formularebene (S3.1): echte Eingabeelemente ueber der Seite.
 *
 * jsdom kann kein Layout, aber es kann Formulare: Werte, Fokus, Tab-Reihen-
 * folge im DOM, `checked`, `selectedOptions`. Genau das wird hier geprueft.
 * Ob die Felder an der richtigen Stelle der gezeichneten Seite liegen,
 * belegt der E2E-Lauf.
 */
const A4 = { breite: 595, hoehe: 842 }

function widget(teile: Record<string, unknown>): Record<string, unknown> {
  return {
    subtype: 'Widget',
    fieldType: 'Tx',
    fieldValue: '',
    rect: [72, 700, 372, 724],
    readOnly: false,
    required: false,
    hidden: false,
    maxLen: 0,
    actions: null,
    ...teile
  }
}

const NAME = widget({ id: '11R', fieldName: 'person.name', fieldValue: 'Erika Muster' })
const EMAIL = widget({
  id: '35R',
  fieldName: 'person.email',
  required: true,
  maxLen: 40,
  rect: [72, 500, 372, 524]
})
const KENNUNG = widget({
  id: '38R',
  fieldName: 'kennung',
  fieldValue: 'K-2026',
  readOnly: true,
  rect: [72, 450, 192, 474]
})
const NOTIZ = widget({ id: '41R', fieldName: 'notiz', multiLine: true, rect: [72, 360, 372, 430] })
const ZUSTIMMUNG = widget({
  id: '15R',
  fieldName: 'zustimmung',
  fieldType: 'Btn',
  checkBox: true,
  fieldValue: 'Off',
  exportValue: 'Yes',
  rect: [72, 650, 90, 668]
})
const FRAU = widget({
  id: '21R',
  fieldName: 'anrede',
  fieldType: 'Btn',
  radioButton: true,
  fieldValue: null,
  buttonValue: 'frau',
  rect: [72, 600, 90, 618]
})
const HERR = widget({
  id: '26R',
  fieldName: 'anrede',
  fieldType: 'Btn',
  radioButton: true,
  fieldValue: null,
  buttonValue: 'herr',
  rect: [120, 600, 138, 618]
})
const LAND = widget({
  id: '32R',
  fieldName: 'land',
  fieldType: 'Ch',
  combo: true,
  multiSelect: false,
  fieldValue: [],
  options: [
    { exportValue: 'Deutschland', displayValue: 'Deutschland' },
    { exportValue: 'Schweiz', displayValue: 'Schweiz' }
  ],
  rect: [72, 550, 272, 574]
})
const SPRACHEN = widget({
  id: '44R',
  fieldName: 'sprachen',
  fieldType: 'Ch',
  combo: false,
  multiSelect: true,
  fieldValue: [],
  options: [
    { exportValue: 'Deutsch', displayValue: 'Deutsch' },
    { exportValue: 'Englisch', displayValue: 'Englisch' }
  ],
  rect: [72, 280, 272, 340]
})
const BETRAG = widget({
  id: '47R',
  fieldName: 'betrag',
  actions: new Map([['Format', ['AFNumber_Format(2, 0, 0, 0, "", true);']]]),
  rect: [72, 230, 192, 254]
})
const SONSTIGES = widget({
  id: '50R',
  fieldName: 'sonstiges',
  actions: new Map([['Validate', ['if (event.value.length < 3) app.alert("zu kurz");']]]),
  rect: [220, 230, 372, 254]
})

function setzeDokument(widgets: unknown[]): void {
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
          getAnnotations: () => Promise.resolve(widgets)
        })
    } as never
  })
}

const ALLE = [
  NAME,
  ZUSTIMMUNG,
  FRAU,
  HERR,
  LAND,
  EMAIL,
  KENNUNG,
  NOTIZ,
  SPRACHEN,
  BETRAG,
  SONSTIGES
]

beforeEach(() => {
  useFormular.getState().vergiss()
})

describe('Formularebene', () => {
  it('rendert je Widget ein Eingabeelement', async () => {
    setzeDokument(ALLE)
    render(<Formularebene index={0} />)
    await screen.findByTestId('formularfeld-person.name')
    expect(screen.getByTestId('formularfeld-person.name').tagName).toBe('INPUT')
    expect(screen.getByTestId('formularfeld-zustimmung')).toHaveProperty('type', 'checkbox')
    expect(screen.getByTestId('formularfeld-anrede-frau')).toHaveProperty('type', 'radio')
    expect(screen.getByTestId('formularfeld-land').tagName).toBe('SELECT')
    expect(screen.getByTestId('formularfeld-notiz').tagName).toBe('TEXTAREA')
  })

  it('zeigt den Wert aus dem Dokument', async () => {
    setzeDokument([NAME])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-person.name')
    expect(feld.value).toBe('Erika Muster')
  })

  it('legt das Feld an die Stelle, die das Dokument nennt', async () => {
    setzeDokument([NAME])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId('formularfeld-person.name')
    // Rect [72, 700, 372, 724] auf einer 842 hohen Seite bei Zoom 1.
    expect(feld.style.left).toBe('72px')
    expect(feld.style.top).toBe(String(842 - 724) + 'px')
    expect(feld.style.width).toBe('300px')
    expect(feld.style.height).toBe('24px')
  })

  it('uebernimmt eine Eingabe in den Store und markiert sie als Aenderung', async () => {
    setzeDokument([NAME])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-person.name')
    fireEvent.change(feld, { target: { value: 'Max Muster' } })
    expect(useFormular.getState().werte['person.name']).toBe('Max Muster')
    const { werte, ursprung } = useFormular.getState()
    expect(geaenderteFelder(werte, ursprung)).toEqual(['person.name'])
    // Und zurueck auf den Ausgangswert: keine Aenderung mehr.
    fireEvent.change(feld, { target: { value: 'Erika Muster' } })
    expect(geaenderteFelder(useFormular.getState().werte, ursprung)).toEqual([])
  })

  /** Aufgabe 2: Schreibschutz und Pflicht sind sichtbar und wirksam. */
  it('sperrt ein schreibgeschuetztes Feld, laesst es aber lesbar', async () => {
    setzeDokument([KENNUNG])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-kennung')
    expect(feld.readOnly).toBe(true)
    expect(feld.value).toBe('K-2026')
    expect(feld.className).toContain('formularfeld-gesperrt')
  })

  /** Exit-Kriterium: die Pflichtfeldpruefung greift. */
  it('meldet ein leeres Pflichtfeld und beruhigt sich nach der Eingabe', async () => {
    setzeDokument([EMAIL])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-person.email')
    expect(feld.getAttribute('aria-required')).toBe('true')
    expect(feld.getAttribute('aria-invalid')).toBe('true')
    expect(feld.dataset['fehler']).toBe('Pflichtfeld')
    expect(feld.title).toBe('Pflichtfeld')
    fireEvent.change(feld, { target: { value: 'erika@example.org' } })
    expect(feld.getAttribute('aria-invalid')).toBeNull()
    expect(feld.dataset['fehler']).toBeUndefined()
  })

  it('begrenzt die Laenge ueber maxLength', async () => {
    setzeDokument([EMAIL])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-person.email')
    expect(feld.maxLength).toBe(40)
  })

  it('kreuzt ein Kontrollkaestchen an und wieder ab', async () => {
    setzeDokument([ZUSTIMMUNG])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-zustimmung')
    expect(feld.checked).toBe(false)
    fireEvent.click(feld)
    expect(useFormular.getState().werte['zustimmung']).toBe(true)
    fireEvent.click(feld)
    expect(useFormular.getState().werte['zustimmung']).toBe(false)
  })

  /** Aufgabe 5: die Gruppe hat einen Wert, nicht zwei; ohne Wahl ist er Off. */
  it('fuehrt eine Auswahlknopf-Gruppe ueber einen gemeinsamen Wert', async () => {
    setzeDokument([FRAU, HERR])
    render(<Formularebene index={0} />)
    const frau = await screen.findByTestId<HTMLInputElement>('formularfeld-anrede-frau')
    const herr = screen.getByTestId<HTMLInputElement>('formularfeld-anrede-herr')
    expect(useFormular.getState().werte['anrede']).toBe('Off')
    expect(frau.checked).toBe(false)
    expect(herr.checked).toBe(false)
    // Beide teilen den DOM-Namen: der Browser laesst nur einen zu.
    expect(frau.name).toBe(herr.name)

    fireEvent.click(herr)
    expect(useFormular.getState().werte['anrede']).toBe('herr')
    expect(herr.checked).toBe(true)
    expect(frau.checked).toBe(false)

    fireEvent.click(frau)
    expect(useFormular.getState().werte['anrede']).toBe('frau')
    expect(frau.checked).toBe(true)
    expect(herr.checked).toBe(false)
  })

  it('zeigt ein Kombinationsfeld ohne Wahl leer und uebernimmt die Wahl', async () => {
    setzeDokument([LAND])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLSelectElement>('formularfeld-land')
    expect(feld.value).toBe('')
    fireEvent.change(feld, { target: { value: 'Schweiz' } })
    expect(useFormular.getState().werte['land']).toEqual(['Schweiz'])
  })

  it('erlaubt Mehrfachauswahl in einem Listenfeld', async () => {
    setzeDokument([SPRACHEN])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLSelectElement>('formularfeld-sprachen')
    expect(feld.multiple).toBe(true)
    for (const option of feld.options) option.selected = true
    fireEvent.change(feld)
    expect(useFormular.getState().werte['sprachen']).toEqual(['Deutsch', 'Englisch'])
  })

  /** Aufgabe 4: das erkannte Zahlformat prueft, ohne ein Skript zu starten. */
  it('prueft ein Feld mit erkanntem Zahlformat', async () => {
    setzeDokument([BETRAG])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-betrag')
    fireEvent.change(feld, { target: { value: 'viel' } })
    expect(feld.dataset['fehler']).toBe('Bitte eine Zahl eingeben')
    fireEvent.change(feld, { target: { value: '12,50' } })
    expect(feld.dataset['fehler']).toBeUndefined()
    expect(screen.queryByTestId('formular-skripthinweis-betrag')).toBeNull()
  })

  /** Aufgabe 4: bei einem fremden Skript ein Hinweis - und kein Urteil. */
  it('zeigt bei einem Skriptfeld den Hinweis und prueft nicht', async () => {
    setzeDokument([SONSTIGES])
    render(<Formularebene index={0} />)
    const feld = await screen.findByTestId<HTMLInputElement>('formularfeld-sonstiges')
    const hinweis = screen.getByTestId('formular-skripthinweis-sonstiges')
    expect(hinweis.title).toBe(skriptHinweis())
    expect(feld.title).toBe(skriptHinweis())
    fireEvent.change(feld, { target: { value: 'x' } })
    expect(feld.dataset['fehler']).toBeUndefined()
  })

  /** Aufgabe 3: die Tab-Reihenfolge ist die Reihenfolge im Dokument. */
  it('haelt die Reihenfolge des Dokuments im DOM', async () => {
    setzeDokument([EMAIL, NAME, KENNUNG])
    render(<Formularebene index={0} />)
    await screen.findByTestId('formularfeld-kennung')
    const namen = [
      ...screen.getByTestId('formularebene-1').querySelectorAll('[data-feldname]')
    ].map((element) => element.getAttribute('data-feldname'))
    expect(namen).toEqual(['person.email', 'person.name', 'kennung'])
  })

  it('laesst versteckte Felder weg', async () => {
    setzeDokument([NAME, widget({ id: '99R', fieldName: 'geheim', hidden: true })])
    render(<Formularebene index={0} />)
    await screen.findByTestId('formularfeld-person.name')
    expect(screen.queryByTestId('formularfeld-geheim')).toBeNull()
  })

  it('rendert nichts fuer eine Seite ohne Felder', async () => {
    setzeDokument([{ subtype: 'Highlight', rect: [0, 0, 1, 1] }])
    const { container } = render(<Formularebene index={0} />)
    await waitFor(() => {
      expect(useFormular.getState().proSeite[1]).toBeDefined()
    })
    expect(container.querySelector('.formularebene')).toBeNull()
  })
})

describe('Formular-Store', () => {
  it('liest eine Seite nur einmal', async () => {
    let aufrufe = 0
    useDokument.setState({
      dokument: {
        getPage: () =>
          Promise.resolve({
            view: [0, 0, 595, 842],
            getAnnotations: () => {
              aufrufe++
              return Promise.resolve([NAME])
            }
          })
      } as never
    })
    const dokument = useDokument.getState().dokument
    if (dokument === null) throw new Error('Testaufbau')
    await useFormular.getState().ladeSeite(dokument, 1)
    await useFormular.getState().ladeSeite(dokument, 1)
    expect(aufrufe).toBe(1)
  })

  it('vergisst beim Wechsel Werte und Ursprung', async () => {
    setzeDokument([NAME])
    const dokument = useDokument.getState().dokument
    if (dokument === null) throw new Error('Testaufbau')
    await useFormular.getState().ladeSeite(dokument, 1)
    useFormular.getState().setzeWert('person.name', 'x')
    useFormular.getState().vergiss()
    expect(useFormular.getState().werte).toEqual({})
    expect(useFormular.getState().ursprung).toEqual({})
    expect(useFormular.getState().proSeite).toEqual({})
  })

  it('meldet einen Lesefehler und merkt sich die Seite als leer', async () => {
    const meldung = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useDokument.setState({
      dokument: {
        getPage: () => Promise.reject(new Error('kaputt'))
      } as never
    })
    const dokument = useDokument.getState().dokument
    if (dokument === null) throw new Error('Testaufbau')
    await useFormular.getState().ladeSeite(dokument, 3)
    expect(useFormular.getState().proSeite[3]).toEqual([])
    expect(meldung).toHaveBeenCalled()
    meldung.mockRestore()
  })
})
