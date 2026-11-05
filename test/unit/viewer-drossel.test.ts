import { describe, expect, it } from 'vitest'
import { Drossel } from '../../src/renderer/src/viewer/drossel'

describe('Drossel', () => {
  it('laesst bis zur Grenze sofort durch', async () => {
    const drossel = new Drossel(2)
    await drossel.betritt()
    await drossel.betritt()
    expect(drossel.anzahlLaufend).toBe(2)
    expect(drossel.anzahlWartend).toBe(0)
  })

  // Der eigentliche Zweck: der dritte Auftrag darf pdf.js nicht zusaetzlich
  // beschaeftigen, solange zwei laufen.
  it('laesst darueber hinaus warten', async () => {
    const drossel = new Drossel(1)
    await drossel.betritt()

    let durch = false
    const zweiter = drossel.betritt().then(() => {
      durch = true
    })

    await Promise.resolve()
    expect(durch).toBe(false)
    expect(drossel.anzahlWartend).toBe(1)

    drossel.verlasse()
    await zweiter
    expect(durch).toBe(true)
    expect(drossel.anzahlLaufend).toBe(1)
  })

  it('bedient Wartende in der Reihenfolge ihres Eintreffens', async () => {
    const drossel = new Drossel(1)
    await drossel.betritt()
    const reihenfolge: number[] = []
    const eins = drossel.betritt().then(() => reihenfolge.push(1))
    const zwei = drossel.betritt().then(() => reihenfolge.push(2))

    drossel.verlasse()
    await eins
    drossel.verlasse()
    await zwei
    expect(reihenfolge).toEqual([1, 2])
  })

  // Ein Aufgeben waehrend des Wartens ist der Normalfall: die Miniatur wird
  // weggescrollt, bevor sie an die Reihe kommt. Der Platz muss trotzdem
  // freigegeben werden, sonst steht die Sidebar danach still.
  it('gibt den Platz auch dann frei, wenn der Wartende aufgibt', async () => {
    const drossel = new Drossel(1)
    await drossel.betritt()
    const aufgeber = drossel.betritt().then(() => {
      drossel.verlasse()
    })
    drossel.verlasse()
    await aufgeber
    await drossel.betritt()
    expect(drossel.anzahlLaufend).toBe(1)
  })

  it('faellt nicht unter null', () => {
    const drossel = new Drossel(1)
    drossel.verlasse()
    expect(drossel.anzahlLaufend).toBe(0)
  })

  it('verlangt mindestens einen Platz', () => {
    expect(() => new Drossel(0)).toThrow(/mindestens/)
  })
})
