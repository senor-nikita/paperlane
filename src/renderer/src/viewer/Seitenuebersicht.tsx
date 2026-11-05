import { useEffect, useMemo, useRef, useState } from 'react'
import { parseBereiche } from '../../../shared/bereiche'
import { reihenfolgeNachVerschieben } from '../../../shared/mutation'
import { useDokument } from '../dokument-store'
import { extrahiereSeiten } from '../extrahieren'
import { loescheSeiten, ordneSeitenAn, zielseiten } from '../mutation'
import { useMutation } from '../mutation-store'
import { useSeitenauswahl } from '../seitenauswahl-store'
import { useUebersicht } from '../uebersicht-store'
import { Drossel } from './drossel'
import { Miniatur } from './Miniatur'
import {
  berechneRaster,
  einfuegestelle,
  KACHEL_MAX,
  KACHEL_MIN,
  sichtbareKacheln,
  zielImRaster
} from './raster'
import { RenderQueue } from './renderqueue'
import { Seitenwerkzeuge } from './Seitenwerkzeuge'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/** Zeilen ober- und unterhalb des Sichtfensters, die vorgehalten werden. */
const PUFFER_ZEILEN = 1
/**
 * Wie viele Kacheln gleichzeitig gezeichnet werden. Zwei statt einer wie in
 * der Seitenleiste: die Hauptansicht liegt verdeckt darunter und zeichnet
 * nichts Neues, der Worker gehoert hier der Uebersicht.
 */
const GLEICHZEITIG = 2

/**
 * Wohin die Seiten nach einer Verschiebung gewandert sind: `reihenfolge[i]`
 * ist die alte Nummer an Position `i + 1`.
 */
function neuePositionen(reihenfolge: readonly number[], alte: readonly number[]): number[] {
  return alte.map((seite) => reihenfolge.indexOf(seite) + 1).sort((a, b) => a - b)
}

/**
 * Die Seitenuebersicht (S6.2): alle Seiten als Raster zum Organisieren -
 * waehlen, verschieben, drehen, loeschen, extrahieren. Sie liegt ueber der
 * Hauptansicht, statt sie zu ersetzen: Scrollstand, Zoom und Renderzustand
 * darunter bleiben erhalten, und "Fertig" fuehrt genau dorthin zurueck.
 *
 * Alles wirkt ueber die vorhandenen Mutationen aus S4.1 und damit in der
 * gemeinsamen Rueckgaengig-Historie. Die Auswahl ist dieselbe wie in der
 * Seitenleiste.
 */
export function Seitenuebersicht(): React.JSX.Element {
  useT()
  const seitenGroessen = useDokument((zustand) => zustand.seitenGroessen)
  const rotation = useDokument((zustand) => zustand.rotation)
  const aktuelleSeite = useDokument((zustand) => zustand.aktuelleSeite)
  const springeZuSeite = useDokument((zustand) => zustand.springeZuSeite)
  const seitenzahl = useDokument((zustand) => zustand.seitenzahl)
  const verschluesselt = useDokument((zustand) => zustand.verschluesselt)
  const ausgewaehlt = useSeitenauswahl((zustand) => zustand.ausgewaehlt)
  const waehle = useSeitenauswahl((zustand) => zustand.klick)
  const setzeAuswahl = useSeitenauswahl((zustand) => zustand.setze)
  const mutationLaeuft = useMutation((zustand) => zustand.laeuft !== null)
  const kachelBreite = useUebersicht((zustand) => zustand.kachelBreite)
  const setzeKachelBreite = useUebersicht((zustand) => zustand.setzeKachelBreite)
  const schliesse = useUebersicht((zustand) => zustand.schliesse)

  const [bereich, setBereich] = useState('')
  const [entfernen, setEntfernen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ansage, setAnsage] = useState('')

  const behaelterRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<RenderQueue | null>(null)
  queueRef.current ??= new RenderQueue()
  const queue = queueRef.current
  const drosselRef = useRef<Drossel | null>(null)
  drosselRef.current ??= new Drossel(GLEICHZEITIG)
  const drossel = drosselRef.current

  const [scrollOben, setScrollOben] = useState(0)
  const [flaeche, setFlaeche] = useState({ breite: 800, hoehe: 600 })

  useEffect(() => {
    const behaelter = behaelterRef.current
    if (behaelter === null) return undefined
    const beobachter = new ResizeObserver((eintraege) => {
      const rechteck = eintraege[0]?.contentRect
      if (rechteck === undefined) return
      setFlaeche({ breite: rechteck.width, hoehe: rechteck.height })
    })
    beobachter.observe(behaelter)
    // Der Fokus gehoert beim Oeffnen ins Raster - wer per Tastatur kommt,
    // soll sofort mit den Pfeilen weiterarbeiten koennen.
    behaelter.focus()
    return () => {
      beobachter.disconnect()
    }
  }, [])

  const raster = useMemo(
    () => berechneRaster(seitenGroessen, rotation, kachelBreite, flaeche.breite),
    [seitenGroessen, rotation, kachelBreite, flaeche.breite]
  )
  const sichtbar = useMemo(
    () => sichtbareKacheln(raster, scrollOben, flaeche.hoehe, PUFFER_ZEILEN),
    [raster, scrollOben, flaeche.hoehe]
  )

  // Die aktive Kachel im Blick behalten, wie die Seitenleiste es tut.
  useEffect(() => {
    const behaelter = behaelterRef.current
    const platz = raster.plaetze[aktuelleSeite - 1]
    if (behaelter === null || platz === undefined) return
    const unten = platz.oben + platz.hoehe
    if (platz.oben < behaelter.scrollTop) behaelter.scrollTop = Math.max(0, platz.oben - 16)
    else if (unten > behaelter.scrollTop + behaelter.clientHeight) {
      behaelter.scrollTop = unten - behaelter.clientHeight + 16
    }
  }, [aktuelleSeite, raster])

  useEffect(() => {
    if (sichtbar.von === -1) return
    const behalten = new Set<number>()
    for (let i = sichtbar.von; i <= sichtbar.bis; i++) behalten.add(i)
    queue.brichAlleAusser(behalten)
  }, [sichtbar, queue])

  useEffect(
    () => () => {
      queue.brichAlles()
    },
    [queue]
  )

  /** Verschieben per Ziehen - dieselbe Regel wie in der Seitenleiste. */
  const gezogenRef = useRef<number[] | null>(null)
  const [ablage, setAblage] = useState<{ seite: number; danach: boolean } | null>(null)

  const verschiebe = async (bewegte: number[], vor: number): Promise<void> => {
    const reihenfolge = reihenfolgeNachVerschieben(seitenzahl, bewegte, vor)
    if (reihenfolge === null || mutationLaeuft) return
    if (!(await ordneSeitenAn(reihenfolge))) return
    const neu = neuePositionen(reihenfolge, bewegte)
    setzeAuswahl(neu)
    const erste = neu[0]
    if (erste !== undefined) springeZuSeite(erste)
    setAnsage(t('uebersicht.verschoben', { anzahl: neu.length, position: erste ?? '' }))
  }

  const gesperrt = verschluesselt || mutationLaeuft

  const beiTaste = (ereignis: React.KeyboardEvent): void => {
    const strg = ereignis.ctrlKey || ereignis.metaKey
    if (ereignis.key === 'Escape') {
      ereignis.preventDefault()
      ereignis.stopPropagation()
      schliesse()
      return
    }
    if (ereignis.key === 'Enter') {
      ereignis.preventDefault()
      schliesse()
      return
    }
    if (ereignis.key === ' ') {
      ereignis.preventDefault()
      waehle(aktuelleSeite, { strg: true, umschalt: false })
      return
    }
    if (strg && ereignis.key.toLowerCase() === 'a') {
      ereignis.preventDefault()
      setzeAuswahl(Array.from({ length: seitenzahl }, (_, i) => i + 1))
      return
    }
    if (ereignis.key === 'Delete') {
      ereignis.preventDefault()
      ereignis.stopPropagation()
      if (!gesperrt) void loescheSeiten(zielseiten())
      return
    }
    if (strg && (ereignis.key === 'ArrowLeft' || ereignis.key === 'ArrowRight')) {
      ereignis.preventDefault()
      if (gesperrt) return
      const seiten = zielseiten()
      const vor = einfuegestelle(
        ereignis.key === 'ArrowLeft' ? 'zurueck' : 'vor',
        seiten,
        seitenzahl
      )
      if (vor !== null) void verschiebe(seiten, vor)
      return
    }
    const ziel = zielImRaster(ereignis.key, aktuelleSeite, seitenzahl, raster.spalten)
    if (ziel === null) return
    ereignis.preventDefault()
    // Umschalt ohne Anker erweitert von der aktiven Seite aus - sonst waere
    // die erste Umschalt-Taste nur ein gewoehnlicher Schritt.
    if (ereignis.shiftKey && useSeitenauswahl.getState().anker === null) {
      waehle(aktuelleSeite, { strg: false, umschalt: false })
    }
    springeZuSeite(ziel)
    waehle(ziel, { strg: false, umschalt: ereignis.shiftKey })
  }

  /** Die Seiten fuer "Extrahieren": der getippte Bereich, sonst die Auswahl. */
  const extrahiere = (): void => {
    let seiten: number[]
    if (bereich.trim() === '') {
      seiten = zielseiten()
    } else {
      const ergebnis = parseBereiche(bereich, seitenzahl)
      if (!ergebnis.ok) {
        setFehler(ergebnis.grund)
        return
      }
      const menge = new Set<number>()
      for (const [von, bis] of ergebnis.bereiche) {
        for (let s = von; s <= bis; s++) menge.add(s)
      }
      seiten = [...menge]
    }
    setFehler(null)
    void extrahiereSeiten(seiten, entfernen)
  }

  const gezeigt = sichtbar.von === -1 ? [] : raster.plaetze.slice(sichtbar.von, sichtbar.bis + 1)

  return (
    <section
      data-testid="seitenuebersicht"
      aria-label={t('uebersicht.titel')}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--tisch)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          padding: '0.3rem 0.6rem',
          background: 'var(--flaeche)',
          borderBottom: '1px solid var(--linie)'
        }}
      >
        <strong style={{ fontSize: '0.9em' }}>Seitenuebersicht</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8em' }}>
          {t('uebersicht.groesse')}
          <input
            type="range"
            data-testid="uebersicht-groesse"
            min={KACHEL_MIN}
            max={KACHEL_MAX}
            step={10}
            value={kachelBreite}
            onChange={(ereignis) => {
              setzeKachelBreite(Number(ereignis.target.value))
            }}
          />
        </label>
        <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
          <Seitenwerkzeuge />
        </div>
        <form
          role="group"
          aria-label={t('uebersicht.extrahieren')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8em' }}
          onSubmit={(ereignis) => {
            ereignis.preventDefault()
            extrahiere()
          }}
        >
          <label htmlFor="uebersicht-bereich">{t('uebersicht.seiten')}</label>
          <input
            id="uebersicht-bereich"
            data-testid="uebersicht-bereich"
            type="text"
            value={bereich}
            placeholder={t('uebersicht.platzhalter')}
            aria-invalid={fehler !== null}
            aria-describedby={fehler !== null ? 'uebersicht-fehler' : undefined}
            style={{ width: '11rem' }}
            onChange={(ereignis) => {
              setBereich(ereignis.target.value)
              setFehler(null)
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <input
              type="checkbox"
              data-testid="uebersicht-entfernen"
              checked={entfernen}
              onChange={(ereignis) => {
                setEntfernen(ereignis.target.checked)
              }}
            />
            {t('uebersicht.entfernen')}
          </label>
          <button
            type="submit"
            data-testid="uebersicht-extrahieren"
            className="knopf"
            disabled={gesperrt}
            title={t('uebersicht.extrahierenTitel')}
          >
            {t('uebersicht.extrahierenKnopf')}
          </button>
        </form>
        <button
          type="button"
          data-testid="uebersicht-schliessen"
          className="knopf"
          onClick={schliesse}
          title={t('uebersicht.fertigTitel')}
        >
          {t('uebersicht.fertig')}
        </button>
      </div>
      {fehler !== null && (
        <p
          id="uebersicht-fehler"
          role="alert"
          data-testid="uebersicht-fehler"
          style={{ margin: 0, padding: '0.2rem 0.6rem', color: '#a4161a', fontSize: '0.8em' }}
        >
          {fehler}
        </p>
      )}
      <span role="status" aria-live="polite" className="nur-fuer-screenreader">
        {ansage}
      </span>
      <div
        ref={behaelterRef}
        data-testid="uebersicht-raster"
        role="listbox"
        aria-label={t('uebersicht.seiten')}
        aria-multiselectable
        aria-activedescendant={'kachel-option-' + String(aktuelleSeite)}
        aria-describedby="uebersicht-hilfe"
        tabIndex={0}
        onKeyDown={beiTaste}
        onScroll={() => {
          setScrollOben(behaelterRef.current?.scrollTop ?? 0)
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <span id="uebersicht-hilfe" hidden>
          {t('uebersicht.hilfe')}
        </span>
        <div style={{ position: 'relative', height: String(raster.gesamthoehe) + 'px' }}>
          {gezeigt.map((platz) => (
            <Miniatur
              key={platz.index}
              kennung="kachel"
              platz={platz}
              links={platz.links}
              waagerecht
              zoom={platz.zoom}
              queue={queue}
              drossel={drossel}
              aktiv={platz.index + 1 === aktuelleSeite}
              gewaehlt={ausgewaehlt.has(platz.index + 1)}
              ablage={
                ablage?.seite === platz.index + 1 ? (ablage.danach ? 'danach' : 'davor') : null
              }
              beiKlick={(seite, modifikatoren) => {
                springeZuSeite(seite)
                waehle(seite, modifikatoren)
              }}
              beiZiehStart={(seite) => {
                gezogenRef.current = ausgewaehlt.has(seite) ? [...ausgewaehlt] : [seite]
              }}
              beiZiehUeber={(seite, danach) => {
                if (gezogenRef.current === null) return
                if (ablage?.seite !== seite || ablage.danach !== danach) {
                  setAblage({ seite, danach })
                }
              }}
              beiAblage={(seite, danach) => {
                const bewegte = gezogenRef.current
                gezogenRef.current = null
                setAblage(null)
                if (bewegte === null) return
                void verschiebe(bewegte, danach ? seite + 1 : seite)
              }}
              beiZiehEnde={() => {
                gezogenRef.current = null
                setAblage(null)
              }}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
