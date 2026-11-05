/** Ein Text mit Einzahl und Mehrzahl; die Zahl steht als `{anzahl}` bereit. */
export interface Plural {
  eins: string
  mehr: string
}

/**
 * Form eines englischen Abschnitts zum deutschen: dieselben Schluessel,
 * dieselbe Art (Text oder Plural). Fehlt ein Schluessel, ist es ein Typfehler
 * an genau dieser Stelle.
 */
export type Abschnitt<T> = {
  readonly [K in keyof T]: T[K] extends Plural ? Plural : string
}
