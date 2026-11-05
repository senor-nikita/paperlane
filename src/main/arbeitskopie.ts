/**
 * Die Arbeitskopie eines Dokuments und ihre Staende (S4.0, S4.1).
 *
 * Bis S3.2 galt: der Main liest die Datei beim Speichern **neu** von der
 * Platte und wendet nur den Aenderungssatz des Renderers an (ADR 0001,
 * Punkt 3). Eine Mutation bricht damit: eine geloeschte Seite steht in keiner
 * Liste, die sich beim Speichern nachspielen liesse — sie ist eine neue
 * Fassung der Bytes. Diese Fassung lebt hier, im Main, je Pfad:
 *
 * - Sie entsteht bei der ersten Mutation aus der Datei (plus den bis dahin
 *   ungespeicherten Anmerkungen und Formularwerten des Renderers).
 * - Jede weitere Mutation baut auf ihr auf.
 * - Das Speichern schreibt sie statt der neu gelesenen Datei. Danach **ist** die
 *   Datei der Stand (`merkeGespeichert`) - die Staende davor bleiben aber
 *   erhalten, damit Rueckgaengig ueber das Speichern hinweg reicht (S7). Nur
 *   das Flachlegen wirft alles weg: es ist nicht umkehrbar.
 * - Ein erneutes Oeffnen des Pfads wirft sie ebenfalls weg — dann gilt
 *   wieder die Platte, auch nach einer Aenderung von aussen (S1.5). Seit S6.1
 *   nur, wenn kein Tab den Pfad mehr zeigt; das Schliessen eines Tabs wirft
 *   sie ebenfalls weg.
 *
 * **Staende (S4.1):** fuer Rueckgaengig ueber Mutationen hinweg behaelt der
 * Main jede Fassung unter einer Nummer. Stand 0 ist die Datei selbst. Der
 * Renderer merkt sich in seiner Historie nur die Nummern (vorher/nachher)
 * und laesst einen Stand wiederherstellen — kein zweites Serialisieren, das
 * bei 20 Schritten auf einem grossen Dokument 20 Sekunden kostete
 * (Messung S4.0: rund 1 s je Schritt).
 *
 * Der Preis ist Speicher: ein grosses Dokument je Stand. Deshalb ein
 * Byte-Budget; darueber faellt der aelteste Stand, der nicht der aktuelle
 * ist, und ein Rueckgaengig dorthin wird als "nicht mehr verfuegbar"
 * abgelehnt — ehrlich statt langsam.
 *
 * Bewusst im Main und nicht im Renderer: die Bytes, die geschrieben werden,
 * sollen vom Main stammen, nicht von einer Sandbox fuer fremde Dokumente.
 */

/** Summe der gehaltenen Staende je Pfad, ueber die der aelteste faellt. */
export const MAX_STAENDE_BYTES = 512 * 1024 * 1024

/**
 * Summe der gehaltenen Staende ueber **alle** Pfade (S6.1, Tabs).
 *
 * Seit mehrere Dokumente offen sein koennen, reicht die Grenze je Pfad nicht:
 * zehn Tabs mit je einem grossen, veraenderten Dokument hielten sonst fuenf
 * Gigabyte im Main-Prozess, und der stuerzte ab, bevor irgendetwas gesichert
 * ist. Ein Gigabyte ist das Doppelte der Grenze je Pfad - ein Dokument kann
 * sie also voll ausschoepfen, und daneben bleibt Platz fuer die aktuellen
 * Staende anderer Tabs. Ein Tab-Limit gibt es bewusst nicht (Entscheidung des
 * Nutzers); begrenzt wird nur, was wirklich Speicher kostet.
 */
export const MAX_GESAMT_BYTES = 1024 * 1024 * 1024

/** Die wirksame Grenze; nur Tests setzen sie herab, statt ein Gigabyte anzulegen. */
let gesamtGrenze = MAX_GESAMT_BYTES

/** Der Stand, der die Datei auf der Platte bedeutet. */
export const DATEI_STAND = 0

interface Verlauf {
  aktuell: number
  /**
   * Welcher Stand die Datei auf der Platte ist. Anfangs `DATEI_STAND`; ein
   * Speichern legt die geschriebenen Bytes als neuen Stand ab und setzt hier
   * dessen Nummer (S7: Rueckgaengig ueber das Speichern hinaus).
   */
  platte: number
  naechster: number
  staende: Map<number, Uint8Array>
}

const verlaeufe = new Map<string, Verlauf>()

function verlauf(pfad: string): Verlauf {
  const vorhanden = verlaeufe.get(pfad)
  if (vorhanden !== undefined) return vorhanden
  const neu: Verlauf = {
    aktuell: DATEI_STAND,
    platte: DATEI_STAND,
    naechster: 1,
    staende: new Map()
  }
  verlaeufe.set(pfad, neu)
  return neu
}

/** Die aktuelle Arbeitskopie; `undefined`, wenn die Datei der Stand ist. */
export function arbeitskopie(pfad: string): Uint8Array | undefined {
  const v = verlaeufe.get(pfad)
  if (v === undefined || v.aktuell === v.platte) return undefined
  return v.staende.get(v.aktuell)
}

/** Ist der aktuelle Stand genau das, was auf der Platte steht? */
export function istSauber(pfad: string): boolean {
  const v = verlaeufe.get(pfad)
  return v === undefined || v.aktuell === v.platte
}

export function hatArbeitskopie(pfad: string): boolean {
  return arbeitskopie(pfad) !== undefined
}

export function aktuellerStand(pfad: string): number {
  return verlaeufe.get(pfad)?.aktuell ?? DATEI_STAND
}

/**
 * Passt eine neue Fassung dieses Pfads noch ins gemeinsame Budget?
 *
 * Unverzichtbar sind nur die aktuellen Staende der **anderen** Pfade - sie
 * sind, was deren Tabs zeigen und beim Speichern schreiben. Aeltere Staende
 * lassen sich opfern (dann ist ein Rueckgaengig dorthin nicht mehr moeglich),
 * und der bisherige aktuelle Stand dieses Pfads wird mit der neuen Fassung
 * zu einem aelteren. Passt die neue Fassung selbst neben den Unverzichtbaren
 * nicht hinein, lehnt der Aufrufer die Mutation ab, statt den Main-Prozess
 * in den Speichermangel zu treiben.
 */
export function passtInsGesamtbudget(pfad: string, bytes: Uint8Array): boolean {
  let unverzichtbar = bytes.byteLength
  for (const [anderer, v] of verlaeufe) {
    if (anderer === pfad) continue
    unverzichtbar += v.staende.get(v.aktuell)?.byteLength ?? 0
  }
  return unverzichtbar <= gesamtGrenze
}

/**
 * Merkt eine neue Fassung als aktuellen Stand und liefert ihre Nummer.
 * Haelt danach das Byte-Budget ein - erst das je Pfad, dann das gemeinsame.
 * Ob die Fassung ueberhaupt passt, prueft der Aufrufer vorher
 * (`passtInsGesamtbudget`).
 */
export function merkeStand(pfad: string, bytes: Uint8Array): number {
  const v = verlauf(pfad)
  const nummer = v.naechster
  v.naechster += 1
  v.staende.set(nummer, bytes)
  v.aktuell = nummer
  haltBudget(v)
  haltGesamtbudget(v)
  return nummer
}

/**
 * Macht einen frueheren (oder spaeteren) Stand zum aktuellen.
 *
 * Liefert die Bytes; `null` fuer den Dateistand (der Aufrufer liest die
 * Datei); `undefined`, wenn der Stand dem Budget zum Opfer gefallen ist.
 */
export function stelleStandHer(pfad: string, stand: number): Uint8Array | null | undefined {
  const v = verlauf(pfad)
  const bytes = v.staende.get(stand)
  if (bytes !== undefined) {
    v.aktuell = stand
    return bytes
  }
  // Der Dateistand, der noch nicht ueberschrieben wurde: die Platte selbst.
  if (stand === DATEI_STAND && v.platte === DATEI_STAND) {
    v.aktuell = DATEI_STAND
    return null
  }
  return undefined
}

/**
 * Muss vor dem Speichern der Inhalt der Platte festgehalten werden?
 *
 * Ja, wenn dieser Pfad schon Staende hat (eine Mutation lief) und Stand 0 -
 * die Datei, wie sie geoeffnet wurde - nur als Verweis auf die Platte gilt:
 * das Speichern ueberschriebe sie, und ein Rueckgaengig bis dorthin fande nichts.
 */
export function brauchtPlattenstand(pfad: string): boolean {
  const v = verlaeufe.get(pfad)
  return v !== undefined && v.platte === DATEI_STAND && !v.staende.has(DATEI_STAND)
}

/**
 * Nach einem erfolgreichen Speichern: die geschriebenen Bytes werden ein neuer
 * Stand und sind ab jetzt die Platte; die Staende davor **bleiben**, damit ein
 * Rueckgaengig ueber das Speichern hinweg reicht (S7). Der aktuelle Stand zaehlt
 * danach als sauber.
 *
 * `plattenBytes` sind die Bytes, die vor dem Ueberschreiben auf der Platte
 * standen - noetig nur, wenn `brauchtPlattenstand` galt.
 *
 * Nach "Speichern unter" zieht der Verlauf auf den neuen Pfad um: dort lebt das
 * Dokument weiter. Ein Pfad ohne Staende (nur Anmerkungen, keine Mutation) hat
 * nichts zu behalten.
 */
export function merkeGespeichert(
  quelle: string,
  ziel: string,
  gespeicherteBytes: Uint8Array,
  plattenBytes?: Uint8Array
): void {
  const v = verlaeufe.get(quelle)
  if (v === undefined) return
  if (plattenBytes !== undefined && v.platte === DATEI_STAND && !v.staende.has(DATEI_STAND)) {
    v.staende.set(DATEI_STAND, plattenBytes)
  }
  const nummer = v.naechster
  v.naechster += 1
  v.staende.set(nummer, gespeicherteBytes)
  v.aktuell = nummer
  v.platte = nummer
  if (ziel !== quelle) {
    verlaeufe.delete(quelle)
    verlaeufe.set(ziel, v)
  }
  haltBudget(v)
  haltGesamtbudget(v)
}

/** Beim erneuten Lesen und beim Flachlegen: die Datei ist der Stand, die Vorgeschichte endet. */
export function vergissArbeitskopie(pfad: string): void {
  verlaeufe.delete(pfad)
}

function haltBudget(v: Verlauf): void {
  let summe = 0
  for (const bytes of v.staende.values()) summe += bytes.byteLength
  // Aelteste zuerst - Map iteriert in Einfuegereihenfolge. Der aktuelle Stand
  // bleibt immer.
  for (const [nummer, bytes] of v.staende) {
    if (summe <= MAX_STAENDE_BYTES) break
    if (nummer === v.aktuell) continue
    v.staende.delete(nummer)
    summe -= bytes.byteLength
  }
}

function gesamtBytes(): number {
  let summe = 0
  for (const v of verlaeufe.values()) {
    for (const bytes of v.staende.values()) summe += bytes.byteLength
  }
  return summe
}

/**
 * Das gemeinsame Budget. Zuerst faellt die Vorgeschichte des Pfads, der
 * gerade gewachsen ist - wer die Last erzeugt, traegt sie. Reicht das nicht,
 * fallen die aelteren Staende der anderen Tabs; ihre aktuellen bleiben immer.
 */
function haltGesamtbudget(zuerst: Verlauf): void {
  let summe = gesamtBytes()
  const reihenfolge = [zuerst, ...[...verlaeufe.values()].filter((v) => v !== zuerst)]
  for (const v of reihenfolge) {
    for (const [nummer, bytes] of v.staende) {
      if (summe <= gesamtGrenze) return
      if (nummer === v.aktuell) continue
      v.staende.delete(nummer)
      summe -= bytes.byteLength
    }
  }
}

/** Nur fuer Tests: die Summe ueber alle Pfade. */
export function gehalteneBytes(): number {
  return gesamtBytes()
}

/** Nur fuer Tests: das gemeinsame Budget herabsetzen. */
export function setzeGesamtgrenze(bytes: number): void {
  gesamtGrenze = bytes
}

/** Nur fuer Tests. */
export function setzeArbeitskopienZurueck(): void {
  verlaeufe.clear()
  gesamtGrenze = MAX_GESAMT_BYTES
}

/** Nur fuer Tests: wie viele Staende ein Pfad haelt. */
export function anzahlStaende(pfad: string): number {
  return verlaeufe.get(pfad)?.staende.size ?? 0
}
