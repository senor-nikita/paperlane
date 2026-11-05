import { Encodings } from '@pdf-lib/standard-fonts'
import { StandardFonts } from 'pdf-lib'
import type { Annotation } from '../shared/annotations'
import { STANDARD_SCHRIFTFAMILIE, type SchriftFamilie } from '../shared/freitext'
import { t } from '../shared/i18n'

/**
 * Schriftauswahl fuer `/FreeText` (S6.5, D22).
 *
 * Electron-frei wie main/erscheinungsbild.ts, aus demselben Grund: die
 * Fremdviewer-Gegenprobe soll diese Zuordnung ausserhalb von Electron pruefen
 * koennen.
 *
 * D22: Standard-14 statt eingebetteter Schrift. `@pdf-lib/standard-fonts` ist
 * bereits eine Abhaengigkeit von `pdf-lib` selbst (siehe dessen
 * package.json) — hier nur ausdruecklich als eigene, exakt gepinnte
 * Laufzeitabhaengigkeit gefuehrt statt stillschweigend transitiv genutzt
 * (`THIRD_PARTY.md`).
 */

/** Welche Standard-14-Datei zu Familie und Stil gehoert. */
export function standardSchriftname(
  familie: SchriftFamilie,
  fett: boolean,
  kursiv: boolean
): StandardFonts {
  if (familie === 'Times') {
    if (fett && kursiv) return StandardFonts.TimesRomanBoldItalic
    if (fett) return StandardFonts.TimesRomanBold
    if (kursiv) return StandardFonts.TimesRomanItalic
    return StandardFonts.TimesRoman
  }
  if (familie === 'Courier') {
    if (fett && kursiv) return StandardFonts.CourierBoldOblique
    if (fett) return StandardFonts.CourierBold
    if (kursiv) return StandardFonts.CourierOblique
    return StandardFonts.Courier
  }
  if (fett && kursiv) return StandardFonts.HelveticaBoldOblique
  if (fett) return StandardFonts.HelveticaBold
  if (kursiv) return StandardFonts.HelveticaOblique
  return StandardFonts.Helvetica
}

/**
 * Schluessel fuer die Schriften-Map in `Erscheinungsmittel` (schreibpfad.ts).
 *
 * Ein Dokument mit mehreren `/FreeText` in verschiedenen Familien und Stilen
 * braucht mehrere eingebettete Schriften — je Kombination genau eine, nicht
 * je Annotation.
 */
export function schriftSchluessel(familie: SchriftFamilie, fett: boolean, kursiv: boolean): string {
  return familie + ':' + (fett ? 'f' : '') + (kursiv ? 'k' : '')
}

/** Der Schluessel, den eine Annotation fuer ihr `/AP` braucht. */
export function schluesselFuer(annotation: Annotation): string {
  if (annotation.typ === 'FreeText') {
    return schriftSchluessel(
      annotation.schriftFamilie ?? STANDARD_SCHRIFTFAMILIE,
      annotation.schriftFett ?? false,
      annotation.schriftKursiv ?? false
    )
  }
  // Stempel (S2.3b) brauchen immer genau diese eine Kombination.
  return schriftSchluessel('Helvetica', false, false)
}

/**
 * Kurzname fuer `/DA`, wie er fuer die Standard-14 gebraeuchlich ist. Nur
 * beschreibend — unser eigenes `/AP` bestimmt das Aussehen, `/DA` ist
 * Metadatum fuer Werkzeuge, die selbst neu setzen (siehe Modulkommentar zu R1
 * in erscheinungsbild.ts).
 */
const DA_NAME: Record<SchriftFamilie, string> = {
  Helvetica: 'Helv',
  Times: 'TiRo',
  Courier: 'Cour'
}

export function daSchriftname(familie: SchriftFamilie): string {
  // `familie` kommt ungeprueft aus dem Renderer: nur eigene Schluessel, sonst
  // lieferte etwa "constructor" eine Prototyp-Eigenschaft (Gate Phase 6, L2).
  return Object.hasOwn(DA_NAME, familie) ? DA_NAME[familie] : DA_NAME.Helvetica
}

/**
 * Zeichen, die pdf.js aus Symbol- und Wingdings-Schriften liefert, und ihre
 * WinAnsi-Gegenstuecke. Word setzt Aufzaehlungspunkte in Symbol; pdf.js gibt
 * sie als Zeichen aus dem privaten Bereich (U+F0B7) zurueck, und die
 * Ersatzschrift lehnte die ganze Zeile ab, obwohl sie einen Punkt hat.
 */
const ERSATZZEICHEN: Readonly<Record<string, string>> = {
  '\uF0B7': '\u2022',
  '\uF0A7': '\u2022',
  '\uF06C': '\u2022',
  '\uF0D8': '\u2022',
  '\u25CF': '\u2022',
  '\u2219': '\u2022',
  '\u25AA': '\u2022',
  '\u25E6': '\u2022',
  '\uF02D': '-',
  '\u2212': '-'
}

/** Ersetzt Aufzaehlungs- und Symbolzeichen, die WinAnsi anders kodiert. */
export function normalisiereZeichen(text: string): string {
  let ergebnis = ''
  for (const zeichen of text) ergebnis += ERSATZZEICHEN[zeichen] ?? zeichen
  return ergebnis
}

/**
 * Zeichen, die WinAnsi (die Kodierung aller Standard-14-Schriften) nicht
 * darstellen kann (S6.5, Aufgabe 4).
 *
 * Zeilenumbrueche werden nicht einzeln gemeldet: sie werden vor dem Zeichnen
 * durch den Zeilenumbruch (main/erscheinungsbild.ts) ohnehin nicht als
 * Glyphe gesetzt.
 */
export function nichtDarstellbareZeichen(text: string): string[] {
  const gefunden: string[] = []
  for (const zeichen of text) {
    if (zeichen === '\n' || zeichen === '\r' || zeichen === '\t') continue
    const codePoint = zeichen.codePointAt(0)
    if (codePoint === undefined) continue
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint) && !gefunden.includes(zeichen)) {
      gefunden.push(zeichen)
    }
  }
  return gefunden
}

/**
 * Meldung fuer alle `/FreeText`-Annotationen eines Aenderungssatzes, oder
 * `null`, wenn alles darstellbar ist.
 *
 * Eine **Meldung**, kein stiller Fehlschlag (Aufgabe 4): der Aufrufer wirft
 * damit vor dem Schreiben, und der bestehende Speicherpfad (ipc.ts) zeigt
 * jeden Fehler ohnehin als Ablehnung an — siehe `abgelehnt(...)` dort.
 */
export function pruefeFreitextZeichensatz(annotationen: readonly Annotation[]): string | null {
  const jeSeite = new Map<number, Set<string>>()
  for (const annotation of annotationen) {
    if (annotation.typ !== 'FreeText') continue
    const zeichen = nichtDarstellbareZeichen(annotation.inhalt)
    if (zeichen.length === 0) continue
    const menge = jeSeite.get(annotation.seite) ?? new Set<string>()
    for (const z of zeichen) menge.add(z)
    jeSeite.set(annotation.seite, menge)
  }
  if (jeSeite.size === 0) return null
  const teile = [...jeSeite.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seite, zeichen]) =>
      t('freitext.seiteZeichen', { seite, zeichen: [...zeichen].join(' ') })
    )
  // Review L1: "eine andere Schrift waehlen" war ein falscher Tipp - alle
  // drei Standard-14-Familien (Helvetica, Times, Courier) nutzen dieselbe
  // WinAnsi-Kodierung, keine kann diese Zeichen zusaetzlich darstellen. Auch
  // eine fremde Annotation, die der Nutzer nur verschoben hat (nicht diese
  // Zeichen selbst eingegeben), kann hier landen (S6.5) - deshalb "entfernen
  // oder aendern", nicht "diese Schrift ist falsch".
  return t('freitext.nichtDarstellbar', { teile: teile.join('; ') })
}
