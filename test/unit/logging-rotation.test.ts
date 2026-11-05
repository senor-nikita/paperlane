import { describe, expect, it } from 'vitest'
import { planeRotation } from '../../src/main/logging/rotation'

const BASIS = 'C:/logs/app.log'

describe('planeRotation', () => {
  it.each([
    [0, false],
    [999, false],
    [1000, true],
    [5000, true]
  ])('bei Groesse %i rotieren: %s', (groesse, erwartet) => {
    expect(planeRotation(BASIS, groesse, 1000, 3).rotieren).toBe(erwartet)
  })

  it('verschiebt von hinten nach vorne', () => {
    // Andersherum wuerde jede Verschiebung die naechste ueberschreiben.
    const plan = planeRotation(BASIS, 2000, 1000, 3)
    expect(plan.verschieben).toEqual([
      { von: BASIS + '.2', nach: BASIS + '.3' },
      { von: BASIS + '.1', nach: BASIS + '.2' },
      { von: BASIS, nach: BASIS + '.1' }
    ])
  })

  it('loescht das aelteste Archiv', () => {
    expect(planeRotation(BASIS, 2000, 1000, 3).loeschen).toEqual([BASIS + '.3'])
  })

  it('loescht ohne Archive die Datei selbst', () => {
    const plan = planeRotation(BASIS, 2000, 1000, 0)
    expect(plan.loeschen).toEqual([BASIS])
    expect(plan.verschieben).toEqual([])
  })
})
