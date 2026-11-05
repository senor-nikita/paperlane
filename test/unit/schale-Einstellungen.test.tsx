import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsPatch } from '../../src/shared/settings'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate(): void {}
  }
}))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

const { useBearbeitung } = await import('../../src/renderer/src/bearbeitung-store')
const { useDokument } = await import('../../src/renderer/src/dokument-store')
const { Einstellungen } = await import('../../src/renderer/src/schale/Einstellungen')
const { useSprache } = await import('../../src/renderer/src/sprache')
const { useDokumentwerkzeuge } =
  await import('../../src/renderer/src/schale/dokumentwerkzeuge-logik')

/**
 * Der Einstellungsdialog (S5.2a, Aufgabe 5): zeigt die Werte aus den Stores,
 * sichert sie als einen Patch ueber die Bruecke und traegt sie erst danach
 * in die Stores ein.
 */
const settingsSet = vi.fn<(patch: SettingsPatch) => Promise<unknown>>()
const settingsGet = vi.fn(() => Promise.resolve({ sprache: 'en' }))
const spracheGet = vi.fn(() => Promise.resolve('en'))

beforeEach(() => {
  settingsSet.mockReset().mockResolvedValue({})
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { settingsSet, settingsGet, spracheGet }
  })
  spracheGet.mockClear()
  useSprache.getState().setze('de', 'auto')
  useDokumentwerkzeuge.setState({ offen: 'einstellungen' })
  useBearbeitung.setState({ autor: 'Nikita', farbe: '#ffd400', strichstaerke: 2 })
  useDokument.setState({ standardPassung: 'breite', hinweis: null })
})

describe('Einstellungen', () => {
  it('zeigt die Werte aus den Stores mit beschrifteten Feldern', () => {
    render(<Einstellungen />)
    expect(screen.getByLabelText<HTMLInputElement>('Autorenname').value).toBe('Nikita')
    expect(screen.getByLabelText<HTMLInputElement>('Farbe neuer Anmerkungen').value).toBe('#ffd400')
    expect(screen.getByLabelText<HTMLInputElement>('Strichstärke').value).toBe('2')
    expect(screen.getByLabelText<HTMLSelectElement>('Ansicht beim Öffnen').value).toBe('breite')
    // Sprachwahl seit S6.8 (D15 revidiert), vorbelegt mit der Einstellung.
    expect(screen.getByLabelText<HTMLSelectElement>('Sprache').value).toBe('auto')
  })

  it('sichert alle drei Bereiche als einen Patch und uebernimmt sie danach', async () => {
    render(<Einstellungen />)
    fireEvent.change(screen.getByTestId('einstellungen-autor'), { target: { value: ' Anna ' } })
    fireEvent.change(screen.getByTestId('einstellungen-farbe'), { target: { value: '#1a4fb4' } })
    fireEvent.change(screen.getByTestId('einstellungen-strichstaerke'), {
      target: { value: '3.5' }
    })
    fireEvent.change(screen.getByTestId('einstellungen-passung'), { target: { value: 'seite' } })
    fireEvent.click(screen.getByTestId('einstellungen-speichern'))

    await waitFor(() => {
      expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    })
    expect(settingsSet).toHaveBeenCalledWith({
      autorName: 'Anna',
      annotationen: { farbe: '#1a4fb4', strichstaerke: 3.5 },
      ansicht: { passung: 'seite' },
      sprache: 'auto'
    })
    const bearbeitung = useBearbeitung.getState()
    expect(bearbeitung.autor).toBe('Anna')
    expect(bearbeitung.farbe).toBe('#1a4fb4')
    expect(bearbeitung.strichstaerke).toBe(3.5)
    expect(useDokument.getState().standardPassung).toBe('seite')
    expect(useDokument.getState().hinweis).toBe('Einstellungen gesichert.')
  })

  it('lehnt eine Strichstaerke ausserhalb der Grenzen ab, ohne zu sichern', () => {
    render(<Einstellungen />)
    fireEvent.change(screen.getByTestId('einstellungen-strichstaerke'), {
      target: { value: '40' }
    })
    fireEvent.click(screen.getByTestId('einstellungen-speichern'))
    expect(screen.getByRole('alert').textContent).toContain('Strichstärke')
    expect(settingsSet).not.toHaveBeenCalled()
    expect(useDokumentwerkzeuge.getState().offen).toBe('einstellungen')
    expect(useBearbeitung.getState().strichstaerke).toBe(2)
  })

  // Was der Main ablehnt oder nicht schreiben kann, darf die Oberflaeche
  // nicht als uebernommen zeigen.
  it('laesst die Stores unveraendert, wenn das Sichern fehlschlaegt', async () => {
    settingsSet.mockRejectedValue(new Error('Platte voll'))
    const fehlerAusgabe = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<Einstellungen />)
    fireEvent.change(screen.getByTestId('einstellungen-autor'), { target: { value: 'Anna' } })
    fireEvent.click(screen.getByTestId('einstellungen-speichern'))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('nicht sichern')
    })
    expect(useBearbeitung.getState().autor).toBe('Nikita')
    expect(useDokumentwerkzeuge.getState().offen).toBe('einstellungen')
    expect(screen.getByTestId<HTMLButtonElement>('einstellungen-speichern').disabled).toBe(false)
    fehlerAusgabe.mockRestore()
  })

  it('schliesst mit Abbrechen und mit Escape, ohne zu sichern', () => {
    const { rerender } = render(<Einstellungen />)
    fireEvent.click(screen.getByTestId('einstellungen-schliessen'))
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()

    useDokumentwerkzeuge.setState({ offen: 'einstellungen' })
    rerender(<Einstellungen />)
    fireEvent.keyDown(screen.getByTestId('einstellungen'), { key: 'Escape' })
    expect(useDokumentwerkzeuge.getState().offen).toBeNull()
    expect(settingsSet).not.toHaveBeenCalled()
  })
})

// S6.8: die Sprachwahl. Nach dem Sichern holt der Dialog die aufgeloeste
// Sprache beim Main ab und die Oberflaeche wechselt ohne Neustart.
describe('Sprachwahl', () => {
  it('sichert die Sprache und wechselt die Oberflaeche sofort', async () => {
    render(<Einstellungen />)
    fireEvent.change(screen.getByTestId('einstellungen-sprache'), { target: { value: 'en' } })
    fireEvent.click(screen.getByTestId('einstellungen-speichern'))
    await waitFor(() => {
      expect(useSprache.getState().sprache).toBe('en')
    })
    expect(settingsSet).toHaveBeenCalledWith(expect.objectContaining({ sprache: 'en' }))
    expect(spracheGet).toHaveBeenCalledTimes(1)
    expect(document.documentElement.lang).toBe('en')
    expect(useDokument.getState().hinweis).toBe('Settings saved.')
    act(() => {
      useSprache.getState().setze('de', 'auto')
    })
  })

  it('fragt den Main nicht, wenn die Sprache gleich bleibt', async () => {
    render(<Einstellungen />)
    fireEvent.click(screen.getByTestId('einstellungen-speichern'))
    await waitFor(() => {
      expect(settingsSet).toHaveBeenCalled()
    })
    expect(spracheGet).not.toHaveBeenCalled()
  })

  it('nennt die Sprachen in ihrer eigenen Sprache', () => {
    render(<Einstellungen />)
    const optionen = [...screen.getByTestId('einstellungen-sprache').querySelectorAll('option')]
    expect(optionen.map((option) => option.textContent)).toEqual([
      'Automatisch (Systemsprache)',
      'Deutsch',
      'English'
    ])
  })
})
