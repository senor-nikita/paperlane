import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFStream,
  PDFString,
  PDFTextField,
  StandardFonts,
  PDFRef,
  PDFName,
  PDFHexString,
  type PDFContext,
  type PDFObject
} from 'pdf-lib'
import {
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState
} from 'pdf-lib'
import type { Aenderungen } from '../shared/aenderungen'
import type { Annotation } from '../shared/annotations'
import { AUS, type Feldwert } from '../shared/formulare'
import {
  STANDARD_SCHRIFTFAMILIE,
  STANDARD_SCHRIFTGROESSE,
  qAusAusrichtung
} from '../shared/freitext'
import {
  brauchtBild,
  brauchtSchrift,
  darfErsetzen,
  erscheinungFuer,
  type EingebetteteSchrift
} from './erscheinungsbild'
import {
  daSchriftname,
  pruefeFreitextZeichensatz,
  schluesselFuer,
  standardSchriftname
} from './freitext-schriften'
import { t } from '../shared/i18n'

/**
 * Der electron-freie Kern des Schreibpfads: Aenderungen mit pdf-lib auf die
 * neu gelesene Originaldatei anwenden (ADR 0001, Punkt 3).
 *
 * Seit S3.2 aus `speichern.ts` herausgeloest, und zwar aus einem einzigen
 * Grund: die Chrome-Gegenprobe (`test/e2e/appearance.chrome.spec.ts`) soll
 * die **echte** Schreibfunktion aufrufen, nicht eine Nachbildung davon. Ein
 * Modul, das `electron` importiert, laesst sich ausserhalb von Electron nicht
 * laden — Dialoge und Dateisystem bleiben deshalb drueben, und `speichern.ts`
 * exportiert alles von hier weiter, damit kein Aufrufer umlernen muss.
 */

/**
 * Traegt das Dokument eine digitale Signatur?
 *
 * Geprueft wird auf `/ByteRange`. Jede Signatur muss dieses Feld nach der
 * PDF-Spezifikation fuehren, und der Bytevergleich kommt ohne vollstaendiges
 * Parsen aus — er laeuft, bevor pdf-lib die Datei ueberhaupt angefasst hat.
 * Ein falscher Alarm kostet eine zusaetzliche Warnung; ein uebersehener Fall
 * kostete den Nutzer eine ungueltige Signatur, von der er nichts erfuhr.
 */
export function hatSignatur(bytes: Uint8Array): boolean {
  const muster = new TextEncoder().encode('/ByteRange')
  for (let i = 0; i + muster.length <= bytes.length; i++) {
    let passt = true
    for (let j = 0; j < muster.length; j++) {
      if (bytes[i + j] !== muster[j]) {
        passt = false
        break
      }
    }
    if (passt) return true
  }
  return false
}

/** Die Objektnummer hinter einer pdf.js-Kennung wie `"10R"`. */
export function objektnummer(id: string): number | null {
  const treffer = /^(\d+)R/.exec(id)
  return treffer === null ? null : Number(treffer[1])
}

/** Praefix der Kennungen, die der Renderer fuer neue Annotationen vergibt. */
const NEU_PRAEFIX = 'neu-'

/**
 * Gehoert dieser Eintrag einer `/Annots`-Liste zur Annotation mit dieser
 * Kennung?
 *
 * Eine Kennung aus der Datei (`10R`) wird ueber die Objektnummer gefunden. Eine
 * Kennung, die der Renderer selbst vergeben hat (`neu-...`), steht seit dem
 * Speichern als `/NM` in der Annotation - ihre Objektnummer vergibt erst die
 * Datei. Ohne diesen zweiten Weg gingen Aenderungen an einer eben gespeicherten
 * Annotation beim naechsten Speichern still verloren.
 */
function gehoertZu(
  kontext: PDFContext,
  eintrag: PDFObject,
  kennung: string,
  nummer: number | null
): boolean {
  if (nummer !== null) return 'objectNumber' in eintrag && eintrag.objectNumber === nummer
  const dict = kontext.lookupMaybe(eintrag, PDFDict)
  const nm = dict?.get(PDFName.of('NM'))
  return (nm instanceof PDFHexString || nm instanceof PDFString) && nm.decodeText() === kennung
}

/** Hat die Kennung einen Weg zur Annotation in der Datei? */
function auffindbar(kennung: string, nummer: number | null): boolean {
  return nummer !== null || kennung.startsWith(NEU_PRAEFIX)
}

function farbwerte(annotation: Annotation): number[] | null {
  const farbe = annotation.farbe
  return farbe === null ? null : [farbe.r / 255, farbe.g / 255, farbe.b / 255]
}

/**
 * Die Felder, die diese Anwendung fuehrt.
 *
 * Alles, was hier **nicht** steht, bleibt bei einer geaenderten Annotation
 * unangetastet im vorhandenen Dictionary stehen — das ist die Zusage
 * "unbekannte Objekte verbatim erhalten" (Folge von D7).
 */
export function felder(
  annotation: Annotation,
  kontext: PDFContext,
  erscheinung: Erscheinungsmittel = {}
): Record<string, PDFObject> {
  const werte: Record<string, PDFObject> = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(annotation.subtyp),
    Rect: kontext.obj([...annotation.rect]),
    // Bit 3 (Print): sonst fehlt die Anmerkung im Ausdruck.
    F: kontext.obj(4),
    CA: kontext.obj(annotation.opazitaet),
    // Hex-Strings und nicht Literal-Strings (Gate Phase 2, H1): pdf-lib
    // schreibt `PDFString` roh in die Datei, ohne Klammern und Backslashes
    // zu maskieren. Eine schliessende Klammer in einer Notiz - oder ein
    // Benutzername wie "O'Brien (IT)" - beendete den String vorzeitig, und
    // der Rest des Dictionaries war fuer jeden Parser Muell. Ein Hex-String
    // braucht kein Maskieren und traegt Umlaute als UTF-16BE mit BOM, was
    // pdf.js beim Lesen transparent dekodiert.
    T: PDFHexString.fromText(annotation.autor),
    Contents: PDFHexString.fromText(annotation.inhalt)
  }
  // Die Kennung einer in dieser Sitzung entstandenen Annotation als /NM. Die
  // Datei vergibt ihr beim Speichern eine Objektnummer, die der Renderer nicht
  // kennt - ohne /NM liesse sich die Annotation danach weder aendern noch
  // loeschen noch ihr Erstellen zuruecknehmen (siehe `gehoertZu`).
  if (annotation.id.startsWith(NEU_PRAEFIX)) werte['NM'] = PDFHexString.fromText(annotation.id)
  if (annotation.geaendert !== null) werte['M'] = PDFHexString.fromText(annotation.geaendert)
  if (annotation.erstellt !== null) {
    werte['CreationDate'] = PDFHexString.fromText(annotation.erstellt)
  }
  const farbe = farbwerte(annotation)
  if (farbe !== null) werte['C'] = kontext.obj(farbe)
  if (annotation.quadPoints !== null) werte['QuadPoints'] = kontext.obj([...annotation.quadPoints])
  if (annotation.striche !== null) {
    werte['InkList'] = kontext.obj(annotation.striche.map((zug) => kontext.obj([...zug])))
  }
  if (annotation.strichstaerke !== null) {
    werte['BS'] = kontext.obj({ W: kontext.obj(annotation.strichstaerke) })
  }
  // pdf.js waehlt das Symbol einer Textnotiz ueber /Name; ohne Angabe zeichnen
  // fremde Betrachter gar nichts.
  if (annotation.typ === 'Text') werte['Name'] = PDFName.of('Comment')

  // /FreeText (S6.5, Aufgabe 3): /DA und /Q sind Metadaten fuer Werkzeuge, die
  // selbst neu setzen; unser eigenes /AP unten bestimmt, was zu sehen ist.
  if (annotation.typ === 'FreeText') {
    const familie = annotation.schriftFamilie ?? STANDARD_SCHRIFTFAMILIE
    const groesse =
      annotation.schriftGroesse !== undefined && annotation.schriftGroesse > 0
        ? annotation.schriftGroesse
        : STANDARD_SCHRIFTGROESSE
    const werteFarbe = farbwerte(annotation) ?? [0, 0, 0]
    const r = werteFarbe[0] ?? 0
    const g = werteFarbe[1] ?? 0
    const b = werteFarbe[2] ?? 0
    const da =
      zahl(r) +
      ' ' +
      zahl(g) +
      ' ' +
      zahl(b) +
      ' rg /' +
      daSchriftname(familie) +
      ' ' +
      zahl(groesse) +
      ' Tf'
    werte['DA'] = PDFHexString.fromText(da)
    werte['Q'] = kontext.obj(qAusAusrichtung(annotation.ausrichtung ?? 'links'))
  }

  // S2.3b: das Erscheinungsbild. Ohne `/AP` zeigt diese Anwendung die
  // Anmerkung weiter an — ein fremder Betrachter in aller Regel nicht (R1).
  const ap = erscheinungFuer(
    annotation,
    kontext,
    (a) => erscheinung.schriften?.get(schluesselFuer(a)) ?? null,
    erscheinung.bilder?.get(annotation.id) ?? null
  )
  if (ap !== null) werte['AP'] = ap
  return werte
}

/** Vier Nachkommastellen, keine Exponentialschreibweise — wie im Erscheinungsbild-Modul. */
function zahl(wert: number): string {
  if (!Number.isFinite(wert)) return '0'
  const gerundet = Math.round(wert * 10000) / 10000
  return Object.is(gerundet, -0) ? '0' : String(gerundet)
}

/**
 * Was `felder` braucht, um ein Erscheinungsbild zu erzeugen (S2.3b).
 *
 * Beides optional: die Schrift entsteht nur, wenn wirklich ein Stempel dabei
 * ist, und die uebrigen Typen kommen ohne aus.
 */
export interface Erscheinungsmittel {
  /**
   * Eine eingebettete Schrift je Familie+Stil-Schluessel (S6.5). Stempel
   * brauchen immer genau eine Kombination (Helvetica, kein Stil); `/FreeText`
   * kann mehrere im selben Dokument brauchen.
   */
  schriften?: ReadonlyMap<string, EingebetteteSchrift>
  /** Eingebettete Bilder je Annotations-Kennung (S3.2, grafische Signatur). */
  bilder?: ReadonlyMap<string, PDFRef>
}

/** Ab dieser Groesse wird ein Bild abgelehnt — ein Signaturbild ist klein. */
export const MAX_BILD_BYTES = 5 * 1024 * 1024

export type Bildart = 'png' | 'jpg'

const PNG_KOPF = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_KOPF = [0xff, 0xd8, 0xff]

/**
 * Erkennt PNG und JPEG am Dateikopf — nicht an Endung oder MIME-Typ. Eine
 * umbenannte Datei ist der haeufigste Grund, warum "ein PNG" keines ist, und
 * pdf-lib wirft dann beim Einbetten einen Fehler, den der Nutzer nicht
 * versteht. Gebraucht beim Laden (`bild.ts`) und beim Einbetten (unten).
 */
export function bildart(bytes: Uint8Array): Bildart | null {
  const beginntMit = (kopf: readonly number[]): boolean =>
    kopf.every((wert, i) => bytes[i] === wert)
  if (beginntMit(PNG_KOPF)) return 'png'
  if (beginntMit(JPEG_KOPF)) return 'jpg'
  return null
}

/**
 * Zerlegt die Bild-Data-URL eines Bildstempels.
 *
 * Nur PNG und JPEG: mehr kann pdf-lib nicht einbetten, und ein Stempel mit
 * fehlendem Bild waere in fremden Betrachtern eine leere Flaeche. Die
 * Pruefung liegt im Main, weil der Renderer die Zeichenkette liefert — was
 * er liefert, ist Eingabe, nicht Wahrheit. Deshalb entscheidet der
 * **Dateikopf** ueber die Art, nicht der MIME-Typ in der URL (Gate Phase 3).
 */
export function zerlegeBildUrl(url: string): { art: Bildart; bytes: Uint8Array } {
  const treffer = /^data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (treffer === null) {
    throw new Error(t('signaturbild.format'))
  }
  const bytes = new Uint8Array(Buffer.from(treffer[1] ?? '', 'base64'))
  if (bytes.byteLength === 0) throw new Error(t('signaturbild.leer'))
  if (bytes.byteLength > MAX_BILD_BYTES) throw new Error(t('signaturbild.zuGross'))
  const art = bildart(bytes)
  if (art === null) throw new Error(t('signaturbild.art'))
  return { art, bytes }
}

/**
 * Bettet die Bilder der Bildstempel ein, einmal je Annotation.
 *
 * Vor dem Erzeugen der Dictionaries, weil `felder` synchron ist und ein
 * `/AP` ohne eingebettetes XObject nicht entstehen darf.
 */
async function bilderFallsNoetig(
  dokument: PDFDocument,
  aenderungen: Aenderungen
): Promise<Map<string, PDFRef>> {
  const bilder = new Map<string, PDFRef>()
  for (const annotation of [...aenderungen.neue, ...aenderungen.geaendert]) {
    if (!brauchtBild(annotation) || annotation.bild === undefined) continue
    const { art, bytes } = zerlegeBildUrl(annotation.bild)
    const eingebettet =
      art === 'png' ? await dokument.embedPng(bytes) : await dokument.embedJpg(bytes)
    bilder.set(annotation.id, eingebettet.ref)
  }
  return bilder
}

/**
 * Bettet alle Schriften ein, die der Aenderungssatz braucht — Stempel und
 * `/FreeText` teilen sich dieses Verfahren (S6.5).
 *
 * Eine Schrift einzubetten vergroessert jedes gespeicherte Dokument. Wer nur
 * markiert, soll das nicht bezahlen. Je Familie+Stil-Kombination genau
 * einmal, nicht je Annotation: pdf-lib legte sonst mehrere gleiche
 * Schriftobjekte an.
 */
async function schriftFallsNoetig(
  dokument: PDFDocument,
  aenderungen: Aenderungen
): Promise<Erscheinungsmittel> {
  const betroffene = [...aenderungen.neue, ...aenderungen.geaendert].filter(brauchtSchrift)
  if (betroffene.length === 0) return {}

  const schluessel = new Set<string>()
  for (const annotation of betroffene) schluessel.add(schluesselFuer(annotation))

  const schriften = new Map<string, EingebetteteSchrift>()
  for (const eintrag of schluessel) {
    const [familieRoh, stil] = eintrag.split(':')
    const familie = (familieRoh ?? 'Helvetica') as Parameters<typeof standardSchriftname>[0]
    const eingebettet = await dokument.embedFont(
      standardSchriftname(familie, (stil ?? '').includes('f'), (stil ?? '').includes('k'))
    )
    schriften.set(eintrag, {
      ref: eingebettet.ref,
      schrift: {
        breiteVon: (text, groesse) => eingebettet.widthOfTextAtSize(text, groesse),
        // `encodeText` liefert eine Hex-Zeichenkette einschliesslich der
        // Spitzklammern - genau das, was vor `Tj` stehen muss.
        kodiere: (text) => eingebettet.encodeText(text).toString()
      }
    })
  }
  return { schriften }
}

function annotationsListe(dokument: PDFDocument, seite: number): PDFArray {
  const knoten = dokument.getPage(seite - 1).node
  const vorhanden = knoten.Annots()
  if (vorhanden !== undefined) return vorhanden
  const neu = dokument.context.obj([])
  knoten.set(PDFName.of('Annots'), neu)
  return neu
}

/**
 * Wendet die Aenderungen auf die **neu gelesene** Originaldatei an.
 *
 * Nur was der Renderer nennt, wird angefasst. Der Bestand einer Seite wird
 * nicht neu aufgebaut: eine Seite, die der Leser nie gesehen hat, ist dem
 * Renderer unbekannt, und ihr Inhalt bleibt genau deshalb unberuehrt.
 */
export interface Schreiboptionen {
  /** Geaenderte Formularwerte je Feldname (S3.2). */
  formularwerte?: Record<string, Feldwert>
  /** Nach dem Eintragen der Werte das Formular flachlegen (S3.2, Aufgabe 2). */
  flachlegen?: boolean
}

/**
 * Traegt Formularwerte in die Felder ein (S3.2, Aufgabe 1).
 *
 * Ueber pdf-libs Formular-API und nicht ueber rohe Dictionaries: sie kennt
 * die Eigenheiten je Feldart - den `/Off`-Zustand einer Gruppe, die
 * `/I`-Indizes einer Mehrfachauswahl, den Kind-Widget-Zustand `/AS`. Das
 * nachzubauen ergaebe genau die Fehler, die die Bibliothek schon behoben hat.
 *
 * **Feld-Appearances erzeugt pdf-lib** (`updateFieldAppearances`), nicht das
 * Modul aus S2.3b. Das ist eine bewusste Abweichung von Aufgabe 1 in S3.2
 * (begruendet im Aenderungsprotokoll des Plans): ein
 * Textfeld braucht Zeilenumbruch, Kammfelder, Ausrichtung und automatische
 * Schriftgroesse - all das hat pdf-lib, und es fuer Felder neu zu schreiben
 * hiesse, eine zweite Implementierung mit eigenen Fehlern neben eine
 * erprobte zu stellen. Das gemeinsame Modul bleibt fuer das, was pdf-lib
 * nicht kann: Anmerkungen und das Signaturbild.
 *
 * Unbekannte Feldnamen werfen. Ein stilles Ueberspringen hiesse, dass der
 * Leser "Gespeichert" liest und ein Wert trotzdem fehlt.
 */
export function wendeFormularwerteAn(
  dokument: PDFDocument,
  werte: Readonly<Record<string, Feldwert>>
): string[] {
  const namen = Object.keys(werte)
  if (namen.length === 0) return []
  const formular = dokument.getForm()
  const geschrieben: string[] = []

  for (const name of namen) {
    const wert = werte[name]
    if (wert === undefined) continue
    const feld = formular.getFieldMaybe(name)
    if (feld === undefined) throw new Error('Unbekanntes Formularfeld: ' + name)
    // Schreibgeschuetzte Felder ruehrt der Renderer nicht an; sollte doch ein
    // Wert ankommen, ist das kein Grund, den Schutz zu umgehen.
    if (feld.isReadOnly()) continue

    if (feld instanceof PDFTextField) {
      feld.setText(typeof wert === 'string' ? wert : '')
    } else if (feld instanceof PDFCheckBox) {
      if (wert === true) feld.check()
      else feld.uncheck()
    } else if (feld instanceof PDFRadioGroup) {
      if (typeof wert === 'string' && wert !== AUS && wert.length > 0) feld.select(wert)
      else feld.clear()
    } else if (feld instanceof PDFDropdown || feld instanceof PDFOptionList) {
      const auswahl = typeof wert === 'string' ? [wert] : typeof wert === 'boolean' ? [] : [...wert]
      if (auswahl.length === 0) feld.clear()
      else
        feld.select(
          feld instanceof PDFDropdown && !feld.isMultiselect() ? (auswahl[0] ?? '') : auswahl
        )
    } else {
      // Schaltflaechen und Signaturfelder tragen keinen Wert, den man setzt.
      continue
    }
    geschrieben.push(name)
  }
  return geschrieben
}

export async function wendeAenderungenAn(
  quellbytes: Uint8Array,
  aenderungen: Aenderungen,
  optionen: Schreiboptionen = {}
): Promise<Uint8Array> {
  // S6.5, Aufgabe 4: vor dem Schreiben melden, nicht still verschlucken.
  // pdf-lib wirft beim Kodieren sonst einen technischen Fehler ohne Bezug
  // zur betroffenen Annotation oder Seite.
  const zeichensatzMeldung = pruefeFreitextZeichensatz([
    ...aenderungen.neue,
    ...aenderungen.geaendert
  ])
  if (zeichensatzMeldung !== null) throw new Error(zeichensatzMeldung)

  const dokument = await PDFDocument.load(quellbytes)
  const erscheinung: Erscheinungsmittel = {
    ...(await schriftFallsNoetig(dokument, aenderungen)),
    bilder: await bilderFallsNoetig(dokument, aenderungen)
  }

  // Formularwerte zuerst: das Flachlegen unten braucht die fertigen
  // Appearances, und die Anmerkungen darunter haengen an keiner davon.
  const formularwerte = optionen.formularwerte ?? {}
  const geschriebeneFelder = wendeFormularwerteAn(dokument, formularwerte)
  if (geschriebeneFelder.length > 0 || optionen.flachlegen === true) {
    // Dieselbe Schrift wie fuer Stempel; pdf-lib nimmt sie fuer alle
    // Textfelder, deren Aussehen neu entstehen muss.
    const schrift = await dokument.embedFont(StandardFonts.Helvetica)
    dokument.getForm().updateFieldAppearances(schrift)
  }
  if (optionen.flachlegen === true) {
    // Nicht umkehrbar: die Felder werden zu Seiteninhalt, das Formular ist
    // danach keines mehr. Der Aufrufer hat vorher gefragt.
    dokument.getForm().flatten()
    // pdf-lib loescht die Widget-Objekte, laesst ihre Verweise aber im
    // /Annots-Feld jeder Seite stehen - haengende Verweise, die bei manchem
    // Leser als Warnung auftauchen. Wegraeumen, was auf nichts mehr zeigt.
    for (const seite of dokument.getPages()) {
      const annots = seite.node.Annots()
      if (annots === undefined) continue
      for (let stelle = annots.size() - 1; stelle >= 0; stelle--) {
        if (dokument.context.lookup(annots.get(stelle)) === undefined) annots.remove(stelle)
      }
    }
  }

  for (const kennung of aenderungen.geloescht) {
    const nummer = objektnummer(kennung)
    if (!auffindbar(kennung, nummer)) continue
    for (let seite = 1; seite <= dokument.getPageCount(); seite++) {
      const liste = annotationsListe(dokument, seite)
      for (let stelle = liste.size() - 1; stelle >= 0; stelle--) {
        if (gehoertZu(dokument.context, liste.get(stelle), kennung, nummer)) liste.remove(stelle)
      }
    }
  }

  for (const annotation of aenderungen.geaendert) {
    const nummer = objektnummer(annotation.id)
    if (!auffindbar(annotation.id, nummer)) continue
    const liste = annotationsListe(dokument, annotation.seite)
    for (let stelle = 0; stelle < liste.size(); stelle++) {
      const eintrag = liste.get(stelle)
      if (!gehoertZu(dokument.context, eintrag, annotation.id, nummer)) continue
      // Im vorhandenen Dictionary nur die gefuehrten Felder ueberschreiben —
      // alles Uebrige bleibt so stehen, wie das Dokument es hatte.
      const dict = liste.lookup(stelle, PDFDict)
      const hatteAp = dict.get(PDFName.of('AP')) !== undefined
      for (const [name, wert] of Object.entries(
        felder(annotation, dokument.context, erscheinung)
      )) {
        // Ein fremdes Erscheinungsbild kann ein eingescanntes Zeichen sein, das
        // sich aus unseren Feldern nicht rekonstruieren laesst (S2.3b).
        if (name === 'AP' && !darfErsetzen(annotation, hatteAp)) continue
        dict.set(PDFName.of(name), wert)
      }
    }
  }

  for (const annotation of aenderungen.neue) {
    const verweis = dokument.context.register(
      dokument.context.obj(felder(annotation, dokument.context, erscheinung))
    )
    annotationsListe(dokument, annotation.seite).push(verweis)
  }

  // S6.5, Aufgabe 5: Flachlegen (S3.2) schreibt auch `/FreeText` fest in den
  // Seiteninhalt — erst hier, nach den beiden Schleifen oben, damit ein
  // gerade erst geaenderter Text mit seinem **neuen** /AP gebacken wird.
  // Das /AP selbst besteht aus echten Textoperatoren (BT/Tj); einmal in den
  // Seiteninhalt uebernommen, findet ihn die Textsuche wie jeden anderen
  // Text der Seite - eine Annotation "flachzulegen" heisst hier wirklich,
  // ihre Glyphen zu Seiteninhalt zu machen, nicht nur, sie unsichtbar zu
  // markieren.
  if (optionen.flachlegen === true) {
    for (const seite of dokument.getPages()) {
      const annots = seite.node.Annots()
      if (annots === undefined) continue
      // Review M3: der bestehende Seiteninhalt kann mit einem nicht
      // zurueckgesetzten `cm` enden (mancher Erzeuger setzt ihn auf oberster
      // Ebene ohne q/Q). `normalize()` kapselt den **vorhandenen** Inhalt
      // einmalig in q/Q (idempotent, eigenes Flag), bevor unten ueberhaupt
      // etwas angehaengt wird - genau wie beim Texteditor (editor.ts), nur
      // ueber die dafuer vorgesehene pdf-lib-Funktion statt von Hand.
      seite.node.normalize()
      for (let stelle = annots.size() - 1; stelle >= 0; stelle--) {
        const verweis = annots.get(stelle)
        const dict = dokument.context.lookup(verweis, PDFDict)
        if (dict === undefined) continue
        const subtyp = dict.get(PDFName.of('Subtype'))
        if (!(subtyp instanceof PDFName) || subtyp.decodeText() !== 'FreeText') continue
        // Eine versteckte Annotation (Flag Hidden, Bit 2 = Wert 2) wird nie
        // gezeichnet - sie beim Flachlegen einzubrennen machte sie sichtbar.
        // Sie war ohnehin nie Bestand der Ansicht, also einfach entfernen.
        const flags = dict.get(PDFName.of('F'))
        const versteckt = flags instanceof PDFNumber && (flags.asNumber() & 2) !== 0
        if (versteckt) {
          annots.remove(stelle)
          continue
        }
        const apDict = dict.lookupMaybe(PDFName.of('AP'), PDFDict)
        const strom = apDict?.get(PDFName.of('N'))
        // Erwartet eine Referenz, wie erscheinungFuer sie immer erzeugt
        // (kontext.register). Ein Inline-Stream waere nicht spezifikationswidrig,
        // kommt aber weder von uns noch ueblicherweise von anderen Schreibern.
        if (!(strom instanceof PDFRef)) continue
        const formDict = dokument.context.lookup(strom, PDFStream)
        const matrix = matrixFuerFlachlegen(formDict, dict)
        const name = seite.node.newXObject('FreitextFlach', strom)
        seite.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(...matrix),
          drawObject(name),
          popGraphicsState()
        )
        annots.remove(stelle)
      }
    }
  }

  return dokument.save()
}

/** Eine Zahl aus einer `PDFArray`-Stelle, `null` wenn dort keine steht. */
function zahlAus(array: PDFArray | undefined, index: number): number | null {
  const wert = array?.get(index)
  return wert instanceof PDFNumber ? wert.asNumber() : null
}

/** Vier Zahlen aus einer `PDFArray`, oder `null`, wenn eine fehlt. */
function vierZahlen(array: PDFArray | undefined): [number, number, number, number] | null {
  const werte: number[] = []
  for (let i = 0; i < 4; i++) {
    const zahl = zahlAus(array, i)
    if (zahl === null || !Number.isFinite(zahl)) return null
    werte.push(zahl)
  }
  return werte as [number, number, number, number]
}

/** Sechs Zahlen aus einer `PDFArray` (Transformationsmatrix), oder die Einheitsmatrix. */
function sechsZahlenOderEinheit(
  array: PDFArray | undefined
): [number, number, number, number, number, number] {
  if (array === undefined) return [1, 0, 0, 1, 0, 0]
  const werte: number[] = []
  for (let i = 0; i < 6; i++) {
    const zahl = zahlAus(array, i)
    if (zahl === null || !Number.isFinite(zahl)) return [1, 0, 0, 1, 0, 0]
    werte.push(zahl)
  }
  return werte as [number, number, number, number, number, number]
}

/**
 * Die Abbildung "transformierte BBox auf Rect" nach PDF 32000-1, 12.5.5
 * (Appearance Streams), Schritt 2c/2d: die BBox des Erscheinungsbilds wird
 * mit dessen eigener `/Matrix` transformiert, die umschliessende Box dieser
 * vier Punkte dann per Skalierung und Verschiebung auf `/Rect` der Annotation
 * abgebildet. `/Do` wendet `/Matrix` selbst automatisch an (PDF 32000-1,
 * 8.10.2) - diese Funktion liefert nur das zusaetzliche `cm` davor.
 *
 * Review M3: `/Do` allein zeichnet ein fremdes Erscheinungsbild nur mit
 * seiner eigenen Matrix - stimmt zufaellig nur, wenn BBox gleich Rect und
 * Matrix die Einheitsmatrix ist (unsere eigenen Erscheinungsbilder,
 * `erscheinungsbild.ts`). Ein fremdes Werkzeug mit `/BBox [0 0 w h]` oder
 * einer Verschiebungsmatrix landete sonst an der falschen Stelle.
 */
function matrixFuerFlachlegen(
  formDict: PDFStream | undefined,
  annotationDict: PDFDict
): [number, number, number, number, number, number] {
  const einheit: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
  const bbox = vierZahlen(formDict?.dict.lookupMaybe(PDFName.of('BBox'), PDFArray))
  const rect = vierZahlen(annotationDict.lookupMaybe(PDFName.of('Rect'), PDFArray))
  if (bbox === null || rect === null) return einheit
  const [a, b, c, d, e, f] = sechsZahlenOderEinheit(
    formDict?.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)
  )
  const roheEcken: [number, number][] = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]]
  ]
  const ecken: [number, number][] = roheEcken.map(([x, y]) => [
    a * x + c * y + e,
    b * x + d * y + f
  ])
  const xWerte = ecken.map(([x]) => x)
  const yWerte = ecken.map(([, y]) => y)
  const minX = Math.min(...xWerte)
  const maxX = Math.max(...xWerte)
  const minY = Math.min(...yWerte)
  const maxY = Math.max(...yWerte)
  const rectX0 = Math.min(rect[0], rect[2])
  const rectY0 = Math.min(rect[1], rect[3])
  const rectBreite = Math.abs(rect[2] - rect[0])
  const rectHoehe = Math.abs(rect[3] - rect[1])
  const transformierteBreite = maxX - minX
  const transformierteHoehe = maxY - minY
  const sx = transformierteBreite > 0 ? rectBreite / transformierteBreite : 1
  const sy = transformierteHoehe > 0 ? rectHoehe / transformierteHoehe : 1
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return einheit
  const tx = rectX0 - sx * minX
  const ty = rectY0 - sy * minY
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return einheit
  return [sx, 0, 0, sy, tx, ty]
}
