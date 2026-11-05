import {
  PDFCheckBox,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDocument
} from 'pdf-lib'
import { AUS, type Feldwert } from '../shared/formulare'

/**
 * FDF-Export (S3.2, Aufgabe 3) — nach PDF 32000-1, Abschnitt 12.7.7, und
 * nicht nach Gefuehl.
 *
 * Eine FDF-Datei ist ein PDF-Objektbaum mit eigenem Kopf: `%FDF-1.2`, ein
 * Wurzelobjekt mit `/FDF`, darin `/F` (die Datei, zu der die Werte gehoeren)
 * und `/Fields`. Jedes Feld traegt `/T` mit seinem **Teilnamen**; ein
 * hierarchischer Name wie `person.name` wird ueber `/Kids` verschachtelt, so
 * wie die Spezifikation es fuer Feldbaeume vorsieht. Werte: Text als String,
 * Kontrollkaestchen und Auswahlknoepfe als **Name** (`/Yes`, `/Off`),
 * Mehrfachauswahl als Feld von Strings.
 *
 * Zeichenketten als Hex-Strings — dieselbe Lehre wie beim Speichern (Gate
 * Phase 2, H1): kein Maskieren, Unicode als UTF-16BE mit BOM.
 *
 * **Bewusst ohne Electron-Import**, damit der Test das Ergebnis mit pdf-libs
 * eigenem Objektparser gegenlesen kann.
 */

/** Ein Knoten des Feldbaums: Teilname, Wert oder Kinder. */
interface Knoten {
  teilname: string
  wert: string | null
  kinder: Map<string, Knoten>
}

function neuerKnoten(teilname: string): Knoten {
  return { teilname, wert: null, kinder: new Map() }
}

function hex(text: string): string {
  return PDFHexString.fromText(text).toString()
}

function name(wert: string): string {
  return PDFName.of(wert).toString()
}

/** Der FDF-Wert eines Feldes, bereits als PDF-Syntax. */
function fdfWert(wert: Feldwert, artName: boolean): string {
  if (typeof wert === 'boolean') return name(wert ? 'Yes' : AUS)
  if (typeof wert === 'string') return artName ? name(wert.length > 0 ? wert : AUS) : hex(wert)
  return '[ ' + wert.map(hex).join(' ') + ' ]'
}

/**
 * Sammelt alle Felder des Dokuments mit ihrem aktuellen Wert — ueberlagert von
 * dem, was der Renderer geaendert hat und noch nicht geschrieben ist.
 *
 * Aus dem Dokument und nicht nur aus dem Renderer: der kennt nur die Seiten,
 * die er gelesen hat. Ein FDF mit der Haelfte der Felder waere kein Export.
 */
export function sammleFeldwerte(
  dokument: PDFDocument,
  ueberschreibungen: Readonly<Record<string, Feldwert>>
): { name: string; wert: string }[] {
  const ergebnis: { name: string; wert: string }[] = []
  for (const feld of dokument.getForm().getFields()) {
    const feldname = feld.getName()
    const neu = ueberschreibungen[feldname]
    let wert: string | null = null

    if (feld instanceof PDFTextField) {
      wert = fdfWert(neu ?? feld.getText() ?? '', false)
    } else if (feld instanceof PDFCheckBox) {
      // Der An-Zustand heisst im Dokument, wie er heisst - nicht immer "Yes".
      const an = feld.acroField.getOnValue()?.decodeText() ?? 'Yes'
      const angekreuzt = typeof neu === 'boolean' ? neu : feld.isChecked()
      wert = name(angekreuzt ? an : AUS)
    } else if (feld instanceof PDFRadioGroup) {
      const gewaehlt = typeof neu === 'string' ? neu : (feld.getSelected() ?? AUS)
      wert = fdfWert(gewaehlt, true)
    } else if (feld instanceof PDFDropdown || feld instanceof PDFOptionList) {
      const gewaehlt = neu === undefined ? feld.getSelected() : neu
      const liste =
        typeof gewaehlt === 'string'
          ? [gewaehlt]
          : typeof gewaehlt === 'boolean'
            ? []
            : [...gewaehlt]
      // Einfachauswahl als String, Mehrfachauswahl als Feld - so verlangt es
      // die Spezifikation fuer /V bei Auswahlfeldern.
      wert =
        liste.length === 1 && !feld.isMultiselect() ? hex(liste[0] ?? '') : fdfWert(liste, false)
    } else {
      // Schaltflaechen und Signaturfelder tragen keinen exportierbaren Wert.
      continue
    }
    ergebnis.push({ name: feldname, wert })
  }
  return ergebnis
}

/** Baut aus vollstaendigen Namen den Feldbaum, den /Kids verlangt. */
function baueBaum(felder: readonly { name: string; wert: string }[]): Map<string, Knoten> {
  const wurzel = new Map<string, Knoten>()
  for (const { name: voll, wert } of felder) {
    const teile = voll.split('.')
    let ebene = wurzel
    let knoten: Knoten | undefined
    for (const teil of teile) {
      knoten = ebene.get(teil)
      if (knoten === undefined) {
        knoten = neuerKnoten(teil)
        ebene.set(teil, knoten)
      }
      ebene = knoten.kinder
    }
    if (knoten !== undefined) knoten.wert = wert
  }
  return wurzel
}

function schreibeKnoten(knoten: Knoten, einzug: string): string {
  const zeilen = [einzug + '<<', einzug + '/T ' + hex(knoten.teilname)]
  if (knoten.wert !== null) zeilen.push(einzug + '/V ' + knoten.wert)
  if (knoten.kinder.size > 0) {
    zeilen.push(einzug + '/Kids [')
    for (const kind of knoten.kinder.values()) zeilen.push(schreibeKnoten(kind, einzug + '  '))
    zeilen.push(einzug + ']')
  }
  zeilen.push(einzug + '>>')
  return zeilen.join('\n')
}

/**
 * Die FDF-Datei als Bytes.
 *
 * `dateiname` ist der Name der PDF-Datei, zu der die Werte gehoeren — `/F`
 * traegt ihn, damit ein Werkzeug die Werte wieder zuordnen kann. Nur der
 * Name, nicht der Pfad: ein Pfad von diesem Rechner sagt einem anderen nichts.
 */
export function erzeugeFdf(
  felder: readonly { name: string; wert: string }[],
  dateiname: string
): Uint8Array {
  const baum = baueBaum(felder)
  const zeilen = [
    '%FDF-1.2',
    // Vier Bytes ueber 127, wie bei PDF ueblich: sie sagen Werkzeugen, dass
    // die Datei binaere Anteile haben kann (die Hex-Strings haben keine, der
    // Kopf ist Konvention).
    '%âãÏÓ',
    '1 0 obj',
    '<<',
    '/FDF <<',
    '/F ' + hex(dateiname),
    '/Fields ['
  ]
  for (const knoten of baum.values()) zeilen.push(schreibeKnoten(knoten, '  '))
  zeilen.push(']', '>>', '>>', 'endobj', 'trailer', '<< /Root 1 0 R >>', '%%EOF', '')
  return new TextEncoder().encode(zeilen.join('\n'))
}
