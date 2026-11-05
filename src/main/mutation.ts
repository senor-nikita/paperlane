import { degrees, PDFDocument, type PDFDict, type PDFPage } from 'pdf-lib'
import type { Mutation, TextBericht } from '../shared/mutation'
import { fuehreTextIsoliertAus, type TextWorkerStarter } from './textbearbeitung/isoliert'
import { ersetzeTextDirekt } from './textbearbeitung/textersetzen'
import { schneideSeitenZu } from './zuschnitt'
import { t } from '../shared/i18n'

let textWorker: TextWorkerStarter | undefined

/**
 * Setzt den Starter des Text-Workers (Gate Phase 6). `index.ts` setzt ihn beim
 * Start der Anwendung; ohne ihn (Unit-Tests, Fremdviewer-Gegenprobe, Werkzeuge
 * ausserhalb von Electron) laeuft `textErsetzen` direkt im aufrufenden Thread.
 */
export function setzeTextWorker(starter: TextWorkerStarter | undefined): void {
  textWorker = starter
}

/**
 * Der electron-freie Kern der Mutationspipeline (S4.0, Aufgabe 1; S4.1
 * erweitert um Drehen und Anordnen): eine Mutation auf Dokumentbytes anwenden
 * und die neuen Bytes liefern.
 *
 * Bewusst so schmal: die Pruefung, **welche** Bytes das sind (Arbeitskopie
 * oder Datei), und die Freigaben liegen im Handler; die Kosten misst
 * `test/perf/mutation.perf.spec.ts` an genau dieser Funktion.
 *
 * Wie beim Schreibpfad wird vollstaendig neu serialisiert (D7): pdf-lib
 * kann nicht inkrementell speichern. Fuer eine Mutation ist das ohnehin die
 * einzige Form — eine geloeschte Seite laesst sich nicht "anhaengen".
 *
 * Anmerkungen folgen ihrer Seite von selbst: sie stehen im `/Annots` der
 * Seite, und die Seite wandert oder faellt als Ganzes (S4.1, Aufgabe 3).
 * Formularfelder nicht — sie haengen zusaetzlich am `/AcroForm`, und ein Feld,
 * dessen Widgets mit der Seite gefallen sind, bliebe dort als Leiche stehen.
 * `entferneVerwaisteFelder` raeumt das auf.
 */
export async function wendeMutationAn(bytes: Uint8Array, mutation: Mutation): Promise<Uint8Array> {
  return (await wendeMutationAnMitBericht(bytes, mutation)).bytes
}

/**
 * Wie `wendeMutationAn`, dazu der Bericht einer Textaenderung (S6.6b):
 * Originalschrift oder Ersatzschrift - der Renderer muss die Ersatzschrift
 * sichtbar melden (ADR 0005, Punkt 4).
 */
export async function wendeMutationAnMitBericht(
  bytes: Uint8Array,
  mutation: Mutation
): Promise<{ bytes: Uint8Array; bericht?: TextBericht }> {
  if (mutation.art === 'textErsetzen') {
    // S6.6b: eine Zeile im Content-Stream loeschen oder ersetzen
    // (main/textbearbeitung/editor.ts). Wirft `TextAbgelehnt` mit Grund.
    // Gate Phase 6: in der Anwendung isoliert im Worker (siehe
    // `setzeTextWorker`), damit ein praepariertes Dokument den Main-Prozess
    // weder zum Absturz bringt noch blockiert.
    return textWorker === undefined
      ? ersetzeTextDirekt(bytes, mutation)
      : fuehreTextIsoliertAus(textWorker, bytes, mutation)
  }
  // `updateMetadata: false`: das Aenderungsdatum setzt der Speicherpfad, wenn
  // die Datei wirklich geschrieben wird - nicht jede Zwischenstufe.
  const dokument = await PDFDocument.load(bytes, { updateMetadata: false })
  const seiten = dokument.getPageCount()

  switch (mutation.art) {
    case 'seitenLoeschen': {
      pruefeSeiten(mutation.seiten, seiten)
      if (mutation.seiten.length >= seiten) {
        // Ein PDF ohne Seiten ist keines: pdf.js lehnt es ab, und der Nutzer
        // haette ein leeres Fenster ohne Weg zurueck.
        throw new Error(t('mutation.letzteSeiteMain'))
      }
      // Von hinten, damit die Indizes der noch zu loeschenden Seiten stimmen.
      for (const seite of [...mutation.seiten].sort((a, b) => b - a)) {
        dokument.removePage(seite - 1)
      }
      if (dokument.getForm().getFields().length > 0) {
        // pdf-lib erneuert nach `removePage` seinen Seiten-Cache nicht:
        // `getPages()` nennt die geloeschte Seite weiter, und jedes Widget
        // saehe "lebend" aus. Deshalb auf einem frisch geladenen Zwischenstand
        // pruefen - nur bei Formularen, der zweite Lauf kostet Zeit.
        const zwischen = await PDFDocument.load(await dokument.save(), { updateMetadata: false })
        entferneVerwaisteFelder(zwischen)
        return { bytes: await zwischen.save() }
      }
      break
    }
    case 'seitenDrehen': {
      pruefeSeiten(mutation.seiten, seiten)
      for (const seite of mutation.seiten) {
        const page = dokument.getPage(seite - 1)
        // Additiv zur vorhandenen Drehung: eine Seite, die im Dokument schon
        // quer liegt, soll um 90 Grad weiter, nicht auf 90 Grad gesetzt werden.
        page.setRotation(degrees((page.getRotation().angle + mutation.grad) % 360))
      }
      break
    }
    case 'seitenAnordnen': {
      pruefeSeiten(mutation.reihenfolge, seiten)
      if (mutation.reihenfolge.length !== seiten) {
        throw new Error(t('mutation.reihenfolge', { genannt: mutation.reihenfolge.length, seiten }))
      }
      const alt: PDFPage[] = dokument.getPages()
      // Alle Seiten aus dem Baum nehmen und in neuer Folge wieder einhaengen.
      // Die Seitenobjekte bleiben dieselben - mit allem, was an ihnen haengt.
      for (let i = seiten - 1; i >= 0; i--) dokument.removePage(i)
      mutation.reihenfolge.forEach((alteNummer, i) => {
        const page = alt[alteNummer - 1]
        if (page !== undefined) dokument.insertPage(i, page)
      })
      break
    }
    case 'seitenZuschneiden': {
      // S6.3: nur `/CropBox`, Inhalt und Anmerkungen bleiben (main/zuschnitt.ts).
      pruefeSeiten(
        mutation.zuschnitte.map((z) => z.seite),
        seiten
      )
      schneideSeitenZu(dokument, mutation.zuschnitte)
      break
    }
  }
  return { bytes: await dokument.save() }
}

function pruefeSeiten(liste: readonly number[], seiten: number): void {
  for (const seite of liste) {
    if (seite > seiten) {
      throw new Error(t('mutation.seiteFehlt', { seite, seiten }))
    }
  }
}

/**
 * Entfernt Formularfelder, von denen kein Widget mehr auf einer Seite liegt
 * (S4.1, Aufgabe 3). Verglichen wird ueber die Dictionaries selbst: pdf-lib
 * liefert fuer dasselbe Objekt dieselbe Instanz, und `/P` ist in der Praxis
 * zu oft leer, um darauf zu bauen.
 */
function entferneVerwaisteFelder(dokument: PDFDocument): void {
  const form = dokument.getForm()
  const felder = form.getFields()
  if (felder.length === 0) return
  const aufSeiten = new Set<PDFDict>()
  for (const page of dokument.getPages()) {
    const annots = page.node.Annots()
    if (annots === undefined) continue
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookup(i)
      if (dict !== undefined) aufSeiten.add(dict as PDFDict)
    }
  }
  for (const feld of felder) {
    const widgets = feld.acroField.getWidgets()
    const lebt = widgets.some((widget) => aufSeiten.has(widget.dict))
    // Nicht `form.removeField`: das will die Widgets von ihren Seiten nehmen
    // und wirft, wenn es die Seite nicht mehr gibt - genau unser Fall. Die
    // Ebene darunter nimmt das Feld aus dem Baum und raeumt leere Eltern mit.
    if (!lebt) form.acroForm.removeField(feld.acroField)
  }
}
