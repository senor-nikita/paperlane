import { bildschirmZuPdf, type Bildschirmrechteck, type Matrix, type Punkt } from './koordinaten'

/**
 * Nutzereingaben in PDF-Geometrie uebersetzen (S2.2).
 *
 * Zwei Wege fuehren hier zusammen: eine Textauswahl im Layer aus S1.4 und ein
 * mit dem Zeiger gezogener Pfad. Beide enden in PDF-Punkten, damit alles
 * Weitere — Erzeugen, Speichern, erneutes Anzeigen — dieselbe Sprache spricht.
 */

/**
 * Die Rechtecke einer Textauswahl, bezogen auf die linke obere Ecke der Seite.
 *
 * `Range.getClientRects` liefert **ein Rechteck je Zeilenkasten** — genau die
 * Zerlegung, die `/QuadPoints` braucht. Sie aus den Zeichenpositionen selbst
 * zu rekonstruieren waere Doppelarbeit und ginge bei Ligaturen und
 * Laufweitenaenderungen daneben.
 *
 * Leere Rechtecke werden uebergangen: Browser liefern sie fuer Zeilenumbrueche,
 * und ein Viererblock ohne Flaeche waere eine Markierung, die niemand sieht und
 * die trotzdem in der Datei steht.
 */
export function auswahlrechtecke(
  bereich: Range,
  behaelter: Element,
  mindestflaeche = 1
): Bildschirmrechteck[] {
  const rahmen = behaelter.getBoundingClientRect()
  const rechtecke: Bildschirmrechteck[] = []
  for (const rechteck of bereich.getClientRects()) {
    if (rechteck.width < mindestflaeche || rechteck.height < mindestflaeche) continue
    // Nur was ueber dieser Seite liegt: eine Auswahl kann ueber den Seitenrand
    // hinausgehen, und die Nachbarseite fuehrt ihre eigene Ebene.
    if (rechteck.bottom <= rahmen.top || rechteck.top >= rahmen.bottom) continue
    rechtecke.push({
      links: rechteck.left - rahmen.left,
      oben: rechteck.top - rahmen.top,
      breite: rechteck.width,
      hoehe: rechteck.height
    })
  }
  return rechtecke
}

/**
 * Bildschirmrechtecke in `/QuadPoints` umrechnen: je Zeile acht Werte in der
 * Reihenfolge oben-links, oben-rechts, unten-links, unten-rechts.
 *
 * `null`, wenn sich die Abbildung nicht umkehren laesst — bei Zoom 0. Eine
 * erfundene Null waere hier besonders schaedlich: sie legte die Markierung in
 * die Seitenecke, wo sie zufaellig echt aussaehe.
 */
export function quadPointsAusRechtecken(
  rechtecke: readonly Bildschirmrechteck[],
  matrix: Matrix
): number[] | null {
  const quadPoints: number[] = []
  for (const rechteck of rechtecke) {
    const linksOben = bildschirmZuPdf({ x: rechteck.links, y: rechteck.oben }, matrix)
    const rechtsUnten = bildschirmZuPdf(
      { x: rechteck.links + rechteck.breite, y: rechteck.oben + rechteck.hoehe },
      matrix
    )
    if (linksOben === null || rechtsUnten === null) return null
    // Nach der Umrechnung kann oben unten sein - bei 180 Grad Drehung ist es
    // das immer. Sortiert wird deshalb in PDF-Koordinaten, nicht vorher.
    const x1 = Math.min(linksOben.x, rechtsUnten.x)
    const x2 = Math.max(linksOben.x, rechtsUnten.x)
    const y1 = Math.min(linksOben.y, rechtsUnten.y)
    const y2 = Math.max(linksOben.y, rechtsUnten.y)
    quadPoints.push(x1, y2, x2, y2, x1, y1, x2, y1)
  }
  return quadPoints.length === 0 ? null : quadPoints
}

/**
 * Der Abstand, ab dem ein Punkt eines Freihandzugs als eigene Richtung zaehlt.
 * In PDF-Punkten.
 */
export const GLAETTUNG_TOLERANZ = 1.2

/** Abstand eines Punktes von der Strecke zwischen zwei anderen. */
function abstandZurStrecke(punkt: Punkt, von: Punkt, bis: Punkt): number {
  const dx = bis.x - von.x
  const dy = bis.y - von.y
  const laengeQuadrat = dx * dx + dy * dy
  if (laengeQuadrat === 0) return Math.hypot(punkt.x - von.x, punkt.y - von.y)
  const anteil = Math.max(
    0,
    Math.min(1, ((punkt.x - von.x) * dx + (punkt.y - von.y) * dy) / laengeQuadrat)
  )
  return Math.hypot(punkt.x - (von.x + anteil * dx), punkt.y - (von.y + anteil * dy))
}

/**
 * Wie viele Punkte in die Vereinfachung gehen duerfen.
 *
 * Ramer-Douglas-Peucker ist im schlechtesten Fall quadratisch — bei einem
 * Zickzack teilt jeder Durchgang nur einen Punkt ab. Ein Zeiger mit hoher
 * Abtastrate liefert schnell mehrere tausend Punkte, und ab etwa zwanzigtausend
 * steht die Oberflaeche spuerbar. Ein von Hand gezogener Strich hat selten mehr
 * als tausend; die Grenze schneidet also nichts weg, was jemand gezeichnet hat.
 */
export const MAX_ZUG_PUNKTE = 4000

/**
 * Duennt einen ueberlangen Zug gleichmaessig aus, bevor er vereinfacht wird.
 *
 * Gleichmaessig und nicht am Ende abgeschnitten: ein abgeschnittener Strich
 * waere ein halber Strich, ein ausgeduennter derselbe Strich mit weniger
 * Stuetzpunkten. Anfang und Ende bleiben in jedem Fall erhalten.
 */
export function duenneAus(zug: readonly Punkt[], hoechstens = MAX_ZUG_PUNKTE): Punkt[] {
  if (zug.length <= hoechstens) return [...zug]
  const schritt = Math.ceil(zug.length / hoechstens)
  const gekuerzt = zug.filter((_punkt, stelle) => stelle % schritt === 0)
  const letzter = zug[zug.length - 1] as Punkt
  if (gekuerzt[gekuerzt.length - 1] !== letzter) gekuerzt.push(letzter)
  return gekuerzt
}

/**
 * Ramer-Douglas-Peucker, iterativ statt rekursiv: ein langer Zug mit tausenden
 * Punkten wuerde den Aufrufstapel sonst sprengen.
 */
export function vereinfache(zug: readonly Punkt[], toleranz: number): Punkt[] {
  if (zug.length < 3) return [...zug]
  const behalten = new Array<boolean>(zug.length).fill(false)
  behalten[0] = true
  behalten[zug.length - 1] = true

  const offen: [number, number][] = [[0, zug.length - 1]]
  while (offen.length > 0) {
    const abschnitt = offen.pop()
    if (abschnitt === undefined) continue
    const [von, bis] = abschnitt
    let weiteste = -1
    let weitester = von
    for (let i = von + 1; i < bis; i++) {
      const abstand = abstandZurStrecke(zug[i] as Punkt, zug[von] as Punkt, zug[bis] as Punkt)
      if (abstand > weiteste) {
        weiteste = abstand
        weitester = i
      }
    }
    if (weiteste > toleranz) {
      behalten[weitester] = true
      offen.push([von, weitester], [weitester, bis])
    }
  }

  return zug.filter((_punkt, stelle) => behalten[stelle] === true)
}

/**
 * Freihandzug glaetten (Aufgabe 4).
 *
 * Zwei Stufen. Erst Ramer-Douglas-Peucker: es wirft alle Punkte weg, die
 * innerhalb der Toleranz auf der Verbindungslinie ihrer Nachbarn liegen. Das
 * entfernt das Zittern der Hand und die Punktflut schneller Zeiger, **ohne**
 * die Form zu veraendern — eine Ecke bleibt eine Ecke.
 *
 * Danach ein gewichteter Mittelwert ueber die inneren Punkte. Er rundet die
 * Restkanten ab; Anfang und Ende bleiben unangetastet, sonst zoege sich der
 * Strich von seinen eigenen Enden zurueck.
 */
export function glaette(zug: readonly Punkt[], toleranz = GLAETTUNG_TOLERANZ): Punkt[] {
  const vereinfacht = vereinfache(duenneAus(zug), toleranz)
  if (vereinfacht.length < 3) return vereinfacht
  const geglaettet: Punkt[] = [vereinfacht[0] as Punkt]
  for (let i = 1; i < vereinfacht.length - 1; i++) {
    const vorher = vereinfacht[i - 1] as Punkt
    const hier = vereinfacht[i] as Punkt
    const nachher = vereinfacht[i + 1] as Punkt
    geglaettet.push({
      x: (vorher.x + 2 * hier.x + nachher.x) / 4,
      y: (vorher.y + 2 * hier.y + nachher.y) / 4
    })
  }
  geglaettet.push(vereinfacht[vereinfacht.length - 1] as Punkt)
  return geglaettet
}
