import type { WordBlock, WordLauf, WordSeite } from '../../shared/ipc'

/**
 * PDF nach Word (S6.7, D19) - die reinen Funktionen der Renderer-Seite.
 *
 * pdf.js liefert Text als Stuecke mit Position (`getTextContent`) und Bilder
 * als Aufrufe in der Operatorliste. Beides ist kein Absatz: ein Absatz ist
 * eine Vermutung aus Grundlinie, Zeilenabstand, Einzug und Zeilenlaenge. Die
 * Vermutung steht hier, frei von pdf.js und Canvas, damit sie ohne laufende
 * Anwendung pruefbar ist. Die Anbindung an pdf.js liegt in `word-extraktion.ts`.
 *
 * Das Layout ist bewusst grob (R16): Lesereihenfolge ist die Reihenfolge des
 * Inhaltsstroms; Spalten, Tabellen und Kopfzeilen werden nicht erkannt.
 */

/** Ein Textstueck von pdf.js in PDF-Punkten, y waechst nach oben. */
export interface Textstueck {
  text: string
  /** Anfang der Grundlinie. */
  x: number
  y: number
  breite: number
  groesse: number
  fett: boolean
  kursiv: boolean
}

/** Ein Bild der Seite, schon als PNG, mit seiner Lage in PDF-Punkten. */
export interface Bildstueck {
  png: Uint8Array
  links: number
  oben: number
  breitePt: number
  hoehePt: number
}

/** Was eine Seite hergibt, bevor Absaetze gebildet werden. */
export interface RohSeite {
  breitePt: number
  hoehePt: number
  stuecke: Textstueck[]
  bilder: Bildstueck[]
}

/** Eine Textzeile: Laeufe gleicher Grundlinie. */
export interface Zeile {
  laeufe: WordLauf[]
  y: number
  links: number
  rechts: number
  /** Groesste Schrift der Zeile, Leerzeichen nicht mitgezaehlt. */
  groesse: number
}

/** Halbe Punkte - feiner unterscheidet Word nicht. */
function halbpunkt(groesse: number): number {
  return Math.round(groesse * 2) / 2
}

/**
 * Fett und kursiv aus dem Schriftnamen, soweit er es verraet (Aufgabe 1),
 * dazu die Merkmale, die pdf.js aus dem Schriftdeskriptor liest. Das
 * Teilmengen-Praefix (`ABCDEF+`) wird vorher abgeschnitten, sonst traefe
 * `/bold/` auf zufaellige Buchstaben nicht - aber `/it/` womoeglich doch.
 */
export function stilAusSchrift(
  name: string,
  merkmale: { bold?: unknown; italic?: unknown } = {}
): { fett: boolean; kursiv: boolean } {
  const rein = name.replace(/^[A-Z]{6}\+/, '')
  const fett =
    merkmale.bold === true ||
    /bold|black|heavy|fett|[-,_ ]bd$|^cmbx?\d/i.test(rein) ||
    /semibold|demi/i.test(rein)
  const kursiv =
    merkmale.italic === true ||
    /italic|oblique|kursiv|slanted|[-,_ ]it$|[-,_ ]ital|^cm(ti|sl|mi)\d/i.test(rein)
  return { fett, kursiv }
}

function letzterLauf(zeile: Zeile): WordLauf | undefined {
  return zeile.laeufe[zeile.laeufe.length - 1]
}

/** Haengt Text an; gleiche Auszeichnung verlaengert den letzten Lauf. */
function haengeAn(laeufe: WordLauf[], neu: WordLauf): void {
  const letzter = laeufe[laeufe.length - 1]
  if (
    letzter !== undefined &&
    letzter.fett === neu.fett &&
    letzter.kursiv === neu.kursiv &&
    letzter.groessePt === neu.groessePt
  ) {
    letzter.text += neu.text
    return
  }
  laeufe.push({ ...neu })
}

function laufAus(stueck: Textstueck): WordLauf {
  return {
    text: stueck.text,
    fett: stueck.fett,
    kursiv: stueck.kursiv,
    groessePt: halbpunkt(stueck.groesse)
  }
}

function istLeer(text: string): boolean {
  return text.trim().length === 0
}

/**
 * Stuecke gleicher Grundlinie werden eine Zeile (Aufgabe 1). "Gleich" heisst:
 * weniger als eine halbe Schriftgroesse auseinander - so bleiben Hoch- und
 * Tiefstellungen in ihrer Zeile. Eine Luecke zwischen zwei Stuecken, die kein
 * Leerzeichen traegt, bekommt eines: pdf.js setzt Woerter oft als getrennte
 * Stuecke ohne das Leerzeichen dazwischen.
 */
export function bildeZeilen(stuecke: readonly Textstueck[]): Zeile[] {
  const zeilen: Zeile[] = []
  let aktuell: Zeile | null = null
  for (const stueck of stuecke) {
    if (stueck.text.length === 0) continue
    const leer = istLeer(stueck.text)
    if (
      aktuell !== null &&
      Math.abs(stueck.y - aktuell.y) <= 0.5 * Math.max(stueck.groesse, aktuell.groesse)
    ) {
      const vorher = letzterLauf(aktuell)?.text ?? ''
      const luecke = stueck.x - aktuell.rechts
      if (
        luecke > 0.2 * Math.max(stueck.groesse, aktuell.groesse) &&
        !/\s$/.test(vorher) &&
        !/^\s/.test(stueck.text)
      ) {
        haengeAn(aktuell.laeufe, { ...laufAus(stueck), text: ' ' })
      }
      haengeAn(aktuell.laeufe, laufAus(stueck))
      aktuell.rechts = Math.max(aktuell.rechts, stueck.x + stueck.breite)
      if (!leer) aktuell.groesse = Math.max(aktuell.groesse, stueck.groesse)
      continue
    }
    // Ein Leerzeichen allein beginnt keine Zeile.
    if (leer) continue
    aktuell = {
      laeufe: [laufAus(stueck)],
      y: stueck.y,
      links: stueck.x,
      rechts: stueck.x + stueck.breite,
      groesse: stueck.groesse
    }
    zeilen.push(aktuell)
  }
  return zeilen
}

/**
 * Wo endet der Satzspiegel rechts? Das 75. Perzentil der Zeilenenden: eine
 * einzelne ueberbreite Zeile (eine Tabelle, eine Fussnote am Rand) soll nicht
 * jede andere Zeile zur "kurzen" Zeile machen.
 */
export function rechterRand(zeilen: readonly Zeile[]): number {
  if (zeilen.length === 0) return 0
  const enden = zeilen.map((zeile) => zeile.rechts).sort((a, b) => a - b)
  return enden[Math.floor((enden.length - 1) * 0.75)] ?? 0
}

/**
 * Zeilen zu Absaetzen (Aufgabe 1). Ein neuer Absatz beginnt, wenn
 *
 * - die Schriftgroesse deutlich wechselt (Ueberschrift und Fliesstext),
 * - der Abstand zur vorigen Zeile groesser ist als im Absatz bisher ueblich
 *   (bei der zweiten Zeile: groesser als 1,75 Schriftgroessen),
 * - die Zeile nicht darunter liegt (neue Spalte, neuer Block),
 * - sie deutlich weiter rechts beginnt als die vorige (Erstzeileneinzug),
 * - oder die vorige Zeile weit vor dem rechten Rand endete.
 */
export function bildeAbsaetze(zeilen: readonly Zeile[], rand = rechterRand(zeilen)): Zeile[][] {
  const absaetze: Zeile[][] = []
  let absatz: Zeile[] = []
  for (const zeile of zeilen) {
    const vorige = absatz[absatz.length - 1]
    if (vorige !== undefined && gehoertDazu(absatz, vorige, zeile, rand)) {
      absatz.push(zeile)
      continue
    }
    absatz = [zeile]
    absaetze.push(absatz)
  }
  return absaetze
}

function gehoertDazu(absatz: readonly Zeile[], vorige: Zeile, zeile: Zeile, rand: number): boolean {
  const groesser = Math.max(vorige.groesse, zeile.groesse)
  if (Math.abs(vorige.groesse - zeile.groesse) > 0.15 * groesser) return false
  const abstand = vorige.y - zeile.y
  if (abstand <= 0.3 * vorige.groesse) return false
  const erste = absatz[0]
  const zweite = absatz[1]
  if (erste !== undefined && zweite !== undefined) {
    if (abstand > (erste.y - zweite.y) * 1.3 + 0.5) return false
  } else if (abstand > 1.75 * groesser) {
    return false
  }
  if (zeile.links > vorige.links + 0.8 * zeile.groesse) return false
  if (vorige.rechts < rand - 4 * vorige.groesse) return false
  return true
}

/**
 * Haengt die Laeufe einer Zeile an einen Absatz. Die Silbentrennung am
 * Zeilenende wird zurueckgenommen (Aufgabe 1): ein weiches Trennzeichen
 * faellt immer weg, ein Bindestrich nach einem Buchstaben nur, wenn die
 * naechste Zeile klein weitergeht ("Mess-" + "werte" = "Messwerte", aber
 * "Nord-" + "Sued" = "Nord-Sued"). Sonst trennt ein Leerzeichen die Zeilen.
 */
export function verbindeZeile(laeufe: WordLauf[], zeile: Zeile): void {
  const letzter = laeufe[laeufe.length - 1]
  const erster = zeile.laeufe[0]
  if (letzter !== undefined && erster !== undefined) {
    const text = letzter.text
    if (text.endsWith('­')) {
      letzter.text = text.slice(0, -1)
    } else if (/\p{L}[-‐]$/u.test(text)) {
      if (/^\p{Ll}/u.test(erster.text)) letzter.text = text.slice(0, -1)
    } else if (/[-‐]$/.test(text)) {
      // "1990-" + "2000": der Strich bleibt, ein Leerzeichen kommt nicht dazu.
    } else if (!/\s$/.test(text) && !/^\s/.test(erster.text)) {
      letzter.text = text + ' '
    }
  }
  for (const lauf of zeile.laeufe) haengeAn(laeufe, lauf)
}

/** Leerzeichen zusammenfassen und die Raender des Absatzes beschneiden. */
function glaette(laeufe: WordLauf[]): WordLauf[] {
  const ergebnis: WordLauf[] = []
  let endetMitLeer = true
  for (const lauf of laeufe) {
    let text = lauf.text.replace(/\s+/g, ' ')
    if (endetMitLeer) text = text.replace(/^ /, '')
    if (text.length === 0) continue
    endetMitLeer = text.endsWith(' ')
    ergebnis.push({ ...lauf, text })
  }
  const letzter = ergebnis[ergebnis.length - 1]
  if (letzter !== undefined) {
    letzter.text = letzter.text.replace(/ $/, '')
    if (letzter.text.length === 0) ergebnis.pop()
  }
  return ergebnis
}

/** Die Groesse, in der die meisten Zeichen stehen. */
function vorherrschendeGroesse(laeufe: readonly WordLauf[]): number {
  const zaehler = new Map<number, number>()
  for (const lauf of laeufe) {
    const zeichen = lauf.text.replace(/\s/g, '').length
    zaehler.set(lauf.groessePt, (zaehler.get(lauf.groessePt) ?? 0) + zeichen)
  }
  let beste = 0
  let meiste = -1
  for (const [groesse, anzahl] of zaehler) {
    if (anzahl > meiste || (anzahl === meiste && groesse < beste)) {
      beste = groesse
      meiste = anzahl
    }
  }
  return beste
}

/**
 * Die Grundschrift des Dokuments: die Groesse mit den meisten Zeichen ueber
 * alle Seiten. An ihr misst sich, was Ueberschrift ist. Ohne Text 11 pt.
 */
export function grundgroesse(zeilen: readonly Zeile[]): number {
  const alle = zeilen.flatMap((zeile) => zeile.laeufe)
  return alle.length === 0 ? 11 : vorherrschendeGroesse(alle) || 11
}

/** Ueberschriftsebene aus der relativen Schriftgroesse (Aufgabe 1). */
export function ebeneFuer(groesse: number, grund: number, zeichen: number): 0 | 1 | 2 | 3 {
  // Lange Absaetze sind Fliesstext, auch in grosser Schrift.
  if (zeichen > 200 || grund <= 0) return 0
  const verhaeltnis = groesse / grund
  if (verhaeltnis >= 1.7) return 1
  if (verhaeltnis >= 1.35) return 2
  if (verhaeltnis >= 1.15) return 3
  return 0
}

/** Ein Absatz aus Zeilen, oder `null`, wenn nichts Lesbares uebrig bleibt. */
export function absatzBlock(zeilen: readonly Zeile[], grund: number): WordBlock | null {
  const laeufe: WordLauf[] = []
  for (const zeile of zeilen) {
    if (laeufe.length === 0) {
      for (const lauf of zeile.laeufe) haengeAn(laeufe, lauf)
    } else {
      verbindeZeile(laeufe, zeile)
    }
  }
  const geglaettet = glaette(laeufe)
  if (geglaettet.length === 0) return null
  const zeichen = geglaettet.reduce((summe, lauf) => summe + lauf.text.length, 0)
  const ebene = ebeneFuer(vorherrschendeGroesse(geglaettet), grund, zeichen)
  return { art: 'absatz', ebene, laeufe: geglaettet }
}

/** Kleiner als das ist Zierrat (Linien, Aufzaehlungspunkte als Bild). */
export const MIN_BILD_PT = 8

/**
 * Die Bloecke einer Seite: Absaetze in Lesereihenfolge, Bilder dazwischen
 * (Aufgabe 2). Ein Bild steht vor dem ersten Absatz, dessen Oberkante unter
 * der Oberkante des Bildes liegt; Bilder, unter denen kein Text mehr kommt,
 * stehen am Ende.
 */
export function bloeckeFuerSeite(seite: RohSeite, grund: number): WordBlock[] {
  const zeilen = bildeZeilen(seite.stuecke)
  const text: { oben: number; block: WordBlock }[] = []
  for (const absatz of bildeAbsaetze(zeilen)) {
    const erste = absatz[0]
    const block = absatzBlock(absatz, grund)
    if (erste === undefined || block === null) continue
    text.push({ oben: erste.y + erste.groesse * 0.8, block })
  }
  const offen = seite.bilder
    .filter((bild) => bild.breitePt >= MIN_BILD_PT && bild.hoehePt >= MIN_BILD_PT)
    .sort((a, b) => b.oben - a.oben || a.links - b.links)
  const bloecke: WordBlock[] = []
  const bildBlock = (bild: Bildstueck): WordBlock => ({
    art: 'bild',
    png: bild.png,
    breitePt: bild.breitePt,
    hoehePt: bild.hoehePt
  })
  for (const eintrag of text) {
    while (offen[0] !== undefined && offen[0].oben > eintrag.oben) {
      const bild = offen.shift()
      if (bild !== undefined) bloecke.push(bildBlock(bild))
    }
    bloecke.push(eintrag.block)
  }
  for (const bild of offen) bloecke.push(bildBlock(bild))
  return bloecke
}

/** Aus den Rohseiten die Seiten des Auftrags - die Grundschrift ueber alle. */
export function baueWordSeiten(seiten: readonly RohSeite[]): WordSeite[] {
  const grund = grundgroesse(seiten.flatMap((seite) => bildeZeilen(seite.stuecke)))
  return seiten.map((seite) => ({
    breitePt: seite.breitePt,
    hoehePt: seite.hoehePt,
    bloecke: bloeckeFuerSeite(seite, grund)
  }))
}

/** Hat die Seite lesbaren Text? Ein Scan ohne Texterkennung hat keinen (Aufgabe 5). */
export function hatText(stuecke: readonly { text: string }[]): boolean {
  return stuecke.some((stueck) => !istLeer(stueck.text))
}

// ---------------------------------------------------------------------------
// Bilder aus der Operatorliste (Aufgabe 2)
// ---------------------------------------------------------------------------

/**
 * Die Operatoren, die hier zaehlen, als Zahlen aus `OPS` von pdf.js. Nicht
 * importiert, damit dieses Modul ohne pdf.js auskommt; ein Unit-Test haelt
 * die Werte gegen die Bibliothek (Muster `ANNOTATIONSMODUS_AUS`).
 */
export const OP = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageXObject: 85,
  paintInlineImageXObject: 86
} as const

/** `ImageKind` von pdf.js - dieselbe Begruendung. */
export const BILDART = { grau1bit: 1, rgb: 2, rgba: 3 } as const

type Matrix = [number, number, number, number, number, number]

const EINHEIT: Matrix = [1, 0, 0, 1, 0, 0]

function istMatrix(wert: unknown): wert is Matrix {
  return (
    Array.isArray(wert) &&
    wert.length === 6 &&
    wert.every((zahl) => typeof zahl === 'number' && Number.isFinite(zahl))
  )
}

/** `aktuell * neu` wie `ctx.transform` - neu wirkt zuerst. */
export function verkette(aktuell: Matrix, neu: Matrix): Matrix {
  const [a, b, c, d, e, f] = aktuell
  const [na, nb, nc, nd, ne, nf] = neu
  return [
    a * na + c * nb,
    b * na + d * nb,
    a * nc + c * nd,
    b * nc + d * nd,
    a * ne + c * nf + e,
    b * ne + d * nf + f
  ]
}

export interface Bildaufruf {
  /** Kennung in `objs`/`commonObjs` oder die Bilddaten selbst (Inline-Bild). */
  quelle: string | Record<string, unknown>
  links: number
  unten: number
  rechts: number
  oben: number
}

/**
 * Sucht die gemalten Bilder und ihre Lage. Ein Bild fuellt das
 * Einheitsquadrat unter der aktuellen Transformation; seine Lage ist dessen
 * Huelle. Verfolgt wird die Transformation ueber `save`/`restore`,
 * `transform` und die Form-XObjects - mehr braucht es fuer die Lage nicht.
 */
export function findeBilder(
  fnArray: readonly number[],
  argsArray: readonly unknown[]
): Bildaufruf[] {
  const stapel: Matrix[] = []
  let ctm: Matrix = EINHEIT
  const bilder: Bildaufruf[] = []
  fnArray.forEach((op, index) => {
    const args = argsArray[index]
    const liste = Array.isArray(args) ? (args as unknown[]) : []
    switch (op) {
      case OP.save:
      case OP.beginGroup:
        stapel.push(ctm)
        return
      case OP.restore:
      case OP.endGroup:
      case OP.paintFormXObjectEnd:
        ctm = stapel.pop() ?? ctm
        return
      case OP.transform:
        if (istMatrix(liste)) ctm = verkette(ctm, liste)
        return
      case OP.paintFormXObjectBegin: {
        stapel.push(ctm)
        const matrix = liste[0]
        if (istMatrix(matrix)) ctm = verkette(ctm, matrix)
        return
      }
      case OP.paintImageXObject:
      case OP.paintInlineImageXObject: {
        const quelle = liste[0]
        if (typeof quelle !== 'string' && (typeof quelle !== 'object' || quelle === null)) return
        const ecken = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1]
        ].map(([x = 0, y = 0]) => [
          ctm[0] * x + ctm[2] * y + ctm[4],
          ctm[1] * x + ctm[3] * y + ctm[5]
        ])
        const xs = ecken.map((ecke) => ecke[0] ?? 0)
        const ys = ecken.map((ecke) => ecke[1] ?? 0)
        bilder.push({
          quelle: quelle as string | Record<string, unknown>,
          links: Math.min(...xs),
          unten: Math.min(...ys),
          rechts: Math.max(...xs),
          oben: Math.max(...ys)
        })
        return
      }
      default:
        return
    }
  })
  return bilder
}

/**
 * Bilddaten von pdf.js als RGBA fuer `ImageData`. pdf.js liefert Bilder ohne
 * `bitmap` in drei Formen (`ImageKind`): 1 Bit Graustufen, zeilenweise auf
 * Bytes aufgefuellt und 1 = weiss; RGB mit 3 Bytes; RGBA mit 4. `null`, wenn
 * die Daten nicht zu den Massen passen.
 */
export function rgbaAusBilddaten(bild: {
  width: number
  height: number
  kind: number
  data: ArrayLike<number>
}): Uint8ClampedArray | null {
  const { width: breite, height: hoehe, kind, data } = bild
  if (!Number.isInteger(breite) || !Number.isInteger(hoehe) || breite <= 0 || hoehe <= 0) {
    return null
  }
  const ziel = new Uint8ClampedArray(breite * hoehe * 4)
  if (kind === BILDART.rgba) {
    if (data.length < ziel.length) return null
    for (let i = 0; i < ziel.length; i++) ziel[i] = data[i] ?? 0
    return ziel
  }
  if (kind === BILDART.rgb) {
    if (data.length < breite * hoehe * 3) return null
    for (let p = 0, q = 0; p < breite * hoehe; p++, q += 3) {
      ziel[p * 4] = data[q] ?? 0
      ziel[p * 4 + 1] = data[q + 1] ?? 0
      ziel[p * 4 + 2] = data[q + 2] ?? 0
      ziel[p * 4 + 3] = 255
    }
    return ziel
  }
  if (kind === BILDART.grau1bit) {
    const zeilenBytes = Math.ceil(breite / 8)
    if (data.length < zeilenBytes * hoehe) return null
    for (let y = 0; y < hoehe; y++) {
      for (let x = 0; x < breite; x++) {
        const byte = data[y * zeilenBytes + (x >> 3)] ?? 0
        const wert = (byte >> (7 - (x & 7))) & 1 ? 255 : 0
        const p = (y * breite + x) * 4
        ziel[p] = wert
        ziel[p + 1] = wert
        ziel[p + 2] = wert
        ziel[p + 3] = 255
      }
    }
    return ziel
  }
  return null
}
