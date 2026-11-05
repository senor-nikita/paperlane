import { PDFContext, PDFName, PDFStream, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  BILD_NAME,
  brauchtBild,
  brauchtSchrift,
  darfErsetzen,
  erscheinungFuer,
  farbanweisung,
  GEMALTE_TYPEN,
  GS_NAME,
  inhaltFuer,
  KAPPA,
  SCHRIFT_NAME,
  STEMPEL_ERSATZ,
  vierecke,
  zahl,
  type Schrift
} from '../../src/main/erscheinungsbild'
import type { Annotation, AnnotationsTyp } from '../../src/shared/annotations'

/**
 * Appearance-Streams (S2.3b) — Gegenmassnahme zu R1.
 *
 * Dieser Test prueft den Inhaltsstrom, nicht sein Aussehen. Dass das Ergebnis
 * in einem fremden Betrachter wirklich sichtbar ist, kann nur der fremde
 * Betrachter sagen; das tut `test/e2e/appearance.chrome.spec.ts`. Die eine
 * Aussage ersetzt die andere nicht: hier wird festgehalten, **warum** der
 * Strom so aussieht, dort, **dass** er wirkt.
 */
function annotation(teile: Partial<Annotation> & Pick<Annotation, 'typ'>): Annotation {
  return {
    id: 'neu-1',
    seite: 1,
    subtyp: teile.typ,
    rect: [100, 700, 200, 740],
    quadPoints: null,
    striche: null,
    farbe: { r: 255, g: 0, b: 0 },
    strichstaerke: 2,
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

/** Eine Schrift ohne Einbettung: jedes Zeichen genau halb so breit wie hoch. */
const schrift: Schrift = {
  breiteVon: (text, groesse) => text.length * groesse * 0.5,
  kodiere: (text) => '(' + text + ')'
}

const strom = (a: Annotation, s: Schrift | null = schrift): string => inhaltFuer(a, s)?.strom ?? ''

describe('zahl', () => {
  it.each([
    [1, '1'],
    [1.23456789, '1.2346'],
    [0, '0'],
    [-0, '0'],
    [-12.5, '-12.5'],
    [100.0001, '100.0001']
  ])('schreibt %f als %s', (wert, erwartet) => {
    expect(zahl(wert)).toBe(erwartet)
  })

  /**
   * Der Grund fuer die eigene Formatierung: `String(1e-7)` ergibt "1e-7", und
   * das ist in einem Inhaltsstrom ein Syntaxfehler. Kein Betrachter sagte
   * danach, warum die Anmerkung fehlt.
   */
  it('erzeugt nie eine Exponentialschreibweise', () => {
    for (const wert of [1e-7, 1e-21, 0.00004]) {
      expect(zahl(wert)).not.toMatch(/e/i)
    }
  })

  it('faellt bei NaN und Unendlich auf 0 zurueck', () => {
    expect(zahl(Number.NaN)).toBe('0')
    expect(zahl(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('farbanweisung', () => {
  it('rechnet die Kanaele auf 0..1 herunter', () => {
    expect(farbanweisung({ r: 255, g: 0, b: 51 }, true, { r: 0, g: 0, b: 0 })).toBe('1 0 0.2 rg')
  })

  it('unterscheidet Fuellen und Zeichnen', () => {
    const farbe = { r: 0, g: 0, b: 0 }
    expect(farbanweisung(farbe, false, farbe)).toBe('0 0 0 RG')
  })

  it('nimmt die Ersatzfarbe, wenn das Dokument keine nennt', () => {
    expect(farbanweisung(null, true, { r: 255, g: 255, b: 255 })).toBe('1 1 1 rg')
  })
})

describe('vierecke', () => {
  it('liest je acht Zahlen ein Viereck', () => {
    const gefunden = vierecke([10, 60, 50, 60, 10, 40, 50, 40])
    expect(gefunden).toHaveLength(1)
    expect(gefunden[0]).toMatchObject({ links: 10, unten: 40, rechts: 50, oben: 60 })
  })

  it('liest mehrere Zeilen', () => {
    const zwei = [10, 60, 50, 60, 10, 40, 50, 40, 10, 30, 90, 30, 10, 10, 90, 10]
    expect(vierecke(zwei)).toHaveLength(2)
  })

  // Geraten waere schlimmer als weggelassen: aus einem halben Viereck entstuende
  // ein Streifen an einer Stelle, an der nie etwas markiert wurde.
  it('verwirft einen unvollstaendigen Rest', () => {
    expect(vierecke([10, 60, 50, 60, 10, 40])).toHaveLength(0)
  })

  it('kommt mit fehlenden QuadPoints zurecht', () => {
    expect(vierecke(null)).toEqual([])
  })
})

describe('inhaltFuer', () => {
  it.each(GEMALTE_TYPEN)('erzeugt fuer %s einen nicht leeren Strom', (typ) => {
    const a = annotation({
      typ,
      quadPoints: [100, 740, 200, 740, 100, 700, 200, 700],
      striche: [[100, 700, 150, 720, 200, 700]],
      inhalt: typ === 'Stamp' ? 'Entwurf' : ''
    })
    const inhalt = inhaltFuer(a, schrift)
    expect(inhalt).not.toBeNull()
    expect(inhalt?.strom.length).toBeGreaterThan(0)
  })

  // Ein Verweis ist eine Flaeche und kein Zeichen; ein unbekannter Typ bringt
  // sein Aussehen selbst mit und darf nicht ueberschrieben werden.
  it.each([['Link'], ['Unbekannt']])('erzeugt fuer %s nichts', (typ) => {
    expect(inhaltFuer(annotation({ typ: typ as AnnotationsTyp }), schrift)).toBeNull()
  })
})

describe('Markierung', () => {
  const markiert = annotation({
    typ: 'Highlight',
    quadPoints: [100, 740, 200, 740, 100, 700, 200, 700]
  })

  /**
   * Ohne `/BM /Multiply` legt sich eine deckende Flaeche ueber den Text. In der
   * eigenen Anzeige faellt das nicht auf — die zeichnet gar nicht aus dem
   * Strom. In einem fremden Betrachter waere die markierte Stelle unlesbar.
   */
  it('setzt den Mischmodus, bevor irgendetwas gefuellt wird', () => {
    const inhalt = inhaltFuer(markiert, null)
    expect(inhalt?.bedarf.multiplizieren).toBe(true)
    expect(inhalt?.strom.startsWith('/' + GS_NAME + ' gs')).toBe(true)
  })

  it('fuellt je Zeile eine Flaeche', () => {
    const zweizeilig = annotation({
      typ: 'Highlight',
      quadPoints: [100, 740, 200, 740, 100, 720, 200, 720, 100, 715, 160, 715, 100, 700, 160, 700]
    })
    expect(strom(zweizeilig).match(/re f/g)).toHaveLength(2)
  })

  it('benutzt die Farbe der Annotation', () => {
    expect(strom(markiert)).toContain('1 0 0 rg')
  })
})

describe('Unterstreichen und Durchstreichen', () => {
  const quad = [100, 740, 200, 740, 100, 700, 200, 700]

  it('legt den Unterstrich unten und den Durchstrich in die Mitte', () => {
    const unterUnten = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f/.exec(
      strom(annotation({ typ: 'Underline', quadPoints: quad }))
    )
    const durchUnten = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f/.exec(
      strom(annotation({ typ: 'StrikeOut', quadPoints: quad }))
    )
    expect(Number(unterUnten?.[2])).toBeLessThan(Number(durchUnten?.[2]))
    // Beide innerhalb der Zeile.
    expect(Number(unterUnten?.[2])).toBeGreaterThanOrEqual(700)
    expect(Number(durchUnten?.[2])).toBeLessThan(740)
  })

  // Eine Unterstreichung unter einer Ueberschrift muss dicker sein als unter
  // einer Fussnote; `strichstaerke` hat bei Text-Markup keine Bedeutung.
  it('skaliert die Dicke mit der Zeilenhoehe', () => {
    const dickeVon = (hoehe: number): number => {
      const oben = 700 + hoehe
      const treffer = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f/.exec(
        strom(
          annotation({
            typ: 'Underline',
            quadPoints: [100, oben, 200, oben, 100, 700, 200, 700]
          })
        )
      )
      return Number(treffer?.[4])
    }
    expect(dickeVon(40)).toBeGreaterThan(dickeVon(10))
  })

  it('braucht keine Sonderressourcen', () => {
    const inhalt = inhaltFuer(annotation({ typ: 'Underline', quadPoints: quad }), null)
    expect(inhalt?.bedarf).toEqual({ multiplizieren: false, schrift: false, bild: false })
  })
})

describe('Freihand', () => {
  it('zeichnet je Zug einen Pfad', () => {
    const gezeichnet = strom(
      annotation({
        typ: 'Ink',
        striche: [
          [100, 700, 150, 720],
          [160, 700, 190, 730]
        ]
      })
    )
    expect(gezeichnet.match(/ m$/gm)).toHaveLength(2)
    expect(gezeichnet.match(/^S$/gm)).toHaveLength(2)
  })

  // Runde Enden und Ecken - sonst saehe ein Zug aus vielen kurzen Strecken an
  // jeder Richtungsaenderung ausgefranst aus.
  it('setzt runde Enden und Ecken', () => {
    const gezeichnet = strom(annotation({ typ: 'Ink', striche: [[100, 700, 150, 720]] }))
    expect(gezeichnet).toContain('1 J')
    expect(gezeichnet).toContain('1 j')
  })

  /** Ein Tipp ohne Bewegung: ohne die Strecke auf sich selbst entstuende nichts. */
  it('macht aus einem einzelnen Punkt einen Punkt', () => {
    const gezeichnet = strom(annotation({ typ: 'Ink', striche: [[120, 710]] }))
    expect(gezeichnet).toContain('120 710 m')
    expect(gezeichnet).toContain('120 710 l')
  })

  it('nimmt die Strichstaerke aus dem Modell', () => {
    expect(strom(annotation({ typ: 'Ink', striche: [[1, 2]], strichstaerke: 3.5 }))).toContain(
      '3.5 w'
    )
  })

  it('faellt ohne Strichstaerke auf einen Punkt zurueck', () => {
    expect(strom(annotation({ typ: 'Ink', striche: [[1, 2]], strichstaerke: null }))).toContain(
      '1 w'
    )
  })

  it('ueberspringt einen leeren Zug', () => {
    expect(strom(annotation({ typ: 'Ink', striche: [[]] }))).not.toContain(' m')
  })
})

describe('Rechteck und Ellipse', () => {
  /**
   * Ein Strich sitzt mittig auf dem Pfad. Ohne das Einruecken laege seine
   * aeussere Haelfte ausserhalb der `/BBox` — und ein Appearance-Stream malt
   * nie darueber hinaus, die Kante waere also halb weg.
   */
  it('rueckt das Rechteck um die halbe Strichstaerke ein', () => {
    const gezeichnet = strom(annotation({ typ: 'Square', rect: [100, 700, 200, 740] }))
    expect(gezeichnet).toContain('101 701 98 38 re S')
  })

  it('zeichnet die Ellipse aus vier Bézierstuecken', () => {
    const gezeichnet = strom(annotation({ typ: 'Circle', rect: [100, 700, 200, 740] }))
    expect(gezeichnet.match(/ c$/gm)).toHaveLength(4)
    expect(gezeichnet).toMatch(/^S$/m)
  })

  it('trifft mit KAPPA den rechten Scheitelpunkt', () => {
    // Strichstaerke 0 heisst nicht "kein Strich": ein unsichtbarer Rahmen waere
    // keine sinnvolle Eingabe, also greift die Vorgabe von einem Punkt. Der
    // Radius ist damit 49,5 statt 50 - eingerueckt um die halbe Staerke.
    const gezeichnet = strom(
      annotation({ typ: 'Circle', rect: [0, 0, 100, 100], strichstaerke: 0 })
    )
    expect(gezeichnet).toContain('1 w')
    // Mittelpunkt (50,50): der Pfad beginnt rechts auf halber Hoehe.
    expect(gezeichnet).toContain('99.5 50 m')
    expect(gezeichnet).toContain(zahl(50 + 49.5 * KAPPA))
  })

  it('bleibt bei einem entarteten Rechteck bei null', () => {
    const gezeichnet = strom(annotation({ typ: 'Square', rect: [100, 700, 100, 700] }))
    expect(gezeichnet).toContain('0 0 re S')
  })
})

describe('Notiz', () => {
  it('fuellt den Koerper in der Farbe und umrandet ihn', () => {
    const gezeichnet = strom(annotation({ typ: 'Text', rect: [100, 700, 120, 720] }))
    expect(gezeichnet).toContain('1 0 0 rg')
    // `B` fuellt und zeichnet in einem Zug.
    expect(gezeichnet).toMatch(/^B$/m)
  })

  it('deutet zwei Textzeilen an', () => {
    const gezeichnet = strom(annotation({ typ: 'Text', rect: [100, 700, 120, 720] }))
    expect(gezeichnet.match(/re f/g)?.length).toBe(2)
  })

  it('braucht keine Schrift', () => {
    expect(brauchtSchrift(annotation({ typ: 'Text' }))).toBe(false)
    expect(inhaltFuer(annotation({ typ: 'Text' }), null)?.bedarf.schrift).toBe(false)
  })
})

describe('Stempel', () => {
  const gestempelt = (inhalt: string, rect: Annotation['rect'] = [100, 700, 200, 740]): string =>
    strom(annotation({ typ: 'Stamp', inhalt, rect }))

  it('zeichnet einen gestrichelten Rahmen', () => {
    expect(gestempelt('Entwurf')).toMatch(/\[[\d.]+\] 0 d/)
    // Das Muster wird zurueckgesetzt, sonst wirkte es in den Text hinein.
    expect(gestempelt('Entwurf')).toContain('[] 0 d')
  })

  it('setzt den Text mit der Schriftressource', () => {
    const gezeichnet = gestempelt('Entwurf')
    expect(gezeichnet).toContain('/' + SCHRIFT_NAME + ' ')
    expect(gezeichnet).toContain('(Entwurf) Tj')
    expect(brauchtSchrift(annotation({ typ: 'Stamp' }))).toBe(true)
  })

  it('nimmt einen Ersatztext, wenn keiner dasteht', () => {
    expect(gestempelt('   ')).toContain('(' + STEMPEL_ERSATZ + ') Tj')
  })

  /**
   * Ohne die Breitengrenze ragte "Vertraulich" seitlich aus dem Stempel
   * heraus — und waere dort abgeschnitten, weil der Strom nicht ueber seine
   * `/BBox` hinausmalt.
   */
  it('verkleinert die Schrift, bis der Text in die Breite passt', () => {
    const groesseAus = (text: string): number => {
      const treffer = new RegExp('/' + SCHRIFT_NAME + ' ([\\d.]+) Tf').exec(gestempelt(text))
      return Number(treffer?.[1])
    }
    expect(groesseAus('Vertraulich')).toBeLessThan(groesseAus('OK'))
  })

  it('zentriert den Text waagerecht', () => {
    // Schriftbreite: 0.5 je Zeichen und Punkt. Bei "AB" und Groesse g ist die
    // Breite g; der Text beginnt also bei 100 + (100 - g) / 2.
    const gezeichnet = gestempelt('AB')
    const groesse = Number(new RegExp('/' + SCHRIFT_NAME + ' ([\\d.]+) Tf').exec(gezeichnet)?.[1])
    const x = Number(/(-?[\d.]+) (-?[\d.]+) Td/.exec(gezeichnet)?.[1])
    expect(x).toBeCloseTo(100 + (100 - groesse) / 2, 3)
  })

  /**
   * Ein Text ohne Schriftressource ergaebe einen Strom, den manche Betrachter
   * stillschweigend verwerfen — dann fehlte nicht nur der Text, sondern der
   * ganze Stempel.
   */
  it('laesst den Text weg, wenn keine Schrift da ist', () => {
    const ohneSchrift = inhaltFuer(annotation({ typ: 'Stamp', inhalt: 'Entwurf' }), null)
    expect(ohneSchrift?.strom).not.toContain('Tj')
    expect(ohneSchrift?.strom).toContain('re S')
    expect(ohneSchrift?.bedarf.schrift).toBe(false)
  })
})

/**
 * Der Bildstempel (S3.2): die grafische Signatur. Kein Text, keine Schrift,
 * nur ein XObject, das mit `cm` auf das Rechteck skaliert wird.
 */
describe('Bildstempel', () => {
  const BILD = 'data:image/png;base64,iVBORw0KGgo='
  const mitBild = (rect: Annotation['rect'] = [100, 700, 220, 740]): Annotation =>
    annotation({ typ: 'Stamp', inhalt: 'ignoriert', rect, bild: BILD })

  it('skaliert das Einheitsquadrat auf das Rechteck und zeichnet das XObject', () => {
    const gezeichnet = strom(mitBild([100, 700, 220, 740]))
    expect(gezeichnet).toContain('120 0 0 40 100 700 cm')
    expect(gezeichnet).toContain('/' + BILD_NAME + ' Do')
    expect(gezeichnet).not.toContain('BT')
  })

  it('braucht ein Bild und keine Schrift', () => {
    expect(inhaltFuer(mitBild(), null)?.bedarf).toEqual({
      multiplizieren: false,
      schrift: false,
      bild: true
    })
    expect(brauchtBild(mitBild())).toBe(true)
    expect(brauchtSchrift(mitBild())).toBe(false)
    expect(brauchtBild(annotation({ typ: 'Stamp', inhalt: 'Entwurf' }))).toBe(false)
  })

  it('kommt ohne Schrift aus, wo der Textstempel keine haette', () => {
    // Beim Textstempel ohne Schrift faellt inhaltFuer auf den Ersatz zurueck;
    // beim Bildstempel gibt es keinen Text, also auch keinen Ersatz.
    expect(strom(mitBild())).not.toContain(STEMPEL_ERSATZ)
  })

  it('bekommt ohne eingebettetes Bild kein /AP', () => {
    const k = PDFContext.create()
    expect(erscheinungFuer(mitBild(), k, () => null)).toBeNull()
    expect(erscheinungFuer(mitBild(), k, () => null, null)).toBeNull()
  })

  it('traegt das Bild als XObject in die Ressourcen ein', () => {
    const k = PDFContext.create()
    const bildRef = PDFRef.of(77)
    const ap = erscheinungFuer(mitBild(), k, () => null, bildRef)
    const stream = k.lookup(ap?.get(PDFName.of('N')), PDFStream)
    const ressourcen = String(stream.dict.get(PDFName.of('Resources')))
    expect(ressourcen).toContain('/XObject')
    expect(ressourcen).toContain('/' + BILD_NAME + ' 77 0 R')
    expect(ressourcen).not.toContain('/Font')
  })
})

/**
 * Die Regel, die fremde Bilder schuetzt: was sich vollstaendig aus unseren
 * Feldern ergibt, darf neu entstehen — alles Uebrige nur, wenn nichts da ist.
 */
describe('darfErsetzen', () => {
  it.each([['Highlight'], ['Underline'], ['StrikeOut'], ['Ink'], ['Square'], ['Circle']])(
    'ersetzt ein vorhandenes Bild bei %s',
    (typ) => {
      expect(darfErsetzen(annotation({ typ: typ as AnnotationsTyp }), true)).toBe(true)
    }
  )

  it.each([['Stamp'], ['Text']])('laesst ein vorhandenes Bild bei %s stehen', (typ) => {
    expect(darfErsetzen(annotation({ typ: typ as AnnotationsTyp }), true)).toBe(false)
  })

  it.each([['Stamp'], ['Text']])('erzeugt fuer %s eines, wenn keines da ist', (typ) => {
    expect(darfErsetzen(annotation({ typ: typ as AnnotationsTyp }), false)).toBe(true)
  })
})

describe('erscheinungFuer', () => {
  const kontext = (): PDFContext => PDFContext.create()

  it('baut ein /AP mit einem /N-Stream', () => {
    const k = kontext()
    const ap = erscheinungFuer(annotation({ typ: 'Square' }), k, () => null)
    expect(ap).not.toBeNull()
    const verweis = ap?.get(PDFName.of('N'))
    expect(verweis).toBeInstanceOf(PDFRef)
    expect(k.lookup(verweis, PDFStream)).toBeInstanceOf(PDFStream)
  })

  /**
   * Der Kern des Entwurfs: `/BBox` gleich `/Rect` und `/Matrix` die
   * Einheitsmatrix. Damit ist der Koordinatenraum des Formulars der der Seite,
   * und keine Abbildung kann dazwischen falsch werden (R1).
   */
  it('setzt /BBox gleich /Rect und /Matrix auf die Einheitsmatrix', () => {
    const k = kontext()
    const a = annotation({ typ: 'Square', rect: [10, 20, 30, 40] })
    const ap = erscheinungFuer(a, k, () => null)
    const stream = k.lookup(ap?.get(PDFName.of('N')), PDFStream)
    expect(String(stream.dict.get(PDFName.of('BBox')))).toBe('[ 10 20 30 40 ]')
    expect(String(stream.dict.get(PDFName.of('Matrix')))).toBe('[ 1 0 0 1 0 0 ]')
    expect(String(stream.dict.get(PDFName.of('Subtype')))).toBe('/Form')
  })

  it('legt Markierungen den Mischmodus in die Ressourcen', () => {
    const k = kontext()
    const a = annotation({
      typ: 'Highlight',
      quadPoints: [100, 740, 200, 740, 100, 700, 200, 700]
    })
    const stream = k.lookup(erscheinungFuer(a, k, () => null)?.get(PDFName.of('N')), PDFStream)
    expect(String(stream.dict.get(PDFName.of('Resources')))).toContain('/BM /Multiply')
  })

  it('traegt die Schrift nur bei einem Stempel ein', () => {
    const k = kontext()
    const ref = PDFRef.of(99)
    const mitStempel = k.lookup(
      erscheinungFuer(annotation({ typ: 'Stamp', inhalt: 'Entwurf' }), k, () => ({
        ref,
        schrift
      }))?.get(PDFName.of('N')),
      PDFStream
    )
    expect(String(mitStempel.dict.get(PDFName.of('Resources')))).toContain('/' + SCHRIFT_NAME)

    const ohneStempel = k.lookup(
      erscheinungFuer(annotation({ typ: 'Square' }), k, () => ({ ref, schrift }))?.get(
        PDFName.of('N')
      ),
      PDFStream
    )
    expect(String(ohneStempel.dict.get(PDFName.of('Resources')))).not.toContain(SCHRIFT_NAME)
  })

  it('liefert fuer einen Verweis nichts', () => {
    expect(erscheinungFuer(annotation({ typ: 'Link' }), kontext(), () => null)).toBeNull()
  })
})
