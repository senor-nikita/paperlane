import { t } from './i18n'

/**
 * Alle Tastenkuerzel an einer Stelle.
 *
 * Diese Liste versorgt drei Verbraucher: die Behandlung im Fenster, die
 * Accelerators des Anwendungsmenues (S1.3b) und die Kuerzeluebersicht fuer die
 * Barrierefreiheit (S5.2a). Zwei getrennte Quellen driften garantiert
 * auseinander — dann steht im Menue etwas anderes, als die Anwendung tut.
 *
 * Liegt in `shared`, weil das Anwendungsmenue im Main-Prozess gebaut wird und
 * die Behandlung im Renderer stattfindet. Beide lesen dieselbe Liste.
 *
 * **Nicht hier hinein gehoeren Befehle, die Electron als `role` erledigt**
 * (Kopieren, Alles auswaehlen, Beenden). Sie stuenden sonst doppelt im System:
 * Electron registriert ihren Accelerator nativ, und die Behandlung im Fenster
 * wuerde denselben Tastendruck zusaetzlich mit `preventDefault` abfangen — das
 * native Kopieren waere dann tot, also genau der Fehler, den S1.3b behebt.
 */
export type Befehl =
  | 'oeffnen'
  /**
   * Speichern in die geoeffnete Datei und Speichern an einen neuen Ort
   * (S2.3a). Zwei Befehle und nicht einer mit Argument: die Kuerzel-Map und
   * das Menue tragen je Eintrag genau einen Befehl ohne Nutzlast.
   */
  | 'speichern'
  | 'speichernUnter'
  /** Formular flachlegen und FDF exportieren (S3.2). */
  | 'formularFlachlegen'
  | 'fdfExportieren'
  /** Die aktuelle Seite loeschen (S4.0) - die erste Dokument-Mutation. */
  | 'seiteLoeschen'
  /** Mehrere PDFs zu einem machen, eines in mehrere (S4.2a). */
  | 'zusammenfuehren'
  | 'teilen'
  /** Seiten als PNG exportieren (S4.2b). */
  | 'pngExportieren'
  /**
   * Seitenuebersicht zum Organisieren ein- und ausblenden, gewaehlte Seiten
   * als neue Datei (S6.2).
   */
  | 'seitenuebersicht'
  | 'seitenExtrahieren'
  /** Drucken (S4.3). */
  | 'drucken'
  /** PDF nach Word (S6.7). */
  | 'wordExportieren'
  | 'seiteVor'
  | 'seiteZurueck'
  | 'anfang'
  | 'ende'
  | 'zoomGroesser'
  | 'zoomKleiner'
  | 'zoomZuruecksetzen'
  | 'passungBreite'
  | 'passungSeite'
  | 'drehenRechts'
  | 'drehenLinks'
  | 'zuSeiteSpringen'
  | 'suchen'
  | 'sidebarUmschalten'
  /** Zurueck zum Auswahlwerkzeug (S2.2, Aufgabe 1). */
  | 'werkzeugAuswahl'
  /** Zeigt die Uebersicht aller Kuerzel (S5.2a) - erzeugt aus dieser Map. */
  | 'kuerzeluebersicht'
  /** Oeffnet den Einstellungsdialog (S5.2a, Aufgabe 5). */
  | 'einstellungen'
  | 'rueckgaengig'
  | 'wiederholen'
  /** Loescht die ausgewaehlte Anmerkung. */
  | 'annotationLoeschen'
  /**
   * Markup aus der bestehenden Textauswahl — aus dem Kontextmenue oder ueber
   * das Kuerzel. Bewusst gewoehnliche Befehle und kein zweiter Nutzlasttyp auf
   * dem Ereigniskanal: ADR 0002 bliebe sonst erneut fortzuschreiben, und der
   * Weg ueber die Kuerzel-Map gibt dieselbe Aktion zugleich der Tastatur.
   */
  | 'markiereAuswahl'
  | 'unterstreicheAuswahl'
  | 'durchstreicheAuswahl'
  /** Den aktiven Tab schliessen und zwischen Tabs wechseln (S6.1b). */
  | 'tabSchliessen'
  | 'tabVor'
  | 'tabZurueck'
  /** Bilder zu einem PDF machen (S6.4, D18). */
  | 'ausBildernErstellen'
  /** Werkzeug "Zuschneiden" waehlen (S6.3). */
  | 'werkzeugZuschneiden'
  /** Werkzeug "Text bearbeiten" waehlen (S6.6b): vorhandene Zeile aendern/loeschen. */
  | 'werkzeugTextBearbeiten'

export interface Kuerzel {
  befehl: Befehl
  /** Wert von KeyboardEvent.key, kleingeschrieben verglichen. */
  taste: string
  strg: boolean
  umschalt: boolean
  /** Schreibweise fuer Electrons Menu-Accelerator (S1.3b). */
  accelerator: string
  /**
   * Eine weitere Belegung fuer einen Befehl, der schon ein Kuerzel hat
   * (S6.1b: Strg+Bild-ab neben Strg+Tab). Das Menue zeigt je Eintrag nur
   * einen Accelerator - den der Hauptbelegung; die Zweitbelegung wirkt im
   * Fenster und steht in der Kuerzeluebersicht.
   */
  zweitbelegung: boolean
}

function k(
  befehl: Befehl,
  taste: string,
  accelerator: string,
  strg = false,
  umschalt = false
): Kuerzel {
  return { befehl, taste, strg, umschalt, accelerator, zweitbelegung: false }
}

/** Wie `k`, aber als Zweitbelegung eines Befehls, der schon eine Hauptbelegung hat. */
function zweit(
  befehl: Befehl,
  taste: string,
  accelerator: string,
  strg = false,
  umschalt = false
): Kuerzel {
  return { ...k(befehl, taste, accelerator, strg, umschalt), zweitbelegung: true }
}

/**
 * Was ein Befehl tut, in der aktiven Sprache (S6.8). Nicht als Feld im
 * Kuerzel: die Liste entsteht einmal beim Laden, die Sprache wechselt zur
 * Laufzeit. Der Schluessel ergibt sich aus dem Befehl; fehlt er im Katalog,
 * ist das ein Typfehler.
 */
export function beschreibeBefehl(befehl: Befehl): string {
  return t(`befehl.${befehl}`)
}

export const KUERZEL: readonly Kuerzel[] = [
  k('oeffnen', 'o', 'CommandOrControl+O', true),
  k('speichern', 's', 'CommandOrControl+S', true),
  k('speichernUnter', 's', 'CommandOrControl+Shift+S', true, true),
  k('formularFlachlegen', 'f', 'CommandOrControl+Shift+F', true, true),
  k('fdfExportieren', 'e', 'CommandOrControl+Shift+E', true, true),
  k('seiteLoeschen', 'delete', 'CommandOrControl+Shift+Delete', true, true),
  k('zusammenfuehren', 'm', 'CommandOrControl+Shift+M', true, true),
  k('teilen', 't', 'CommandOrControl+Shift+T', true, true),
  k('pngExportieren', 'p', 'CommandOrControl+Shift+P', true, true),
  k('seitenuebersicht', 'o', 'CommandOrControl+Shift+O', true, true),
  k('seitenExtrahieren', 'k', 'CommandOrControl+Shift+K', true, true),
  k('drucken', 'p', 'CommandOrControl+P', true),
  k('wordExportieren', 'j', 'CommandOrControl+Shift+J', true, true),
  k('seiteVor', 'pagedown', 'PageDown'),
  k('seiteZurueck', 'pageup', 'PageUp'),
  k('anfang', 'home', 'Home'),
  k('ende', 'end', 'End'),
  k('zoomGroesser', '+', 'CommandOrControl+Plus', true),
  k('zoomKleiner', '-', 'CommandOrControl+-', true),
  k('zoomZuruecksetzen', '0', 'CommandOrControl+0', true),
  k('passungBreite', '1', 'CommandOrControl+1', true),
  k('passungSeite', '2', 'CommandOrControl+2', true),
  k('drehenRechts', 'r', 'CommandOrControl+R', true),
  k('drehenLinks', 'r', 'CommandOrControl+Shift+R', true, true),
  k('zuSeiteSpringen', 'g', 'CommandOrControl+G', true),
  k('suchen', 'f', 'CommandOrControl+F', true),
  k('sidebarUmschalten', 'f4', 'F4'),
  // Escape ohne Zusatztaste: der uebliche Ausweg aus einem Modus. Die
  // Behandlung im Fenster laesst Eingabefelder ohnehin in Ruhe.
  k('werkzeugAuswahl', 'escape', 'Escape'),
  k('rueckgaengig', 'z', 'CommandOrControl+Z', true),
  // Strg+Y und nicht Strg+Umschalt+Z: unter Windows ist das die gewohnte
  // Belegung, und das Menue zeigt je Befehl genau eine.
  k('wiederholen', 'y', 'CommandOrControl+Y', true),
  k('annotationLoeschen', 'delete', 'Delete'),
  k('markiereAuswahl', 'h', 'CommandOrControl+Shift+H', true, true),
  k('unterstreicheAuswahl', 'u', 'CommandOrControl+Shift+U', true, true),
  k('durchstreicheAuswahl', 'd', 'CommandOrControl+Shift+D', true, true),
  // Ohne Zusatztaste: F1 ist die gewohnte Hilfetaste, und die Uebersicht
  // erreicht damit auch, wer die Kuerzel gerade nicht kennt (S5.2a).
  k('kuerzeluebersicht', 'f1', 'F1'),
  // Strg+Komma: die verbreitete Belegung fuer Einstellungen (VS Code, macOS).
  k('einstellungen', ',', 'CommandOrControl+,', true),
  // Tabs (S6.1b). Strg+W gehoerte bis hierher der Rolle `close` und schloss
  // das ganze Fenster; mit Tabs erwartet man darunter den Tab, wie im
  // Browser. Das Fenster schliesst jetzt Strg+Umschalt+W (FENSTER_SCHLIESSEN).
  k('tabSchliessen', 'w', 'CommandOrControl+W', true),
  k('tabVor', 'tab', 'CommandOrControl+Tab', true),
  k('tabZurueck', 'tab', 'CommandOrControl+Shift+Tab', true, true),
  // Strg+Bild-ab/-auf wie in Browsern und Office: dort wechseln sie ebenfalls
  // den Tab. Ohne Strg blaettern dieselben Tasten weiter die Seite.
  zweit('tabVor', 'pagedown', 'CommandOrControl+PageDown', true),
  zweit('tabZurueck', 'pageup', 'CommandOrControl+PageUp', true),
  // 'I' ist mit keinem anderen Befehl belegt.
  k('ausBildernErstellen', 'i', 'CommandOrControl+Shift+I', true, true),
  // B wie "beschneiden": frei, keine Electron-Rolle; C und X scheiden aus
  // (Rollentasten, siehe Test), Z waere als Strg+Umschalt+Z "Wiederholen".
  k('werkzeugZuschneiden', 'b', 'CommandOrControl+Shift+B', true, true),
  // L wie "Zeile" (line): frei, auch ohne Umschalt nicht belegt, keine Rolle.
  k('werkzeugTextBearbeiten', 'l', 'CommandOrControl+Shift+L', true, true)
]

/**
 * Fenster schliessen - eine Electron-Rolle und deshalb **nicht** in der Map
 * (siehe Kopfkommentar): Electron registriert den Accelerator nativ, und die
 * Behandlung im Fenster darf denselben Tastendruck nicht zusaetzlich abfangen.
 * Der Accelerator steht trotzdem hier, weil der Guard aus S1.3b die
 * Electron-Schreibweise ausserhalb dieser Datei verbietet - und weil hier
 * sichtbar bleibt, dass er mit keinem Kuerzel der Map kollidiert.
 */
export const FENSTER_SCHLIESSEN = {
  accelerator: 'CommandOrControl+Shift+W'
} as const

/**
 * Die Accelerator-Schreibweise als das, was auf der Tastatur steht - fuer die
 * Kuerzeluebersicht aus S5.2a.
 *
 * Steht hier und nicht in der Komponente, weil der Guard aus S1.3b die
 * Electron-Schreibweise ausserhalb dieser Datei verbietet: zwei Quellen fuer
 * dieselben Kuerzel driften auseinander, und dann zeigt die Uebersicht etwas
 * anderes, als die Anwendung tut.
 */
export function alsTasten(accelerator: string): string {
  return accelerator
    .split('+')
    .map((teil) => tastenname(teil))
    .join(' + ')
}

function tastenname(teil: string): string {
  switch (teil) {
    case 'CommandOrControl':
      return t('taste.strg')
    case 'Shift':
      return t('taste.umschalt')
    case 'Delete':
      return t('taste.entf')
    case 'PageDown':
      return t('taste.bildAb')
    case 'PageUp':
      return t('taste.bildAuf')
    case 'Home':
      return t('taste.pos1')
    case 'End':
      return t('taste.ende')
    case 'Escape':
      return t('taste.esc')
    default:
      return teil
  }
}

/** Die Tasten eines Befehls, wie sie in Titeln und der Uebersicht stehen. */
export function tastenFuer(befehl: Befehl): string {
  return alsTasten(findeKuerzel(befehl).accelerator)
}

/**
 * Nachschlag fuer das Menue. Wirft bewusst, statt einen leeren Accelerator zu
 * liefern: ein Menueeintrag ohne Kuerzel faellt niemandem auf, ein fehlendes
 * Kuerzel im Test dagegen sofort.
 */
export function findeKuerzel(befehl: Befehl): Kuerzel {
  const gefunden = KUERZEL.find((kuerzel) => kuerzel.befehl === befehl && !kuerzel.zweitbelegung)
  if (gefunden === undefined) throw new Error('Kein Kuerzel fuer Befehl: ' + befehl) // KEIN-UI-TEXT: Invariante, der Test prueft alle Befehle
  return gefunden
}

export interface TastenEreignis {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Findet den Befehl zu einem Tastendruck.
 *
 * Die Reihenfolge zaehlt: das Kuerzel mit Umschalt muss vor dem gleichnamigen
 * ohne Umschalt geprueft werden, sonst faengt "Strg+R" auch "Strg+Umschalt+R".
 */
export function findeBefehl(ereignis: TastenEreignis): Befehl | null {
  const taste = ereignis.key.toLowerCase()
  const strg = ereignis.ctrlKey || ereignis.metaKey
  const passende = KUERZEL.filter((kuerzel) => kuerzel.taste === taste && kuerzel.strg === strg)
  const mitUmschalt = passende.find((kuerzel) => kuerzel.umschalt && ereignis.shiftKey)
  if (mitUmschalt !== undefined) return mitUmschalt.befehl
  const ohneUmschalt = passende.find((kuerzel) => !kuerzel.umschalt && !ereignis.shiftKey)
  return ohneUmschalt?.befehl ?? null
}
