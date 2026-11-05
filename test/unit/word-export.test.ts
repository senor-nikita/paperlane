import { describe, expect, it } from 'vitest'
import type { WordLauf } from '../../src/shared/ipc'
import {
  absatzBlock,
  baueWordSeiten,
  bildeAbsaetze,
  bildeZeilen,
  bloeckeFuerSeite,
  ebeneFuer,
  findeBilder,
  grundgroesse,
  hatText,
  OP,
  rechterRand,
  rgbaAusBilddaten,
  stilAusSchrift,
  verbindeZeile,
  verkette,
  type Bildstueck,
  type Textstueck,
  type Zeile
} from '../../src/renderer/src/word-export'

/**
 * Die Gruppierung fuer PDF nach Word (S6.7, Aufgabe 1 und 2) - reine
 * Funktionen, ohne pdf.js. Die Stuecke sind so gebaut, wie pdf.js sie
 * liefert: Grundlinie in PDF-Punkten, y nach oben.
 */

function stueck(text: string, x: number, y: number, teil: Partial<Textstueck> = {}): Textstueck {
  const groesse = teil.groesse ?? 11
  return {
    text,
    x,
    y,
    breite: teil.breite ?? text.length * groesse * 0.5,
    groesse,
    fett: teil.fett ?? false,
    kursiv: teil.kursiv ?? false
  }
}

/** Zeilen im Abstand von 14 pt, links buendig, rechts bis `rechts`. */
function zeilen(texte: string[], y = 700, rechts = 500): Textstueck[] {
  return texte.map((text, index) => stueck(text, 72, y - index * 14, { breite: rechts - 72 }))
}

function texte(bloecke: ReturnType<typeof bloeckeFuerSeite>): string[] {
  return bloecke.map((block) =>
    block.art === 'bild' ? '[Bild]' : block.laeufe.map((lauf) => lauf.text).join('')
  )
}

function bild(oben: number, links = 72, hoehe = 100): Bildstueck {
  return { png: new Uint8Array([1]), links, oben, breitePt: 100, hoehePt: hoehe }
}

describe('stilAusSchrift', () => {
  it.each([
    ['Helvetica-Bold', true, false],
    ['ABCDEF+Arial-BoldItalicMT', true, true],
    ['TimesNewRomanPS-ItalicMT', false, true],
    ['Helvetica-Oblique', false, true],
    ['Calibri,Bold', true, false],
    ['Frutiger-Black', true, false],
    ['MyriadPro-Semibold', true, false],
    ['CMBX10', true, false],
    ['CMTI10', false, true],
    ['Helvetica', false, false],
    // Das Teilmengen-Praefix darf nichts ausloesen.
    ['BOLDIT+Helvetica', false, false]
  ])('%s -> fett %s, kursiv %s', (name, fett, kursiv) => {
    expect(stilAusSchrift(name)).toEqual({ fett, kursiv })
  })

  it('nimmt die Merkmale aus dem Schriftdeskriptor dazu', () => {
    expect(stilAusSchrift('g_d0_f1', { bold: true, italic: true })).toEqual({
      fett: true,
      kursiv: true
    })
  })
})

describe('bildeZeilen', () => {
  it('fasst Stuecke gleicher Grundlinie zusammen und setzt Leerzeichen in Luecken', () => {
    const ergebnis = bildeZeilen([
      stueck('Hallo', 72, 700, { breite: 25 }),
      stueck('Welt', 110, 700.5, { breite: 20 }),
      stueck('Zweite', 72, 686)
    ])
    expect(ergebnis).toHaveLength(2)
    expect(ergebnis[0]?.laeufe.map((l) => l.text).join('')).toBe('Hallo Welt')
    expect(ergebnis[0]?.rechts).toBe(130)
  })

  it('setzt kein Leerzeichen, wo die Stuecke aneinander stossen', () => {
    const ergebnis = bildeZeilen([
      stueck('Mess', 72, 700, { breite: 20 }),
      stueck('wert', 92, 700, { breite: 20 })
    ])
    expect(ergebnis[0]?.laeufe[0]?.text).toBe('Messwert')
  })

  it('haelt Laeufe mit anderer Auszeichnung getrennt', () => {
    const ergebnis = bildeZeilen([
      stueck('fett', 72, 700, { breite: 20, fett: true }),
      stueck(' normal', 92, 700, { breite: 30 })
    ])
    expect(ergebnis[0]?.laeufe).toEqual([
      { text: 'fett', fett: true, kursiv: false, groessePt: 11 },
      { text: ' normal', fett: false, kursiv: false, groessePt: 11 }
    ])
  })

  it('beginnt keine Zeile mit einem Leerzeichen und uebergeht leere Stuecke', () => {
    const ergebnis = bildeZeilen([
      stueck('', 72, 700),
      stueck(' ', 72, 700),
      stueck('Text', 72, 686)
    ])
    expect(ergebnis).toHaveLength(1)
    expect(ergebnis[0]?.y).toBe(686)
  })

  it('zaehlt Leerzeichen nicht zur Schriftgroesse der Zeile', () => {
    const ergebnis = bildeZeilen([
      stueck('Text', 72, 700, { breite: 20 }),
      stueck(' ', 92, 700, { groesse: 13 })
    ])
    expect(ergebnis[0]?.groesse).toBe(11)
  })
})

describe('rechterRand', () => {
  it('ist das 75. Perzentil der Zeilenenden', () => {
    const z = (rechts: number): Zeile => ({ laeufe: [], y: 0, links: 72, rechts, groesse: 11 })
    expect(rechterRand([z(300), z(500), z(510), z(900)])).toBe(510)
    expect(rechterRand([])).toBe(0)
  })
})

describe('bildeAbsaetze', () => {
  it('haelt einen Absatz mit gleichmaessigem Zeilenabstand zusammen', () => {
    const absaetze = bildeAbsaetze(bildeZeilen(zeilen(['eins', 'zwei', 'drei'])))
    expect(absaetze).toHaveLength(1)
  })

  it('trennt bei groesserem Abstand', () => {
    const stuecke = [...zeilen(['eins', 'zwei']), ...zeilen(['drei'], 650)]
    expect(bildeAbsaetze(bildeZeilen(stuecke)).map((a) => a.length)).toEqual([2, 1])
  })

  it('trennt bei einem Abstand, der groesser ist als bisher im Absatz', () => {
    const stuecke = [...zeilen(['eins', 'zwei', 'drei']), ...zeilen(['vier'], 700 - 28 - 20)]
    expect(bildeAbsaetze(bildeZeilen(stuecke)).map((a) => a.length)).toEqual([3, 1])
  })

  it('trennt bei Wechsel der Schriftgroesse', () => {
    const stuecke = [stueck('Titel', 72, 720, { groesse: 20 }), ...zeilen(['Text'], 700)]
    expect(bildeAbsaetze(bildeZeilen(stuecke))).toHaveLength(2)
  })

  it('trennt bei einem Erstzeileneinzug', () => {
    const stuecke = [
      ...zeilen(['eins', 'zwei']),
      stueck('drei', 100, 672, { breite: 400 }),
      stueck('vier', 72, 658, { breite: 428 })
    ]
    expect(bildeAbsaetze(bildeZeilen(stuecke)).map((a) => a.length)).toEqual([2, 2])
  })

  it('trennt nach einer kurzen Zeile', () => {
    const stuecke = [
      stueck('eins', 72, 700, { breite: 428 }),
      stueck('kurz.', 72, 686, { breite: 40 }),
      stueck('drei', 72, 672, { breite: 428 }),
      stueck('vier', 72, 658, { breite: 428 })
    ]
    expect(bildeAbsaetze(bildeZeilen(stuecke)).map((a) => a.length)).toEqual([2, 2])
  })

  it('trennt, wenn die naechste Zeile nicht darunter liegt (neue Spalte)', () => {
    const stuecke = [...zeilen(['links oben', 'links unten']), stueck('rechts oben', 320, 700)]
    expect(bildeAbsaetze(bildeZeilen(stuecke))).toHaveLength(2)
  })
})

describe('verbindeZeile', () => {
  const lauf = (text: string): WordLauf => ({ text, fett: false, kursiv: false, groessePt: 11 })
  const zeile = (text: string): Zeile => ({
    laeufe: [lauf(text)],
    y: 0,
    links: 0,
    rechts: 0,
    groesse: 11
  })

  it.each([
    ['Mess-', 'werte', 'Messwerte'],
    ['Nord-', 'Sued', 'Nord-Sued'],
    ['Silben­', 'trennung', 'Silbentrennung'],
    ['Ende', 'Anfang', 'Ende Anfang'],
    ['Ende ', 'Anfang', 'Ende Anfang'],
    ['1990-', '2000', '1990-2000']
  ])('%s + %s = %s', (vorne, hinten, erwartet) => {
    const laeufe = [lauf(vorne)]
    verbindeZeile(laeufe, zeile(hinten))
    expect(laeufe.map((l) => l.text).join('')).toBe(erwartet)
  })
})

describe('Ueberschriften', () => {
  it('ergeben sich aus der relativen Schriftgroesse', () => {
    expect(ebeneFuer(24, 11, 20)).toBe(1)
    expect(ebeneFuer(16, 11, 20)).toBe(2)
    expect(ebeneFuer(13, 11, 20)).toBe(3)
    expect(ebeneFuer(11.5, 11, 20)).toBe(0)
  })

  it('sind nie lange Absaetze', () => {
    expect(ebeneFuer(24, 11, 500)).toBe(0)
    expect(ebeneFuer(24, 0, 5)).toBe(0)
  })

  it('messen sich an der Groesse mit den meisten Zeichen', () => {
    const z = bildeZeilen([
      stueck('Kurzer Titel', 72, 760, { groesse: 24 }),
      ...zeilen(['ein langer Fliesstext mit vielen Zeichen', 'und noch mehr davon'])
    ])
    expect(grundgroesse(z)).toBe(11)
    expect(grundgroesse([])).toBe(11)
  })
})

describe('absatzBlock', () => {
  it('fuegt Zeilen zusammen, glaettet Leerzeichen und bestimmt die Ebene', () => {
    const z = bildeZeilen([
      stueck('  Ueber   ', 72, 700, { groesse: 20 }),
      stueck('schrift ', 72, 680, { groesse: 20 })
    ])
    expect(absatzBlock(z, 11)).toEqual({
      art: 'absatz',
      ebene: 1,
      laeufe: [{ text: 'Ueber schrift', fett: false, kursiv: false, groessePt: 20 }]
    })
  })

  it('liefert null ohne lesbaren Text', () => {
    expect(absatzBlock([], 11)).toBeNull()
  })
})

describe('bloeckeFuerSeite', () => {
  const seite = (stuecke: Textstueck[], bilder: Bildstueck[] = []) => ({
    breitePt: 595,
    hoehePt: 842,
    stuecke,
    bilder
  })

  it('setzt Bilder in Lesereihenfolge zwischen die Absaetze', () => {
    const bloecke = bloeckeFuerSeite(
      seite([...zeilen(['oben'], 760), ...zeilen(['unten'], 400)], [bild(700), bild(300)]),
      11
    )
    expect(texte(bloecke)).toEqual(['oben', '[Bild]', 'unten', '[Bild]'])
  })

  it('ordnet Bilder gleicher Hoehe von links nach rechts', () => {
    const bloecke = bloeckeFuerSeite(seite([], [bild(500, 300), bild(500, 72)]), 11)
    expect(bloecke.map((b) => (b.art === 'bild' ? b.breitePt : 0))).toEqual([100, 100])
    expect(texte(bloecke)).toEqual(['[Bild]', '[Bild]'])
  })

  it('laesst Zierrat unter 8 pt weg', () => {
    expect(bloeckeFuerSeite(seite([], [bild(500, 72, 4)]), 11)).toEqual([])
  })
})

describe('baueWordSeiten', () => {
  it('uebernimmt die Masse und misst Ueberschriften am ganzen Dokument', () => {
    const seiten = baueWordSeiten([
      {
        breitePt: 595,
        hoehePt: 842,
        stuecke: [stueck('Titel', 72, 760, { groesse: 24 })],
        bilder: []
      },
      { breitePt: 300, hoehePt: 400, stuecke: zeilen(['Fliesstext hier', 'mehr']), bilder: [] }
    ])
    expect(seiten.map((s) => [s.breitePt, s.hoehePt])).toEqual([
      [595, 842],
      [300, 400]
    ])
    expect(seiten[0]?.bloecke[0]).toMatchObject({ art: 'absatz', ebene: 1 })
  })
})

describe('hatText', () => {
  it('erkennt Seiten ohne lesbaren Text', () => {
    expect(hatText([])).toBe(false)
    expect(hatText([{ text: '  ' }])).toBe(false)
    expect(hatText([{ text: ' a' }])).toBe(true)
  })
})

describe('findeBilder', () => {
  it('verfolgt die Transformation ueber save, restore und Form-XObjects', () => {
    const ops = [
      OP.save,
      OP.transform,
      OP.paintImageXObject,
      OP.restore,
      OP.paintFormXObjectBegin,
      OP.transform,
      OP.paintInlineImageXObject,
      OP.paintFormXObjectEnd,
      OP.beginGroup,
      OP.endGroup,
      OP.paintImageXObject,
      999
    ]
    const args = [
      null,
      [200, 0, 0, 100, 50, 600],
      ['img_p0_1'],
      null,
      [[1, 0, 0, 1, 100, 100], null],
      [50, 0, 0, 50, 0, 0],
      [{ width: 1, height: 1 }],
      null,
      [{}],
      [{}],
      [42],
      null
    ]
    const bilder = findeBilder(ops, args)
    expect(bilder).toEqual([
      { quelle: 'img_p0_1', links: 50, unten: 600, rechts: 250, oben: 700 },
      { quelle: { width: 1, height: 1 }, links: 100, unten: 100, rechts: 150, oben: 150 }
    ])
  })

  it('findet gedrehte Bilder mit ihrer Huelle', () => {
    const [treffer] = findeBilder(
      [OP.transform, OP.paintImageXObject],
      [[0, 100, -50, 0, 300, 400], ['x']]
    )
    expect(treffer).toMatchObject({ links: 250, unten: 400, rechts: 300, oben: 500 })
  })

  it('verkettet wie ctx.transform', () => {
    expect(verkette([2, 0, 0, 2, 10, 10], [1, 0, 0, 1, 5, 5])).toEqual([2, 0, 0, 2, 20, 20])
  })
})

describe('rgbaAusBilddaten', () => {
  it('wandelt RGB, RGBA und 1-Bit-Graustufen', () => {
    expect([
      ...(rgbaAusBilddaten({ width: 1, height: 1, kind: 2, data: [1, 2, 3] }) ?? [])
    ]).toEqual([1, 2, 3, 255])
    expect([
      ...(rgbaAusBilddaten({ width: 1, height: 1, kind: 3, data: [1, 2, 3, 4] }) ?? [])
    ]).toEqual([1, 2, 3, 4])
    // 0b10100000: weiss, schwarz, weiss; die Zeile ist auf ein Byte aufgefuellt.
    const grau = rgbaAusBilddaten({ width: 3, height: 1, kind: 1, data: [0b10100000] })
    expect([...(grau ?? [])]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255])
  })

  it('lehnt unpassende Daten ab', () => {
    expect(rgbaAusBilddaten({ width: 0, height: 1, kind: 2, data: [] })).toBeNull()
    expect(rgbaAusBilddaten({ width: 2, height: 1, kind: 2, data: [1, 2, 3] })).toBeNull()
    expect(rgbaAusBilddaten({ width: 1, height: 1, kind: 3, data: [1] })).toBeNull()
    expect(rgbaAusBilddaten({ width: 9, height: 2, kind: 1, data: [0, 0, 0] })).toBeNull()
    expect(rgbaAusBilddaten({ width: 1, height: 1, kind: 7, data: [1, 2, 3] })).toBeNull()
  })
})
