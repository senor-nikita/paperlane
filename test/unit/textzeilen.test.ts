import { describe, expect, it } from 'vitest'
import {
  beschreibeBericht,
  beschreibeMutation,
  pruefeMutation,
  seiteNachMutation,
  seitenzahlNach,
  type Mutation
} from '../../src/shared/mutation'
import {
  bildeZeilen,
  MAX_ZEILENTEXT,
  pruefeTextZeile,
  vergleichsform,
  zeilenEcken,
  type TextElement,
  type TextZeile
} from '../../src/shared/textzeilen'

/** S6.6b: Zeilen aus pdf.js-Elementen und die Mutation `textErsetzen`. */

const el = (str: string, x: number, y: number, breite: number, groesse = 12): TextElement => ({
  str,
  transform: [groesse, 0, 0, groesse, x, y],
  width: breite
})

describe('bildeZeilen', () => {
  it('fasst Elemente einer Grundlinie mit kleiner Luecke zusammen', () => {
    const zeilen = bildeZeilen([
      el('Hallo', 72, 700, 30),
      el('Welt', 105, 700, 25),
      el('dicht', 130.5, 700, 25)
    ])
    expect(zeilen).toHaveLength(1)
    // 3 pt Luecke > 0,15 em: ein Leerzeichen; 0,5 pt: keins.
    expect(zeilen[0]?.text).toBe('Hallo Weltdicht')
    expect(zeilen[0]?.von).toBe(72)
    expect(zeilen[0]?.bis).toBe(155.5)
  })

  it('trennt Spalten auf derselben Grundlinie und sortiert von oben nach unten', () => {
    const zeilen = bildeZeilen([
      el('unten', 72, 600, 30),
      el('rechts', 300, 700, 30),
      el('links', 72, 700, 30),
      el('   ', 200, 700, 5)
    ])
    expect(zeilen.map((z) => z.text)).toEqual(['links', 'rechts', 'unten'])
  })

  it('kleine Grundlinienabweichung bleibt dieselbe Zeile, gedrehter Text eine eigene', () => {
    const gedreht: TextElement = { str: 'hoch', transform: [0, 12, -12, 0, 560, 300], width: 30 }
    const zeilen = bildeZeilen([el('a', 72, 700, 6), el('b', 79, 701, 6), gedreht])
    expect(zeilen.map((z) => [z.text, z.winkel])).toEqual([
      ['ab', 0],
      ['hoch', 90]
    ])
    const hoch = zeilen[1] as TextZeile
    expect(hoch.dx).toBeCloseTo(0)
    expect(hoch.dy).toBeCloseTo(1)
    expect(hoch.grundlinie).toBeCloseTo(-560)
    expect(hoch.von).toBeCloseTo(300)
  })

  it('verwirft Elemente ohne brauchbare Matrix', () => {
    expect(bildeZeilen([{ str: 'x', transform: [0, 0, 0, 0, 1, 1], width: 1 }])).toEqual([])
    expect(bildeZeilen([{ str: 'x', transform: [1, 0], width: 1 }])).toEqual([])
    expect(
      bildeZeilen([{ str: 'x', transform: [12, 0, 0, 12, 1, 1], width: Number.NaN }])[0]?.bis
    ).toBe(1)
    expect(
      bildeZeilen([{ str: 'x', transform: [-12, 0, 0, -12, 1, 1], width: 3 }])[0]?.winkel
    ).toBe(180)
  })
})

describe('vergleichsform und zeilenEcken', () => {
  it('Ligaturen aufgeloest, Leerraum weg', () => {
    expect(vergleichsform('ﬁnden  und­\nweiter')).toBe('findenundweiter')
  })

  it('Ecken einer waagerechten Zeile', () => {
    const [z] = bildeZeilen([el('x', 10, 100, 50, 20)])
    expect(zeilenEcken(z as TextZeile)).toEqual([
      [10, 95],
      [60, 95],
      [60, 120],
      [10, 120]
    ])
  })
})

const ZEILE: TextZeile = {
  winkel: 0,
  dx: 1,
  dy: 0,
  grundlinie: 700,
  von: 72,
  bis: 200,
  groesse: 12,
  text: 'Hallo'
}

describe('pruefeTextZeile', () => {
  it('nimmt eine gueltige Zeile', () => {
    expect(pruefeTextZeile(ZEILE)).toEqual(ZEILE)
  })

  it('lehnt Kaputtes ab', () => {
    for (const falsch of [
      null,
      'x',
      { ...ZEILE, dx: 0.5 },
      { ...ZEILE, groesse: 0 },
      { ...ZEILE, bis: 10 },
      { ...ZEILE, von: Number.NaN },
      { ...ZEILE, text: '' },
      { ...ZEILE, text: 'x'.repeat(MAX_ZEILENTEXT + 1) },
      { ...ZEILE, winkel: '0' }
    ]) {
      expect(pruefeTextZeile(falsch)).toBeNull()
    }
  })
})

describe('Mutation textErsetzen', () => {
  const mutation: Mutation = { art: 'textErsetzen', seite: 2, zeile: ZEILE, text: 'Neu' }

  it('wird geprueft', () => {
    expect(pruefeMutation(mutation)).toEqual(mutation)
    expect(pruefeMutation({ ...mutation, text: '' })).toEqual({ ...mutation, text: '' })
    expect(pruefeMutation({ ...mutation, text: 'a\nb' })).toBeNull()
    expect(pruefeMutation({ ...mutation, text: 'a\u007fb' })).toBeNull()
    expect(pruefeMutation({ ...mutation, text: 5 })).toBeNull()
    expect(pruefeMutation({ ...mutation, text: 'x'.repeat(MAX_ZEILENTEXT + 1) })).toBeNull()
    expect(pruefeMutation({ ...mutation, seite: 0 })).toBeNull()
    expect(pruefeMutation({ ...mutation, seite: 1.5 })).toBeNull()
    expect(pruefeMutation({ ...mutation, zeile: { ...ZEILE, dy: 3 } })).toBeNull()
  })

  it('Beschreibung, Seitenzahl, Ansicht', () => {
    expect(beschreibeMutation(mutation)).toBe('Zeile ersetzen (Seite 2)')
    expect(beschreibeMutation({ ...mutation, text: ' ' })).toBe('Zeile löschen (Seite 2)')
    expect(seitenzahlNach(5, mutation)).toBe(5)
    expect(seiteNachMutation(3, mutation, 5)).toBe(3)
  })

  it('Bericht', () => {
    expect(beschreibeBericht({ schrift: 'original' })).toBe('Originalschrift benutzt')
    expect(beschreibeBericht({ schrift: 'keine' })).toBe('Text aus dem Seiteninhalt entfernt')
    expect(
      beschreibeBericht({ schrift: 'ersatz', ersatzschrift: 'Helvetica', grund: 'Glyph fehlt: 7' })
    ).toBe('Ersatzschrift Helvetica benutzt – Originalschrift reicht nicht: Glyph fehlt: 7')
    expect(beschreibeBericht({ schrift: 'ersatz', ersatzschrift: 'Times-Roman' })).toBe(
      'Ersatzschrift Times-Roman benutzt'
    )
  })
})
