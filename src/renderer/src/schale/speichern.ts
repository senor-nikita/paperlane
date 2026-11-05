import { useEffect, useMemo } from 'react'
import {
  anzahl,
  istLeer,
  ohneRohdaten,
  sammleAenderungen,
  type Aenderungen
} from '../../../shared/aenderungen'
import type { Feldwert } from '../../../shared/formulare'
import type { SpeicherAuftrag } from '../../../shared/ipc'
import { useAnnotationen } from '../annotations-store'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { geaenderteFelder, useFormular } from '../formular-store'
import { useMutation } from '../mutation-store'
import { beendeVorgang, beginneVorgang } from '../vorgaenge'
import { t } from '../../../shared/i18n'

/**
 * Die Renderer-Seite des Speicherns (S2.3a).
 *
 * Hier entsteht der Auftrag und sonst nichts: die Pruefung des Zielpfads
 * (Invariante 11), die Signaturwarnung und das atomare Schreiben liegen im
 * Main-Prozess. Der Renderer ist eine Sandbox fuer fremde Dokumente; was von
 * hier kommt, ist eine Bitte und keine Anweisung.
 *
 * Der Aenderungssatz wird **abgeleitet** und nicht mitgeschrieben (siehe
 * shared/aenderungen.ts) — deshalb braucht dieses Modul keinen eigenen
 * Zustand ausser der Sperre gegen zwei gleichzeitige Laeufe.
 */

/** Laeuft gerade ein Speichervorgang? Zwei zugleich schrieben uebereinander. */
let laeuft = false

/** Nur fuer Tests: die Sperre loesen, damit Faelle sich nicht beeinflussen. */
export function setzeSperreZurueck(): void {
  laeuft = false
  beendeVorgang('speichern')
}

/**
 * Was sich gegenueber dem Dokument geaendert hat.
 *
 * Bewusst ueber `useMemo` und nicht als Selektor im Store: `sammleAenderungen`
 * erzeugt bei jedem Aufruf ein neues Objekt, was in einem zustand-Selektor
 * eine Endlosschleife ausloeste. Dasselbe Muster wie `alleAnnotationen`.
 */
export function useAenderungen(): Aenderungen {
  const proSeite = useAnnotationen((zustand) => zustand.proSeite)
  const urspruenglich = useAnnotationen((zustand) => zustand.urspruenglich)
  return useMemo(() => sammleAenderungen(proSeite, urspruenglich), [proSeite, urspruenglich])
}

/**
 * Wieviele Aenderungen offen sind; `0` heisst "nichts zu speichern".
 *
 * Seit S3.1 zaehlen Formularwerte mit; seit S3.2 werden sie mitgeschrieben,
 * und ein Speichern raeumt beide Zaehler. Seit S4.0 zaehlen Mutationen: nach
 * einer geloeschten Seite ist die Arbeitskopie im Main nicht die Datei -
 * auch wenn der Renderer keine offene Anmerkung mehr kennt.
 */
export function useAnzahlAenderungen(): number {
  const werte = useFormular((zustand) => zustand.werte)
  const ursprung = useFormular((zustand) => zustand.ursprung)
  const mutationen = useMutation((zustand) => zustand.anzahl)
  const formular = useMemo(() => geaenderteFelder(werte, ursprung).length, [werte, ursprung])
  return anzahl(useAenderungen()) + formular + mutationen
}

/**
 * Dieselbe Rechnung wie `useAnzahlAenderungen`, ausserhalb von React und auf
 * beliebigen Staenden - fuer die Momentaufnahme eines inaktiven Tabs (S6.1),
 * dessen Stores gerade einem anderen gehoeren.
 */
export function zaehleAenderungen(stand: {
  proSeite: Parameters<typeof sammleAenderungen>[0]
  urspruenglich: Parameters<typeof sammleAenderungen>[1]
  werte: Readonly<Record<string, Feldwert>>
  ursprung: Readonly<Record<string, Feldwert>>
  mutationen: number
}): number {
  return (
    anzahl(sammleAenderungen(stand.proSeite, stand.urspruenglich)) +
    geaenderteFelder(stand.werte, stand.ursprung).length +
    stand.mutationen
  )
}

/**
 * Meldet dem Main-Prozess, ob ungespeicherte Aenderungen vorliegen.
 *
 * Er braucht die Antwort **synchron**, wenn das Fenster geschlossen wird —
 * ein Nachfragen zu diesem Zeitpunkt kaeme zu spaet. Deshalb haelt er eine
 * Kopie des Standes, die dieser Effekt bei jeder Aenderung nachfuehrt.
 */
export function useMeldeAenderungen(): void {
  const offen = useAnzahlAenderungen() > 0
  const pfad = useDokument((zustand) => zustand.pfad)

  /**
   * Seit S6.1 je Pfad: der Main haelt den Stand jedes offenen Dokuments.
   * Gemeldet wird immer der **aktive** Tab. Beim Wechsel aendert sich `pfad`,
   * und der neue Tab meldet seinen Stand - der verlassene behaelt im Main,
   * was er zuletzt gemeldet hat, und das ist richtig: seine Aenderungen sind
   * nicht weg, nur nicht zu sehen.
   *
   * Ohne Pfad wird nichts gemeldet. Ein leerer Pfad hiesse im Vertrag "alle
   * zuruecksetzen", und ohne Pfad ist der Store auch zwischendurch - etwa nach
   * einer abgebrochenen Passwortabfrage, waehrend andere Tabs offen sind. Das
   * Zuruecksetzen, wenn wirklich kein Tab mehr offen ist, meldet der Tab-Store
   * selbst (`schliesse`).
   */
  useEffect(() => {
    const api = bruecke()
    if (api === undefined || pfad === null) return
    api.dokumentGeaendert({ pfad, geaendert: offen }).catch((fehler: unknown) => {
      // Nicht verschlucken: bliebe der Main auf einem alten Stand, warnte er
      // beim Schliessen vor nichts oder vor etwas, das laengst gesichert ist.
      console.error('Aenderungsstand konnte nicht gemeldet werden:', fehler)
    })
  }, [offen, pfad])
}

export type Speicherziel = 'gleich' | 'neu'

/**
 * Formulardaten als FDF exportieren (S3.2, Aufgabe 3).
 *
 * Mitgeschickt werden nur die ungespeicherten Aenderungen; alles Uebrige
 * liest der Main aus der Datei - auch Felder auf Seiten, die hier nie
 * geladen wurden.
 */
export async function exportiereFdf(): Promise<void> {
  const { pfad, setzeHinweis } = useDokument.getState()
  const api = bruecke()
  if (api === undefined) return
  if (pfad === null) {
    setzeHinweis(t('speichern.keinDokument'))
    return
  }
  const formular = useFormular.getState()
  const formularwerte: Record<string, Feldwert> = {}
  for (const name of geaenderteFelder(formular.werte, formular.ursprung)) {
    const wert = formular.werte[name]
    if (wert !== undefined) formularwerte[name] = wert
  }
  try {
    const ergebnis = await api.formularFdfExportieren({ quelle: pfad, formularwerte })
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    setzeHinweis(t('speichern.fdfExportiert', { name: ergebnis.name }))
  } catch (fehler) {
    console.error('FDF-Export fehlgeschlagen:', fehler)
    setzeHinweis(t('speichern.fdfFehler'))
  }
}

/**
 * Speichert das Dokument.
 *
 * Als gewoehnliche Funktion und nicht als Hook: aufgerufen wird sie aus der
 * Befehlsausfuehrung, also ausserhalb des React-Baums. Der Zugriff auf die
 * Stores laeuft deshalb ueber `getState()` — dasselbe Muster wie die
 * Annotationsbefehle aus S2.2.
 */
export interface Speicheroptionen {
  /**
   * Formular flachlegen (S3.2, Aufgabe 2). Der Main fragt vorher nach; danach
   * wird das Dokument neu geladen, weil es keine Felder mehr hat.
   */
  flachlegen?: boolean
}

export async function speichere(
  ziel: Speicherziel,
  optionen: Speicheroptionen = {}
): Promise<void> {
  const { pfad, verschluesselt, setzeHinweis, uebernimmZiel, ladePfadNeu } = useDokument.getState()
  const api = bruecke()
  if (api === undefined) return
  if (pfad === null) {
    setzeHinweis(t('speichern.keinDokument'))
    return
  }
  if (laeuft) return

  const { proSeite, urspruenglich, merkeGespeichert } = useAnnotationen.getState()
  const gesammelt = sammleAenderungen(proSeite, urspruenglich)
  // Formularwerte (S3.2): nur die geaenderten Felder reisen mit.
  const formular = useFormular.getState()
  const formularwerte: Record<string, Feldwert> = {}
  for (const name of geaenderteFelder(formular.werte, formular.ursprung)) {
    const wert = formular.werte[name]
    if (wert !== undefined) formularwerte[name] = wert
  }
  const flachlegen = optionen.flachlegen === true
  const mutationen = useMutation.getState()
  // Bei "Speichern unter" auch ohne Aenderungen: eine Kopie an einen anderen
  // Ort ist ein sinnvoller Wunsch. "Speichern" dagegen schriebe die Datei
  // ohne Not vollstaendig neu (D7) und stempelte sie mit einem neuen ModDate.
  // Flachlegen ist selbst eine Aenderung, eine Mutation (S4.0) auch.
  if (
    ziel === 'gleich' &&
    istLeer(gesammelt) &&
    Object.keys(formularwerte).length === 0 &&
    !flachlegen &&
    mutationen.anzahl === 0
  ) {
    setzeHinweis(t('speichern.nichts'))
    return
  }

  const auftrag: SpeicherAuftrag = {
    quelle: pfad,
    // `null` heisst "frag nach dem Ort". Nur der Dialog im Main gibt einen
    // Pfad zum Schreiben frei (Invariante 11).
    ziel: ziel === 'gleich' ? pfad : null,
    verschluesselt,
    aenderungen: {
      neue: gesammelt.neue.map(ohneRohdaten),
      geaendert: gesammelt.geaendert.map(ohneRohdaten),
      geloescht: gesammelt.geloescht
    },
    formularwerte,
    flachlegen
  }

  laeuft = true
  // Sperrt den Tabwechsel (S6.1): das Ergebnis gehoert in die Stores genau
  // dieses Tabs.
  beginneVorgang('speichern')
  try {
    const ergebnis = await api.dokumentSpeichern(auftrag)
    // Wer selbst abbricht, braucht keine Erklaerung.
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    // Erst den neuen Ort uebernehmen, dann den Stand als gesichert merken:
    // ein weiteres Strg+S soll in die Datei gehen, die gerade entstanden ist.
    uebernimmZiel(ergebnis.pfad, ergebnis.name)
    merkeGespeichert()
    formular.merkeGespeichert()
    mutationen.merkeGespeichert()
    if (ergebnis.pfad !== pfad) {
      // Nach "Speichern unter" lebt das Dokument unter dem neuen Pfad weiter;
      // `useMeldeAenderungen` meldet nur den. Der alte Pfad ist in keinem Tab
      // mehr offen, sein Stand im Main darf nicht "geaendert" bleiben - sonst
      // warnte das Schliessen des Fensters vor Aenderungen, die gesichert sind.
      api.dokumentGeaendert({ pfad, geaendert: false }).catch((fehler: unknown) => {
        console.error('Aenderungsstand konnte nicht gemeldet werden:', fehler)
      })
    }
    if (flachlegen) {
      // Die Datei hat keine Felder mehr; was der Store haelt, ist veraltet.
      // Neu laden, damit die Anzeige zeigt, was jetzt in der Datei steht.
      setzeHinweis(t('speichern.flachgelegt', { name: ergebnis.name }))
      await ladePfadNeu(ergebnis.pfad)
      return
    }
    setzeHinweis(t('speichern.gespeichert', { name: ergebnis.name }))
  } catch (fehler) {
    console.error('Speichern fehlgeschlagen:', fehler)
    setzeHinweis(t('speichern.fehler'))
  } finally {
    laeuft = false
    beendeVorgang('speichern')
  }
}
