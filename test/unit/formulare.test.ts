import { describe, expect, it } from 'vitest'
import {
  AUS,
  datumsmuster,
  erkenneFormat,
  istLeer,
  pruefeWert,
  wertGleich,
  type Formularfeld
} from '../../src/shared/formulare'

/**
 * Das Formularmodell (S3.1) — vor allem die deklarative Pruefung.
 *
 * Kern des Schrittes ist Aufgabe 4: Validierung ohne ein einziges Skript
 * auszufuehren. Die AF-Standardaufrufe werden wiedererkannt, alles
 * andere ergibt "skript" und damit kein Urteil.
 */
function feld(teile: Partial<Formularfeld> = {}): Formularfeld {
  return {
    id: '11R',
    name: 'feld',
    art: 'text',
    seite: 1,
    rect: [0, 0, 100, 20],
    schreibgeschuetzt: false,
    pflicht: false,
    versteckt: false,
    maxLaenge: null,
    mehrzeilig: false,
    passwort: false,
    exportwert: null,
    optionen: [],
    kombiniert: false,
    mehrfach: false,
    format: null,
    ausgangswert: '',
    hilfetext: null,
    ...teile
  }
}

describe('erkenneFormat', () => {
  it('liefert ohne Skripte nichts', () => {
    expect(erkenneFormat([])).toBeNull()
  })

  it('erkennt AFNumber_Format mit Nachkommastellen', () => {
    expect(erkenneFormat(['AFNumber_Format(2, 0, 0, 0, "", true);'])).toEqual({
      art: 'zahl',
      nachkommastellen: 2
    })
  })

  it('erkennt das Tastendruck-Gegenstueck als dieselbe Regel', () => {
    expect(
      erkenneFormat([
        'AFNumber_Format(0, 0, 0, 0, "", true);',
        'AFNumber_Keystroke(0, 0, 0, 0, "", true);'
      ])
    ).toEqual({ art: 'zahl', nachkommastellen: 0 })
  })

  it('erkennt AFPercent_Format als Zahl', () => {
    expect(erkenneFormat(['AFPercent_Format(1, 0);'])).toEqual({ art: 'zahl', nachkommastellen: 1 })
  })

  it('erkennt AFDate_FormatEx mit seinem Muster', () => {
    expect(erkenneFormat(['AFDate_FormatEx("dd.mm.yyyy");'])).toEqual({
      art: 'datum',
      muster: 'dd.mm.yyyy'
    })
  })

  it('nimmt fuer den numerischen Kurzaufruf ein deutsches Muster an', () => {
    expect(erkenneFormat(['AFDate_Format(2);'])).toEqual({ art: 'datum', muster: 'dd.mm.yyyy' })
  })

  /**
   * Die Regel, die Invariante 6 traegt: was nicht wiedererkannt wird, wird
   * nicht geraten. Ein Feld mit einem einzigen fremden Skript ist ein
   * Skriptfeld - auch wenn daneben ein bekannter Aufruf steht.
   */
  it('stuft ein fremdes Skript als skript ein', () => {
    expect(erkenneFormat(['if (event.value.length < 3) app.alert("zu kurz");'])).toEqual({
      art: 'skript'
    })
  })

  it('laesst ein fremdes Skript ueber einen bekannten Aufruf gewinnen', () => {
    expect(erkenneFormat(['AFNumber_Format(2, 0, 0, 0, "", true);', 'app.beep();'])).toEqual({
      art: 'skript'
    })
  })
})

describe('datumsmuster', () => {
  it.each([
    ['dd.mm.yyyy', '03.09.2026', true],
    ['dd.mm.yyyy', '3.9.2026', false],
    ['d.m.yyyy', '3.9.2026', true],
    ['yyyy-mm-dd', '2026-09-03', true],
    ['yyyy-mm-dd', '2026/09/03', false],
    ['mm/dd/yy', '09/03/26', true],
    ['dd.mm.yyyy HH:MM', '03.09.2026 14:05', true]
  ])('%s prueft %s als %s', (muster, eingabe, erwartet) => {
    expect(datumsmuster(muster).test(eingabe)).toBe(erwartet)
  })

  it('maskiert Sonderzeichen im Muster', () => {
    expect(datumsmuster('dd (mm) yyyy').test('03 (09) 2026')).toBe(true)
  })
})

describe('istLeer', () => {
  it.each([
    ['', true],
    ['   ', true],
    [AUS, true],
    ['x', false],
    [false, true],
    [true, false],
    [[], true],
    [['a'], false]
  ])('%o ist leer: %s', (wert, erwartet) => {
    expect(istLeer(wert)).toBe(erwartet)
  })
})

describe('pruefeWert', () => {
  it('laesst ein freies Feld in Ruhe', () => {
    expect(pruefeWert(feld(), '')).toBeNull()
    expect(pruefeWert(feld(), 'irgendwas')).toBeNull()
  })

  /** Exit-Kriterium: die Pflichtfeldpruefung greift. */
  it('meldet ein leeres Pflichtfeld', () => {
    expect(pruefeWert(feld({ pflicht: true }), '')).toBe('Pflichtfeld')
    expect(pruefeWert(feld({ pflicht: true }), '  ')).toBe('Pflichtfeld')
    expect(pruefeWert(feld({ pflicht: true }), 'x')).toBeNull()
  })

  it('meldet ein Pflicht-Kontrollkaestchen, das nicht angekreuzt ist', () => {
    expect(pruefeWert(feld({ art: 'kontrollkaestchen', pflicht: true }), false)).toBe('Pflichtfeld')
    expect(pruefeWert(feld({ art: 'kontrollkaestchen', pflicht: true }), true)).toBeNull()
  })

  it('meldet eine Pflicht-Gruppe ohne Wahl', () => {
    expect(pruefeWert(feld({ art: 'auswahlknopf', pflicht: true }), AUS)).toBe('Pflichtfeld')
    expect(pruefeWert(feld({ art: 'auswahlknopf', pflicht: true }), 'frau')).toBeNull()
  })

  it('haelt die Hoechstlaenge ein', () => {
    expect(pruefeWert(feld({ maxLaenge: 3 }), 'abcd')).toBe('Höchstens 3 Zeichen')
    expect(pruefeWert(feld({ maxLaenge: 3 }), 'abc')).toBeNull()
  })

  it('prueft eine Zahl mit Komma oder Punkt', () => {
    const zahl = feld({ format: { art: 'zahl', nachkommastellen: 2 } })
    expect(pruefeWert(zahl, '12,50')).toBeNull()
    expect(pruefeWert(zahl, '12.50')).toBeNull()
    expect(pruefeWert(zahl, '-3')).toBeNull()
    expect(pruefeWert(zahl, 'zwoelf')).toBe('Bitte eine Zahl eingeben')
  })

  it('prueft ein Datum gegen sein Muster', () => {
    const datum = feld({ format: { art: 'datum', muster: 'dd.mm.yyyy' } })
    expect(pruefeWert(datum, '03.09.2026')).toBeNull()
    expect(pruefeWert(datum, '2026-09-03')).toBe('Datum im Format dd.mm.yyyy')
  })

  // Leer ist nicht falsch: ein Format sagt, wie etwas auszusehen hat, wenn
  // etwas dasteht. Ob etwas dastehen muss, sagt allein `pflicht`.
  it('laesst ein leeres Feld mit Format durch', () => {
    expect(pruefeWert(feld({ format: { art: 'zahl', nachkommastellen: 0 } }), '')).toBeNull()
  })

  /** Kein Urteil ohne Grundlage: was das Skript wollte, weiss niemand. */
  it('gibt bei einem Skriptfeld kein Urteil ab', () => {
    expect(pruefeWert(feld({ format: { art: 'skript' } }), 'x')).toBeNull()
    expect(pruefeWert(feld({ format: { art: 'skript' } }), '')).toBeNull()
  })

  it('prueft die Pflicht auch bei einem Skriptfeld', () => {
    expect(pruefeWert(feld({ format: { art: 'skript' }, pflicht: true }), '')).toBe('Pflichtfeld')
  })
})

describe('wertGleich', () => {
  it('vergleicht Zeichenketten und Wahrheitswerte direkt', () => {
    expect(wertGleich('a', 'a')).toBe(true)
    expect(wertGleich('a', 'b')).toBe(false)
    expect(wertGleich(true, true)).toBe(true)
    expect(wertGleich(true, 'true')).toBe(false)
  })

  it('vergleicht Listen inhaltlich', () => {
    expect(wertGleich(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(wertGleich(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(wertGleich([], [])).toBe(true)
    expect(wertGleich(['a'], 'a')).toBe(false)
  })
})
