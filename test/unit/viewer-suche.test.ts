import { describe, expect, it } from 'vitest'
import {
  baueSeitentext,
  findeTreffer,
  normalisiere,
  zerlegeAufElemente,
  type Suchoptionen,
  type Textelement
} from '../../src/renderer/src/viewer/suche'

const STANDARD: Suchoptionen = { achteAufGrossschreibung: false, nurGanzeWoerter: false }

const elemente = (...teile: (string | [string, boolean])[]): Textelement[] =>
  teile.map((teil) =>
    typeof teil === 'string' ? { str: teil } : { str: teil[0], hasEOL: teil[1] }
  )

describe('baueSeitentext', () => {
  it('haengt Elemente ohne Trenner zusammen', () => {
    expect(baueSeitentext(elemente('Wasser', 'zeichen')).roh).toBe('Wasserzeichen')
  })

  // Ohne dieses Leerzeichen verschmilzt das letzte Wort einer Zeile mit dem
  // ersten der naechsten zu einem Phantomwort.
  it('setzt nach einem Zeilenumbruch ein Leerzeichen', () => {
    expect(baueSeitentext(elemente(['Erste', true], 'Zweite')).roh).toBe('Erste Zweite')
  })

  it('merkt sich den Startoffset jedes Elements', () => {
    expect(baueSeitentext(elemente('ab', 'cde')).starts).toEqual([0, 2])
  })
})

describe('normalisiere', () => {
  it('schreibt klein, wenn Grossschreibung egal ist', () => {
    expect(normalisiere('ABC', false).text).toBe('abc')
  })

  it('laesst die Schreibweise stehen, wenn sie zaehlt', () => {
    expect(normalisiere('ABC', true).text).toBe('ABC')
  })

  // Eine Ligatur wird zu zwei Zeichen. Ohne die Rueckabbildung saessen die
  // Trefferrechtecke danach daneben.
  it('loest Ligaturen auf und merkt sich die Herkunft', () => {
    const ergebnis = normalisiere('\uFB01nden', false)
    expect(ergebnis.text).toBe('finden')
    expect(ergebnis.zuRoh).toEqual([0, 0, 1, 2, 3, 4])
  })
})

describe('findeTreffer', () => {
  it('findet einen Treffer innerhalb eines Elements', () => {
    const text = baueSeitentext(elemente('Hier steht Wasserzeichen.'))
    expect(findeTreffer(text, 'Wasserzeichen', STANDARD)).toEqual([{ von: 11, bis: 24 }])
  })

  // Der eigentliche Zweck: pdf.js zerlegt Woerter mitten drin.
  it('findet einen Treffer ueber Elementgrenzen hinweg', () => {
    const text = baueSeitentext(elemente('Wasser', 'zeichen'))
    expect(findeTreffer(text, 'Wasserzeichen', STANDARD)).toEqual([{ von: 0, bis: 13 }])
  })

  it('findet ueber eine Ligatur hinweg', () => {
    const text = baueSeitentext(elemente('Wir \uFB01nden es'))
    expect(findeTreffer(text, 'finden', STANDARD)).toHaveLength(1)
  })

  it('findet mehrere Treffer', () => {
    const text = baueSeitentext(elemente('aha aha aha'))
    expect(findeTreffer(text, 'aha', STANDARD)).toHaveLength(3)
  })

  it('achtet auf Wunsch auf Grossschreibung', () => {
    const text = baueSeitentext(elemente('Haus haus'))
    expect(findeTreffer(text, 'Haus', STANDARD)).toHaveLength(2)
    expect(findeTreffer(text, 'Haus', { ...STANDARD, achteAufGrossschreibung: true })).toHaveLength(
      1
    )
  })

  it('begrenzt auf ganze Woerter', () => {
    const text = baueSeitentext(elemente('Haus Hausboot'))
    expect(findeTreffer(text, 'Haus', STANDARD)).toHaveLength(2)
    expect(findeTreffer(text, 'Haus', { ...STANDARD, nurGanzeWoerter: true })).toHaveLength(1)
  })

  it('findet ueberlappende Vorkommen', () => {
    const text = baueSeitentext(elemente('aaaa'))
    expect(findeTreffer(text, 'aa', STANDARD)).toHaveLength(3)
  })

  it.each([[''], ['   x   ']])('liefert bei %o nichts Unerwartetes', (begriff) => {
    const text = baueSeitentext(elemente('abc'))
    expect(findeTreffer(text, begriff, STANDARD)).toEqual([])
  })
})

describe('zerlegeAufElemente', () => {
  it('verteilt einen Treffer auf die beteiligten Elemente', () => {
    const teile = elemente('Wasser', 'zeichen')
    const text = baueSeitentext(teile)
    const [treffer] = findeTreffer(text, 'Wasserzeichen', STANDARD)
    expect(zerlegeAufElemente(text, teile, treffer!)).toEqual([
      { element: 0, von: 0, bis: 6 },
      { element: 1, von: 0, bis: 7 }
    ])
  })

  it('schneidet innerhalb eines Elements genau zu', () => {
    const teile = elemente('Das Wasserzeichen hier')
    const text = baueSeitentext(teile)
    const [treffer] = findeTreffer(text, 'Wasser', STANDARD)
    expect(zerlegeAufElemente(text, teile, treffer!)).toEqual([{ element: 0, von: 4, bis: 10 }])
  })

  it('laesst unbeteiligte Elemente aus', () => {
    const teile = elemente('vorne', 'Treffer', 'hinten')
    const text = baueSeitentext(teile)
    const [treffer] = findeTreffer(text, 'Treffer', STANDARD)
    expect(zerlegeAufElemente(text, teile, treffer!).map((b) => b.element)).toEqual([1])
  })
})
