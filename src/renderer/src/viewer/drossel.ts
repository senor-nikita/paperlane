/**
 * Begrenzt, wie viele Auftraege gleichzeitig laufen duerfen.
 *
 * Die Miniaturen teilen sich den pdf.js-Worker mit der Hauptansicht. Ohne
 * Begrenzung schickt ein Sprung ans Dokumentende ein Dutzend Miniaturauftraege
 * auf einmal los, und die Seite, die der Leser tatsaechlich ansieht, wartet
 * hinter ihnen. Die Virtualisierung haelt die Zahl der Miniaturen klein, diese
 * Drossel haelt sie zusaetzlich hintereinander.
 *
 * Bewusst frei von React und pdf.js — damit ohne laufende Anwendung pruefbar.
 */
export class Drossel {
  private laufend = 0
  private readonly wartend: (() => void)[] = []

  constructor(private readonly hoechstens: number) {
    if (hoechstens < 1) throw new Error('Die Drossel braucht mindestens einen Platz') // KEIN-UI-TEXT: Invariante
  }

  /**
   * Wartet, bis ein Platz frei ist. Jeder erfolgreiche Aufruf muss von genau
   * einem `verlasse` begleitet werden, sonst bleibt der Platz fuer immer belegt
   * und die Miniaturen halten still.
   */
  async betritt(): Promise<void> {
    if (this.laufend < this.hoechstens) {
      this.laufend += 1
      return
    }
    await new Promise<void>((aufloesen) => {
      this.wartend.push(aufloesen)
    })
    this.laufend += 1
  }

  verlasse(): void {
    this.laufend = Math.max(0, this.laufend - 1)
    const naechster = this.wartend.shift()
    naechster?.()
  }

  get anzahlLaufend(): number {
    return this.laufend
  }

  get anzahlWartend(): number {
    return this.wartend.length
  }
}
