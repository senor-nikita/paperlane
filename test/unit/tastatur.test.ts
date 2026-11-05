import { describe, expect, it } from 'vitest'
import {
  beschreibeBefehl,
  FENSTER_SCHLIESSEN,
  KUERZEL,
  findeBefehl,
  findeKuerzel,
  type TastenEreignis
} from '../../src/shared/tastatur'

const ereignis = (teil: Partial<TastenEreignis>): TastenEreignis => ({
  key: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...teil
})

describe('KUERZEL', () => {
  // Das Menue zeigt je Befehl einen Accelerator; weitere Belegungen sind als
  // Zweitbelegung markiert (S6.1b) und haben immer eine Hauptbelegung.
  it('vergibt jedem Befehl genau eine Hauptbelegung', () => {
    const befehle = KUERZEL.filter((k) => !k.zweitbelegung).map((k) => k.befehl)
    expect(new Set(befehle).size).toBe(befehle.length)
    for (const zweit of KUERZEL.filter((k) => k.zweitbelegung)) {
      expect(befehle).toContain(zweit.befehl)
    }
  })

  it('gibt jedem Kuerzel eine Beschreibung und einen Accelerator', () => {
    for (const kuerzel of KUERZEL) {
      expect(beschreibeBefehl(kuerzel.befehl).length).toBeGreaterThan(0)
      expect(kuerzel.accelerator.length).toBeGreaterThan(0)
    }
  })

  it('vergibt keine Tastenkombination doppelt', () => {
    const kombinationen = KUERZEL.map(
      (k) => k.taste + '|' + String(k.strg) + '|' + String(k.umschalt)
    )
    expect(new Set(kombinationen).size).toBe(kombinationen.length)
  })

  /**
   * Stuende hier ein Eintrag fuer Strg+C, faenge findeBefehl den Tastendruck ab
   * und das preventDefault in App.tsx machte das native Kopieren wirkungslos —
   * genau der Fehler, den S1.3b behebt (ADR 0002).
   */
  it('enthaelt keinen Befehl, den Electron als Rolle erledigt', () => {
    const rollenTasten = ['c', 'v', 'x', 'a', 'q']
    const treffer = KUERZEL.filter((k) => k.strg && rollenTasten.includes(k.taste))
    expect(treffer.map((k) => k.befehl)).toEqual([])
  })

  // Strg+W gehoert seit S6.1b dem Tab; die Rolle `close` liegt auf
  // Strg+Umschalt+W, und das darf kein Kuerzel der Map belegen - sonst fingen
  // Fenster und Rolle denselben Tastendruck.
  it('laesst Strg+Umschalt+W der Rolle close', () => {
    expect(findeBefehl(ereignis({ key: 'w', ctrlKey: true }))).toBe('tabSchliessen')
    expect(findeBefehl(ereignis({ key: 'w', ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(FENSTER_SCHLIESSEN.accelerator).toBe('CommandOrControl+Shift+W')
  })
})

describe('findeKuerzel', () => {
  it('liefert den Eintrag zum Befehl', () => {
    expect(findeKuerzel('suchen').accelerator).toBe('CommandOrControl+F')
  })

  it('liefert bei zwei Belegungen die Hauptbelegung', () => {
    expect(findeKuerzel('tabZurueck').accelerator).toBe('CommandOrControl+Shift+Tab')
    expect(findeKuerzel('tabZurueck').zweitbelegung).toBe(false)
  })

  // Ein leerer Accelerator faellt im Menue niemandem auf, ein Fehler hier schon.
  it('wirft bei einem unbekannten Befehl', () => {
    expect(() => findeKuerzel('gibtEsNicht' as never)).toThrow(/Kein Kuerzel/)
  })
})

describe('findeBefehl', () => {
  it.each([
    [{ key: 'PageDown' }, 'seiteVor'],
    [{ key: 'PageUp' }, 'seiteZurueck'],
    [{ key: 'Home' }, 'anfang'],
    [{ key: 'End' }, 'ende'],
    [{ key: 'o', ctrlKey: true }, 'oeffnen'],
    [{ key: '0', ctrlKey: true }, 'zoomZuruecksetzen'],
    [{ key: '1', ctrlKey: true }, 'passungBreite'],
    [{ key: 'g', ctrlKey: true }, 'zuSeiteSpringen']
  ])('erkennt %o als %s', (teil, erwartet) => {
    expect(findeBefehl(ereignis(teil))).toBe(erwartet)
  })

  // Ohne Beachtung der Umschalttaste faengt Strg+R auch Strg+Umschalt+R und
  // dreht dann in die falsche Richtung.
  it('unterscheidet Drehrichtungen ueber die Umschalttaste', () => {
    expect(findeBefehl(ereignis({ key: 'r', ctrlKey: true }))).toBe('drehenRechts')
    expect(findeBefehl(ereignis({ key: 'r', ctrlKey: true, shiftKey: true }))).toBe('drehenLinks')
  })

  it('behandelt die Befehlstaste wie Strg', () => {
    expect(findeBefehl(ereignis({ key: 'o', metaKey: true }))).toBe('oeffnen')
  })

  it('ignoriert unbekannte Tasten', () => {
    expect(findeBefehl(ereignis({ key: 'q' }))).toBeNull()
    expect(findeBefehl(ereignis({ key: 'Tab' }))).toBeNull()
  })

  // S6.1b: zwei Belegungen je Richtung, wie im Browser.
  it.each([
    [{ key: 'Tab', ctrlKey: true }, 'tabVor'],
    [{ key: 'PageDown', ctrlKey: true }, 'tabVor'],
    [{ key: 'Tab', ctrlKey: true, shiftKey: true }, 'tabZurueck'],
    [{ key: 'PageUp', ctrlKey: true }, 'tabZurueck'],
    [{ key: 'w', ctrlKey: true }, 'tabSchliessen']
  ])('erkennt %o als Tab-Befehl %s', (teil, erwartet) => {
    expect(findeBefehl(ereignis(teil))).toBe(erwartet)
  })

  // Ohne Strg blaettern Bild-ab/-auf weiter die Seite.
  it('laesst Bild-ab ohne Strg beim Blaettern', () => {
    expect(findeBefehl(ereignis({ key: 'PageDown' }))).toBe('seiteVor')
    expect(findeBefehl(ereignis({ key: 'PageUp' }))).toBe('seiteZurueck')
  })
})
