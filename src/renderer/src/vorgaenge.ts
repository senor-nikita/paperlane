/**
 * Asynchrone Vorgaenge, waehrend derer kein Tab gewechselt oder geschlossen
 * werden darf (S6.1).
 *
 * Speichern und Drucken lesen zu Beginn die Stores des aktiven Tabs und
 * schreiben am Ende hinein (`merkeGespeichert`, Hinweise). Wechselte dazwischen
 * der Tab, landete der gesicherte Stand im falschen Dokument - der Nutzer
 * saehe ein "gespeichert" an einer Datei, die nie geschrieben wurde.
 *
 * Ein eigenes, abhaengigkeitsfreies Modul, weil der Tab-Store die Sperre
 * pruefen muss und die Vorgaenge selbst (Speichern, Druck) ihn umgekehrt
 * nicht kennen sollen.
 */
const laufend = new Set<string>()

export function beginneVorgang(name: string): void {
  laufend.add(name)
}

export function beendeVorgang(name: string): void {
  laufend.delete(name)
}

/** Der Name eines laufenden Vorgangs oder `null`. */
export function laufenderVorgang(): string | null {
  for (const name of laufend) return name
  return null
}

/** Nur fuer Tests. */
export function vergissVorgaenge(): void {
  laufend.clear()
}
