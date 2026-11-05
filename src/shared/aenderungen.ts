import type { Annotation } from './annotations'

/**
 * Was sich am Annotationsbestand geaendert hat (S2.3a).
 *
 * **Abgeleitet, nicht mitgeschrieben.** Ein Protokoll, das bei jedem Erstellen,
 * Aendern und Loeschen fortgeschrieben wird, muss auch jedes Rueckgaengig und
 * jedes Wiederholen richtig behandeln — und wird genau dort falsch. Der
 * Vergleich zwischen dem gelesenen und dem aktuellen Stand kann das nicht:
 * fuenfzehn Schritte vor und wieder zurueck ergeben wieder "nichts geaendert".
 *
 * Das ist zugleich der Dirty-State aus Aufgabe 5.
 */
export interface Aenderungen {
  /** In dieser Sitzung entstanden; im Dokument gibt es sie noch nicht. */
  neue: Annotation[]
  /** Aus dem Dokument gelesen und seither veraendert. */
  geaendert: Annotation[]
  /** Kennungen aus dem Dokument, die der Nutzer entfernt hat. */
  geloescht: string[]
}

export function istLeer(aenderungen: Aenderungen): boolean {
  return (
    aenderungen.neue.length === 0 &&
    aenderungen.geaendert.length === 0 &&
    aenderungen.geloescht.length === 0
  )
}

export function anzahl(aenderungen: Aenderungen): number {
  return aenderungen.neue.length + aenderungen.geaendert.length + aenderungen.geloescht.length
}

/**
 * Entfernt `roh` vor dem Versand ueber IPC.
 *
 * Der Datensatz von pdf.js gehoert dem Renderer; der Main-Prozess liest die
 * Datei ohnehin neu und findet dort die Originale. Ihn mitzuschicken waere
 * Ballast — und ein `Float32Array` im strukturierten Klon eine unnoetige
 * Fehlerquelle.
 */
export function ohneRohdaten(annotation: Annotation): Annotation {
  return { ...annotation, roh: null }
}

/**
 * Gleichheit zweier Annotationen — ohne `roh`.
 *
 * `roh` ist der unveraenderte Datensatz von pdf.js. Er aendert sich nie und
 * enthaelt getypte Felder, die ein Vergleich ueber JSON nicht ueberlebt.
 */
export function gleich(a: Annotation, b: Annotation): boolean {
  return JSON.stringify(ohneRohdaten(a)) === JSON.stringify(ohneRohdaten(b))
}

type Bestand = Readonly<Record<number, readonly Annotation[]>>

/**
 * Vergleicht den aktuellen Stand mit dem, was beim Lesen im Dokument stand.
 *
 * **Nur Seiten, die wirklich gelesen wurden**, zaehlen. Eine Seite, die der
 * Leser nie gesehen hat, steht in `urspruenglich` nicht — und ihre
 * Annotationen bleiben beim Speichern unangetastet. Wuerde stattdessen der
 * gesamte Bestand als massgeblich gelten, loeschte ein Speichern alles, was
 * auf ungelesenen Seiten steht.
 */
export function sammleAenderungen(aktuell: Bestand, urspruenglich: Bestand): Aenderungen {
  const neue: Annotation[] = []
  const geaendert: Annotation[] = []
  const geloescht: string[] = []

  for (const [schluessel, alteListe] of Object.entries(urspruenglich)) {
    const seite = Number(schluessel)
    const jetzt = aktuell[seite] ?? []
    const nachKennung = new Map(jetzt.map((eintrag) => [eintrag.id, eintrag]))

    for (const alt of alteListe) {
      const neu = nachKennung.get(alt.id)
      if (neu === undefined) geloescht.push(alt.id)
      else if (!gleich(alt, neu)) geaendert.push(neu)
    }

    const alteKennungen = new Set(alteListe.map((eintrag) => eintrag.id))
    for (const eintrag of jetzt) {
      if (!alteKennungen.has(eintrag.id)) neue.push(eintrag)
    }
  }

  return { neue, geaendert, geloescht }
}
