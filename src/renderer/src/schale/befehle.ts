import { useCallback, useEffect, type RefObject } from 'react'
import { verschluesseltText } from '../../../shared/errors'
import { findeBefehl, type Befehl } from '../../../shared/tastatur'
import { useAnnotationen } from '../annotations-store'
import { loescheAnnotation } from '../annotationsbefehle'
import { useBearbeitung } from '../bearbeitung-store'
import { bruecke } from '../bruecke'
import { useHistorie } from '../historie'
import { useDokument } from '../dokument-store'
import { extrahiereSeiten } from '../extrahieren'
import { loescheAktuelleSeite, zielseiten } from '../mutation'
import { useUebersicht } from '../uebersicht-store'
import { beginneBilderZuPdf } from './bilderzupdf-logik'
import { beginneZusammenfuehren, useDokumentwerkzeuge } from './dokumentwerkzeuge-logik'
import { exportiereFdf, speichere } from './speichern'
import { useSuche } from '../suche-store'
import { useTabs } from '../tabs-store'
import { t } from '../../../shared/i18n'

/**
 * Die Befehlsausfuehrung der Anwendung — ein Weg fuer alle Ausloeser.
 *
 * Tastenkuerzel, Anwendungsmenue und Kontextmenue laufen durch dieselbe
 * Funktion (ADR 0002). Zwei Ausfuehrungswege wuerden auseinander driften, und
 * dann taete das Menue etwas anderes als das Kuerzel daneben.
 */

/** Ob ein Tastendruck in einem Element landet, dem die Tasten selbst gehoeren. */
export function istEingabefeld(ziel: EventTarget | null): boolean {
  return (
    ziel instanceof HTMLInputElement ||
    ziel instanceof HTMLTextAreaElement ||
    ziel instanceof HTMLSelectElement
  )
}

export interface Eingabefelder {
  /** Das Feld fuer die Seitenzahl — `zuSeiteSpringen` waehlt seinen Inhalt aus. */
  seite: RefObject<HTMLInputElement | null>
  /** Das Suchfeld — `suchen` waehlt seinen Inhalt aus. */
  suche: RefObject<HTMLInputElement | null>
}

export function useBefehle(felder: Eingabefelder): (befehl: Befehl) => void {
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const zoom = useDokument((zustand) => zustand.zoom)
  // Seit S6.1 oeffnet jeder Einstieg einen neuen Tab.
  const oeffneUeberDialog = useTabs((zustand) => zustand.oeffneUeberDialog)
  const oeffneUeberPfad = useTabs((zustand) => zustand.oeffneUeberPfad)
  const meldeVerschwunden = useTabs((zustand) => zustand.meldeVerschwunden)
  const springeZuSeite = useDokument((zustand) => zustand.springeZuSeite)
  const zoomeStufe = useDokument((zustand) => zustand.zoomeStufe)
  const setzeZoom = useDokument((zustand) => zustand.setzeZoom)
  const setzePassung = useDokument((zustand) => zustand.setzePassung)
  const drehe = useDokument((zustand) => zustand.drehe)
  const schalteSidebar = useDokument((zustand) => zustand.schalteSidebar)
  const setzeSuchbegriff = useSuche((zustand) => zustand.setzeBegriff)
  const starteSuche = useSuche((zustand) => zustand.starte)

  const fuehreAus = useCallback(
    (befehl: Befehl): void => {
      switch (befehl) {
        case 'oeffnen':
          void oeffneUeberDialog()
          return
        // Kein Eintrag in der Abhaengigkeitsliste noetig: `speichere` holt
        // sich Dokument und Anmerkungen selbst ueber `getState()`.
        case 'speichern':
          void speichere('gleich')
          return
        case 'speichernUnter':
          void speichere('neu')
          return
        case 'formularFlachlegen':
          void speichere('gleich', { flachlegen: true })
          return
        case 'fdfExportieren':
          void exportiereFdf()
          return
        case 'seiteLoeschen':
          void loescheAktuelleSeite()
          return
        case 'zusammenfuehren':
          void beginneZusammenfuehren()
          return
        case 'teilen':
          // Ohne Dokument gibt es nichts zu teilen; Zusammenfuehren geht auch ohne.
          // Ein passwortgeschuetztes muesste neu geschrieben werden - gesperrt
          // wie Speichern, mit dem Grund statt eines Fehlers hinterher.
          if (useDokument.getState().verschluesselt) {
            useDokument.getState().setzeHinweis(verschluesseltText())
          } else if (useDokument.getState().ladeZustand === 'bereit') {
            useDokumentwerkzeuge.getState().oeffne('teilen')
          } else {
            useDokument.getState().setzeHinweis(t('hinweis.teilenOhneDokument'))
          }
          return
        case 'seitenuebersicht':
          if (useDokument.getState().ladeZustand === 'bereit') {
            useUebersicht.getState().schalte()
          } else {
            useDokument.getState().setzeHinweis(t('hinweis.ohneDokument'))
          }
          return
        case 'seitenExtrahieren':
          // Die Auswahl, sonst die aktuelle Seite - wie Drehen und Loeschen.
          // Einen getippten Bereich nimmt die Seitenuebersicht entgegen.
          if (useDokument.getState().ladeZustand === 'bereit') {
            void extrahiereSeiten(zielseiten(), false)
          } else {
            useDokument.getState().setzeHinweis(t('hinweis.extrahierenOhneDokument'))
          }
          return
        case 'pngExportieren':
          if (useDokument.getState().ladeZustand === 'bereit') {
            useDokumentwerkzeuge.getState().oeffne('png')
          } else {
            useDokument.getState().setzeHinweis(t('hinweis.exportierenOhneDokument'))
          }
          return
        case 'wordExportieren':
          // Liest nur ueber pdf.js - anders als Teilen und Drucken auch bei
          // passwortgeschuetzten Dokumenten (Begruendung in main/word-export.ts).
          if (useDokument.getState().ladeZustand === 'bereit') {
            useDokumentwerkzeuge.getState().oeffne('word')
          } else {
            useDokument.getState().setzeHinweis(t('hinweis.exportierenOhneDokument'))
          }
          return
        case 'drucken':
          // Die Druckvorlage entsteht ueber pdf-lib (ADR 0003) - wie beim Teilen.
          if (useDokument.getState().verschluesselt) {
            useDokument.getState().setzeHinweis(verschluesseltText())
          } else if (useDokument.getState().ladeZustand === 'bereit') {
            useDokumentwerkzeuge.getState().oeffne('drucken')
          } else {
            useDokument.getState().setzeHinweis(t('hinweis.druckenOhneDokument'))
          }
          return
        case 'seiteVor':
          springeZuSeite(aktuelleSeite + 1)
          return
        case 'seiteZurueck':
          springeZuSeite(aktuelleSeite - 1)
          return
        case 'anfang':
          springeZuSeite(1)
          return
        case 'ende':
          springeZuSeite(seitenzahl)
          return
        case 'zoomGroesser':
          zoomeStufe(1)
          return
        case 'zoomKleiner':
          zoomeStufe(-1)
          return
        case 'zoomZuruecksetzen':
          setzeZoom(1)
          return
        case 'passungBreite':
          setzePassung('breite', zoom)
          return
        case 'passungSeite':
          setzePassung('seite', zoom)
          return
        case 'drehenRechts':
          drehe(1)
          return
        case 'drehenLinks':
          drehe(-1)
          return
        case 'zuSeiteSpringen':
          felder.seite.current?.select()
          return
        case 'suchen':
          felder.suche.current?.select()
          return
        case 'sidebarUmschalten':
          schalteSidebar()
          return
        case 'kuerzeluebersicht':
          // Ein zweites F1 schliesst sie wieder - sonst muesste man zum
          // Zumachen zur Maus greifen, was die Uebersicht gerade widerlegt.
          if (useDokumentwerkzeuge.getState().offen === 'kuerzel') {
            useDokumentwerkzeuge.getState().schliesse()
            return
          }
          useDokumentwerkzeuge.getState().oeffne('kuerzel')
          return
        case 'einstellungen':
          // Wie F1: ein zweites Strg+, schliesst den Dialog wieder.
          if (useDokumentwerkzeuge.getState().offen === 'einstellungen') {
            useDokumentwerkzeuge.getState().schliesse()
            return
          }
          useDokumentwerkzeuge.getState().oeffne('einstellungen')
          return
        case 'werkzeugAuswahl': {
          // Der Ausweg aus jedem Zeichenmodus (S2.2, Aufgabe 1) - und seit
          // S5.2a zuerst der Ausweg aus einem offenen Feld. Escape schliesst,
          // was zuletzt aufgegangen ist; das Feld selbst faengt die Taste nur
          // ab, solange der Fokus darin liegt.
          const werkzeuge = useDokumentwerkzeuge.getState()
          if (werkzeuge.offen !== null) {
            werkzeuge.schliesse()
            return
          }
          if (useUebersicht.getState().offen) {
            useUebersicht.getState().schliesse()
            return
          }
          useBearbeitung.getState().setzeWerkzeug('auswahl')
          return
        }
        case 'rueckgaengig':
          useHistorie.getState().rueckgaengig()
          return
        case 'wiederholen':
          useHistorie.getState().wiederholen()
          return
        case 'markiereAuswahl':
          useBearbeitung.getState().wendeAn('markieren')
          return
        case 'unterstreicheAuswahl':
          useBearbeitung.getState().wendeAn('unterstreichen')
          return
        case 'durchstreicheAuswahl':
          useBearbeitung.getState().wendeAn('durchstreichen')
          return
        case 'annotationLoeschen': {
          const gewaehlt = useBearbeitung.getState().ausgewaehlt
          if (gewaehlt === null) return
          const annotation = useAnnotationen.getState().finde(gewaehlt)
          if (annotation !== null) loescheAnnotation(annotation)
          return
        }
        // Tabs (S6.1b). Ist gerade gesperrt, setzen `schliesse` und
        // `naechster` den Grund selbst als Hinweis - ein Kuerzel, das still
        // nichts tut, liest sich wie ein Fehler.
        case 'tabSchliessen': {
          const { aktiv, schliesse } = useTabs.getState()
          if (aktiv === null) return
          schliesse(aktiv).catch((error: unknown) => {
            console.error('Tab konnte nicht geschlossen werden:', error)
          })
          return
        }
        case 'tabVor':
          useTabs.getState().naechster(1)
          return
        case 'tabZurueck':
          useTabs.getState().naechster(-1)
          return
        case 'ausBildernErstellen':
          void beginneBilderZuPdf()
          return
        case 'werkzeugZuschneiden':
          useBearbeitung.getState().setzeWerkzeug('zuschneiden')
          return
        case 'werkzeugTextBearbeiten':
          useBearbeitung.getState().setzeWerkzeug('textBearbeiten')
          return
      }
    },
    [
      aktuelleSeite,
      seitenzahl,
      zoom,
      felder,
      oeffneUeberDialog,
      springeZuSeite,
      zoomeStufe,
      setzeZoom,
      setzePassung,
      drehe,
      schalteSidebar
    ]
  )

  useEffect(() => {
    const beiTaste = (ereignis: KeyboardEvent): void => {
      // In einem Eingabefeld gehoeren die Tasten dem Feld: Home, Ende und
      // Entf bewegen dort die Einfuegemarke und loeschen Zeichen - sie
      // duerfen nicht zur ersten Seite springen oder eine Anmerkung
      // loeschen. Seit S3.1 mit textarea und select: Formularfelder und der
      // Notizzettel sind keine <input>.
      if (istEingabefeld(ereignis.target) && !ereignis.ctrlKey && !ereignis.metaKey) return
      const befehl = findeBefehl(ereignis)
      if (befehl === null) return
      ereignis.preventDefault()
      fuehreAus(befehl)
    }
    window.addEventListener('keydown', beiTaste)
    return () => {
      window.removeEventListener('keydown', beiTaste)
    }
  }, [fuehreAus])

  useEffect(() => {
    const api = bruecke()
    if (api === undefined) return undefined
    return api.beiEreignis((nachricht) => {
      if (nachricht.art === 'befehl') {
        fuehreAus(nachricht.befehl)
        return
      }
      // Die Datei ist waehrend des Betrachtens verschwunden (S1.5, Fall 4).
      // Seit S6.1 kann das jeder offene Tab sein: der Hinweis erscheint nur,
      // wenn es der aktive ist, sonst wird es am Tab vermerkt.
      if (nachricht.art === 'dokumentVerschwunden') {
        meldeVerschwunden(nachricht.pfad)
        return
      }
      // Der Druck ist eine Phase weiter (S4.3, Aufgabe 3).
      if (nachricht.art === 'druckFortschritt') {
        useDokumentwerkzeuge.getState().setzeDruckphase(nachricht.phase)
        return
      }
      // "Oeffnen mit" oder eine zweite Instanz. Der Pfad geht denselben Weg
      // wie ein Drop: durch die Pruefung im Main-Prozess.
      if (nachricht.art === 'dokumentAusSystem') {
        oeffneUeberPfad(nachricht.pfad).catch((error: unknown) => {
          console.error('Dokument aus dem System konnte nicht geoeffnet werden:', error)
        })
        return
      }
      // Eine Auswahl ueber mehrere Zeilen traegt Umbrueche; der Seitentext
      // kennt an dieser Stelle nur ein Leerzeichen (viewer/suche.ts).
      const begriff = nachricht.text.replace(/\s+/g, ' ').trim()
      if (begriff.length === 0) return
      setzeSuchbegriff(begriff)
      felder.suche.current?.focus()
      starteSuche().catch((error: unknown) => {
        console.error('Suche nach der Auswahl fehlgeschlagen:', error)
      })
    })
  }, [fuehreAus, felder, oeffneUeberPfad, meldeVerschwunden, setzeSuchbegriff, starteSuche])

  return fuehreAus
}
