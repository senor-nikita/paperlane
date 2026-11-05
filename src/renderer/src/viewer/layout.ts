/**
 * Seitenanordnung als reine Funktionen.
 *
 * Die Virtualisierung braucht die Position jeder Seite, bevor die Seite selbst
 * gerendert wurde — sonst haette der Scrollbereich keine verlaessliche Hoehe
 * und wuerde bei jedem Rendern springen. Hier steckt die gesamte Rechnerei,
 * frei von React und pdf.js und damit ohne laufende Anwendung pruefbar.
 */
export interface SeitenGroesse {
  /** Breite in PDF-Punkten, ungedreht. */
  breite: number
  /** Hoehe in PDF-Punkten, ungedreht. */
  hoehe: number
}

export interface SeitenPlatz {
  /** Nullbasierter Seitenindex. */
  index: number
  /** Abstand vom oberen Rand des Scrollbereichs, in CSS-Pixeln. */
  oben: number
  breite: number
  hoehe: number
  /** Versatz des Seitenmittelpunkts von der Mitte der Flaeche (CSS-Pixel); fehlt oder 0 bei einer Spalte. */
  mitte?: number
}

export interface Layout {
  plaetze: SeitenPlatz[]
  gesamthoehe: number
  maxBreite: number
}

export const SEITENABSTAND = 16

/** 90 und 270 Grad vertauschen Breite und Hoehe. */
export function gedrehteGroesse(groesse: SeitenGroesse, rotation: number): SeitenGroesse {
  const normiert = ((rotation % 360) + 360) % 360
  return normiert === 90 || normiert === 270
    ? { breite: groesse.hoehe, hoehe: groesse.breite }
    : { breite: groesse.breite, hoehe: groesse.hoehe }
}

/**
 * Ordnet die Seiten in Zeilen zu je `spalten` Seiten an (1 = untereinander,
 * 2 = Zwei-Seiten-Ansicht: 1+2, 3+4, ...). Die Seiten einer Zeile stehen
 * oben buendig nebeneinander; eine allein stehende letzte Seite sitzt mittig.
 * `mitte` ist der waagerechte Versatz des Seitenmittelpunkts von der Mitte der
 * Flaeche; bei einer Spalte bleibt er 0.
 */
export function berechneLayout(
  groessen: readonly SeitenGroesse[],
  zoom: number,
  rotation: number,
  abstand: number = SEITENABSTAND,
  spalten = 1
): Layout {
  const plaetze: SeitenPlatz[] = []
  let oben = 0
  let maxBreite = 0

  for (let start = 0; start < groessen.length; start += spalten) {
    const zeile = groessen.slice(start, start + spalten).map((groesse) => {
      const gedreht = gedrehteGroesse(groesse, rotation)
      return { breite: gedreht.breite * zoom, hoehe: gedreht.hoehe * zoom }
    })
    const zeilenBreite =
      zeile.reduce((summe, seite) => summe + seite.breite, 0) + (zeile.length - 1) * abstand
    let links = -zeilenBreite / 2
    let zeilenHoehe = 0
    zeile.forEach((seite, versatz) => {
      plaetze.push({
        index: start + versatz,
        oben,
        breite: seite.breite,
        hoehe: seite.hoehe,
        mitte: spalten === 1 ? 0 : links + seite.breite / 2
      })
      links += seite.breite + abstand
      if (seite.hoehe > zeilenHoehe) zeilenHoehe = seite.hoehe
    })
    oben += zeilenHoehe + abstand
    if (zeilenBreite > maxBreite) maxBreite = zeilenBreite
  }

  // Der letzte Abstand zaehlt nicht zur Gesamthoehe.
  const gesamthoehe = plaetze.length === 0 ? 0 : oben - abstand
  return { plaetze, gesamthoehe, maxBreite }
}

export interface SichtBereich {
  /** Erster sichtbarer Index, -1 wenn nichts sichtbar ist. */
  von: number
  /** Letzter sichtbarer Index, einschliesslich. */
  bis: number
}

/**
 * Welche Seiten liegen im Sichtfenster, zuzueglich Puffer?
 *
 * Nur diese Seiten bekommen ein Canvas. Alle anderen behalten einen
 * Platzhalter mit korrekter Hoehe — genau das haelt den Speicher unabhaengig
 * von der Seitenzahl.
 */
export function sichtbareSeiten(
  layout: Layout,
  scrollOben: number,
  sichtHoehe: number,
  puffer: number
): SichtBereich {
  if (layout.plaetze.length === 0) return { von: -1, bis: -1 }

  const untereKante = scrollOben + sichtHoehe
  let von = -1
  let bis = -1
  for (const platz of layout.plaetze) {
    const seiteEndet = platz.oben + platz.hoehe
    if (seiteEndet < scrollOben || platz.oben > untereKante) continue
    if (von === -1) von = platz.index
    bis = platz.index
  }

  // Kein Treffer: das Sichtfenster liegt in einem Abstand zwischen zwei Seiten
  // oder hinter dem Ende. Die naechstgelegene Seite gilt dann als sichtbar.
  if (von === -1) {
    const letzter = layout.plaetze.length - 1
    const naechste = scrollOben <= 0 ? 0 : letzter
    von = naechste
    bis = naechste
  }

  return {
    von: Math.max(0, von - puffer),
    bis: Math.min(layout.plaetze.length - 1, bis + puffer)
  }
}

/**
 * Die Seite, an der beim Zoomen oder Drehen festgehalten wird, samt ihrem
 * relativen Anteil im Sichtfenster. Ohne diesen Anker springt die Leseposition
 * bei jeder Zoomstufe.
 */
export interface Anker {
  index: number
  /** Anteil 0..1, wo im Sichtfenster die Seitenoberkante lag. */
  anteil: number
}

export function bestimmeAnker(layout: Layout, scrollOben: number): Anker | null {
  const platz = layout.plaetze.find((p) => p.oben + p.hoehe > scrollOben) ?? layout.plaetze[0]
  if (platz === undefined) return null
  const anteil = platz.hoehe === 0 ? 0 : (scrollOben - platz.oben) / platz.hoehe
  return { index: platz.index, anteil }
}

/**
 * Der Anker beim Zoomen mit dem Mausrad: die Stelle **unter dem Zeiger** soll
 * unter dem Zeiger bleiben. Senkrecht haelt sie sich an die Seite und ihren
 * Anteil (die festen Abstaende zwischen den Seiten wachsen nicht mit, ein
 * reines Skalieren der Scrollposition triebe bei vielen Seiten davon);
 * waagerecht an den Abstand von der Mitte der Flaeche.
 */
export interface ZoomAnker {
  index: number
  /** Wo in der Seite der Zeiger stand, als Anteil der Seitenhoehe (auch ausserhalb 0..1 im Abstand). */
  anteilY: number
  /** Abstand des Zeigers von der Mitte der Flaeche, in Pixeln beim alten Zoom. */
  abstandX: number
}

export function bestimmeZoomAnker(
  layout: Layout,
  scrollOben: number,
  scrollLinks: number,
  zeigerX: number,
  zeigerY: number,
  flaechenBreite: number,
  rand: number
): ZoomAnker | null {
  const letzter = layout.plaetze[layout.plaetze.length - 1]
  if (letzter === undefined) return null
  const inhaltY = scrollOben + zeigerY - rand
  const platz = layout.plaetze.find((p) => p.oben + p.hoehe > inhaltY) ?? letzter
  return {
    index: platz.index,
    anteilY: platz.hoehe === 0 ? 0 : (inhaltY - platz.oben) / platz.hoehe,
    abstandX: scrollLinks + zeigerX - flaechenBreite / 2
  }
}

/** Die Scrollposition, bei der der Anker nach dem Zoomen wieder unter dem Zeiger liegt. */
export function scrollNachZoom(
  layout: Layout,
  anker: ZoomAnker,
  faktor: number,
  zeigerX: number,
  zeigerY: number,
  flaechenBreite: number,
  rand: number
): { oben: number; links: number } {
  const platz = layout.plaetze[anker.index]
  const oben = platz === undefined ? 0 : rand + platz.oben + anker.anteilY * platz.hoehe - zeigerY
  const links = flaechenBreite / 2 + anker.abstandX * faktor - zeigerX
  return { oben: Math.max(0, oben), links: Math.max(0, links) }
}

export function scrollFuerAnker(layout: Layout, anker: Anker): number {
  const platz = layout.plaetze[anker.index]
  if (platz === undefined) return 0
  return Math.max(0, platz.oben + anker.anteil * platz.hoehe)
}
