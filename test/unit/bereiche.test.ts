import { describe, expect, it } from 'vitest'
import { bereicheJeSeitenzahl, formatiereBereiche, parseBereiche } from '../../src/shared/bereiche'

/** Die getippten Seitenbereiche fuer das Teilen (S4.2a). */
describe('parseBereiche', () => {
  it('liest Einzelseiten und Bereiche, mit Komma oder Semikolon', () => {
    expect(parseBereiche('1-3, 5;7 - 9', 10)).toEqual({
      ok: true,
      bereiche: [
        [1, 3],
        [5, 5],
        [7, 9]
      ]
    })
  })

  it('erlaubt Ueberlappungen und beliebige Reihenfolge', () => {
    expect(parseBereiche('5, 1-6', 10)).toEqual({
      ok: true,
      bereiche: [
        [5, 5],
        [1, 6]
      ]
    })
  })

  it('nennt den Grund, wenn etwas nicht stimmt', () => {
    expect(parseBereiche('', 10)).toMatchObject({ ok: false, grund: /Bitte Seiten/ })
    expect(parseBereiche('a-b', 10)).toMatchObject({ ok: false, grund: /kein Seitenbereich/ })
    expect(parseBereiche('3-1', 10)).toMatchObject({ ok: false, grund: /nicht groesser/ })
    expect(parseBereiche('0', 10)).toMatchObject({ ok: false, grund: /ab 1/ })
    expect(parseBereiche('9-12', 10)).toMatchObject({ ok: false, grund: /10 Seiten/ })
    expect(parseBereiche('1--3', 10)).toMatchObject({ ok: false })
  })

  it('teilt nach Seitenzahl, die letzte Datei mit dem Rest', () => {
    expect(bereicheJeSeitenzahl('5', 12)).toEqual({
      ok: true,
      bereiche: [
        [1, 5],
        [6, 10],
        [11, 12]
      ]
    })
  })

  it('teilt ohne Rest, wenn die Zahl aufgeht', () => {
    expect(bereicheJeSeitenzahl(' 3 ', 9)).toEqual({
      ok: true,
      bereiche: [
        [1, 3],
        [4, 6],
        [7, 9]
      ]
    })
  })

  it('teilt je eine Seite bei 1', () => {
    expect(bereicheJeSeitenzahl('1', 3)).toEqual({
      ok: true,
      bereiche: [
        [1, 1],
        [2, 2],
        [3, 3]
      ]
    })
  })

  it.each([[''], ['0'], ['-2'], ['2,5'], ['abc'], ['3 Seiten']])(
    'lehnt "%s" als Seitenzahl ab',
    (text) => {
      expect(bereicheJeSeitenzahl(text, 10)).toMatchObject({ ok: false })
    }
  )

  it('lehnt eine Zahl ab der Seitenzahl ab: das waere nur eine Datei', () => {
    expect(bereicheJeSeitenzahl('10', 10)).toMatchObject({ ok: false })
    expect(bereicheJeSeitenzahl('11', 10)).toMatchObject({ ok: false })
    expect(bereicheJeSeitenzahl('9', 10)).toMatchObject({ ok: true })
  })

  it('formatiert zurueck in die Kurzform', () => {
    expect(
      formatiereBereiche([
        [1, 3],
        [5, 5]
      ])
    ).toBe('1-3, 5')
  })
})
