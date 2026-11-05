import { PDFDict, PDFName, type PDFContext, type PDFObject, type PDFRef } from 'pdf-lib'
import type { Annotation, Farbe } from '../shared/annotations'
import { STANDARD_AUSRICHTUNG, STANDARD_SCHRIFTGROESSE } from '../shared/freitext'

/**
 * Appearance-Streams (S2.3b) — das groesste fachliche Risiko des Projekts (R1).
 *
 * Eine Annotation ohne `/AP` zeigt **diese** Anwendung wieder an, weil sie sie
 * aus `/QuadPoints` und `/InkList` selbst zeichnet. Ein fremder Betrachter tut
 * das in aller Regel nicht: er malt, was im Appearance-Stream steht, und sonst
 * nichts. Ohne dieses Modul waere jede hier erzeugte Anmerkung ausserhalb von
 * paperlane unsichtbar — und niemand merkte es, weil die eigene Anzeige
 * stimmt.
 *
 * **Bewusst ohne Electron-Import.** Das Modul haengt nur an pdf-lib und am
 * internen Modell. So kann die Gegenprobe in einem echten Chrome (Aufgabe 3b)
 * die Dokumente selbst bauen. S3.2 nutzt es fuer den Bildstempel der
 * grafischen Signatur (`bildstempel`); die Feld-Appearances der
 * Formularwerte erzeugt dagegen pdf-lib selbst (`updateFieldAppearances`) -
 * eine bewusste Abweichung von Aufgabe 2 dort, begruendet im
 * Aenderungsprotokoll des Plans.
 *
 * ## Die eine Entscheidung, die alles Uebrige einfach macht
 *
 * `/BBox` ist **gleich** `/Rect`, `/Matrix` ist die Einheitsmatrix. Damit ist
 * der Koordinatenraum des Formulars derselbe wie der der Seite, und jede
 * Zeichenanweisung darf die Werte aus dem Modell unveraendert benutzen. Jede
 * andere Wahl braucht eine Abbildung zwischen zwei Raeumen — und genau solche
 * Abbildungen sind es, die in fremden Betrachtern falsch herauskommen, waehrend
 * die eigene Anzeige weiter stimmt. Das ist R1 in einem Satz.
 *
 * Der Preis: ein Freihandzug mit breiter Feder wird an den Raendern des `/Rect`
 * beschnitten, weil ein Appearance-Stream nie ueber seine `/BBox` hinausmalt.
 * Das ist sichtbar, aber harmlos — und die Alternative (eine groessere `/BBox`)
 * zoege eine Skalierung nach sich, die alles andere um denselben Faktor
 * verzerrte.
 */

/**
 * Bézier-Faktor fuer einen Viertelkreis.
 *
 * Vier Kurvenstuecke mit diesem Faktor treffen den Kreis auf etwa ein
 * Zehntausendstel des Radius genau. PDF kennt keinen Kreisbefehl.
 */
export const KAPPA = 0.5522847498

/** Schluessel der Ressourcen im Strom. Beliebig, aber hier und dort derselbe. */
export const GS_NAME = 'GS0'
export const SCHRIFT_NAME = 'F0'
export const BILD_NAME = 'Im0'

/** Die Typen, fuer die dieses Modul ein Erscheinungsbild erzeugt. */
export const GEMALTE_TYPEN = [
  'Highlight',
  'Underline',
  'StrikeOut',
  'Text',
  'Ink',
  'Stamp',
  'Square',
  'Circle',
  'FreeText'
] as const

/**
 * Typen, deren Aussehen sich **vollstaendig** aus den Feldern ergibt, die diese
 * Anwendung fuehrt.
 *
 * Fuer sie wird ein vorhandenes `/AP` bedenkenlos ersetzt: es kann nichts
 * enthalten, was nicht auch neu entstuende. Fuer `Stamp` und `Text` gilt das
 * nicht — dort kann ein fremdes Dokument ein eingescanntes Firmenzeichen oder
 * ein eigenes Symbol hinterlegt haben. Solche Bilder werden nicht
 * ueberschrieben (siehe `darfErsetzen`).
 */
const VOLLSTAENDIG_ABGELEITET: readonly string[] = [
  'Highlight',
  'Underline',
  'StrikeOut',
  'Ink',
  'Square',
  'Circle',
  // FreeText (S6.5): jede Aenderung geht durch unsere eigene Bearbeitung, die
  // das ganze Modell fuehrt (Text, Schrift, Groesse, Farbe, Ausrichtung).
  // Anders als beim Stempel gibt es hier kein Bild, das verloren gehen
  // koennte — nur Text, den wir selbst gerade neu gesetzt haben.
  'FreeText'
]

/** Standard-Strichstaerke, wenn das Dokument keine nennt. */
export const STANDARD_STRICH = 1

/** Wie dick ein Unterstrich im Verhaeltnis zur Zeilenhoehe ist. */
export const MARKUP_DICKE = 0.07

/**
 * Eine Schrift, so wie dieses Modul sie braucht.
 *
 * Nur zwei Faehigkeiten statt des ganzen `PDFFont`: so laesst sich der
 * Textsatz eines Stempels ohne eingebettete Schrift pruefen, und das Modul
 * bleibt von der pdf-lib-Schnittstelle unabhaengig.
 */
export interface Schrift {
  /** Breite des Textes bei dieser Groesse, in PDF-Punkten. */
  breiteVon: (text: string, groesse: number) => number
  /** Der Text als PDF-Zeichenkette, einschliesslich Klammern oder Spitzklammern. */
  kodiere: (text: string) => string
}

/** Was der erzeugte Strom an Ressourcen voraussetzt. */
export interface Bedarf {
  /** `/ExtGState` mit `/BM /Multiply` — nur Markierungen brauchen das. */
  multiplizieren: boolean
  /** Eine Schrift im Ressourcenverzeichnis — nur Stempel brauchen das. */
  schrift: boolean
  /** Ein Bild-XObject — nur Stempel mit Bild, also die grafische Signatur (S3.2). */
  bild: boolean
}

export interface Inhalt {
  strom: string
  bedarf: Bedarf
}

const OHNE: Bedarf = { multiplizieren: false, schrift: false, bild: false }

/**
 * Eine Zahl fuer einen PDF-Inhaltsstrom.
 *
 * Vier Nachkommastellen und **keine Exponentialschreibweise**: `1e-7` waere im
 * Strom ein Syntaxfehler, und kein Betrachter sagte, warum die Anmerkung
 * verschwunden ist.
 */
export function zahl(wert: number): string {
  if (!Number.isFinite(wert)) return '0'
  const gerundet = Math.round(wert * 10000) / 10000
  return Object.is(gerundet, -0) ? '0' : String(gerundet)
}

const SCHWARZ: Farbe = { r: 26, g: 26, b: 26 }
const GELB: Farbe = { r: 255, g: 212, b: 0 }

/** `r g b rg` zum Fuellen, `r g b RG` zum Zeichnen. Kanaele 0..1. */
export function farbanweisung(farbe: Farbe | null, fuellen: boolean, ersatz: Farbe): string {
  const { r, g, b } = farbe ?? ersatz
  return zahl(r / 255) + ' ' + zahl(g / 255) + ' ' + zahl(b / 255) + ' ' + (fuellen ? 'rg' : 'RG')
}

interface Kasten {
  links: number
  unten: number
  rechts: number
  oben: number
  breite: number
  hoehe: number
}

function kasten(werte: readonly number[]): Kasten {
  const [a = 0, b = 0, c = 0, d = 0] = werte
  const links = Math.min(a, c)
  const rechts = Math.max(a, c)
  const unten = Math.min(b, d)
  const oben = Math.max(b, d)
  return { links, unten, rechts, oben, breite: rechts - links, hoehe: oben - unten }
}

/**
 * Die Vierecke einer Textmarkierung, je Zeile eines.
 *
 * `/QuadPoints` steht flach: x1,y1 oben-links, x2,y2 oben-rechts, x3,y3
 * unten-links, x4,y4 unten-rechts — acht Zahlen je Zeile. Ein unvollstaendiger
 * Rest am Ende wird verworfen statt geraten.
 */
export function vierecke(quadPoints: readonly number[] | null): Kasten[] {
  if (quadPoints === null) return []
  const gefunden: Kasten[] = []
  for (let i = 0; i + 8 <= quadPoints.length; i += 8) {
    const roh = [
      quadPoints[i],
      quadPoints[i + 1],
      quadPoints[i + 2],
      quadPoints[i + 3],
      quadPoints[i + 4],
      quadPoints[i + 5],
      quadPoints[i + 6],
      quadPoints[i + 7]
    ]
    if (!roh.every((wert): wert is number => typeof wert === 'number')) continue
    const x = [roh[0], roh[2], roh[4], roh[6]] as number[]
    const y = [roh[1], roh[3], roh[5], roh[7]] as number[]
    const links = Math.min(...x)
    const rechts = Math.max(...x)
    const unten = Math.min(...y)
    const oben = Math.max(...y)
    gefunden.push({ links, unten, rechts, oben, breite: rechts - links, hoehe: oben - unten })
  }
  return gefunden
}

/** Ein gefuelltes Rechteck. */
function flaeche(links: number, unten: number, breite: number, hoehe: number): string {
  return zahl(links) + ' ' + zahl(unten) + ' ' + zahl(breite) + ' ' + zahl(hoehe) + ' re f'
}

function markierung(annotation: Annotation): Inhalt {
  // `/GS0 gs` setzt den Mischmodus. Ohne ihn legt sich eine deckende Flaeche
  // ueber den Text, und in einem fremden Betrachter ist die Stelle danach
  // unlesbar - das Gegenteil einer Markierung.
  const zeilen = ['/' + GS_NAME + ' gs', farbanweisung(annotation.farbe, true, GELB)]
  for (const feld of vierecke(annotation.quadPoints)) {
    zeilen.push(flaeche(feld.links, feld.unten, feld.breite, feld.hoehe))
  }
  return {
    strom: zeilen.join('\n'),
    bedarf: { multiplizieren: true, schrift: false, bild: false }
  }
}

/**
 * Unterstreichen und Durchstreichen.
 *
 * Die Dicke kommt aus der Zeilenhoehe und nicht aus `strichstaerke`: bei
 * Text-Markup hat das Feld keine Bedeutung (siehe shared/annotations.ts), und
 * eine feste Staerke saehe unter einer Ueberschrift zu duenn und in einer
 * Fussnote zu dick aus.
 */
function strichMarkup(annotation: Annotation, anteilVonUnten: number): Inhalt {
  const zeilen = [farbanweisung(annotation.farbe, true, SCHWARZ)]
  for (const feld of vierecke(annotation.quadPoints)) {
    const dicke = Math.max(0.6, feld.hoehe * MARKUP_DICKE)
    zeilen.push(flaeche(feld.links, feld.unten + feld.hoehe * anteilVonUnten, feld.breite, dicke))
  }
  return { strom: zeilen.join('\n'), bedarf: OHNE }
}

function strichstaerke(annotation: Annotation): number {
  const wert = annotation.strichstaerke
  return wert !== null && wert > 0 ? wert : STANDARD_STRICH
}

function freihand(annotation: Annotation): Inhalt {
  const breite = strichstaerke(annotation)
  const zeilen = [
    farbanweisung(annotation.farbe, false, SCHWARZ),
    zahl(breite) + ' w',
    // Runde Enden und Ecken: ein Zug aus vielen kurzen Strecken saehe mit
    // eckigen Enden an jeder Richtungsaenderung ausgefranst aus.
    '1 J',
    '1 j'
  ]
  for (const zug of annotation.striche ?? []) {
    const punkte: [number, number][] = []
    for (let i = 0; i + 2 <= zug.length; i += 2) {
      const x = zug[i]
      const y = zug[i + 1]
      if (typeof x === 'number' && typeof y === 'number') punkte.push([x, y])
    }
    const erster = punkte[0]
    if (erster === undefined) continue
    const teile = [zahl(erster[0]) + ' ' + zahl(erster[1]) + ' m']
    for (const [x, y] of punkte.slice(1)) teile.push(zahl(x) + ' ' + zahl(y) + ' l')
    // Ein einzelner Punkt: mit runden Enden ergibt die Strecke auf sich selbst
    // einen Punkt. Ohne diesen Zweig zeichnete ein Tipp gar nichts.
    if (punkte.length === 1) teile.push(zahl(erster[0]) + ' ' + zahl(erster[1]) + ' l')
    teile.push('S')
    zeilen.push(teile.join('\n'))
  }
  return { strom: zeilen.join('\n'), bedarf: OHNE }
}

function rechteck(annotation: Annotation): Inhalt {
  const breite = strichstaerke(annotation)
  const k = kasten(annotation.rect)
  // Um die halbe Strichstaerke einruecken: ein Strich sitzt mittig auf dem
  // Pfad, und ohne das laege seine aeussere Haelfte ausserhalb der /BBox und
  // wuerde abgeschnitten.
  const rand = breite / 2
  return {
    strom: [
      farbanweisung(annotation.farbe, false, SCHWARZ),
      zahl(breite) + ' w',
      zahl(k.links + rand) +
        ' ' +
        zahl(k.unten + rand) +
        ' ' +
        zahl(Math.max(0, k.breite - breite)) +
        ' ' +
        zahl(Math.max(0, k.hoehe - breite)) +
        ' re S'
    ].join('\n'),
    bedarf: OHNE
  }
}

function ellipse(annotation: Annotation): Inhalt {
  const breite = strichstaerke(annotation)
  const k = kasten(annotation.rect)
  const rand = breite / 2
  const rx = Math.max(0, k.breite / 2 - rand)
  const ry = Math.max(0, k.hoehe / 2 - rand)
  const cx = k.links + k.breite / 2
  const cy = k.unten + k.hoehe / 2
  const dx = rx * KAPPA
  const dy = ry * KAPPA

  const kurve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): string =>
    [zahl(x1), zahl(y1), zahl(x2), zahl(y2), zahl(x3), zahl(y3), 'c'].join(' ')

  return {
    strom: [
      farbanweisung(annotation.farbe, false, SCHWARZ),
      zahl(breite) + ' w',
      zahl(cx + rx) + ' ' + zahl(cy) + ' m',
      kurve(cx + rx, cy + dy, cx + dx, cy + ry, cx, cy + ry),
      kurve(cx - dx, cy + ry, cx - rx, cy + dy, cx - rx, cy),
      kurve(cx - rx, cy - dy, cx - dx, cy - ry, cx, cy - ry),
      kurve(cx + dx, cy - ry, cx + rx, cy - dy, cx + rx, cy),
      'S'
    ].join('\n'),
    bedarf: OHNE
  }
}

/**
 * Das Symbol einer Notiz: ein Sprechblasenkoerper mit kleiner Spitze und zwei
 * angedeuteten Textzeilen.
 *
 * Ein fremder Betrachter zeichnet fuer `/Text` **kein** eigenes Symbol, wenn
 * ein `/AP` da ist — er zeigt genau das hier. Deshalb muss es auch bei
 * Briefmarkengroesse noch als Notiz zu erkennen sein.
 */
function notiz(annotation: Annotation): Inhalt {
  const k = kasten(annotation.rect)
  const koerperHoehe = k.hoehe * 0.78
  const unten = k.unten + (k.hoehe - koerperHoehe)
  const strich = Math.max(0.5, Math.min(k.breite, k.hoehe) * 0.06)

  const zeilen = [
    farbanweisung(annotation.farbe, true, GELB),
    farbanweisung(SCHWARZ, false, SCHWARZ),
    zahl(strich) + ' w',
    '1 j',
    // Koerper: fuellen und umranden in einem Zug.
    zahl(k.links + strich) +
      ' ' +
      zahl(unten) +
      ' ' +
      zahl(Math.max(0, k.breite - strich * 2)) +
      ' ' +
      zahl(Math.max(0, koerperHoehe - strich)) +
      ' re',
    'B'
  ]

  // Die Spitze unten links, als gefuelltes Dreieck in derselben Farbe.
  const spitzeX = k.links + k.breite * 0.28
  const spitzeBreite = k.breite * 0.22
  zeilen.push(
    farbanweisung(annotation.farbe, true, GELB),
    zahl(spitzeX) + ' ' + zahl(unten + strich / 2) + ' m',
    zahl(spitzeX + spitzeBreite) + ' ' + zahl(unten + strich / 2) + ' l',
    zahl(spitzeX) + ' ' + zahl(k.unten) + ' l',
    'f'
  )

  // Zwei Textzeilen als Andeutung.
  zeilen.push(farbanweisung(SCHWARZ, true, SCHWARZ))
  for (const anteil of [0.45, 0.62]) {
    zeilen.push(
      flaeche(
        k.links + k.breite * 0.25,
        k.unten + k.hoehe * anteil,
        k.breite * 0.5,
        Math.max(0.4, k.hoehe * 0.06)
      )
    )
  }

  return { strom: zeilen.join('\n'), bedarf: OHNE }
}

/** Was auf einem Stempel steht, wenn er keinen eigenen Text traegt. */
export const STEMPEL_ERSATZ = 'Stempel'

/**
 * Ein Stempel: gestrichelter Rahmen mit mittigem Text — dieselbe Bildsprache
 * wie auf dem Bildschirm.
 *
 * Der einzige Typ, der eine Schrift braucht. Ohne sie entsteht nur der Rahmen;
 * einen Text ohne Schriftressource zu setzen ergaebe einen Strom, den manche
 * Betrachter stillschweigend verwerfen.
 */
function stempel(annotation: Annotation, schrift: Schrift | null): Inhalt {
  const breite = strichstaerke(annotation)
  const k = kasten(annotation.rect)
  const rand = breite / 2
  const zeilen = [
    farbanweisung(annotation.farbe, false, SCHWARZ),
    zahl(breite) + ' w',
    '[' + zahl(Math.max(1, k.breite * 0.03)) + '] 0 d',
    zahl(k.links + rand) +
      ' ' +
      zahl(k.unten + rand) +
      ' ' +
      zahl(Math.max(0, k.breite - breite)) +
      ' ' +
      zahl(Math.max(0, k.hoehe - breite)) +
      ' re S',
    // Strichmuster zuruecksetzen, damit es nicht in den Text hineinwirkt.
    '[] 0 d'
  ]

  if (schrift === null) return { strom: zeilen.join('\n'), bedarf: OHNE }

  const text = annotation.inhalt.trim().length > 0 ? annotation.inhalt.trim() : STEMPEL_ERSATZ
  const beiEins = schrift.breiteVon(text, 1)
  // Zwei Grenzen, die kleinere gewinnt: die Hoehe des Stempels und seine
  // Breite. Ohne die zweite ragte "Vertraulich" seitlich heraus.
  const nachHoehe = k.hoehe * 0.5
  const nachBreite = beiEins > 0 ? (k.breite * 0.82) / beiEins : nachHoehe
  const groesse = Math.max(1, Math.min(nachHoehe, nachBreite))
  const textbreite = schrift.breiteVon(text, groesse)

  zeilen.push(
    'BT',
    '/' + SCHRIFT_NAME + ' ' + zahl(groesse) + ' Tf',
    farbanweisung(annotation.farbe, true, SCHWARZ),
    // Die Grundlinie liegt etwa ein Drittel der Schriftgroesse unter der Mitte;
    // so sitzt die Versalhoehe mittig im Rahmen.
    zahl(k.links + (k.breite - textbreite) / 2) +
      ' ' +
      zahl(k.unten + k.hoehe / 2 - groesse * 0.35) +
      ' Td',
    schrift.kodiere(text) + ' Tj',
    'ET'
  )

  return {
    strom: zeilen.join('\n'),
    bedarf: { multiplizieren: false, schrift: true, bild: false }
  }
}

/**
 * Ein Stempel mit Bild — die grafische Signatur (S3.2, Aufgabe 4).
 *
 * Das Bild fuellt das `/Rect` vollstaendig: `cm` skaliert das Einheitsquadrat
 * des Bild-XObjects auf Breite und Hoehe, verschoben an die linke untere
 * Ecke. Das Seitenverhaeltnis hat der Renderer beim Anlegen des Rechtecks
 * bereits gewahrt; hier wird nichts mehr gerechnet, was falsch werden kann.
 */
function bildstempel(annotation: Annotation): Inhalt {
  const k = kasten(annotation.rect)
  return {
    strom: [
      'q',
      [zahl(k.breite), '0', '0', zahl(k.hoehe), zahl(k.links), zahl(k.unten), 'cm'].join(' '),
      '/' + BILD_NAME + ' Do',
      'Q'
    ].join('\n'),
    bedarf: { multiplizieren: false, schrift: false, bild: true }
  }
}

/** Kleiner Innenrand, damit Glyphen nicht auf der `/Rect`-Kante sitzen. */
const FREITEXT_RAND = 2

/** Zeilenabstand relativ zur Schriftgroesse — knapper als bei Fliesstext, wie in Notiz-Editoren ueblich. */
const FREITEXT_ZEILENHOEHE = 1.18

/**
 * Weicher Zeilenumbruch (S6.5, Aufgabe 1: mehrzeilig).
 *
 * Zuerst an vorhandenen Zeilenumbruechen des Nutzers trennen, dann jede
 * Zeile gierig nach Woertern umbrechen. Ein einzelnes Wort, das breiter ist
 * als `maxBreite`, wird zeichenweise gebrochen — sonst entstuende eine
 * Endlosschleife, die nie vorankommt (etwa bei einer sehr langen URL ohne
 * Leerzeichen).
 */
export function zeilenUmbrechen(
  text: string,
  schrift: Schrift,
  groesse: number,
  maxBreite: number,
  maxZeilen = Number.POSITIVE_INFINITY
): string[] {
  const zeilen: string[] = []
  const breite = (s: string): number => schrift.breiteVon(s, groesse)
  // Linear statt quadratisch (Gate Phase 6, M4): die Zeilenbreite wird
  // fortgeschrieben, statt fuer jedes Wort und jedes Zeichen die ganze
  // bisherige Zeile neu zu messen. Der Zuwachs wird am letzten Zeichen der
  // Zeile gemessen, damit die Unterschneidung am Uebergang mitzaehlt.
  const zuwachs = (zeile: string, anhang: string): number => {
    const letztes = letztesZeichen(zeile)
    return breite(letztes + anhang) - breite(letztes)
  }
  const fuege = (zeile: string): boolean => {
    zeilen.push(zeile)
    return zeilen.length < maxZeilen
  }
  if (maxZeilen <= 0) return zeilen
  for (const absatz of text.split(/\r\n|\r|\n/)) {
    if (absatz.length === 0) {
      if (!fuege('')) return zeilen
      continue
    }
    let aktuell = ''
    let aktuellBreite = 0
    for (const wort of absatz.split(' ')) {
      const kandidatBreite =
        aktuell.length === 0 ? breite(wort) : aktuellBreite + zuwachs(aktuell, ' ' + wort)
      if (maxBreite <= 0 || kandidatBreite <= maxBreite || aktuell.length === 0) {
        // `aktuell.length === 0`: ein einzelnes zu breites Wort trotzdem
        // setzen, statt es vor sich selbst umzubrechen zu versuchen.
        aktuell = aktuell.length === 0 ? wort : aktuell + ' ' + wort
        aktuellBreite = kandidatBreite
        continue
      }
      if (!fuege(aktuell)) return zeilen
      aktuell = wort
      aktuellBreite = breite(wort)
    }
    // Ein einzelnes Wort, das immer noch breiter als `maxBreite` ist:
    // zeichenweise weiter zerlegen, damit die Schleife oben terminiert.
    if (maxBreite > 0 && breite(aktuell) > maxBreite) {
      let stueck = ''
      let stueckBreite = 0
      for (const zeichen of aktuell) {
        if (stueck.length === 0) {
          stueck = zeichen
          stueckBreite = breite(zeichen)
          continue
        }
        const naechsteBreite = stueckBreite + zuwachs(stueck, zeichen)
        if (naechsteBreite > maxBreite) {
          if (!fuege(stueck)) return zeilen
          stueck = zeichen
          stueckBreite = breite(zeichen)
        } else {
          stueck += zeichen
          stueckBreite = naechsteBreite
        }
      }
      if (stueck.length > 0 && !fuege(stueck)) return zeilen
      continue
    }
    if (!fuege(aktuell)) return zeilen
  }
  return zeilen
}

/** Das letzte Zeichen (Codepunkt) eines Textes. */
function letztesZeichen(s: string): string {
  const letzte = s.charCodeAt(s.length - 1)
  const tief = letzte >= 0xdc00 && letzte <= 0xdfff && s.length >= 2
  return s.slice(tief ? -2 : -1)
}

/**
 * Mehr Zeichen setzt das Erscheinungsbild eines `/FreeText` nicht (Gate
 * Phase 6, M4) - eine Notiz dieser Laenge laeuft ohnehin weit ueber ihr
 * Rechteck hinaus.
 */
export const MAX_FREITEXT_ZEICHEN = 20_000

/**
 * Freier Text (S6.5): mehrzeilig, mit Ausrichtung, in der gewaehlten Schrift.
 *
 * Jede Zeile ein eigener `BT`/`ET`-Block: das macht die Ausrichtung einfach
 * (jede Zeile hat ihre eigene Breite und damit ihren eigenen linken Rand),
 * auf Kosten eines etwas laengeren Stroms — bei Notizgroesse ohne Bedeutung.
 * `/BBox` schneidet ueberlaufenden Text ab (Modulkommentar oben); das ist
 * gewollt, nicht ein Fehler dieses Moduls.
 */
function freitext(annotation: Annotation, schrift: Schrift): Inhalt {
  const k = kasten(annotation.rect)
  const groesse =
    annotation.schriftGroesse !== undefined && annotation.schriftGroesse > 0
      ? annotation.schriftGroesse
      : STANDARD_SCHRIFTGROESSE
  const ausrichtung = annotation.ausrichtung ?? STANDARD_AUSRICHTUNG
  const maxBreite = Math.max(0, k.breite - FREITEXT_RAND * 2)
  const zeilenhoehe = groesse * FREITEXT_ZEILENHOEHE
  // Erste Grundlinie: ein Stueck unter der Oberkante, damit die Versalhoehe
  // nicht ueber das Rechteck hinausragt.
  const y0 = k.oben - FREITEXT_RAND - groesse * 0.82
  // Nur so viele Zeilen umbrechen, wie die Schleife unten zeichnen kann (M4);
  // eine Zeile Reserve gegen Rundung.
  const sichtbar = Math.max(0, Math.floor((y0 - (k.unten - groesse)) / zeilenhoehe) + 2)
  const zeilen = zeilenUmbrechen(
    annotation.inhalt.slice(0, MAX_FREITEXT_ZEICHEN),
    schrift,
    groesse,
    maxBreite,
    sichtbar
  )

  const zeichenketten: string[] = [farbanweisung(annotation.farbe, true, SCHWARZ)]
  let y = y0
  for (const zeile of zeilen) {
    if (y < k.unten - groesse) break
    const breite = schrift.breiteVon(zeile, groesse)
    const x =
      ausrichtung === 'mitte'
        ? k.links + (k.breite - breite) / 2
        : ausrichtung === 'rechts'
          ? k.rechts - FREITEXT_RAND - breite
          : k.links + FREITEXT_RAND
    zeichenketten.push(
      'BT',
      '/' + SCHRIFT_NAME + ' ' + zahl(groesse) + ' Tf',
      zahl(x) + ' ' + zahl(y) + ' Td',
      schrift.kodiere(zeile) + ' Tj',
      'ET'
    )
    y -= zeilenhoehe
  }

  return {
    strom: zeichenketten.join('\n'),
    bedarf: { multiplizieren: false, schrift: true, bild: false }
  }
}

/**
 * Der Inhaltsstrom fuer eine Annotation — in **Seitenkoordinaten**, weil
 * `/BBox` gleich `/Rect` und `/Matrix` die Einheitsmatrix ist.
 *
 * `null` fuer Typen ohne eigenes Bild: ein `/Link` ist eine Flaeche und kein
 * Zeichen, und ein unbekannter Typ bringt sein Aussehen selbst mit.
 */
export function inhaltFuer(annotation: Annotation, schrift: Schrift | null): Inhalt | null {
  switch (annotation.typ) {
    case 'Highlight':
      return markierung(annotation)
    case 'Underline':
      return strichMarkup(annotation, 0.06)
    case 'StrikeOut':
      return strichMarkup(annotation, 0.42)
    case 'Ink':
      return freihand(annotation)
    case 'Square':
      return rechteck(annotation)
    case 'Circle':
      return ellipse(annotation)
    case 'Text':
      return notiz(annotation)
    case 'Stamp':
      return annotation.bild !== undefined ? bildstempel(annotation) : stempel(annotation, schrift)
    case 'FreeText':
      // Ohne Schrift kein Text - aber auch kein `null`: eine leere Flaeche
      // waere fuer eine Textannotation ein schlechterer Rueckfall als gar
      // kein /AP (dann zeichnet diese Anwendung ihre eigene Vorschau weiter).
      return schrift === null ? null : freitext(annotation, schrift)
    default:
      return null
  }
}

/** Braucht dieser Typ eine Schrift im Ressourcenverzeichnis? */
export function brauchtSchrift(annotation: Annotation): boolean {
  return (
    (annotation.typ === 'Stamp' && annotation.bild === undefined) || annotation.typ === 'FreeText'
  )
}

/** Traegt diese Annotation ein Bild, das als XObject eingebettet werden muss? */
export function brauchtBild(annotation: Annotation): boolean {
  return annotation.typ === 'Stamp' && annotation.bild !== undefined
}

/**
 * Darf ein **vorhandenes** `/AP` ersetzt werden?
 *
 * Fuer Typen, deren Aussehen sich vollstaendig aus den gefuehrten Feldern
 * ergibt: immer. Fuer Stempel und Notizen nur, wenn keines da ist — ein fremdes
 * Dokument kann dort ein eingescanntes Firmenzeichen oder ein eigenes Symbol
 * hinterlegt haben, und das zu ueberschreiben waere Datenverlust an einer
 * Stelle, an der wir nicht wissen, was wir wegnehmen.
 *
 * Folge, bewusst in Kauf genommen: faerbt jemand einen fremden Stempel um,
 * sieht man das in paperlane, in einem fremden Betrachter aber erst, wenn der
 * selbst neu zeichnet. Der umgekehrte Fehler waere schlimmer.
 */
export function darfErsetzen(annotation: Annotation, hatBereitsAp: boolean): boolean {
  if (!hatBereitsAp) return true
  return VOLLSTAENDIG_ABGELEITET.includes(annotation.typ)
}

/**
 * Baut das `/AP`-Verzeichnis mit seinem `/N`-Stream.
 *
 * `null`, wenn der Typ kein Bild braucht. Der Strom wird **nicht** komprimiert:
 * er ist klein, und ein lesbarer Strom laesst sich in einem kaputten Dokument
 * mit einem Texteditor nachsehen — bei R1 ist das die paar hundert Byte wert.
 */
/** Eine eingebettete Schrift mit ihrer Objektreferenz, fuer genau eine Familie+Stil-Kombination. */
export interface EingebetteteSchrift {
  ref: PDFRef
  schrift: Schrift
}

export function erscheinungFuer(
  annotation: Annotation,
  kontext: PDFContext,
  /**
   * Ein Nachschlag statt einer einzelnen Schrift: ein Dokument kann mehrere
   * `/FreeText` in verschiedenen Familien und Stilen tragen, jede Annotation
   * braucht ihre eigene (S6.5). `null`, wenn fuer diese Annotation keine
   * Schrift noetig oder keine eingebettet ist.
   */
  schriftFuer: (annotation: Annotation) => EingebetteteSchrift | null,
  bildRef: PDFRef | null = null
): PDFDict | null {
  const eingebettet = schriftFuer(annotation)
  const inhalt = inhaltFuer(annotation, eingebettet?.schrift ?? null)
  if (inhalt === null) return null
  // Ein Bildstempel ohne eingebettetes Bild ergaebe einen Strom, der auf ein
  // fehlendes XObject zeigt - in manchen Betrachtern ein Fehler, in anderen
  // eine leere Flaeche. Dann lieber gar kein /AP; die Aufrufstelle bettet
  // das Bild vorher ein.
  if (inhalt.bedarf.bild && bildRef === null) return null

  // Schon fertige PDF-Objekte statt verschachtelter Literale: `obj` ist je
  // Literaltyp ueberladen, und eine Union trifft keine der Ueberladungen.
  const ressourcen: Record<string, PDFObject> = {}
  if (inhalt.bedarf.multiplizieren) {
    ressourcen['ExtGState'] = kontext.obj({
      [GS_NAME]: kontext.obj({ Type: 'ExtGState', BM: 'Multiply' })
    })
  }
  if (inhalt.bedarf.schrift && eingebettet !== null) {
    ressourcen['Font'] = kontext.obj({ [SCHRIFT_NAME]: eingebettet.ref })
  }
  if (inhalt.bedarf.bild && bildRef !== null) {
    ressourcen['XObject'] = kontext.obj({ [BILD_NAME]: bildRef })
  }

  const strom = kontext.stream(inhalt.strom, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    // Gleich dem /Rect - siehe Modulkommentar. Der Betrachter bildet /BBox auf
    // /Rect ab; sind beide gleich, ist die Abbildung die Identitaet.
    BBox: [...annotation.rect],
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: ressourcen
  })

  const ap = kontext.obj({})
  ap.set(PDFName.of('N'), kontext.register(strom))
  return ap
}
