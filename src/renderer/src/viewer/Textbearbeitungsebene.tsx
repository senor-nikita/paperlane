import { useEffect, useRef, useState } from 'react'
import {
  bildeZeilen,
  zeilenEcken,
  type TextElement,
  type TextZeile
} from '../../../shared/textzeilen'
import { useBearbeitung } from '../bearbeitung-store'
import { useDokument } from '../dokument-store'
import { ersetzeTextzeile } from '../mutation'
import { huelle, pdfZuBildschirm, type Bildschirmrechteck } from './koordinaten'
import { useSeitenmatrix } from './seitenmatrix'
import { t } from '../../../shared/i18n'
import { useT } from '../sprache'

/**
 * Das Werkzeug "Text bearbeiten" auf einer Seite (S6.6b, ADR 0005).
 *
 * Nur vorhanden, solange das Werkzeug gewaehlt ist. Legt ueber jede Zeile
 * der Textebene - gebildet aus `getTextContent` wie im Main
 * (`shared/textzeilen.ts`) - eine Klickflaeche. Ein Klick oeffnet an Ort und
 * Stelle ein Eingabefeld mit dem Zeilentext: Enter ersetzt, leer + Enter
 * oder Entf auf dem ganz markierten Text loescht, Esc oder Wegklicken bricht
 * ab. Angewendet wird ueber die Mutationspipeline (`textErsetzen`); ob die
 * Originalschrift gereicht hat oder die Ersatzschrift noetig war, meldet der
 * Hinweis danach.
 */

interface TextbearbeitungsebeneProps {
  /** Nullbasierter Seitenindex. */
  index: number
}

function bildschirmrechteck(
  zeile: TextZeile,
  matrix: Parameters<typeof pdfZuBildschirm>[1]
): Bildschirmrechteck | null {
  const punkte = zeilenEcken(zeile).map(([x, y]) => pdfZuBildschirm({ x, y }, matrix))
  return huelle(punkte.map((p) => ({ links: p.x, oben: p.y, breite: 0, hoehe: 0 })))
}

export function Textbearbeitungsebene({
  index
}: TextbearbeitungsebeneProps): React.JSX.Element | null {
  useT()
  const seite = index + 1
  const werkzeug = useBearbeitung((zustand) => zustand.werkzeug)
  const dokument = useDokument((zustand) => zustand.dokument)
  const matrix = useSeitenmatrix(index)
  const [zeilen, setZeilen] = useState<TextZeile[]>([])
  const [offen, setOffen] = useState<number | null>(null)
  const [eingabe, setEingabe] = useState('')
  const feldRef = useRef<HTMLInputElement>(null)
  const aktiv = werkzeug === 'textBearbeiten'

  useEffect(() => {
    setOffen(null)
    if (!aktiv || dokument === null) {
      setZeilen([])
      return undefined
    }
    let abgebrochen = false
    const lade = async (): Promise<void> => {
      const pdfSeite = await dokument.getPage(seite)
      const inhalt = await pdfSeite.getTextContent()
      if (abgebrochen) return
      const elemente: TextElement[] = []
      for (const item of inhalt.items) {
        if ('str' in item)
          elemente.push({ str: item.str, transform: item.transform as number[], width: item.width })
      }
      setZeilen(bildeZeilen(elemente))
    }
    lade().catch((fehler: unknown) => {
      console.error('Textzeilen von Seite ' + String(seite) + ' nicht lesbar:', fehler)
    })
    return () => {
      abgebrochen = true
    }
  }, [aktiv, dokument, seite])

  useEffect(() => {
    if (offen === null) return
    const feld = feldRef.current
    if (feld === null) return
    feld.focus()
    feld.select()
  }, [offen])

  if (!aktiv || matrix === null) return null

  const schliesse = (): void => {
    setOffen(null)
  }

  const wendeAn = (zeile: TextZeile, text: string): void => {
    setOffen(null)
    if (text === zeile.text) return
    void ersetzeTextzeile(seite, zeile, text)
  }

  const offeneZeile = offen === null ? undefined : zeilen[offen]
  const offenesRechteck = offeneZeile === undefined ? null : bildschirmrechteck(offeneZeile, matrix)
  const masstab = Math.hypot(matrix[0], matrix[1])

  return (
    <div
      data-testid={'textbearbeitung-' + String(seite)}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {zeilen.map((zeile, nummer) => {
        const r = bildschirmrechteck(zeile, matrix)
        if (r === null || nummer === offen) return null
        return (
          <button
            key={nummer}
            type="button"
            className="textzeile"
            data-testid={'textzeile-' + String(seite) + '-' + String(nummer)}
            aria-label={t('zeile.bearbeitenLabel', { text: zeile.text })}
            title={t('zeile.bearbeiten')}
            onClick={() => {
              setEingabe(zeile.text)
              setOffen(nummer)
            }}
            style={{
              position: 'absolute',
              left: String(r.links) + 'px',
              top: String(r.oben) + 'px',
              width: String(Math.max(4, r.breite)) + 'px',
              height: String(Math.max(4, r.hoehe)) + 'px',
              padding: 0,
              margin: 0,
              border: '1px dashed rgba(47, 111, 235, 0.55)',
              background: 'rgba(47, 111, 235, 0.06)',
              cursor: 'text',
              pointerEvents: 'auto'
            }}
          />
        )
      })}
      {offeneZeile !== undefined && offenesRechteck !== null && (
        <input
          ref={feldRef}
          type="text"
          data-testid="textzeile-eingabe"
          aria-label={t('zeile.neuerText', { text: offeneZeile.text })}
          value={eingabe}
          onChange={(ereignis) => {
            setEingabe(ereignis.target.value)
          }}
          onKeyDown={(ereignis) => {
            if (ereignis.key === 'Escape') {
              ereignis.preventDefault()
              ereignis.stopPropagation()
              schliesse()
            } else if (ereignis.key === 'Enter') {
              ereignis.preventDefault()
              wendeAn(offeneZeile, eingabe)
            } else if (ereignis.key === 'Delete') {
              const feld = ereignis.currentTarget
              const allesMarkiert =
                feld.value === '' ||
                (feld.selectionStart === 0 && feld.selectionEnd === feld.value.length)
              if (allesMarkiert) {
                ereignis.preventDefault()
                wendeAn(offeneZeile, '')
              }
            }
          }}
          onBlur={schliesse}
          style={{
            position: 'absolute',
            left: String(offenesRechteck.links) + 'px',
            top: String(offenesRechteck.oben) + 'px',
            minWidth: String(Math.max(80, offenesRechteck.breite)) + 'px',
            height: String(Math.max(16, offenesRechteck.hoehe)) + 'px',
            boxSizing: 'border-box',
            fontSize: String(Math.max(10, offeneZeile.groesse * masstab * 0.9)) + 'px',
            fontFamily: 'Helvetica, Arial, sans-serif',
            padding: '0 2px',
            border: '2px solid #2f6feb',
            background: '#ffffff',
            pointerEvents: 'auto',
            zIndex: 2
          }}
        />
      )}
    </div>
  )
}
