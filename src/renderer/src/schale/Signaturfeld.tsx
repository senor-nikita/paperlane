import { useCallback, useEffect, useRef, useState } from 'react'
import { useBearbeitung, type SignaturBild } from '../bearbeitung-store'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { useT } from '../sprache'

/**
 * Das Signaturfeld (S3.2, Aufgabe 4): eine Unterschrift zeichnen oder ein
 * Bild laden, dann auf die Seite oder in ein Signaturfeld setzen.
 *
 * Was hier entsteht, ist ein **Bild** — keine kryptografische Signatur. Es
 * belegt nicht, wer unterschrieben hat, und es schuetzt das Dokument nicht
 * vor Aenderungen. Der Satz steht sichtbar im Feld, nicht nur im Quelltext:
 * wer eine Unterschrift in ein PDF setzt, soll wissen, was sie wert ist.
 *
 * Gezeichnet wird transparent: das PNG traegt einen Alphakanal, damit die
 * Unterschrift ueber dem Text liegt und ihn nicht mit einer weissen Flaeche
 * verdeckt. Beim Uebernehmen wird auf den beschriebenen Bereich beschnitten,
 * sonst naehme ein kleines Kuerzel die volle Flaeche ein und das Rechteck auf
 * der Seite bestuende zum Grossteil aus Luft.
 */

export const ZEICHEN_BREITE = 420
export const ZEICHEN_HOEHE = 140
const STRICH = 2.5
const TINTE = '#1b1b1b'
const RAND = 8

interface Grenzen {
  links: number
  oben: number
  rechts: number
  unten: number
}

/** Misst eine Data-URL, indem der Browser sie dekodiert. */
function messeBild(url: string): Promise<SignaturBild> {
  return new Promise((erfuellen, ablehnen) => {
    const bild = new Image()
    bild.onload = () => {
      erfuellen({ url, breite: bild.naturalWidth, hoehe: bild.naturalHeight })
    }
    bild.onerror = () => {
      ablehnen(new Error('Das Bild liess sich nicht dekodieren.')) // KEIN-UI-TEXT: Protokoll, der Hinweis ist allgemein
    }
    bild.src = url
  })
}

export interface SignaturfeldProps {
  /** Aufgerufen, wenn das Feld geschlossen werden soll — uebernommen oder nicht. */
  onFertig: () => void
}

export function Signaturfeld({ onFertig }: SignaturfeldProps): React.JSX.Element {
  const setzeSignaturBild = useBearbeitung((zustand) => zustand.setzeSignaturBild)
  const setzeHinweis = useDokument((zustand) => zustand.setzeHinweis)
  const t = useT()

  const leinwandRef = useRef<HTMLCanvasElement>(null)
  const zeichnetRef = useRef(false)
  const grenzenRef = useRef<Grenzen | null>(null)
  const [gezeichnet, setGezeichnet] = useState(false)
  const [geladen, setGeladen] = useState<SignaturBild | null>(null)
  const [laedt, setLaedt] = useState(false)

  /** Die Leinwand in Geraetepixeln, damit die Linie auf HiDPI nicht verwischt. */
  useEffect(() => {
    const leinwand = leinwandRef.current
    if (leinwand === null) return
    const faktor = window.devicePixelRatio || 1
    leinwand.width = Math.round(ZEICHEN_BREITE * faktor)
    leinwand.height = Math.round(ZEICHEN_HOEHE * faktor)
    const kontext = leinwand.getContext('2d')
    if (kontext === null) return
    kontext.scale(faktor, faktor)
    kontext.lineWidth = STRICH
    kontext.lineCap = 'round'
    kontext.lineJoin = 'round'
    kontext.strokeStyle = TINTE
    // Nach dem Laden eines Bildes kommt die Leinwand neu in den Baum; die
    // Abhaengigkeit sorgt dafuer, dass sie dann erneut eingerichtet wird.
  }, [geladen])

  const punkt = (ereignis: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rahmen = ereignis.currentTarget.getBoundingClientRect()
    return { x: ereignis.clientX - rahmen.left, y: ereignis.clientY - rahmen.top }
  }

  const merkeGrenzen = (p: { x: number; y: number }): void => {
    const g = grenzenRef.current
    grenzenRef.current =
      g === null
        ? { links: p.x, oben: p.y, rechts: p.x, unten: p.y }
        : {
            links: Math.min(g.links, p.x),
            oben: Math.min(g.oben, p.y),
            rechts: Math.max(g.rechts, p.x),
            unten: Math.max(g.unten, p.y)
          }
  }

  const beiZeigerAb = (ereignis: React.PointerEvent<HTMLCanvasElement>): void => {
    const kontext = ereignis.currentTarget.getContext('2d')
    if (kontext === null) return
    ereignis.currentTarget.setPointerCapture(ereignis.pointerId)
    const p = punkt(ereignis)
    zeichnetRef.current = true
    kontext.beginPath()
    kontext.moveTo(p.x, p.y)
    // Ein Punkt ohne Bewegung: sonst hinterliesse ein Tippen nichts.
    kontext.lineTo(p.x + 0.01, p.y)
    kontext.stroke()
    merkeGrenzen(p)
    setGezeichnet(true)
  }

  const beiZeigerBewegung = (ereignis: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!zeichnetRef.current) return
    const kontext = ereignis.currentTarget.getContext('2d')
    if (kontext === null) return
    const p = punkt(ereignis)
    kontext.lineTo(p.x, p.y)
    kontext.stroke()
    merkeGrenzen(p)
  }

  const beiZeigerAuf = (): void => {
    zeichnetRef.current = false
  }

  const leeren = useCallback((): void => {
    // In CSS-Pixeln loeschen: der Kontext ist skaliert.
    leinwandRef.current?.getContext('2d')?.clearRect(0, 0, ZEICHEN_BREITE, ZEICHEN_HOEHE)
    grenzenRef.current = null
    setGezeichnet(false)
    setGeladen(null)
  }, [])

  /** Beschneidet die Zeichnung auf den beschriebenen Bereich plus Rand. */
  const zeichnungAlsBild = (): SignaturBild | null => {
    const leinwand = leinwandRef.current
    const grenzen = grenzenRef.current
    if (leinwand === null || grenzen === null) return null
    const faktor = leinwand.width / ZEICHEN_BREITE
    const links = Math.max(0, Math.floor((grenzen.links - RAND) * faktor))
    const oben = Math.max(0, Math.floor((grenzen.oben - RAND) * faktor))
    const rechts = Math.min(leinwand.width, Math.ceil((grenzen.rechts + RAND) * faktor))
    const unten = Math.min(leinwand.height, Math.ceil((grenzen.unten + RAND) * faktor))
    const breite = Math.max(1, rechts - links)
    const hoehe = Math.max(1, unten - oben)
    const ausschnitt = document.createElement('canvas')
    ausschnitt.width = breite
    ausschnitt.height = hoehe
    const kontext = ausschnitt.getContext('2d')
    if (kontext === null) return null
    kontext.drawImage(leinwand, links, oben, breite, hoehe, 0, 0, breite, hoehe)
    return { url: ausschnitt.toDataURL('image/png'), breite, hoehe }
  }

  const bildLaden = async (): Promise<void> => {
    const api = bruecke()
    if (api === undefined) return
    setLaedt(true)
    try {
      const ergebnis = await api.bildLaden()
      if (ergebnis.art === 'abgebrochen') return
      if (ergebnis.art === 'abgelehnt') {
        setzeHinweis(ergebnis.grund)
        return
      }
      const gemessen = await messeBild(ergebnis.url)
      // Das geladene Bild ersetzt die Zeichnung — beides zugleich gaebe zwei
      // Signaturen, und welche gemeint ist, wuesste niemand.
      grenzenRef.current = null
      setGezeichnet(false)
      setGeladen(gemessen)
    } catch (fehler) {
      console.error('Signaturbild konnte nicht geladen werden:', fehler)
      setzeHinweis(t('signatur.ladenFehler'))
    } finally {
      setLaedt(false)
    }
  }

  const uebernehmen = (): void => {
    const bild = geladen ?? zeichnungAlsBild()
    if (bild === null) return
    setzeSignaturBild(bild)
    onFertig()
  }

  const hatEtwas = geladen !== null || gezeichnet

  return (
    <div
      data-testid="signaturfeld"
      role="group"
      aria-label={t('signatur.titel')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--linie)',
        background: 'var(--flaeche)'
      }}
    >
      <p data-testid="signatur-hinweis" style={{ margin: 0, fontSize: '0.85em', color: '#444' }}>
        {t('signatur.hinweis')} {t('signatur.anleitung')}
      </p>

      {geladen === null ? (
        <canvas
          ref={leinwandRef}
          data-testid="signatur-zeichenflaeche"
          aria-label={t('signatur.zeichenflaeche')}
          onPointerDown={beiZeigerAb}
          onPointerMove={beiZeigerBewegung}
          onPointerUp={beiZeigerAuf}
          onPointerCancel={beiZeigerAuf}
          style={{
            width: String(ZEICHEN_BREITE) + 'px',
            height: String(ZEICHEN_HOEHE) + 'px',
            border: '1px dashed #9a9a9a',
            background: '#fff',
            cursor: 'crosshair',
            touchAction: 'none'
          }}
        />
      ) : (
        <img
          data-testid="signatur-vorschau"
          src={geladen.url}
          alt={t('signatur.geladen')}
          style={{
            maxWidth: String(ZEICHEN_BREITE) + 'px',
            maxHeight: String(ZEICHEN_HOEHE) + 'px',
            border: '1px dashed #9a9a9a',
            background: '#fff'
          }}
        />
      )}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="signatur-leeren"
          className="knopf"
          disabled={!hatEtwas}
          onClick={leeren}
        >
          {t('signatur.leeren')}
        </button>
        <button
          type="button"
          data-testid="signatur-laden"
          className="knopf"
          disabled={laedt}
          onClick={() => {
            void bildLaden()
          }}
        >
          {t('signatur.bildLaden')}
        </button>
        <button
          type="button"
          data-testid="signatur-uebernehmen"
          className="knopf"
          style={{ fontWeight: 700 }}
          disabled={!hatEtwas}
          onClick={uebernehmen}
        >
          {t('signatur.uebernehmen')}
        </button>
        <button type="button" data-testid="signatur-abbrechen" className="knopf" onClick={onFertig}>
          {t('schale.abbrechen')}
        </button>
      </div>
    </div>
  )
}
