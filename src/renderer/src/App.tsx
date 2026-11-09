import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { APP_NAME, windowTitle } from '../../shared/app-info'
import { useT } from './sprache'
import { useBearbeitung } from './bearbeitung-store'
import { bruecke } from './bruecke'
import { useDokument } from './dokument-store'
import { useTabs } from './tabs-store'
import { useBefehle } from './schale/befehle'
import { Kopfleiste } from './schale/Kopfleiste'
import { Meldungen } from './schale/Meldungen'
import { Passwortabfrage } from './schale/Passwortabfrage'
import { Seitenansage } from './schale/Seitenansage'
import { useMeldeAenderungen } from './schale/speichern'
import { Startseite } from './schale/Startseite'
import { Tableiste } from './schale/Tableiste'
import { Werkzeugleiste } from './schale/Werkzeugleiste'
import { Fortschritt } from './schale/Fortschritt'
import { Dokumentwerkzeuge } from './schale/Dokumentwerkzeuge'
import { BilderZuPdf } from './schale/BilderZuPdf'
import { bilderHinzufuegen, sindNurBilder, useBilderZuPdf } from './schale/bilderzupdf-logik'
import {
  useAnnotationsvorgaben,
  useAufraeumenBeiWechsel,
  useLeseposition,
  useSitzungSichern,
  useStartdokument
} from './schale/sitzung'
import { Dokumentansicht } from './viewer/Dokumentansicht'
import { Seitenuebersicht } from './viewer/Seitenuebersicht'
import { Sidebar } from './viewer/Sidebar'
import { useUebersicht } from './uebersicht-store'
import './schale/schale.css'

/**
 * Bringt der Drag Dateien? Beim Ablegen stehen sie in `files`, schon beim
 * Darueberziehen nennt der Browser sie nur als Typ "Files" in `types`.
 * Markierter Text, den die Maus zieht, Links und die Miniaturen beim
 * Umordnen tragen keinen davon.
 */
function traegtDateien(daten: DataTransfer): boolean {
  return daten.files.length > 0 || Array.from(daten.types).includes('Files')
}

/**
 * Die Schale der Anwendung.
 *
 * Sie haelt nur zusammen, was zusammengehoert: die Anordnung, das Fallenlassen
 * von Dateien und die beiden Eingabefelder, die Befehle ansteuern koennen.
 * Alles Uebrige liegt in `schale/` daneben — die Datei war bis S2.1 auf ueber
 * 670 Zeilen gewachsen, und S2.2 bringt Werkzeuge und eine Historie dazu.
 */
export function App(): React.JSX.Element {
  const t = useT()
  const leisteOffen = useBearbeitung((zustand) => zustand.leisteOffen)
  const bereit = useDokument((zustand) => zustand.ladeZustand === 'bereit')
  const sidebarSichtbar = useDokument((zustand) => zustand.sidebarSichtbar)
  const uebersichtOffen = useUebersicht((zustand) => zustand.offen)
  const setzeHinweis = useDokument((zustand) => zustand.setzeHinweis)
  const oeffneUeberPfad = useTabs((zustand) => zustand.oeffneUeberPfad)
  const aktiverTab = useTabs((zustand) => zustand.aktiv)
  const aktiverName = useTabs(
    (zustand) => zustand.tabs.find((tab) => tab.id === zustand.aktiv)?.name
  )

  const [ueberFenster, setUeberFenster] = useState(false)

  /**
   * Die Felder, die ein Befehl ansteuern kann. Der Verweis wird einmal
   * gebildet und nicht bei jedem Rendern neu: sonst meldete sich der
   * Tastenzuhoerer bei jeder Zustandsaenderung ab und wieder an.
   */
  const seiteRef = useRef<HTMLInputElement>(null)
  const sucheRef = useRef<HTMLInputElement>(null)
  const felder = useMemo(() => ({ seite: seiteRef, suche: sucheRef }), [])

  useStartdokument()
  useSitzungSichern()
  useAnnotationsvorgaben()
  useAufraeumenBeiWechsel()
  useLeseposition()
  // Der Main-Prozess braucht den Aenderungsstand, bevor das Fenster schliesst
  // — dann ist es fuer eine Nachfrage zu spaet (S2.3a, Aufgabe 5).
  useMeldeAenderungen()
  useBefehle(felder)

  // Der Fenstertitel nennt das Dokument des aktiven Tabs (S6.1b); Electron
  // uebernimmt `document.title` in Titelleiste und Taskleiste. Ohne Tab
  // steht nur der Anwendungsname da. Einen Stern fuer Aenderungen sieht
  // `windowTitle` nicht vor - die Marke steht in Kopf- und Tab-Leiste.
  useEffect(() => {
    document.title = windowTitle(aktiverName)
  }, [aktiverName])

  /**
   * Drag & Drop. `will-navigate` im Main-Prozess verhindert, dass ein Drop die
   * Anwendung zur Datei navigieren laesst; hier wird zusaetzlich der Browser-
   * Standard unterbunden und der Pfad ungeprueft an den Main-Prozess gereicht,
   * der ihn prueft.
   */
  const beiDrop = (ereignis: React.DragEvent): void => {
    setUeberFenster(false)
    const api = bruecke()
    const dateien = Array.from(ereignis.dataTransfer.files)
    // Ein Drag ohne Dateien ist keine Ablage: markierter Text, den die Maus
    // zieht, ein Link, ein Miniaturbild beim Umordnen. Das meldet nichts - der
    // Hinweis "keine Datei" gilt nur dem, der eine Datei meinte (s. u.).
    if (!traegtDateien(ereignis.dataTransfer)) return
    ereignis.preventDefault()
    if (api === undefined || dateien.length === 0) {
      setzeHinweis(t('app.keineDatei'))
      return
    }
    // `File.path` gibt es seit Electron 32 nicht mehr; der Pfad kommt aus dem
    // Preload ueber webUtils.
    const pfade = dateien.map((datei) => api.pfadVonDatei(datei)).filter((p) => p.length > 0)
    if (pfade.length === 0) {
      setzeHinweis(t('app.keineSystemdatei'))
      return
    }
    // Aus Bildern erstellen (S6.4, Aufgabe 1, dritter Einstieg): eine Ablage
    // ausschliesslich aus Bilddateien oeffnet das Feld statt eines PDF-Tabs.
    // Gemischte Ablagen bleiben beim bestehenden Weg - ein Bild darin scheitert
    // dort sichtbar, statt still zu verschwinden.
    if (sindNurBilder(pfade)) {
      useBilderZuPdf.getState().oeffne()
      void bilderHinzufuegen(pfade)
      return
    }
    // Mehrere Dateien ergeben mehrere Tabs (S6.1). Der Tab-Store oeffnet sie
    // nacheinander; die zuletzt geoeffnete ist danach aktiv.
    const meldungen = pfade.map((pfad) =>
      oeffneUeberPfad(pfad).catch((error: unknown) => {
        console.error('Fallengelassene Datei konnte nicht geoeffnet werden:', error)
        return null
      })
    )
    // Die Meldungen sammeln (S6.1b): jedes Laden raeumt den Hinweis weg, und
    // ohne das stuende die Ablehnung der ersten Datei nur so lange da, bis
    // die zweite geladen ist. Bei einer einzelnen Datei hat der Tab-Store
    // die Meldung schon gesetzt.
    if (pfade.length < 2) return
    void Promise.all(meldungen).then((alle) => {
      const abgelehnt = alle.filter((meldung): meldung is string => meldung !== null)
      if (abgelehnt.length > 0) setzeHinweis(abgelehnt.join(' '))
    })
  }

  return (
    <div
      data-testid="fenster"
      onDragOver={(ereignis) => {
        // Nur Dateien lassen sich hier ablegen; sonst bliebe nach dem Ziehen
        // von Text der gestrichelte Rahmen stehen und das Drop meldete "keine
        // Datei".
        if (!traegtDateien(ereignis.dataTransfer)) return
        // Ohne preventDefault laesst der Browser das Drop gar nicht erst zu.
        ereignis.preventDefault()
        setUeberFenster(true)
      }}
      onDragLeave={() => {
        setUeberFenster(false)
      }}
      onDrop={beiDrop}
      style={{
        background: 'var(--papier)',
        color: 'var(--tinte)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        margin: 0,
        outline: ueberFenster ? '3px dashed #1a4fb4' : 'none',
        outlineOffset: '-3px'
      }}
    >
      {/* Erstes fokussierbares Element im Dokument (S5.2a, Aufgabe 1): wer mit
          der Tastatur ankommt, ueberspringt Kopf- und Werkzeugleiste, statt
          sich durch dreissig Knoepfe zum Text zu tabben. */}
      <a className="sprungmarke" href="#dokumentbereich">
        {t('app.zumDokument')}
      </a>
      {/* Die Anwendung braucht genau eine Ueberschrift erster Ordnung. Sichtbar
          waere sie doppelt - der Name steht schon in der Kopfleiste und im
          Fenstertitel -, im Zugaenglichkeitsbaum fehlte sie bisher ganz. */}
      <h1 className="nur-fuer-screenreader">{t('app.ueberschrift', { app: APP_NAME })}</h1>
      <Seitenansage />
      <Kopfleiste seiteRef={seiteRef} sucheRef={sucheRef} />
      <Tableiste />
      {/* Die Werkzeuge erscheinen erst mit einem Dokument: ohne Seite gibt es
          nichts zu markieren. */}
      {bereit && leisteOffen && <Werkzeugleiste />}
      <Meldungen />
      <Fortschritt />
      <Dokumentwerkzeuge />
      <BilderZuPdf />
      <Passwortabfrage />
      {/*
       * Die Hauptlandmarke umfasst Seitenleiste und Ansicht, nicht das ganze
       * Fenster: Kopfleiste und Werkzeuge sind eigene Landmarken und gehoeren
       * nicht in `main`. `tabIndex={-1}` macht sie zum Ziel der Sprungmarke -
       * ohne das setzt der Sprung nur den Startpunkt der Tabfolge, und der
       * Screenreader liest weiter an der alten Stelle.
       *
       * `minHeight: 0` bleibt noetig, damit Seitenleiste und Ansicht in sich
       * scrollen, statt die Spalte zu dehnen.
       */}
      <main
        id="dokumentbereich"
        tabIndex={-1}
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          outlineOffset: '-3px',
          // Bezugsrahmen fuer die Seitenuebersicht, die darueber liegt (S6.2).
          position: 'relative'
        }}
      >
        {!bereit && <Startseite />}
        {/* Je Tab frisch aufgebaut (S6.1): Renderwarteschlange, Scrollanker
            und Miniaturen gehoeren zum Dokument des Tabs. Ohne den Schluessel
            fuehre die Ansicht mit dem Anker des verlassenen Tabs fort. */}
        {bereit && (
          <Fragment key={aktiverTab ?? 'ohne-tab'}>
            {sidebarSichtbar && <Sidebar />}
            <Dokumentansicht />
            {uebersichtOffen && <Seitenuebersicht />}
          </Fragment>
        )}
      </main>
    </div>
  )
}
