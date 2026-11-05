import { describe, expect, it, vi } from 'vitest'
import { RenderQueue } from '../../src/renderer/src/viewer/renderqueue'

const auftrag = () => ({ cancel: vi.fn(() => undefined) })

describe('RenderQueue', () => {
  it('haelt hoechstens einen Auftrag je Seite', () => {
    const queue = new RenderQueue()
    const erster = auftrag()
    queue.starte(3, erster)
    queue.starte(3, auftrag())
    expect(erster.cancel).toHaveBeenCalledTimes(1)
    expect(queue.anzahlLaufend).toBe(1)
  })

  it('bricht Seiten ausserhalb des Sichtfensters ab', () => {
    const queue = new RenderQueue()
    const weg = auftrag()
    const bleibt = auftrag()
    queue.starte(1, weg)
    queue.starte(2, bleibt)
    queue.brichAlleAusser(new Set([2]))
    expect(weg.cancel).toHaveBeenCalledTimes(1)
    expect(bleibt.cancel).not.toHaveBeenCalled()
    expect(queue.anzahlLaufend).toBe(1)
  })

  it('bricht einen fertigen Auftrag nicht nachtraeglich ab', () => {
    const queue = new RenderQueue()
    const fertig = auftrag()
    queue.starte(5, fertig)
    queue.fertig(5)
    queue.brichAlles()
    expect(fertig.cancel).not.toHaveBeenCalled()
    expect(queue.anzahlLaufend).toBe(0)
  })

  it('vertraegt Abbruch einer unbekannten Seite', () => {
    const queue = new RenderQueue()
    expect(() => {
      queue.brich(42)
    }).not.toThrow()
  })
})

describe('Obergrenze', () => {
  // Netz unter der Virtualisierung (S1.5, Fall 5): stapeln sich Auftraege
  // doch einmal, sollen die aeltesten weichen statt den Speicher zu fuellen.
  it('bricht den aeltesten Auftrag ab, wenn die Grenze erreicht ist', () => {
    const queue = new RenderQueue(2)
    const ersteAbbrechen = vi.fn()
    queue.starte(1, { cancel: ersteAbbrechen })
    queue.starte(2, { cancel: vi.fn() })
    expect(queue.anzahlLaufend).toBe(2)

    queue.starte(3, { cancel: vi.fn() })
    expect(ersteAbbrechen).toHaveBeenCalled()
    expect(queue.anzahlLaufend).toBe(2)
  })

  it('haelt die Grenze auch ueber viele Auftraege', () => {
    const queue = new RenderQueue(3)
    for (let i = 0; i < 20; i++) queue.starte(i, { cancel: vi.fn() })
    expect(queue.anzahlLaufend).toBe(3)
  })
})
