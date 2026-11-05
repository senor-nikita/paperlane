/**
 * Umrechnung zwischen PDF-Punkten und Bildschirmpixeln (S2.1, Aufgabe 5) —
 * im Plan `pdfToScreen` / `screenToPdf`.
 *
 * **Die fehleranfaelligste Stelle der Phase (Risiko R6).** Liegt die
 * Transformation falsch, verrutscht ab S2.2 alles bei Zoom oder Drehung, und
 * der Fehler faellt erst auf, wenn schon Annotationen darauf aufbauen. Deshalb
 * reine Funktionen mit Rundlauftests statt Rechnerei in einer Komponente.
 *
 * Die Matrix ist dieselbe, die pdf.js in `PageViewport` aufstellt — bewusst,
 * nicht zufaellig: die Ebene liegt ueber einem Canvas, das pdf.js mit genau
 * dieser Abbildung gezeichnet hat. Eine eigene Herleitung waere eine zweite
 * Fassung, die frueher oder spaeter um ein halbes Pixel abweicht.
 *
 * Die Argumente entsprechen dem, was `Seite.tsx` an `getViewport` uebergibt:
 * `ansicht` ist `PDFPageProxy.view` (die MediaBox in Benutzerkoordinaten),
 * `zoom` der Massstab in CSS-Pixeln je Punkt und `rotation` die Drehung, die
 * die Ansicht zeigt. Weichen die Werte hier von denen dort ab, driften Ebene
 * und Canvas auseinander.
 */

export interface Punkt {
  x: number
  y: number
}

/** Affine Abbildung `[a, b, c, d, e, f]`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. */
export type Matrix = readonly [number, number, number, number, number, number]

/** Achsenparalleles Rechteck in CSS-Pixeln, gemessen ab der linken oberen Seitenecke. */
export interface Bildschirmrechteck {
  links: number
  oben: number
  breite: number
  hoehe: number
}

function normiereDrehung(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360
}

/**
 * Stellt die Abbildung PDF → Bildschirm auf.
 *
 * `ansicht` ist `[x1, y1, x2, y2]`. Die Kanten muessen nicht sortiert sein —
 * die MediaBox mancher Dokumente steht auf dem Kopf, und die Betraege unten
 * fangen das ab, statt eine negative Hoehe weiterzureichen.
 */
export function baueTransformation(
  ansicht: readonly number[],
  zoom: number,
  rotation: number
): Matrix {
  const x1 = ansicht[0] ?? 0
  const y1 = ansicht[1] ?? 0
  const x2 = ansicht[2] ?? 0
  const y2 = ansicht[3] ?? 0
  const mitteX = (x1 + x2) / 2
  const mitteY = (y1 + y2) / 2

  // Die vier Vielfachen von 90 Grad. Das negative d bei 0 Grad ist die
  // eigentliche Umkehr: das PDF misst y von unten, der Bildschirm von oben.
  let a: number
  let b: number
  let c: number
  let d: number
  switch (normiereDrehung(rotation)) {
    case 90:
      a = 0
      b = 1
      c = 1
      d = 0
      break
    case 180:
      a = -1
      b = 0
      c = 0
      d = 1
      break
    case 270:
      a = 0
      b = -1
      c = -1
      d = 0
      break
    default:
      a = 1
      b = 0
      c = 0
      d = -1
  }

  // Bei 90 und 270 Grad tauschen Breite und Hoehe die Rollen; der Versatz
  // richtet sich dann nach der jeweils anderen Kante.
  const versatzX = (a === 0 ? Math.abs(mitteY - y1) : Math.abs(mitteX - x1)) * zoom
  const versatzY = (a === 0 ? Math.abs(mitteX - x1) : Math.abs(mitteY - y1)) * zoom

  return [
    a * zoom,
    b * zoom,
    c * zoom,
    d * zoom,
    versatzX - a * zoom * mitteX - c * zoom * mitteY,
    versatzY - b * zoom * mitteX - d * zoom * mitteY
  ]
}

/** Ein Punkt in PDF-Koordinaten auf seine Stelle in der Seite, in CSS-Pixeln. */
export function pdfZuBildschirm(punkt: Punkt, matrix: Matrix): Punkt {
  return {
    x: matrix[0] * punkt.x + matrix[2] * punkt.y + matrix[4],
    y: matrix[1] * punkt.x + matrix[3] * punkt.y + matrix[5]
  }
}

/**
 * Die Umkehrung. `null`, wenn die Matrix entartet ist — das kann nur bei einem
 * Zoom von 0 passieren, und dann gibt es keine sinnvolle Antwort. Stillschweigend
 * eine Null zu liefern hiesse, den Fehler an die Aufrufstelle zu verschenken.
 */
export function bildschirmZuPdf(punkt: Punkt, matrix: Matrix): Punkt | null {
  const [a, b, c, d, e, f] = matrix
  const determinante = a * d - b * c
  if (determinante === 0 || !Number.isFinite(determinante)) return null
  const x = punkt.x - e
  const y = punkt.y - f
  return {
    x: (d * x - c * y) / determinante,
    y: (a * y - b * x) / determinante
  }
}

/**
 * Ein PDF-Rechteck als achsenparalleles Bildschirmrechteck.
 *
 * Alle vier Ecken werden abgebildet und nicht nur zwei gegenueberliegende:
 * bei 90 und 270 Grad vertauschen sich links/rechts und oben/unten, und mit
 * zwei Ecken kaeme eine negative Breite heraus.
 */
export function rechteckZuBildschirm(rect: readonly number[], matrix: Matrix): Bildschirmrechteck {
  const x1 = rect[0] ?? 0
  const y1 = rect[1] ?? 0
  const x2 = rect[2] ?? 0
  const y2 = rect[3] ?? 0
  const ecken = [
    pdfZuBildschirm({ x: x1, y: y1 }, matrix),
    pdfZuBildschirm({ x: x2, y: y1 }, matrix),
    pdfZuBildschirm({ x: x2, y: y2 }, matrix),
    pdfZuBildschirm({ x: x1, y: y2 }, matrix)
  ]
  const xs = ecken.map((ecke) => ecke.x)
  const ys = ecken.map((ecke) => ecke.y)
  const links = Math.min(...xs)
  const oben = Math.min(...ys)
  return { links, oben, breite: Math.max(...xs) - links, hoehe: Math.max(...ys) - oben }
}

/**
 * Die Rechtecke einer Text-Markierung, ein Block von acht Werten je Zeile.
 *
 * Unvollstaendige Bloecke am Ende werden uebergangen: `/QuadPoints` kommt aus
 * einem fremden Dokument, und eine halbe Zeile ist kein Grund, die ganze
 * Markierung fallen zu lassen.
 */
export function quadPointsZuRechtecken(
  quadPoints: readonly number[],
  matrix: Matrix
): Bildschirmrechteck[] {
  const rechtecke: Bildschirmrechteck[] = []
  for (let i = 0; i + 8 <= quadPoints.length; i += 8) {
    const block = quadPoints.slice(i, i + 8)
    if (block.some((wert) => !Number.isFinite(wert))) continue
    const xs = [block[0] ?? 0, block[2] ?? 0, block[4] ?? 0, block[6] ?? 0]
    const ys = [block[1] ?? 0, block[3] ?? 0, block[5] ?? 0, block[7] ?? 0]
    rechtecke.push(
      rechteckZuBildschirm(
        [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        matrix
      )
    )
  }
  return rechtecke
}

/** Eine flache Punktliste `x,y,x,y,…` als Bildschirmpunkte. */
export function punktlisteZuBildschirm(punkte: readonly number[], matrix: Matrix): Punkt[] {
  const abgebildet: Punkt[] = []
  for (let i = 0; i + 2 <= punkte.length; i += 2) {
    const x = punkte[i]
    const y = punkte[i + 1]
    if (x === undefined || y === undefined) continue
    abgebildet.push(pdfZuBildschirm({ x, y }, matrix))
  }
  return abgebildet
}

/**
 * Hit-Testing fuer die spaetere Auswahl (S2.1, Aufgabe 6).
 *
 * `toleranz` gibt einen Rand in Pixeln dazu. Ohne ihn ist eine unterstrichene
 * Zeile mit der Maus kaum zu treffen: ihr Rechteck ist nur wenige Pixel hoch.
 */
export function punktInRechteck(punkt: Punkt, rechteck: Bildschirmrechteck, toleranz = 0): boolean {
  return (
    punkt.x >= rechteck.links - toleranz &&
    punkt.x <= rechteck.links + rechteck.breite + toleranz &&
    punkt.y >= rechteck.oben - toleranz &&
    punkt.y <= rechteck.oben + rechteck.hoehe + toleranz
  )
}

/** Die Huelle mehrerer Rechtecke. `null` bei leerer Liste. */
export function huelle(rechtecke: readonly Bildschirmrechteck[]): Bildschirmrechteck | null {
  if (rechtecke.length === 0) return null
  const links = Math.min(...rechtecke.map((rechteck) => rechteck.links))
  const oben = Math.min(...rechtecke.map((rechteck) => rechteck.oben))
  const rechts = Math.max(...rechtecke.map((rechteck) => rechteck.links + rechteck.breite))
  const unten = Math.max(...rechtecke.map((rechteck) => rechteck.oben + rechteck.hoehe))
  return { links, oben, breite: rechts - links, hoehe: unten - oben }
}
