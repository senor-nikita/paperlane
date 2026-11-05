import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild
} from 'docx'
import type { WordAuftrag, WordBlock, WordLauf, WordSeite } from '../shared/ipc'
import { t } from '../shared/i18n'

/**
 * PDF nach Word (S6.7, D19) - der electron-freie Kern im Main.
 *
 * Zwei Aufgaben, beide ohne Electron pruefbar:
 *
 * 1. **Die Eingabe pruefen.** Der Auftrag kommt aus dem Renderer, und der
 *    zeigt fremde Dokumente - seine Nachrichten sind nicht vertrauenswuerdig.
 *    Geprueft werden Typen, Grenzen fuer Anzahl und Groesse und bei jedem Bild
 *    der PNG-Kopf. Heraus kommt ein **neu aufgebautes** Objekt, nicht das des
 *    Renderers mit angehaengten Feldern.
 * 2. **Die `.docx` bauen** - mit dem Paket `docx` (MIT, D19). Das Layout ist
 *    bewusst grob (R16): Absaetze, Ueberschriften 1-3, fett und kursiv,
 *    Bilder in Lesereihenfolge, Seitenumbruch je PDF-Seite.
 *
 * Seitengroesse aus der ersten Seite. Die Raender kennt der IPC-Vertrag nicht
 * (`WordSeite` traegt nur die Masse); sie sind fest und an die Seite
 * angepasst, siehe `rand`.
 */

/** Mehr Seiten nimmt auch der Druck nicht an; darueber ist etwas faul. */
export const MAX_SEITEN = 10_000
export const MAX_BLOECKE = 500_000
export const MAX_LAEUFE_JE_ABSATZ = 10_000
/**
 * Security L5: 50 Millionen Zeichen und 1 GB Bilder waren zu grosszuegig fuer
 * einen synchronen Main - `Packer.toBuffer` (jszip) haelt die ganze `.docx`
 * im Speicher, und der Auftrag kommt vom Renderer, der ein fremdes Dokument
 * zeigt (Bedrohungsmodell). 10 Millionen Zeichen sind immer noch gut 5.000
 * dichte Seiten; das Bildbudget ist an `MAX_GESAMT_BYTES` der Arbeitskopien
 * angelehnt (`arbeitskopie.ts`, 1 GB dort ist bereits das Budget **aller**
 * offenen Tabs zusammen - ein einzelner Word-Export soll nicht annaehernd so
 * viel beanspruchen duerfen).
 */
export const MAX_ZEICHEN = 10_000_000
export const MAX_BILDER = 20_000
/** Ein PNG, das der Renderer auf hoechstens 2048 Pixel je Kante bringt. */
export const MAX_BILD_BYTES = 64 * 1024 * 1024
export const MAX_BILD_BYTES_GESAMT = 256 * 1024 * 1024
/** 200 Zoll - die groesste Seite, die ein PDF kennt. */
export const MAX_MASS_PT = 14_400
export const MAX_SCHRIFT_PT = 1_638
const MAX_PFADLAENGE = 32 * 1024

/** Groesste Seite, die Word annimmt: 22 Zoll je Kante. */
const WORD_MAX_SEITE_PT = 1_584

const PNG_SIGNATUR = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

export type WordPruefung = { ok: true; auftrag: WordAuftrag } | { ok: false; grund: string }

/**
 * Ist das ein PNG? Signatur und als erster Chunk `IHDR` mit Breite und Hoehe
 * groesser null - so fangen auch abgeschnittene Bytes an der Grenze auf.
 */
export function istPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false
  if (!PNG_SIGNATUR.every((wert, stelle) => bytes[stelle] === wert)) return false
  const typ = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0)
  if (typ !== 'IHDR') return false
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return sicht.getUint32(16) > 0 && sicht.getUint32(20) > 0
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert)
}

function istMass(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert) && wert > 0 && wert <= MAX_MASS_PT
}

/**
 * Die in XML 1.0 verbotenen Zeichen (ohne Tab und Zeilenumbruch, die vorher
 * zu Leerzeichen werden) samt der Nichtzeichen U+FFFE und U+FFFF. Als
 * Zeichenkette mit Escapes, damit kein Werkzeug die Zeichen selbst einsetzt.
 */
const STEUERZEICHEN = '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF'

/**
 * Zeichen, die XML 1.0 nicht erlaubt, machen die `.docx` kaputt - Word meldet
 * dann "unlesbarer Inhalt" und bietet eine Reparatur an. PDFs tragen solche
 * Zeichen oefter, als man denkt (Steuerzeichen aus kaputten ToUnicode-Tabellen).
 * Tab und Zeilenumbruch werden Leerzeichen: ein Lauf ist eine Zeile Text.
 */
export function bereinigeText(text: string): string {
  return (
    text
      .replace(/[\t\n\r]/g, ' ')
      .replace(new RegExp('[' + STEUERZEICHEN + ']', 'g'), '')
      // Einzelne Surrogate sind kein gueltiges Zeichen.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  )
}

interface Zaehler {
  bloecke: number
  zeichen: number
  bilder: number
  bildBytes: number
}

function pruefeLauf(eingabe: unknown, zaehler: Zaehler): WordLauf | string {
  if (!istObjekt(eingabe)) return t('word.v.laufForm')
  const { text, fett, kursiv, groessePt } = eingabe
  if (typeof text !== 'string') return t('word.v.laufText')
  if (typeof fett !== 'boolean' || typeof kursiv !== 'boolean') {
    return t('word.v.laufAuszeichnung')
  }
  if (typeof groessePt !== 'number' || !Number.isFinite(groessePt) || groessePt <= 0) {
    return t('word.v.laufGroesse')
  }
  zaehler.zeichen += text.length
  if (zaehler.zeichen > MAX_ZEICHEN) return t('word.v.zuVielText')
  return {
    text: bereinigeText(text),
    fett,
    kursiv,
    groessePt: Math.min(Math.max(groessePt, 1), MAX_SCHRIFT_PT)
  }
}

function pruefeBlock(eingabe: unknown, zaehler: Zaehler): WordBlock | string {
  if (!istObjekt(eingabe)) return t('word.v.blockForm')
  zaehler.bloecke += 1
  if (zaehler.bloecke > MAX_BLOECKE) return t('word.v.zuVieleAbsaetze')
  if (eingabe['art'] === 'absatz') {
    const ebene = eingabe['ebene']
    if (ebene !== 0 && ebene !== 1 && ebene !== 2 && ebene !== 3) {
      return t('word.v.ebene')
    }
    const laeufe = eingabe['laeufe']
    if (!Array.isArray(laeufe) || laeufe.length > MAX_LAEUFE_JE_ABSATZ) {
      return t('word.v.laeufe')
    }
    const geprueft: WordLauf[] = []
    for (const lauf of laeufe) {
      const ergebnis = pruefeLauf(lauf, zaehler)
      if (typeof ergebnis === 'string') return ergebnis
      geprueft.push(ergebnis)
    }
    return { art: 'absatz', ebene, laeufe: geprueft }
  }
  if (eingabe['art'] === 'bild') {
    const { png, breitePt, hoehePt } = eingabe
    if (!(png instanceof Uint8Array)) return t('word.v.bildDaten')
    if (png.length > MAX_BILD_BYTES) return t('word.v.bildZuGross')
    if (!istPng(png)) return t('word.v.keinPng')
    if (!istMass(breitePt) || !istMass(hoehePt)) return t('word.v.bildMasse')
    zaehler.bilder += 1
    zaehler.bildBytes += png.length
    if (zaehler.bilder > MAX_BILDER) return t('word.v.zuVieleBilder')
    if (zaehler.bildBytes > MAX_BILD_BYTES_GESAMT) {
      return t('word.v.bilderZuGross')
    }
    // Eine eigene Kopie: die Bytes des Renderers koennten auf einen groesseren
    // Puffer zeigen, von dem nur ein Ausschnitt gemeint ist.
    return { art: 'bild', png: png.slice(), breitePt, hoehePt }
  }
  return t('word.v.blockArt')
}

function pruefeSeite(eingabe: unknown, zaehler: Zaehler): WordSeite | string {
  if (!istObjekt(eingabe)) return t('word.v.seiteForm')
  const { breitePt, hoehePt, bloecke } = eingabe
  if (!istMass(breitePt) || !istMass(hoehePt)) return t('word.v.seiteMasse')
  if (!Array.isArray(bloecke)) return t('word.v.seiteBloecke')
  const geprueft: WordBlock[] = []
  for (const block of bloecke) {
    const ergebnis = pruefeBlock(block, zaehler)
    if (typeof ergebnis === 'string') return ergebnis
    geprueft.push(ergebnis)
  }
  return { breitePt, hoehePt, bloecke: geprueft }
}

/** Prueft den Auftrag des Renderers und baut ihn neu auf. */
export function pruefeWordAuftrag(eingabe: unknown): WordPruefung {
  const abgelehnt = (grund: string): WordPruefung => ({ ok: false, grund })
  if (!istObjekt(eingabe)) return abgelehnt(t('auftrag.form'))
  const { quelle, seiten, seitenumbruch } = eingabe
  if (typeof quelle !== 'string' || quelle.length === 0 || quelle.length > MAX_PFADLAENGE) {
    return abgelehnt(t('word.v.keineQuelle'))
  }
  if (typeof seitenumbruch !== 'boolean') {
    return abgelehnt(t('auftrag.form'))
  }
  if (!Array.isArray(seiten) || seiten.length === 0) {
    return abgelehnt(t('word.v.keineSeiten'))
  }
  if (seiten.length > MAX_SEITEN) return abgelehnt(t('word.v.zuVieleSeiten'))
  const zaehler: Zaehler = { bloecke: 0, zeichen: 0, bilder: 0, bildBytes: 0 }
  const geprueft: WordSeite[] = []
  for (const seite of seiten) {
    const ergebnis = pruefeSeite(seite, zaehler)
    if (typeof ergebnis === 'string') return abgelehnt(ergebnis)
    geprueft.push(ergebnis)
  }
  return { ok: true, auftrag: { quelle, seiten: geprueft, seitenumbruch } }
}

/** Twips (Zwanzigstel Punkt) - die Masseinheit von Seite und Rand in DOCX. */
function twips(pt: number): number {
  return Math.round(pt * 20)
}

/**
 * Der Rand ringsum. Der Vertrag traegt keine Raender, also ein fester Wert:
 * ein Zoll wie in Word, aber hoechstens ein Zehntel der kuerzeren Kante -
 * ein Etikett von 3 x 5 cm behielte sonst keinen Platz fuer Text.
 */
export function rand(breitePt: number, hoehePt: number): number {
  return Math.max(9, Math.min(72, Math.round(Math.min(breitePt, hoehePt) * 0.1)))
}

/**
 * Bildgroesse in Pixeln (96 dpi, die Einheit von `docx`), das
 * Seitenverhaeltnis gewahrt und in den Satzspiegel eingepasst. Die Groesse
 * bleibt proportional zur Seite: die `.docx`-Seite hat die Masse der
 * PDF-Seite, das Bild seine Punktmasse von dort.
 */
export function bildMasse(
  breitePt: number,
  hoehePt: number,
  satzBreitePt: number,
  satzHoehePt: number
): { breite: number; hoehe: number } {
  const faktor = Math.min(1, satzBreitePt / breitePt, satzHoehePt / hoehePt)
  const pixel = (pt: number): number => Math.max(1, Math.round(((pt * faktor) / 72) * 96))
  return { breite: pixel(breitePt), hoehe: pixel(hoehePt) }
}

const UEBERSCHRIFT = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3
} as const

export interface DocxOptionen {
  /** Titel in den Dokumenteigenschaften, etwa der Name der Quelldatei. */
  titel: string
}

/** Baut die `.docx` aus einem **gepruefen** Auftrag. */
export async function baueDocx(auftrag: WordAuftrag, optionen: DocxOptionen): Promise<Uint8Array> {
  const erste = auftrag.seiten[0]
  const breitePt = Math.min(erste?.breitePt ?? 595, WORD_MAX_SEITE_PT)
  const hoehePt = Math.min(erste?.hoehePt ?? 842, WORD_MAX_SEITE_PT)
  const randPt = rand(breitePt, hoehePt)
  const satzBreite = breitePt - 2 * randPt
  const satzHoehe = hoehePt - 2 * randPt

  const absaetze: Paragraph[] = []
  auftrag.seiten.forEach((seite, seitenindex) => {
    seite.bloecke.forEach((block, blockindex) => {
      // Der Umbruch haengt am ersten Absatz der naechsten Seite und nicht als
      // leerer Absatz dazwischen: so entsteht kein Absatz ohne Inhalt, und
      // eine leere PDF-Seite ergibt keine leere Word-Seite.
      const umbruch = auftrag.seitenumbruch && seitenindex > 0 && blockindex === 0
      absaetze.push(absatzAus(block, umbruch, satzBreite, satzHoehe))
    })
  })
  // Ein Dokument ohne einen einzigen Absatz ist fuer Word kein Dokument.
  if (absaetze.length === 0) absaetze.push(new Paragraph({}))

  const dokument = new Document({
    creator: 'paperlane',
    title: optionen.titel,
    description: t('word.beschreibung'),
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(breitePt), height: twips(hoehePt) },
            margin: {
              top: twips(randPt),
              right: twips(randPt),
              bottom: twips(randPt),
              left: twips(randPt)
            }
          }
        },
        children: absaetze
      }
    ]
  })
  return new Uint8Array(await Packer.toBuffer(dokument))
}

function absatzAus(
  block: WordBlock,
  umbruch: boolean,
  satzBreite: number,
  satzHoehe: number
): Paragraph {
  if (block.art === 'bild') {
    const masse = bildMasse(block.breitePt, block.hoehePt, satzBreite, satzHoehe)
    return new Paragraph({
      pageBreakBefore: umbruch,
      children: [
        new ImageRun({
          type: 'png',
          data: block.png,
          transformation: { width: masse.breite, height: masse.hoehe }
        })
      ]
    })
  }
  const kinder: ParagraphChild[] = block.laeufe.map(
    (lauf) =>
      new TextRun({
        text: lauf.text,
        bold: lauf.fett,
        italics: lauf.kursiv,
        // Halbe Punkte.
        size: Math.round(lauf.groessePt * 2)
      })
  )
  return new Paragraph({
    pageBreakBefore: umbruch,
    ...(block.ebene === 0 ? {} : { heading: UEBERSCHRIFT[block.ebene] }),
    children: kinder
  })
}
