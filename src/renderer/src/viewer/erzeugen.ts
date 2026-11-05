import type { Annotation, AnnotationsTyp, Farbe, PdfRechteck } from '../../../shared/annotations'
import {
  STANDARD_AUSRICHTUNG,
  STANDARD_SCHRIFTFAMILIE,
  STANDARD_SCHRIFTGROESSE
} from '../../../shared/freitext'
import type { Punkt } from './koordinaten'
import { t } from '../../../shared/i18n'

/**
 * Neue Annotationen bauen und vorhandene veraendern (S2.2).
 *
 * Reine Funktionen: sie bekommen Koordinaten in PDF-Punkten und liefern einen
 * Datensatz des internen Modells. Nichts hier kennt den Speicher, den Zoom
 * oder das Dokument — genau deshalb laesst sich jede Form ohne laufende
 * Anwendung pruefen.
 */

export interface Vorgaben {
  autor: string
  /** Farbe als `#rrggbb`. */
  farbe: string
  strichstaerke: number
}

/**
 * PDF-Datumszeichenkette, etwa `D:20260908143000Z`.
 *
 * Bewusst in UTC mit `Z` statt mit Zeitzonenversatz: der Versatz waere
 * korrekt, aber er verraet, in welcher Zeitzone der Autor sitzt, und das
 * braucht niemand in einem Dokument, das weitergegeben wird.
 */
export function pdfDatum(zeitpunkt: Date): string {
  const zweistellig = (wert: number): string => String(wert).padStart(2, '0')
  return (
    'D:' +
    String(zeitpunkt.getUTCFullYear()) +
    zweistellig(zeitpunkt.getUTCMonth() + 1) +
    zweistellig(zeitpunkt.getUTCDate()) +
    zweistellig(zeitpunkt.getUTCHours()) +
    zweistellig(zeitpunkt.getUTCMinutes()) +
    zweistellig(zeitpunkt.getUTCSeconds()) +
    'Z'
  )
}

/** `#rrggbb` in die Kanaele 0..255, die das Modell fuehrt. */
export function farbeAusHex(hex: string): Farbe {
  const treffer = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (treffer === null) return { r: 0, g: 0, b: 0 }
  return {
    r: Number.parseInt(treffer[1] ?? '0', 16),
    g: Number.parseInt(treffer[2] ?? '0', 16),
    b: Number.parseInt(treffer[3] ?? '0', 16)
  }
}

/** Kanaele zurueck nach `#rrggbb` — fuer den Farbwaehler der Werkzeugleiste. */
export function hexAusFarbe(farbe: Farbe | null): string {
  if (farbe === null) return '#000000'
  const kanal = (wert: number): string =>
    Math.max(0, Math.min(255, Math.round(wert)))
      .toString(16)
      .padStart(2, '0')
  return '#' + kanal(farbe.r) + kanal(farbe.g) + kanal(farbe.b)
}

/**
 * Kennungen fuer neu erzeugte Annotationen.
 *
 * Der Zaehler laeuft je Sitzung. Er darf nicht mit den Kennungen kollidieren,
 * die pdf.js aus dem Dokument vergibt (etwa `10R`), daher das Praefix.
 *
 * Seit der Rueckgaengig-Historie ueber das Speichern hinweg schreibt der
 * Schreibpfad die Kennung als `/NM` in die Annotation: so findet er sie nach
 * dem Speichern wieder, obwohl die Datei ihr eine Objektnummer gab. Dann muss
 * die Kennung auch **sitzungsuebergreifend** eindeutig sein — ein Zaehler, der
 * bei jedem Start wieder bei 1 beginnt, traefe in einer frueher gespeicherten
 * Datei auf eine fremde Annotation mit `/NM` `neu-1`. Das Sitzungskennzeichen
 * davor verhindert das.
 */
let zaehler = 0
const SITZUNG = Math.random().toString(36).slice(2, 10)

export function neueKennung(): string {
  zaehler += 1
  return 'neu-' + SITZUNG + '-' + String(zaehler)
}

/** Nur fuer Tests: den Zaehler zuruecksetzen, damit Kennungen vorhersagbar sind. */
export function setzeKennungszaehlerZurueck(): void {
  zaehler = 0
}

function grundgeruest(
  seite: number,
  typ: AnnotationsTyp,
  rect: PdfRechteck,
  vorgaben: Vorgaben,
  jetzt: Date
): Annotation {
  const datum = pdfDatum(jetzt)
  return {
    id: neueKennung(),
    seite,
    typ,
    subtyp: typ,
    rect,
    quadPoints: null,
    striche: null,
    farbe: farbeAusHex(vorgaben.farbe),
    strichstaerke: null,
    opazitaet: 1,
    autor: vorgaben.autor,
    inhalt: '',
    erstellt: datum,
    geaendert: datum,
    versteckt: false,
    ziel: null,
    // Neu entstanden, also kein fremdes Objekt, das erhalten bleiben muesste.
    roh: null
  }
}

/** Die Huelle einer Liste von QuadPoint-Bloecken, als `/Rect`. */
export function rechteckAusQuadPoints(quadPoints: readonly number[]): PdfRechteck {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i + 1 < quadPoints.length; i += 2) {
    xs.push(quadPoints[i] ?? 0)
    ys.push(quadPoints[i + 1] ?? 0)
  }
  if (xs.length === 0) return [0, 0, 0, 0]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * Text-Markup aus einer Auswahl (Aufgabe 2).
 *
 * `quadPoints` traegt **einen Viererblock je Textzeile**. Ein einziges
 * Rechteck ueber den ganzen Bereich waere bei einer Markierung ueber einen
 * Zeilenumbruch sichtbar falsch: sie deckte dann auch den eingerueckten Anfang
 * und das leere Zeilenende mit ab.
 */
export function erzeugeMarkup(
  typ: 'Highlight' | 'Underline' | 'StrikeOut',
  seite: number,
  quadPoints: readonly number[],
  vorgaben: Vorgaben,
  jetzt: Date = new Date()
): Annotation | null {
  if (quadPoints.length < 8) return null
  const grund = grundgeruest(seite, typ, rechteckAusQuadPoints(quadPoints), vorgaben, jetzt)
  return {
    ...grund,
    quadPoints: [...quadPoints],
    // Markierungen bleiben durchscheinend, damit der Text darunter lesbar
    // bleibt; Striche zeichnen daneben und brauchen volle Deckung.
    opazitaet: typ === 'Highlight' ? 0.4 : 1
  }
}

/** Groesse eines neu gesetzten Textfelds in PDF-Punkten (S6.5, Aufgabe 1). */
export const FREITEXT_BREITE = 180
export const FREITEXT_HOEHE = 50

/**
 * Ein leeres `/FreeText`-Feld an der angeklickten Stelle (S6.5, Aufgabe 1).
 *
 * Wie bei der Notiz ist der Klickpunkt die obere linke Ecke. Anders als die
 * Notiz startet das Feld mit brauchbarer Groesse zum Tippen — der Nutzer
 * kann sie danach wie jede andere gegenstaendliche Annotation ziehen.
 */
export function erzeugeFreitext(
  seite: number,
  punkt: Punkt,
  vorgaben: Vorgaben,
  jetzt: Date = new Date()
): Annotation {
  const rect: PdfRechteck = [punkt.x, punkt.y - FREITEXT_HOEHE, punkt.x + FREITEXT_BREITE, punkt.y]
  return {
    ...grundgeruest(seite, 'FreeText', rect, vorgaben, jetzt),
    schriftFamilie: STANDARD_SCHRIFTFAMILIE,
    schriftGroesse: STANDARD_SCHRIFTGROESSE,
    schriftFett: false,
    schriftKursiv: false,
    ausrichtung: STANDARD_AUSRICHTUNG
  }
}

/** Grundgroesse eines Notizzettel-Markers in PDF-Punkten. */
export const NOTIZ_GROESSE = 24

/** Eine Textnotiz an der angeklickten Stelle (Aufgabe 3). */
export function erzeugeNotiz(
  seite: number,
  punkt: Punkt,
  vorgaben: Vorgaben,
  jetzt: Date = new Date()
): Annotation {
  // Der Klickpunkt ist die obere linke Ecke des Markers: dorthin hat der
  // Nutzer gezeigt, und ein um sich selbst zentrierter Marker spraenge beim
  // Setzen sichtbar zur Seite.
  const rect: PdfRechteck = [punkt.x, punkt.y - NOTIZ_GROESSE, punkt.x + NOTIZ_GROESSE, punkt.y]
  return grundgeruest(seite, 'Text', rect, vorgaben, jetzt)
}

/** Freihand aus bereits geglaetteten Punkten in PDF-Koordinaten (Aufgabe 4). */
export function erzeugeFreihand(
  seite: number,
  zug: readonly Punkt[],
  vorgaben: Vorgaben,
  jetzt: Date = new Date()
): Annotation | null {
  if (zug.length < 2) return null
  const flach = zug.flatMap((punkt) => [punkt.x, punkt.y])
  // Das Rechteck umfasst die Strichstaerke: ein Pfad genau auf der Kante waere
  // sonst zur Haelfte ausserhalb seines eigenen /Rect.
  const rand = vorgaben.strichstaerke / 2
  const xs = zug.map((punkt) => punkt.x)
  const ys = zug.map((punkt) => punkt.y)
  const rect: PdfRechteck = [
    Math.min(...xs) - rand,
    Math.min(...ys) - rand,
    Math.max(...xs) + rand,
    Math.max(...ys) + rand
  ]
  return {
    ...grundgeruest(seite, 'Ink', rect, vorgaben, jetzt),
    striche: [flach],
    strichstaerke: vorgaben.strichstaerke
  }
}

/** Kantenlaengen eines Stempels in PDF-Punkten. */
export const STEMPEL_BREITE = 120
export const STEMPEL_HOEHE = 36

/** Ein Stempel an der angeklickten Stelle (Aufgabe 5). */
export function erzeugeStempel(
  seite: number,
  punkt: Punkt,
  text: string,
  vorgaben: Vorgaben,
  jetzt: Date = new Date()
): Annotation {
  const rect: PdfRechteck = [punkt.x, punkt.y - STEMPEL_HOEHE, punkt.x + STEMPEL_BREITE, punkt.y]
  return { ...grundgeruest(seite, 'Stamp', rect, vorgaben, jetzt), inhalt: text }
}

/** Breite einer frei gesetzten Signatur in PDF-Punkten; die Hoehe folgt dem Bild. */
export const SIGNATUR_BREITE = 150

/** Rueckfall, wenn das Bild kein brauchbares Seitenverhaeltnis nennt. */
const SIGNATUR_VERHAELTNIS = 3

function sicheresVerhaeltnis(seitenverhaeltnis: number): number {
  return Number.isFinite(seitenverhaeltnis) && seitenverhaeltnis > 0
    ? seitenverhaeltnis
    : SIGNATUR_VERHAELTNIS
}

/**
 * Das Rechteck einer frei gesetzten Signatur: die angeklickte Stelle ist die
 * linke obere Ecke, wie beim Stempel. `seitenverhaeltnis` ist Breite durch
 * Hoehe des Bildes; ein Wert <= 0 oder nicht endlich faellt auf 3:1 zurueck,
 * damit ein kaputtes Bild keine Annotation mit Hoehe 0 oder unendlich erzeugt.
 */
export function signaturRechteck(punkt: Punkt, seitenverhaeltnis: number): PdfRechteck {
  const hoehe = SIGNATUR_BREITE / sicheresVerhaeltnis(seitenverhaeltnis)
  return [punkt.x, punkt.y - hoehe, punkt.x + SIGNATUR_BREITE, punkt.y]
}

/**
 * Passt ein Bild in ein Feld ein — so gross wie moeglich, das
 * Seitenverhaeltnis gewahrt, mittig. Fuer die Signatur in einem
 * Signaturfeld: das Bild soll das Feld fuellen, aber nicht verzerren, und
 * nicht ueber den Rand hinaus — der Appearance-Stream zeichnet genau in
 * `/Rect`, und was dort verzerrt ist, ist es in jedem Betrachter.
 */
export function passeEin(feld: PdfRechteck, seitenverhaeltnis: number): PdfRechteck {
  const verhaeltnis = sicheresVerhaeltnis(seitenverhaeltnis)
  const links = Math.min(feld[0], feld[2])
  const unten = Math.min(feld[1], feld[3])
  const feldBreite = Math.abs(feld[2] - feld[0])
  const feldHoehe = Math.abs(feld[3] - feld[1])
  let breite = feldBreite
  let hoehe = breite / verhaeltnis
  if (hoehe > feldHoehe) {
    hoehe = feldHoehe
    breite = hoehe * verhaeltnis
  }
  const dx = (feldBreite - breite) / 2
  const dy = (feldHoehe - hoehe) / 2
  return [links + dx, unten + dy, links + dx + breite, unten + dy + hoehe]
}

/**
 * Eine grafische Signatur (S3.2, Aufgabe 4): ein Stempel, der ein Bild
 * traegt. Der Inhalt nennt, was es ist — im Dokument sichtbar fuer jeden,
 * der die Anmerkung liest, und in der Seitenleiste als Beschriftung.
 */
export function erzeugeSignatur(
  seite: number,
  rect: PdfRechteck,
  bild: string,
  vorgaben: Vorgaben,
  jetzt: Date = new Date()
): Annotation {
  return {
    ...grundgeruest(seite, 'Stamp', rect, vorgaben, jetzt),
    inhalt: t('signatur.inhalt'),
    bild
  }
}

/**
 * Eine Annotation verschieben.
 *
 * Rechteck, QuadPoints und Freihandpunkte wandern gemeinsam — bliebe eines
 * davon liegen, risse die Markierung von ihrem Rechteck ab.
 */
export function verschiebe(annotation: Annotation, dx: number, dy: number): Annotation {
  return {
    ...annotation,
    rect: [
      annotation.rect[0] + dx,
      annotation.rect[1] + dy,
      annotation.rect[2] + dx,
      annotation.rect[3] + dy
    ],
    quadPoints:
      annotation.quadPoints === null
        ? null
        : annotation.quadPoints.map((wert, stelle) => wert + (stelle % 2 === 0 ? dx : dy)),
    striche:
      annotation.striche === null
        ? null
        : annotation.striche.map((zug) =>
            zug.map((wert, stelle) => wert + (stelle % 2 === 0 ? dx : dy))
          )
  }
}

/**
 * Eine Annotation auf ein neues Rechteck bringen (Groesse aendern).
 *
 * QuadPoints und Freihandpunkte werden mitskaliert. Ein entartetes Mass wird
 * abgewiesen statt durch null geteilt: eine auf Breite 0 gezogene Markierung
 * waere unwiederbringlich verloren.
 */
export function skaliere(annotation: Annotation, ziel: PdfRechteck): Annotation | null {
  const [ax1, ay1, ax2, ay2] = annotation.rect
  const breite = ax2 - ax1
  const hoehe = ay2 - ay1
  if (breite <= 0 || hoehe <= 0) return null
  const [zx1, zy1, zx2, zy2] = ziel
  if (zx2 - zx1 <= 0 || zy2 - zy1 <= 0) return null

  const fx = (zx2 - zx1) / breite
  const fy = (zy2 - zy1) / hoehe
  const x = (wert: number): number => zx1 + (wert - ax1) * fx
  const y = (wert: number): number => zy1 + (wert - ay1) * fy

  return {
    ...annotation,
    rect: ziel,
    quadPoints:
      annotation.quadPoints === null
        ? null
        : annotation.quadPoints.map((wert, stelle) => (stelle % 2 === 0 ? x(wert) : y(wert))),
    striche:
      annotation.striche === null
        ? null
        : annotation.striche.map((zug) =>
            zug.map((wert, stelle) => (stelle % 2 === 0 ? x(wert) : y(wert)))
          )
  }
}

/** Eine Aenderung eintragen und das Aenderungsdatum nachfuehren. */
export function aendere(
  annotation: Annotation,
  teil: Partial<Annotation>,
  jetzt: Date = new Date()
): Annotation {
  return { ...annotation, ...teil, geaendert: pdfDatum(jetzt) }
}
