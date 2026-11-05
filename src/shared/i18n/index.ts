/**
 * Uebersetzungsschicht (S6.8, revidiert D15).
 *
 * Bewusst ohne Abhaengigkeit: zwei Sprachen, Platzhalter und eine Pluralform
 * brauchen keine Bibliothek. Der deutsche Katalog ist die Quelle der
 * Schluessel; der englische muss jeden davon tragen, sonst ist es ein
 * Typfehler. Platzhalter (`{name}`) werden aus dem deutschen Text abgeleitet -
 * wer `t` ohne den verlangten Wert ruft, bekommt ebenfalls einen Typfehler.
 *
 * Main und Renderer halten je eine aktive Sprache in diesem Modul. Der Main
 * setzt sie beim Start aus Einstellung und Systemsprache, der Renderer aus
 * der Antwort des Main (`spracheGet`). Texte, die schon angezeigt werden,
 * wechseln nur dort, wo eine Komponente neu zeichnet (`useT` im Renderer,
 * Neuaufbau des Menues im Main).
 */
import { de } from './de'
import { en } from './en'
import type { Plural } from './typen'

export type Sprache = 'de' | 'en'

/** Was der Nutzer einstellt: `auto` folgt der Systemsprache. */
export type Sprachwahl = 'auto' | Sprache

export const SPRACHWAHLEN: readonly Sprachwahl[] = ['auto', 'de', 'en']

export function istSprachwahl(wert: unknown): wert is Sprachwahl {
  return typeof wert === 'string' && (SPRACHWAHLEN as readonly string[]).includes(wert)
}

/**
 * Systemsprache auf eine der beiden Sprachen abbilden: jedes Deutsch (`de`,
 * `de-AT`, `de-CH` ...) wird Deutsch, alles andere Englisch - Englisch ist die
 * bessere Wahl fuer jemanden, dessen Sprache die Anwendung nicht kennt.
 */
export function spracheAusLocale(locale: string): Sprache {
  return /^de(?:[-_]|$)/i.test(locale.trim()) ? 'de' : 'en'
}

export function loeseSpracheAuf(wahl: Sprachwahl, locale: string): Sprache {
  return wahl === 'auto' ? spracheAusLocale(locale) : wahl
}

export type { Abschnitt, Plural } from './typen'

type Deutsch = typeof de

export type Schluessel = keyof Deutsch

type Platzhalter<S extends string> = S extends `${string}{${infer P}}${infer R}`
  ? P | Platzhalter<R>
  : never

type PlatzhalterVon<E> = E extends Plural
  ? Platzhalter<E['eins'] | E['mehr']> | 'anzahl'
  : E extends string
    ? Platzhalter<E>
    : never

/** Die Werte, die ein Schluessel verlangt. */
export type Werte<K extends Schluessel> = {
  [P in PlatzhalterVon<Deutsch[K]>]: P extends 'anzahl' ? number : string | number
}

type WerteArgument<K extends Schluessel> = [PlatzhalterVon<Deutsch[K]>] extends [never]
  ? []
  : [werte: Werte<K>]

/** Form jedes weiteren Katalogs: dieselben Schluessel, dieselbe Art. */
export type Katalog = {
  readonly [K in Schluessel]: Deutsch[K] extends Plural ? Plural : string
}

const KATALOGE: Record<Sprache, Katalog> = { de, en }

let aktiv: Sprache = 'de'

export function aktiveSprache(): Sprache {
  return aktiv
}

export function setzeSprache(sprache: Sprache): void {
  aktiv = sprache
}

function istPlural(eintrag: string | Plural): eintrag is Plural {
  return typeof eintrag === 'object'
}

function fuelle(text: string, werte: Record<string, string | number> | undefined): string {
  if (werte === undefined) return text
  return text.replace(/\{(\w+)\}/g, (ganz, name: string) => {
    const wert = werte[name]
    return wert === undefined ? ganz : String(wert)
  })
}

/** Uebersetzt in eine ausdrueckliche Sprache (Tests, Ansagen in fester Sprache). */
export function uebersetze<K extends Schluessel>(
  sprache: Sprache,
  schluessel: K,
  ...werte: WerteArgument<K>
): string {
  const eintrag: string | Plural = KATALOGE[sprache][schluessel]
  const w = werte[0] as Record<string, string | number> | undefined
  if (istPlural(eintrag)) {
    const anzahl = w?.['anzahl']
    return fuelle(anzahl === 1 ? eintrag.eins : eintrag.mehr, w)
  }
  return fuelle(eintrag, w)
}

/** Uebersetzt in die aktive Sprache. */
export function t<K extends Schluessel>(schluessel: K, ...werte: WerteArgument<K>): string {
  return uebersetze(aktiv, schluessel, ...werte)
}

/**
 * Eine Zahl, wie sie in der aktiven Sprache geschrieben wird: im Deutschen
 * mit Dezimalkomma. Bewusst ohne Tausendertrennung - die Zahlen der
 * Oberflaeche (Millimeter, Zoom, DPI) sind klein, und ein Trenner saehe im
 * Deutschen wie ein Dezimalpunkt aus.
 */
export function zahl(wert: number): string {
  const text = String(wert)
  return aktiv === 'de' ? text.replace('.', ',') : text
}

/** Nur fuer Tests und den Guard: die Kataloge selbst. */
export const KATALOG_DE: Katalog = de
export const KATALOG_EN: Katalog = en
