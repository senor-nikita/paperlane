/**
 * Pruefung externer Verweise aus Dokumenten (S2.1, Aufgabe 3).
 *
 * `will-navigate` und `setWindowOpenHandler` sperren seit S0.2 jede Navigation
 * — richtig so, ein Betrachter ist kein Browser. Ein Literaturverweis muss sich
 * trotzdem oeffnen lassen. Der einzige Weg dorthin fuehrt ueber einen eigenen
 * IPC-Kanal an `shell.openExternal`, und der ist nur so gut wie diese Pruefung.
 *
 * Warum eine Allowlist und keine Sperrliste: `shell.openExternal` uebergibt an
 * das Betriebssystem. Unter Windows heisst das, dass Schemata wie `file:`,
 * `ms-msdt:` oder ein beliebiges registriertes Protokoll Programme starten
 * koennen. Eine Sperrliste muesste jedes davon kennen; die Allowlist muss nur
 * die drei kennen, die ein Dokument braucht.
 *
 * Bewusst im shared-Bereich: der Main-Prozess erzwingt sie, die Unit-Tests
 * pruefen sie, und beide sehen dieselbe Fassung.
 */
import { t } from './i18n'

/** Was ein PDF-Verweis oeffnen darf. Alles Uebrige wird abgelehnt. */
export const ERLAUBTE_SCHEMATA = ['http:', 'https:', 'mailto:'] as const

/**
 * Obergrenze fuer die Laenge. Ein Verweis aus einem fremden Dokument ist
 * beliebig lang; er landet in einem Dialogtext und in einer Uebergabe an das
 * Betriebssystem. Beides will begrenzt sein.
 */
export const MAX_URL_LAENGE = 2048

export type LinkPruefung =
  | {
      ok: true
      /** Die normalisierte Adresse, wie sie geoeffnet wird. */
      url: string
      /**
       * Der Host allein — fuer den Bestaetigungsdialog.
       *
       * Ohne ihn traegt `https://vertrauen.example@fremde.example/` den Leser
       * in die Irre: alles vor dem `@` ist Benutzerinformation, geoeffnet wird
       * `fremde.example`. Bei `mailto:` leer.
       */
      host: string
    }
  | { ok: false; grund: string }

/**
 * Prueft ein Verweisziel aus einem Dokument.
 *
 * Die Eingabe ist `unknown`, weil sie aus einem fremden PDF ueber den Renderer
 * kommt: an dieser Stelle ist noch nicht einmal sicher, dass es eine
 * Zeichenkette ist.
 */
export function pruefeExternesZiel(eingabe: unknown): LinkPruefung {
  if (typeof eingabe !== 'string' || eingabe.trim().length === 0) {
    return { ok: false, grund: t('link.leer') }
  }
  if (eingabe.length > MAX_URL_LAENGE) {
    return {
      ok: false,
      grund: t('link.zuLang')
    }
  }

  // Ohne Basis-URL: ein relativer Verweis hat in einem Dokumentbetrachter kein
  // sinnvolles Gegenstueck und soll scheitern, statt geraten zu werden.
  const zerlegt = URL.parse(eingabe)
  if (zerlegt === null) {
    return { ok: false, grund: t('link.ungueltig') }
  }

  if (!(ERLAUBTE_SCHEMATA as readonly string[]).includes(zerlegt.protocol)) {
    return {
      ok: false,
      grund: t('link.schema', {
        schema: zerlegt.protocol.replace(':', ''),
        erlaubt: ERLAUBTE_SCHEMATA.map((schema) => schema.replace(':', '')).join(', ')
      })
    }
  }

  return { ok: true, url: zerlegt.href, host: zerlegt.host }
}
