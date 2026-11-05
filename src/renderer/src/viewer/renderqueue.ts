/**
 * Haelt hoechstens einen laufenden Zeichenauftrag je Seite.
 *
 * Ohne das stapeln sich beim Scrollen die Auftraege: pdf.js arbeitet sie alle
 * ab, auch fuer Seiten, die laengst wieder aus dem Sichtfenster gescrollt sind.
 * Der Speicher steigt dann mit der Scrollgeschwindigkeit statt mit der Anzahl
 * sichtbarer Seiten.
 */
export interface Abbrechbar {
  cancel: () => void
}

/**
 * Obergrenze gleichzeitiger Auftraege (S1.5, Fall 5).
 *
 * Die Virtualisierung haelt die Zahl der sichtbaren Seiten ohnehin klein. Diese
 * Grenze ist das Netz darunter: stapeln sich Auftraege doch einmal, soll der
 * Renderer nicht am Speicher ersticken, sondern die aeltesten abbrechen.
 */
export const HOECHSTENS_GLEICHZEITIG = 8

export class RenderQueue {
  private readonly laufend = new Map<number, Abbrechbar>()

  constructor(private readonly hoechstens: number = HOECHSTENS_GLEICHZEITIG) {}

  /** Startet einen Auftrag und bricht einen bereits laufenden derselben Seite ab. */
  starte(index: number, auftrag: Abbrechbar): void {
    this.brich(index)
    // Map behaelt die Einfuegereihenfolge: der erste Schluessel ist der
    // aelteste Auftrag.
    while (this.laufend.size >= this.hoechstens) {
      const aeltester = this.laufend.keys().next()
      if (aeltester.done === true) break
      this.brich(aeltester.value)
    }
    this.laufend.set(index, auftrag)
  }

  fertig(index: number): void {
    this.laufend.delete(index)
  }

  brich(index: number): void {
    const vorhanden = this.laufend.get(index)
    if (vorhanden === undefined) return
    vorhanden.cancel()
    this.laufend.delete(index)
  }

  /** Bricht alles ab, was nicht mehr im Sichtfenster liegt. */
  brichAlleAusser(behalten: ReadonlySet<number>): void {
    for (const index of [...this.laufend.keys()]) {
      if (!behalten.has(index)) this.brich(index)
    }
  }

  brichAlles(): void {
    this.brichAlleAusser(new Set())
  }

  get anzahlLaufend(): number {
    return this.laufend.size
  }
}
