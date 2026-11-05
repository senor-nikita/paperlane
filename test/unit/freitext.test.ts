import { PDFContext, PDFDocument, PDFName, PDFStream, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  erscheinungFuer,
  inhaltFuer,
  SCHRIFT_NAME,
  zeilenUmbrechen,
  type Schrift
} from '../../src/main/erscheinungsbild'
import {
  daSchriftname,
  nichtDarstellbareZeichen,
  normalisiereZeichen,
  pruefeFreitextZeichensatz,
  schluesselFuer,
  schriftSchluessel,
  standardSchriftname
} from '../../src/main/freitext-schriften'
import {
  qAusAusrichtung,
  ausrichtungAusQ,
  STANDARD_SCHRIFTGROESSE
} from '../../src/shared/freitext'
import type { Annotation } from '../../src/shared/annotations'
import { erzeugeFreitext } from '../../src/renderer/src/viewer/erzeugen'
import { wandleAnnotation } from '../../src/renderer/src/viewer/annotationen'

/**
 * S6.5 — Text hinzufuegen: Modell, Zeilenumbruch/Ausrichtung im
 * Appearance-Stream, Zeichensatzpruefung.
 *
 * Wie in erscheinungsbild.test.ts: hier steht **warum** der Strom so
 * entsteht, nicht **dass** er in einem Fremdbetrachter sichtbar ist — das
 * uebernimmt test/e2e/appearance.chrome.spec.ts.
 */

function annotation(teile: Partial<Annotation> & Pick<Annotation, 'typ'>): Annotation {
  return {
    id: 'neu-1',
    seite: 1,
    subtyp: teile.typ,
    rect: [100, 700, 300, 740],
    quadPoints: null,
    striche: null,
    farbe: { r: 10, g: 20, b: 30 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: '',
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: null,
    ...teile
  }
}

/** Jedes Zeichen genau ein Punkt breit je Punkt Schriftgroesse — leicht nachzurechnen. */
const schrift: Schrift = {
  breiteVon: (text, groesse) => text.length * groesse,
  kodiere: (text) => '(' + text + ')'
}

describe('zeilenUmbrechen', () => {
  it('bricht an vorhandenen Zeilenumbruechen', () => {
    expect(zeilenUmbrechen('eins\nzwei', schrift, 1, 1000)).toEqual(['eins', 'zwei'])
  })

  it('bricht gierig nach Woertern um, wenn die Breite nicht reicht', () => {
    // Bei groesse=1 ist jedes Zeichen 1pt breit; maxBreite=7 erlaubt "aa bb"
    // (5 Zeichen) aber nicht mehr "cc" dazu (8 Zeichen).
    expect(zeilenUmbrechen('aa bb cc', schrift, 1, 7)).toEqual(['aa bb', 'cc'])
  })

  it('bricht ein einzelnes zu breites Wort zeichenweise, statt haengenzubleiben', () => {
    const zeilen = zeilenUmbrechen('abcdefghij', schrift, 1, 3)
    expect(zeilen.join('')).toBe('abcdefghij')
    expect(zeilen.every((zeile) => zeile.length <= 3)).toBe(true)
  })

  it('behandelt leere Zeilen als eigenen Absatz', () => {
    expect(zeilenUmbrechen('eins\n\nzwei', schrift, 1, 1000)).toEqual(['eins', '', 'zwei'])
  })

  it('kommt ohne Umbruch aus, wenn maxBreite 0 oder negativ ist', () => {
    // Ein Rechteck ohne Breite (Groesse noch nicht gezogen): keine
    // Endlosschleife, ein einzelnes Wort bleibt ganz.
    expect(zeilenUmbrechen('ein wort', schrift, 1, 0)).toEqual(['ein wort'])
  })
})

describe('FreeText im Erscheinungsbild', () => {
  it('erzeugt echte Textoperatoren (BT/Tj/ET), keine Vektorgrafik', () => {
    const a = annotation({ typ: 'FreeText', inhalt: 'Hallo Welt' })
    const strom = inhaltFuer(a, schrift)?.strom ?? ''
    expect(strom).toContain('BT')
    expect(strom).toContain('(Hallo Welt) Tj')
    expect(strom).toContain('ET')
    expect(strom).toContain('/' + SCHRIFT_NAME)
  })

  it('liefert ohne Schrift kein Erscheinungsbild statt einer leeren Flaeche', () => {
    const a = annotation({ typ: 'FreeText', inhalt: 'Text' })
    expect(inhaltFuer(a, null)).toBeNull()
  })

  it('richtet Zeilen nach links, mitte und rechts unterschiedlich aus', () => {
    const basis = annotation({ typ: 'FreeText', inhalt: 'ab', rect: [0, 0, 100, 20] })
    const links = inhaltFuer({ ...basis, ausrichtung: 'links' }, schrift)?.strom ?? ''
    const mitte = inhaltFuer({ ...basis, ausrichtung: 'mitte' }, schrift)?.strom ?? ''
    const rechts = inhaltFuer({ ...basis, ausrichtung: 'rechts' }, schrift)?.strom ?? ''
    const xVon = (strom: string): string => /([\d.-]+) [\d.-]+ Td/.exec(strom)?.[1] ?? ''
    expect(Number(xVon(links))).toBeLessThan(Number(xVon(mitte)))
    expect(Number(xVon(mitte))).toBeLessThan(Number(xVon(rechts)))
  })

  it('setzt mehrere Zeilen mit fallender Grundlinie ab', () => {
    const a = annotation({
      typ: 'FreeText',
      inhalt: 'erste\nzweite',
      rect: [0, 0, 400, 100],
      schriftGroesse: 12
    })
    const strom = inhaltFuer(a, schrift)?.strom ?? ''
    const treffer = [...strom.matchAll(/[\d.-]+ ([\d.-]+) Td/g)].map((m) => Number(m[1]))
    expect(treffer.length).toBe(2)
    expect(treffer[1]).toBeLessThan(treffer[0] ?? 0)
  })

  it('erscheinungFuer loest die Schrift ueber den Nachschlag auf', () => {
    const kontext = PDFContext.create()
    const ref = kontext.register(kontext.obj({}))
    const a = annotation({ typ: 'FreeText', inhalt: 'x' })
    const ap = erscheinungFuer(a, kontext, () => ({ ref, schrift }))
    expect(ap).not.toBeNull()
    const stream = kontext.lookup(ap?.get(PDFName.of('N')), PDFStream)
    expect(String(stream.dict.get(PDFName.of('Resources')))).toContain('/Font')
  })

  it('bekommt ohne aufgeloeste Schrift kein /AP', () => {
    const kontext = PDFContext.create()
    const a = annotation({ typ: 'FreeText', inhalt: 'x' })
    expect(erscheinungFuer(a, kontext, () => null)).toBeNull()
  })
})

describe('Schriftauswahl (D22)', () => {
  it('waehlt je Familie und Stil eine eigene Standard-14-Datei', () => {
    expect(standardSchriftname('Helvetica', false, false)).toBe('Helvetica')
    expect(standardSchriftname('Helvetica', true, false)).toBe('Helvetica-Bold')
    expect(standardSchriftname('Times', false, true)).toBe('Times-Italic')
    expect(standardSchriftname('Courier', true, true)).toBe('Courier-BoldOblique')
  })

  it('vergibt fuer Stempel immer denselben Schluessel', () => {
    const stempel = annotation({ typ: 'Stamp' })
    expect(schluesselFuer(stempel)).toBe(schriftSchluessel('Helvetica', false, false))
  })

  it('vergibt fuer FreeText den Schluessel aus Familie und Stil', () => {
    const a = annotation({ typ: 'FreeText', schriftFamilie: 'Times', schriftFett: true })
    expect(schluesselFuer(a)).toBe(schriftSchluessel('Times', true, false))
  })

  it('hat fuer jede Familie einen /DA-Kurznamen', () => {
    expect(daSchriftname('Helvetica')).toBe('Helv')
    expect(daSchriftname('Times')).toBe('TiRo')
    expect(daSchriftname('Courier')).toBe('Cour')
  })
})

describe('Ausrichtung <-> /Q', () => {
  it('rundet in beide Richtungen', () => {
    expect(qAusAusrichtung('links')).toBe(0)
    expect(qAusAusrichtung('mitte')).toBe(1)
    expect(qAusAusrichtung('rechts')).toBe(2)
    expect(ausrichtungAusQ(0)).toBe('links')
    expect(ausrichtungAusQ(1)).toBe('mitte')
    expect(ausrichtungAusQ(2)).toBe('rechts')
    expect(ausrichtungAusQ(undefined)).toBe('links')
  })
})

/**
 * Aufgabe 4: Zeichen ausserhalb des Zeichensatzes vor dem Speichern melden.
 */
describe('Zeichensatzpruefung', () => {
  it('erkennt Umlaute und das Eurozeichen als darstellbar', () => {
    expect(nichtDarstellbareZeichen('Grösse: 10€ äöüÄÖÜß')).toEqual([])
  })

  it('meldet Zeichen ausserhalb von WinAnsi', () => {
    expect(nichtDarstellbareZeichen('Test 中 ok')).toEqual(['中'])
  })

  it('ignoriert Zeilenumbrueche und Tabulatoren', () => {
    expect(nichtDarstellbareZeichen('eins\nzwei\ttab')).toEqual([])
  })

  it('liefert null, wenn kein FreeText betroffen ist', () => {
    expect(pruefeFreitextZeichensatz([annotation({ typ: 'Stamp', inhalt: '中' })])).toBeNull()
  })

  it('nennt Seite und Zeichen in der Meldung', () => {
    const meldung = pruefeFreitextZeichensatz([
      annotation({ typ: 'FreeText', seite: 3, inhalt: 'Test 中 ok' })
    ])
    expect(meldung).toContain('Seite 3')
    expect(meldung).toContain('中')
  })

  // Review L1: die Meldung empfahl vorher "eine andere Schrift waehlen" -
  // ein falscher Tipp, denn alle drei Standard-14-Familien sind WinAnsi und
  // keine kann zusaetzliche Zeichen darstellen.
  it('empfiehlt keine andere Schrift - alle Standard-14 sind WinAnsi', () => {
    const meldung = pruefeFreitextZeichensatz([
      annotation({ typ: 'FreeText', seite: 1, inhalt: '中' })
    ])
    expect(meldung).not.toMatch(/andere Schrift/)
  })
})

describe('erzeugeFreitext', () => {
  it('setzt ein Feld mit Standardwerten an der angeklickten Stelle', () => {
    const neu = erzeugeFreitext(
      1,
      { x: 50, y: 700 },
      { autor: 'Ada', farbe: '#112233', strichstaerke: 1 }
    )
    expect(neu.typ).toBe('FreeText')
    expect(neu.subtyp).toBe('FreeText')
    expect(neu.rect[0]).toBe(50)
    expect(neu.rect[3]).toBe(700)
    expect(neu.schriftGroesse).toBe(STANDARD_SCHRIFTGROESSE)
    expect(neu.schriftFamilie).toBe('Helvetica')
    expect(neu.ausrichtung).toBe('links')
    expect(neu.inhalt).toBe('')
  })
})

describe('Fremde /FreeText bleiben bearbeitbar (Aufgabe 3)', () => {
  it('liest Schrift, Groesse, Farbe und Ausrichtung aus /DA und /Q', () => {
    const roh = {
      id: '5R',
      subtype: 'FreeText',
      rect: [0, 0, 100, 50],
      annotationFlags: 0,
      contentsObj: { str: 'Fremder Text' },
      defaultAppearanceData: { fontSize: 14, fontName: 'Times-Bold', fontColor: [10, 20, 30] },
      textAlignment: 2
    }
    const annotation = wandleAnnotation(roh, 2)
    expect(annotation).not.toBeNull()
    expect(annotation?.typ).toBe('FreeText')
    expect(annotation?.schriftGroesse).toBe(14)
    expect(annotation?.schriftFamilie).toBe('Times')
    expect(annotation?.schriftFett).toBe(true)
    expect(annotation?.ausrichtung).toBe('rechts')
    expect(annotation?.farbe).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('faellt ohne /DA auf Helvetica in Standardgroesse zurueck', () => {
    const roh = {
      id: '6R',
      subtype: 'FreeText',
      rect: [0, 0, 100, 50],
      annotationFlags: 0
    }
    const annotation = wandleAnnotation(roh, 1)
    expect(annotation?.schriftFamilie).toBe('Helvetica')
    expect(annotation?.schriftGroesse).toBe(STANDARD_SCHRIFTGROESSE)
    expect(annotation?.ausrichtung).toBe('links')
  })
})

/**
 * Gate Phase 6, M4: der Umbruch war quadratisch in der Textlaenge (jedes Wort
 * und jedes Zeichen mass die ganze bisherige Zeile). Ein fremdes `/FreeText`
 * mit langem `/Contents` blockierte so den Main beim Neusetzen des `/AP`.
 */
describe('FreeText-Umbruch: linear und begrenzt (Gate Phase 6, M4)', () => {
  /** Wie eine echte Schrift: die Messung selbst kostet O(Textlaenge). */
  const zaehlend = { zeichen: 0 }
  const messend: Schrift = {
    breiteVon: (text, groesse) => {
      zaehlend.zeichen += text.length
      return text.length * groesse
    },
    kodiere: (text) => '(' + text + ')'
  }

  /** Der bisherige Algorithmus als Referenz fuer das Ergebnis. */
  function alterUmbruch(text: string, s: Schrift, groesse: number, maxBreite: number): string[] {
    const zeilen: string[] = []
    for (const absatz of text.split(/\r\n|\r|\n/)) {
      if (absatz.length === 0) {
        zeilen.push('')
        continue
      }
      let aktuell = ''
      for (const wort of absatz.split(' ')) {
        const kandidat = aktuell.length === 0 ? wort : aktuell + ' ' + wort
        if (maxBreite <= 0 || s.breiteVon(kandidat, groesse) <= maxBreite || aktuell.length === 0) {
          aktuell = kandidat
          continue
        }
        zeilen.push(aktuell)
        aktuell = wort
      }
      if (maxBreite > 0 && s.breiteVon(aktuell, groesse) > maxBreite) {
        let rest = aktuell
        while (rest.length > 0) {
          let stueck = ''
          for (const zeichen of rest) {
            const naechstes = stueck + zeichen
            if (stueck.length > 0 && s.breiteVon(naechstes, groesse) > maxBreite) break
            stueck = naechstes
          }
          if (stueck.length === 0) stueck = rest[0] ?? ''
          zeilen.push(stueck)
          rest = rest.slice(stueck.length)
        }
        continue
      }
      zeilen.push(aktuell)
    }
    return zeilen
  }

  it('gemessene Zeichen wachsen linear mit dem Text (Woerter und ein langes Wort)', () => {
    for (const text of ['wort '.repeat(40_000), 'x'.repeat(200_000)]) {
      zaehlend.zeichen = 0
      const t = performance.now()
      zeilenUmbrechen(text, messend, 1, 5_000)
      expect(zaehlend.zeichen).toBeLessThan(text.length * 10)
      expect(performance.now() - t).toBeLessThan(2000)
    }
  })

  it('bricht nach maxZeilen ab', () => {
    zaehlend.zeichen = 0
    const zeilen = zeilenUmbrechen('a b c d e f g h\n'.repeat(100_000), messend, 1, 3, 5)
    expect(zeilen).toHaveLength(5)
    expect(zaehlend.zeichen).toBeLessThan(1000)
    expect(zeilenUmbrechen('abc', messend, 1, 3, 0)).toEqual([])
  })

  it('liefert dieselben Zeilen wie der alte Umbruch - auch mit Unterschneidung', async () => {
    const doc = await PDFDocument.create()
    const helvetica = await doc.embedFont(StandardFonts.Helvetica)
    const echt: Schrift = {
      breiteVon: (text, groesse) => helvetica.widthOfTextAtSize(text, groesse),
      kodiere: (text) => '(' + text + ')'
    }
    let seed = 7
    const zufall = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const alphabet = 'AVAWTo.,y LTaYv r-Pf  \nWeltwirtschaftsgipfel AV'
    for (let fall = 0; fall < 200; fall++) {
      let text = ''
      const laenge = zufall(120)
      for (let k = 0; k < laenge; k++) text += alphabet[zufall(alphabet.length)]
      const groesse = 6 + zufall(20)
      const breite = zufall(250)
      expect(
        zeilenUmbrechen(text, echt, groesse, breite),
        JSON.stringify([text, groesse, breite])
      ).toEqual(alterUmbruch(text, echt, groesse, breite))
    }
  })

  it('ein FreeText mit einer Million Zeichen setzt nur, was ins Rechteck passt', () => {
    const a = annotation({ typ: 'FreeText', inhalt: 'Wort '.repeat(200_000) })
    zaehlend.zeichen = 0
    const t = performance.now()
    const strom = inhaltFuer(a, messend)?.strom ?? ''
    expect(performance.now() - t).toBeLessThan(2000)
    // 40 pt hohes Rechteck, 12 pt Schrift: eine Handvoll Zeilen.
    expect(strom.split(' Tj').length - 1).toBeLessThan(5)
    expect(zaehlend.zeichen).toBeLessThan(100_000)
  })

  it('daSchriftname nimmt keine Prototyp-Eigenschaften (L2)', () => {
    expect(daSchriftname('constructor' as never)).toBe('Helv')
    expect(daSchriftname('__proto__' as never)).toBe('Helv')
  })
})

// S6.9: Word setzt Aufzaehlungspunkte in Symbol; pdf.js liefert sie als
// U+F0B7. Die Ersatzschrift kennt den Punkt als U+2022.
describe('normalisiereZeichen', () => {
  it('bildet Aufzaehlungszeichen aus Symbol und Wingdings auf den WinAnsi-Punkt ab', () => {
    expect(normalisiereZeichen('\uF0B7 Punkt')).toBe('\u2022 Punkt')
    expect(normalisiereZeichen('\u25CF\uF0A7\u2219')).toBe('\u2022\u2022\u2022')
    expect(nichtDarstellbareZeichen(normalisiereZeichen('\uF0B7 Daten'))).toEqual([])
  })

  it('laesst alles andere unveraendert', () => {
    expect(normalisiereZeichen('Grüße – 5 € \u2022')).toBe('Grüße – 5 € \u2022')
  })
})
