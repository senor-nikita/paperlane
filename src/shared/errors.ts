/**
 * Fehlertaxonomie (S1.5, Aufgabe 6).
 *
 * Jeder Fehler bekommt drei Dinge: eine Art, an der die Oberflaeche ihr
 * Verhalten festmacht, einen Text fuer den Nutzer und ein technisches Detail
 * fuer das Protokoll. Ohne diese Trennung landet entweder eine
 * pdf.js-Ausnahme im Fenster oder eine nichtssagende Meldung im Log.
 *
 * Der Nutzertext nennt nach Moeglichkeit den Ausweg. "Datei beschaedigt" allein
 * laesst den Leser ratlos zurueck; "…, waehlen Sie ein anderes Dokument"
 * nicht.
 *
 * Die Texte stehen im Katalog (S6.8) und entstehen beim Deuten in der aktiven
 * Sprache.
 *
 * Bewusst im shared-Bereich: der Main-Prozess deutet Dateifehler, der Renderer
 * deutet pdf.js-Fehler, und beide sollen dieselben Arten benutzen.
 */
import { t } from './i18n'

export type FehlerArt =
  /** Die Datei ist kein brauchbares PDF oder abgeschnitten. */
  | 'beschaedigt'
  /** Verschluesselt; ein Passwort wird gebraucht. */
  | 'passwortNoetig'
  /** Das eingegebene Passwort war falsch. */
  | 'passwortFalsch'
  | 'nichtGefunden'
  | 'keinZugriff'
  /** Waehrend des Betrachtens geloescht oder ersetzt. */
  | 'verschwunden'
  /** Der Renderer hat den Speicher verloren oder ist abgestuerzt. */
  | 'speichermangel'
  | 'unbekannt'

export interface Anwendungsfehler {
  art: FehlerArt
  /** Was der Nutzer liest. Gehoert in die Oberflaeche. */
  nutzertext: string
  /** Technisches Detail fuer das Protokoll. Gehoert nie in die Oberflaeche. */
  detail: string
}

/**
 * Text aus einem beliebigen Wert, ohne selbst zu werfen. `String()` ruft
 * `toString` des Werts - bei einem Objekt mit verbogenem Prototyp wirft das,
 * und die Fehlerdeutung waere selbst der naechste Fehler (Fuzzing S6.10).
 */
function alsText(wert: unknown): string {
  try {
    return String(wert)
  } catch {
    return Object.prototype.toString.call(wert)
  }
}

function benenne(fehler: unknown): { name: string; nachricht: string; code: string } {
  if (fehler instanceof Error) {
    // `code` strukturell lesen statt ueber NodeJS.ErrnoException: diese Datei
    // wird auch vom Renderer uebersetzt, wo es die Node-Typen nicht gibt.
    const code: unknown = (fehler as { code?: unknown }).code
    const name: unknown = fehler.name
    const nachricht: unknown = fehler.message
    return {
      name: typeof name === 'string' ? name : alsText(name),
      nachricht: typeof nachricht === 'string' ? nachricht : alsText(nachricht),
      code: typeof code === 'string' ? code : ''
    }
  }
  return { name: '', nachricht: alsText(fehler), code: '' }
}

function mitDatei(text: string, dateiname: string | undefined): string {
  return dateiname === undefined || dateiname.length === 0
    ? text
    : t('fehler.mitDatei', { datei: dateiname, text })
}

/**
 * Deutet eine beliebige Ausnahme.
 *
 * pdf.js meldet ueber `name`: `PasswordException` (mit `code` 1 fuer "noetig"
 * und 2 fuer "falsch"), `InvalidPDFException` fuer beschaedigte Dateien,
 * `MissingPDFException` fuer nicht auffindbare. Node meldet ueber `code`.
 * Alles Uebrige faellt bewusst auf `unbekannt` und nimmt die Originalmeldung
 * ins Detail mit — verschluckt wird nichts.
 */
export function deuteFehler(fehler: unknown, dateiname?: string): Anwendungsfehler {
  const { name, nachricht, code } = benenne(fehler)
  const detail = name.length > 0 ? name + ': ' + nachricht : nachricht

  if (name === 'PasswordException') {
    // pdf.js: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD.
    const falsch = (fehler as { code?: unknown }).code === 2 || /incorrect/i.test(nachricht)
    return falsch
      ? {
          art: 'passwortFalsch',
          nutzertext: t('fehler.passwortFalsch'),
          detail
        }
      : {
          art: 'passwortNoetig',
          nutzertext: mitDatei(t('fehler.passwortNoetig'), dateiname),
          detail
        }
  }

  if (name === 'InvalidPDFException') {
    return {
      art: 'beschaedigt',
      nutzertext: mitDatei(t('fehler.beschaedigt'), dateiname),
      detail
    }
  }

  if (name === 'MissingPDFException' || code === 'ENOENT') {
    return {
      art: 'nichtGefunden',
      nutzertext: mitDatei(t('fehler.nichtGefunden'), dateiname),
      detail
    }
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return {
      art: 'keinZugriff',
      nutzertext: mitDatei(t('fehler.keinZugriff'), dateiname),
      detail
    }
  }

  // Chromium meldet Speichermangel als RangeError beim Anlegen des Puffers.
  if (name === 'RangeError' && /allocation|out of memory/i.test(nachricht)) {
    return {
      art: 'speichermangel',
      nutzertext: t('fehler.speichermangel'),
      detail
    }
  }

  return {
    art: 'unbekannt',
    nutzertext: mitDatei(t('fehler.unbekannt'), dateiname),
    detail
  }
}

/** Meldung fuer eine Datei, die waehrend des Betrachtens verschwunden ist. */
export function verschwundenText(): string {
  return t('fehler.verschwunden')
}

/**
 * Meldung fuer alles, was ein passwortgeschuetztes Dokument neu schreiben
 * muesste: Speichern, Seitenoperationen, Drucken, Zusammenfuehren, Teilen.
 * pdf-lib kann solche Dokumente nicht entschluesseln; mit `ignoreEncryption`
 * kaemen unentschluesselte Streams heraus und das Ergebnis waere beschaedigt.
 */
export function verschluesseltText(): string {
  return t('fehler.verschluesselt')
}

/**
 * Hinweis fuer XFA-Formulare.
 *
 * Ohne ihn sieht der Nutzer eine scheinbar leere, korrekt geladene Seite: mit
 * `enableXfa: false` zeigt pdf.js die im Dokument hinterlegte Ausweichseite
 * ("Please wait…").
 */
export function xfaText(): string {
  return t('fehler.xfa')
}
