import { beforeEach, describe, expect, it } from 'vitest'
import { useSeitenauswahl } from '../../src/renderer/src/seitenauswahl-store'

/** Die Mehrfachauswahl (S4.1) - Dateimanager-Regeln. */
const sortiert = (): number[] => [...useSeitenauswahl.getState().ausgewaehlt].sort((a, b) => a - b)

beforeEach(() => {
  useSeitenauswahl.getState().leere()
})

describe('Seitenauswahl', () => {
  it('waehlt mit Klick genau eine Seite und setzt den Anker', () => {
    useSeitenauswahl.getState().klick(3, { strg: false, umschalt: false })
    useSeitenauswahl.getState().klick(5, { strg: false, umschalt: false })
    expect(sortiert()).toEqual([5])
    expect(useSeitenauswahl.getState().anker).toBe(5)
  })

  it('schaltet mit Strg um', () => {
    const k = useSeitenauswahl.getState().klick
    k(3, { strg: false, umschalt: false })
    k(7, { strg: true, umschalt: false })
    expect(sortiert()).toEqual([3, 7])
    k(3, { strg: true, umschalt: false })
    expect(sortiert()).toEqual([7])
  })

  it('waehlt mit Umschalt den Bereich vom Anker, mit Strg zusaetzlich', () => {
    const k = useSeitenauswahl.getState().klick
    k(4, { strg: false, umschalt: false })
    k(7, { strg: false, umschalt: true })
    expect(sortiert()).toEqual([4, 5, 6, 7])
    k(2, { strg: false, umschalt: true })
    expect(sortiert()).toEqual([2, 3, 4])
    k(9, { strg: true, umschalt: true })
    expect(sortiert()).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('verhaelt sich ohne Anker bei Umschalt wie ein Klick', () => {
    useSeitenauswahl.getState().klick(6, { strg: false, umschalt: true })
    expect(sortiert()).toEqual([6])
  })

  it('laesst sich direkt setzen und leeren', () => {
    useSeitenauswahl.getState().setze([9, 2])
    expect(sortiert()).toEqual([2, 9])
    expect(useSeitenauswahl.getState().anker).toBe(9)
    useSeitenauswahl.getState().leere()
    expect(sortiert()).toEqual([])
    expect(useSeitenauswahl.getState().anker).toBeNull()
  })
})
