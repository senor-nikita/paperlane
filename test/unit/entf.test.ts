import { describe, expect, it } from 'vitest'
import { loeschtDieAnnotation, type EntfEreignis } from '../../src/renderer/src/viewer/entf'

/**
 * Entf in einem Eingabefeld einer Anmerkung: ein Zeichen oder die ganze
 * Anmerkung? Die Anmerkung geht nur weg, wenn Entf kein Zeichen loeschen koennte.
 */
function ereignis(
  text: string,
  von: number,
  bis: number,
  teil: Partial<Omit<EntfEreignis, 'currentTarget'>> = {}
): EntfEreignis {
  return {
    key: 'Delete',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...teil,
    currentTarget: { value: text, selectionStart: von, selectionEnd: bis }
  }
}

describe('loeschtDieAnnotation', () => {
  it('loescht die Anmerkung bei leerem Feld', () => {
    expect(loeschtDieAnnotation(ereignis('', 0, 0))).toBe(true)
  })

  it('loescht die Anmerkung, wenn die Einfuegemarke am Ende steht', () => {
    expect(loeschtDieAnnotation(ereignis('Hallo', 5, 5))).toBe(true)
  })

  it('loescht nur ein Zeichen, wenn rechts der Einfuegemarke noch Text steht', () => {
    expect(loeschtDieAnnotation(ereignis('Hallo', 0, 0))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('Hallo', 3, 3))).toBe(false)
  })

  it('loescht nur die Markierung, wenn Text markiert ist', () => {
    expect(loeschtDieAnnotation(ereignis('Hallo', 0, 5))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('Hallo', 2, 5))).toBe(false)
  })

  it('tut bei einer gehaltenen Taste nichts: Zeichen wegraeumen darf nicht die Anmerkung kosten', () => {
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { repeat: true }))).toBe(false)
  })

  it('ignoriert andere Tasten und Zusatztasten', () => {
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { key: 'Backspace' }))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { key: 'a' }))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { ctrlKey: true }))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { metaKey: true }))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { altKey: true }))).toBe(false)
    expect(loeschtDieAnnotation(ereignis('', 0, 0, { shiftKey: true }))).toBe(false)
  })
})
