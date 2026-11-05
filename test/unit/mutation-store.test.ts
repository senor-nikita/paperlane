import { beforeEach, describe, expect, it } from 'vitest'
import { useMutation } from '../../src/renderer/src/mutation-store'

/**
 * S7: der Mutationszaehler nach Rueckgaengig und Wiederholen. Er fiel beim
 * Speichern auf null; ein Rueckgaengig bis vor das Speichern macht das
 * Dokument wieder ungespeichert, und ein reines Herunterzaehlen bliebe bei null.
 */
beforeEach(() => {
  useMutation.setState({ anzahl: 0, laeuft: null, erwarteNeuladen: false })
})

describe('nachStand', () => {
  it('meldet einen ungespeicherten Stand nach einem Rueckgaengig ueber das Speichern', () => {
    // Gespeichert: der Zaehler steht auf null.
    useMutation.getState().merkeGespeichert()
    // Rueckgaengig bis vor das Speichern: die Platte ist ein anderer Stand.
    useMutation.getState().nachStand(false, -1)
    expect(useMutation.getState().anzahl).toBe(1)
  })

  it('meldet nichts Offenes, wenn der Stand die Platte ist', () => {
    useMutation.setState({ anzahl: 2 })
    useMutation.getState().nachStand(true, -1)
    expect(useMutation.getState().anzahl).toBe(0)
  })

  it('zaehlt zwischen ungespeicherten Staenden herunter, aber nie unter eins', () => {
    useMutation.setState({ anzahl: 3 })
    useMutation.getState().nachStand(false, -1)
    expect(useMutation.getState().anzahl).toBe(2)
    useMutation.getState().nachStand(false, -1)
    useMutation.getState().nachStand(false, -1)
    expect(useMutation.getState().anzahl).toBe(1)
  })

  it('zaehlt beim Wiederholen hoch', () => {
    useMutation.getState().nachStand(false, 1)
    expect(useMutation.getState().anzahl).toBe(1)
    useMutation.getState().nachStand(false, 1)
    expect(useMutation.getState().anzahl).toBe(2)
  })
})
