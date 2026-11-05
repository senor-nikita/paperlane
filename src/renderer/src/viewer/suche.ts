/**
 * Suchlogik als reine Funktionen.
 *
 * Der schwierige Teil ist nicht das Finden, sondern das Zurueckrechnen: pdf.js
 * liefert den Seitentext als Folge von Elementen, die mitten im Wort enden
 * koennen. Wer nur innerhalb einzelner Elemente sucht, findet "Wasserzeichen"
 * nicht, wenn es als "Wasser" und "zeichen" ankommt — der haeufigste Grund fuer
 * "findet nichts, obwohl es dasteht".
 */

/** Ein Textelement, wie pdf.js es liefert. */
export interface Textelement {
  str: string
  /** Ob nach diesem Element ein Zeilenumbruch folgt. */
  hasEOL?: boolean
}

export interface Seitentext {
  /** Alle Elemente aneinandergehaengt. */
  roh: string
  /** Startoffset jedes Elements im rohen Text. */
  starts: number[]
}

/**
 * Haengt die Elemente zusammen. Nach einem Zeilenumbruch kommt ein Leerzeichen,
 * damit das letzte Wort der Zeile nicht mit dem ersten der naechsten verschmilzt.
 */
export function baueSeitentext(elemente: readonly Textelement[]): Seitentext {
  const teile: string[] = []
  const starts: number[] = []
  let offset = 0
  for (const element of elemente) {
    starts.push(offset)
    teile.push(element.str)
    offset += element.str.length
    if (element.hasEOL === true) {
      teile.push(' ')
      offset += 1
    }
  }
  return { roh: teile.join(''), starts }
}

/**
 * Ligaturen, die pdf.js als ein Zeichen liefert. Ohne Aufloesung findet die
 * Suche nach "finden" nichts in einem Text, der die Ligatur fi verwendet.
 */
const LIGATUREN: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st'
}

export interface Normalisiert {
  text: string
  /** Zu jeder Position im normalisierten Text der Offset im rohen Text. */
  zuRoh: number[]
}

/**
 * Kleinschreibung, aufgeloeste Ligaturen und vereinheitlichte Leerzeichen.
 *
 * Die Laenge aendert sich dabei — eine Ligatur wird zu zwei Zeichen. Deshalb
 * wird zu jeder Position gemerkt, wo sie im Rohtext stand; ohne diese Abbildung
 * saessen die Trefferrechtecke daneben.
 */
export function normalisiere(roh: string, achteAufGrossschreibung: boolean): Normalisiert {
  const zeichen: string[] = []
  const zuRoh: number[] = []
  for (let i = 0; i < roh.length; i++) {
    const original = roh[i] ?? ''
    const ersatz = LIGATUREN[original] ?? original
    const angepasst = achteAufGrossschreibung ? ersatz : ersatz.toLowerCase()
    for (const einzeln of angepasst) {
      zeichen.push(einzeln)
      zuRoh.push(i)
    }
  }
  return { text: zeichen.join(''), zuRoh }
}

export interface Suchoptionen {
  achteAufGrossschreibung: boolean
  nurGanzeWoerter: boolean
}

export interface Treffer {
  /** Startoffset im Rohtext der Seite. */
  von: number
  /** Endoffset im Rohtext, ausschliesslich. */
  bis: number
}

const WORTZEICHEN = /[\p{L}\p{N}_]/u

function istWortgrenze(text: string, position: number): boolean {
  const zeichen = text[position]
  return zeichen === undefined || !WORTZEICHEN.test(zeichen)
}

export function findeTreffer(
  seitentext: Seitentext,
  suchbegriff: string,
  optionen: Suchoptionen
): Treffer[] {
  if (suchbegriff.length === 0) return []
  const heuhaufen = normalisiere(seitentext.roh, optionen.achteAufGrossschreibung)
  const nadel = normalisiere(suchbegriff, optionen.achteAufGrossschreibung).text
  if (nadel.length === 0) return []

  const treffer: Treffer[] = []
  let ab = 0
  for (;;) {
    const stelle = heuhaufen.text.indexOf(nadel, ab)
    if (stelle === -1) break
    ab = stelle + 1

    if (optionen.nurGanzeWoerter) {
      const davor = istWortgrenze(heuhaufen.text, stelle - 1)
      const danach = istWortgrenze(heuhaufen.text, stelle + nadel.length)
      if (!davor || !danach) continue
    }

    const von = heuhaufen.zuRoh[stelle]
    const letzte = heuhaufen.zuRoh[stelle + nadel.length - 1]
    if (von === undefined || letzte === undefined) continue
    treffer.push({ von, bis: letzte + 1 })
  }
  return treffer
}

export interface Elementbereich {
  /** Index des Textelements. */
  element: number
  /** Startoffset innerhalb des Elements. */
  von: number
  /** Endoffset innerhalb des Elements, ausschliesslich. */
  bis: number
}

/**
 * Auf welche Textelemente verteilt sich ein Treffer? Ein Treffer kann ueber
 * mehrere Elemente laufen, dann bekommt jedes seinen Anteil.
 */
export function zerlegeAufElemente(
  seitentext: Seitentext,
  elemente: readonly Textelement[],
  treffer: Treffer
): Elementbereich[] {
  const bereiche: Elementbereich[] = []
  elemente.forEach((element, index) => {
    const start = seitentext.starts[index]
    if (start === undefined) return
    const ende = start + element.str.length
    const von = Math.max(treffer.von, start)
    const bis = Math.min(treffer.bis, ende)
    if (von >= bis) return
    bereiche.push({ element: index, von: von - start, bis: bis - start })
  })
  return bereiche
}
