/**
 * Zeilen fuer "Text bearbeiten" (S6.6b, ADR 0005): was der Nutzer als **eine
 * Zeile** anklickt, und woran der Main dieselbe Zeile im Content-Stream
 * wiederfindet.
 *
 * Eine Zeile sind pdf.js-Textelemente gleicher Richtung und Grundlinie, deren
 * Luecke kleiner als eine Schriftgroesse ist. Tabellenspalten auf derselben
 * Grundlinie werden damit getrennte Zeilen — genau die Einheit, die ADR 0005
 * festlegt (kein Absatz, kein Umbruch).
 *
 * Liegt in `shared` und ohne Importe: der Renderer bildet die Zeilen aus
 * `getTextContent`, der Main ordnet ihnen Glyphen zu. Beide rechnen in
 * PDF-Benutzerkoordinaten der Seite (vor jeder Ansichtsdrehung) — pdf.js legt
 * `transform` genau dort ab.
 */

/** Eine Zeile in Seitenkoordinaten. */
export interface TextZeile {
  /** Richtung der Grundlinie in ganzen Grad (0 = waagerecht nach rechts). */
  winkel: number
  /** Einheitsvektor der Leserichtung. */
  dx: number
  dy: number
  /** Abstand der Grundlinie vom Ursprung, senkrecht zur Leserichtung. */
  grundlinie: number
  /** Anfang und Ende entlang der Leserichtung. */
  von: number
  bis: number
  /** Schriftgroesse in Seiteneinheiten (die groesste der Zeile). */
  groesse: number
  /** Der Text, den pdf.js fuer diese Zeile liefert. */
  text: string
}

/** Das, was aus `getTextContent().items` gebraucht wird. */
export interface TextElement {
  str: string
  transform: readonly number[]
  width: number
}

/** Hoechstlaenge eines Ersatztextes - eine Zeile, kein Aufsatz. */
export const MAX_ZEILENTEXT = 2000

/**
 * Vergleichsform: Unicode-Kompatibilitaetszerlegung (Ligaturen "ﬁ" = "fi")
 * und ohne Leerraum, weil pdf.js Leerzeichen aus Abstaenden erfindet, die im
 * Stream als Verschiebung stehen - und umgekehrt.
 */
export function vergleichsform(text: string): string {
  return text.normalize('NFKC').replace(/[\s­​]/g, '')
}

function winkelAus(dx: number, dy: number): number {
  const grad = Math.round((Math.atan2(dy, dx) * 180) / Math.PI)
  return grad === -180 ? 180 : grad
}

interface Geometrie {
  winkel: number
  dx: number
  dy: number
  grundlinie: number
  von: number
  bis: number
  groesse: number
  text: string
}

function geometrie(element: TextElement): Geometrie | null {
  const [a, b, c, d, e, f] = element.transform
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined
  ) {
    return null
  }
  const laenge = Math.hypot(a, b)
  if (!Number.isFinite(laenge) || laenge === 0) return null
  const dx = a / laenge
  const dy = b / laenge
  const groesse = Math.hypot(c, d) || laenge
  const von = dx * e + dy * f
  return {
    winkel: winkelAus(dx, dy),
    dx,
    dy,
    grundlinie: -dy * e + dx * f,
    von,
    bis: von + (Number.isFinite(element.width) ? element.width : 0),
    groesse,
    text: element.str
  }
}

/**
 * Bildet die Zeilen einer Seite. Reihenfolge: nach Richtung, dann Grundlinie,
 * dann Anfang - stabil, damit die Nummerierung der Zeilen reproduzierbar ist.
 */
export function bildeZeilen(elemente: readonly TextElement[]): TextZeile[] {
  const geo: Geometrie[] = []
  for (const element of elemente) {
    if (typeof element.str !== 'string' || element.str.trim() === '') continue
    const g = geometrie(element)
    if (g !== null) geo.push(g)
  }
  geo.sort((u, v) => u.winkel - v.winkel || v.grundlinie - u.grundlinie || u.von - v.von)

  // Reihen: gleiche Richtung, Grundlinie innerhalb 0,3 Schriftgroessen.
  const reihen: { winkel: number; grundlinie: number; groesse: number; els: Geometrie[] }[] = []
  for (const g of geo) {
    const reihe = reihen.find(
      (r) =>
        r.winkel === g.winkel &&
        Math.abs(r.grundlinie - g.grundlinie) < 0.3 * Math.max(r.groesse, g.groesse)
    )
    if (reihe === undefined) {
      reihen.push({ winkel: g.winkel, grundlinie: g.grundlinie, groesse: g.groesse, els: [g] })
    } else reihe.els.push(g)
  }

  const zeilen: TextZeile[] = []
  for (const reihe of reihen) {
    reihe.els.sort((u, v) => u.von - v.von)
    let zeile: TextZeile | null = null
    for (const g of reihe.els) {
      const groesse = Math.max(g.groesse, zeile?.groesse ?? 0)
      if (zeile !== null && g.von - zeile.bis < groesse && g.von > zeile.von - 0.5) {
        zeile.text += (g.von - zeile.bis > 0.15 * groesse ? ' ' : '') + g.text
        zeile.bis = Math.max(zeile.bis, g.bis)
        zeile.groesse = groesse
      } else {
        zeile = {
          winkel: g.winkel,
          dx: g.dx,
          dy: g.dy,
          grundlinie: g.grundlinie,
          von: g.von,
          bis: g.bis,
          groesse: g.groesse,
          text: g.text
        }
        zeilen.push(zeile)
      }
    }
  }
  return zeilen
}

/**
 * Die vier Ecken der Zeile in Seitenkoordinaten (Grundlinie bis eine
 * Schriftgroesse darueber, dazu ein Viertel fuer Unterlaengen) - fuer die
 * Klickflaeche und das Eingabefeld.
 */
export function zeilenEcken(zeile: TextZeile): [number, number][] {
  const { dx, dy, grundlinie, von, bis, groesse } = zeile
  // Senkrecht zur Leserichtung, "nach oben" im Sinne der Schrift.
  const nx = -dy
  const ny = dx
  const punkt = (s: number, p: number): [number, number] => [dx * s + nx * p, dy * s + ny * p]
  const unten = grundlinie - 0.25 * groesse
  const oben = grundlinie + groesse
  return [punkt(von, unten), punkt(bis, unten), punkt(bis, oben), punkt(von, oben)]
}

function endlich(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert)
}

/** Prueft eine Zeile aus dem Renderer (fremde Eingabe fuer den Main). */
export function pruefeTextZeile(eingabe: unknown): TextZeile | null {
  if (typeof eingabe !== 'object' || eingabe === null) return null
  const w = eingabe as Record<string, unknown>
  const { winkel, dx, dy, grundlinie, von, bis, groesse, text } = w
  if (!endlich(winkel) || !endlich(dx) || !endlich(dy) || !endlich(grundlinie)) return null
  if (!endlich(von) || !endlich(bis) || !endlich(groesse)) return null
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_ZEILENTEXT) return null
  if (Math.abs(Math.hypot(dx, dy) - 1) > 1e-3 || groesse <= 0 || bis < von) return null
  return { winkel, dx, dy, grundlinie, von, bis, groesse, text }
}
