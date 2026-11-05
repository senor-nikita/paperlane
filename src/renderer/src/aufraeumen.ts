import { useAnnotationen } from './annotations-store'
import { useBearbeitung } from './bearbeitung-store'
import { useFormular } from './formular-store'
import { useHistorie } from './historie'
import { useMutation } from './mutation-store'
import { useSeitenauswahl } from './seitenauswahl-store'
import { leereTextCache, useSuche } from './suche-store'

/**
 * Alles, was zu einem Dokument gehoert und beim Wechsel weg muss: Textcache
 * und Suche, Anmerkungen, Formularwerte, Historie, Auswahl, Mutationsstand.
 *
 * Bis S6.0 lebte das nur als Effekt an der Ladenummer (`useAufraeumenBeiWechsel`).
 * Seit S6.1 ruft der Tab-Store es **ausdruecklich** auf, bevor er einen
 * neuen Tab laedt oder den letzten schliesst - der Stand des verlassenen Tabs
 * steckt dann schon in seiner Momentaufnahme, und das Aufraeumen haengt
 * nicht mehr am Zeitpunkt eines Effekts. Der Effekt ruft es weiter fuer den
 * Wechsel zu einer Datei und das Neuladen nach einer Mutation.
 *
 * `mitHistorie: false` fuer das Neuladen nach einer Mutation (S4.1): es ist
 * dasselbe Dokument, der Mutationsschritt selbst steht in der Historie, und
 * die Schritte davor werden gueltig, sobald er zurueckgenommen ist.
 *
 * Ein eigenes Modul, weil Schale (Effekt) und Tab-Store es beide brauchen
 * und die Schale den Tab-Store ohnehin importiert.
 */
export function raeumeAuf(mitHistorie = true): void {
  leereTextCache()
  useSuche.getState().zuruecksetzen()
  useAnnotationen.getState().vergiss()
  // Formularwerte gehoeren zum Dokument, nicht zur Sitzung (S3.1).
  useFormular.getState().vergiss()
  // Die Historie gehoerte zum vorigen Dokument. Bliebe sie stehen, traege
  // ein Strg+Z eine Anmerkung in eine Datei ein, in der sie nie war.
  if (mitHistorie) useHistorie.getState().leere()
  useBearbeitung.getState().waehle(null)
  // Faellt nicht, solange ein Neuladen nach einer Mutation erwartet wird.
  useMutation.getState().vergiss()
  useSeitenauswahl.getState().leere()
}
