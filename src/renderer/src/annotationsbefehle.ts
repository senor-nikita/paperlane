import type { Annotation } from '../../shared/annotations'
import { useAnnotationen } from './annotations-store'
import { useBearbeitung } from './bearbeitung-store'
import { useHistorie } from './historie'
import { t } from '../../shared/i18n'

/**
 * Die drei Aenderungen an Annotationen — jede mit ihrem Rueckweg (S2.2).
 *
 * Bewusst gewoehnliche Funktionen und kein Hook: sie werden aus Ereignissen
 * heraus gerufen, nicht beim Rendern, und `getState()` ist genau dafuer
 * gedacht. Ein Hook zwaenge jede Aufrufstelle in eine Abhaengigkeitsliste,
 * ohne dass irgendetwas davon neu gezeichnet werden muesste.
 *
 * Alles laeuft ueber diese Stelle. Wuerde eine Aufrufstelle den Speicher
 * direkt anfassen, entstuende eine Aenderung ohne Historienschritt — und
 * Strg+Z naehme dann etwas anderes zurueck, als der Nutzer zuletzt getan hat.
 */

/** Beschriftungen fuer die Historie, in der Sprache des Nutzers (S6.8: Katalog). */
const BEZEICHNUNG: Record<string, () => string> = {
  Highlight: () => t('anmerkung.Highlight'),
  Underline: () => t('anmerkung.Underline'),
  StrikeOut: () => t('anmerkung.StrikeOut'),
  Text: () => t('anmerkung.Text'),
  FreeText: () => t('anmerkung.FreeText'),
  Ink: () => t('anmerkung.Ink'),
  Stamp: () => t('anmerkung.Stamp'),
  Square: () => t('anmerkung.Square'),
  Circle: () => t('anmerkung.Circle'),
  Link: () => t('anmerkung.Link')
}

function benenne(annotation: Annotation): string {
  return BEZEICHNUNG[annotation.typ]?.() ?? t('anmerkung.allgemein')
}

/** Hebt die Auswahl auf, wenn sie auf diese Annotation zeigt. */
function loeseAuswahl(id: string): void {
  const bearbeitung = useBearbeitung.getState()
  if (bearbeitung.ausgewaehlt === id) bearbeitung.waehle(null)
}

/** An welcher Stelle ihrer Seite die Annotation steht; -1, wenn nicht gefunden. */
function stelleVon(annotation: Annotation): number {
  const liste = useAnnotationen.getState().proSeite[annotation.seite] ?? []
  return liste.findIndex((eintrag) => eintrag.id === annotation.id)
}

export function erstelleAnnotation(annotation: Annotation): void {
  const { fuegeEin, entferne } = useAnnotationen.getState()
  fuegeEin(annotation)
  useHistorie.getState().merke({
    beschreibung: t('historie.erstellt', { was: benenne(annotation) }),
    ruecknehmen: () => {
      entferne(annotation.id)
      // Eine zurueckgenommene Annotation darf nicht ausgewaehlt bleiben: der
      // Rahmen staende sonst um etwas, das es nicht mehr gibt.
      loeseAuswahl(annotation.id)
    },
    wiederholen: () => {
      fuegeEin(annotation)
    }
  })
}

export function veraendereAnnotation(vorher: Annotation, nachher: Annotation): void {
  const { ersetze } = useAnnotationen.getState()
  ersetze(nachher)
  useHistorie.getState().merke({
    beschreibung: t('historie.geaendert', { was: benenne(nachher) }),
    ruecknehmen: () => {
      ersetze(vorher)
    },
    wiederholen: () => {
      ersetze(nachher)
    }
  })
}

export function loescheAnnotation(annotation: Annotation): void {
  const { fuegeEin, entferne } = useAnnotationen.getState()
  // Die Stelle vor dem Entfernen merken, damit das Zuruecknehmen die
  // Reihenfolge wiederherstellt - sie entscheidet, was beim Ueberlappen oben
  // liegt.
  const stelle = stelleVon(annotation)
  entferne(annotation.id)
  loeseAuswahl(annotation.id)
  useHistorie.getState().merke({
    beschreibung: t('historie.geloescht', { was: benenne(annotation) }),
    ruecknehmen: () => {
      fuegeEin(annotation, stelle < 0 ? undefined : stelle)
    },
    wiederholen: () => {
      entferne(annotation.id)
      loeseAuswahl(annotation.id)
    }
  })
}
