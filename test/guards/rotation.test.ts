import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Drehung laeuft ueber `getViewport({ rotation })` — mit **einer** Ausnahme.
 *
 * Ein CSS-transform auf dem Seiten-, Canvas- oder Annotationscontainer waere
 * der naheliegende Weg und der falsche: die Textauswahl verhaelt sich in
 * Chromium ueber gedrehten Containern erratisch, und jede Bildschirmkoordinate
 * muesste ab S2.1 zusaetzlich die CSS-Matrix invertieren — genau die
 * Fehlerquelle aus Risiko R6.
 *
 * Die Ausnahme ist die Textebene, und sie ist keine Aufweichung, sondern die
 * einzige Stelle, an der die Regel nicht anwendbar war: pdf.js legt seine
 * Spans in ungedrehten Seitenkoordinaten ab und dreht sie im eigenen Viewer
 * per CSS. Wer die Spans stattdessen selbst setzt, braucht die Drehung ebenso
 * — dann je Span statt einmal am Container, also oefter und nicht seltener.
 * Gedrehter Text ohne Drehung gibt es nicht. Begruendung und Beleg:
 * Aenderungshistorie zum 2026-09-08, E2E `textebene-drehung.electron.spec.ts`.
 *
 * Der Guard sichert dafuer drei engere Aussagen:
 * 1. Ausserhalb von `textebene.css` gibt es kein `rotate(` — auch nicht in
 *    weiteren Stilen, die frueher gar nicht geprueft wurden.
 * 2. In `textebene.css` sind nur die vier Seitendrehungen und die
 *    Span-Variable von pdf.js erlaubt, angebunden an `data-drehung`.
 * 3. Es wird nirgends eine Drehung in TypeScript ausgerechnet — der Wert
 *    kommt aus derselben Quelle wie der von `getViewport`.
 *
 * `translateX` zum Zentrieren ist erlaubt; verboten ist nur die Drehung.
 */

/** Die einzige Datei, die ein CSS-`rotate` tragen darf. */
const TEXTEBENE = join('src', 'renderer', 'src', 'viewer', 'textebene.css')

/** Und dort nur diese Formen — keine gerechneten, keine krummen Winkel. */
const ERLAUBTE_DREHUNGEN = new Set([
  'rotate(90deg)',
  'rotate(180deg)',
  'rotate(270deg)',
  'rotate(var(--rotate))'
])

function dateien(pfad: string): string[] {
  return statSync(pfad).isFile()
    ? [pfad]
    : readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
}

function quellen(): string[] {
  return dateien('src').filter(
    (pfad) => pfad.endsWith('.ts') || pfad.endsWith('.tsx') || pfad.endsWith('.css')
  )
}

describe('Drehung', () => {
  it('verwendet ausserhalb der Textebene nirgends ein CSS-rotate', () => {
    const treffer = quellen()
      .filter((pfad) => pfad !== TEXTEBENE)
      .filter((pfad) => /rotate\s*\(/.test(readFileSync(pfad, 'utf8')))
    expect(treffer).toEqual([])
  })

  it('rechnet auch in der Textebene keine Drehung in TypeScript aus', () => {
    const treffer = dateien('src')
      .filter((pfad) => pfad.endsWith('.ts') || pfad.endsWith('.tsx'))
      .filter((pfad) => /rotate\s*\(/.test(readFileSync(pfad, 'utf8')))
    expect(treffer).toEqual([])
  })

  it('dreht die Textebene nur in Vielfachen von 90 Grad', () => {
    const stil = readFileSync(TEXTEBENE, 'utf8')
    // Eine Klammerebene tief - `rotate(var(--rotate))` waere sonst abgeschnitten.
    const gefunden = [...stil.matchAll(/rotate\((?:[^()]|\([^()]*\))*\)/g)].map(
      (eintrag) => eintrag[0]
    )
    expect(gefunden.length).toBeGreaterThan(0)
    expect(gefunden.filter((eintrag) => !ERLAUBTE_DREHUNGEN.has(eintrag))).toEqual([])
  })

  it('bindet die Drehung der Textebene an data-drehung', () => {
    const stil = readFileSync(TEXTEBENE, 'utf8')
    for (const grad of [90, 180, 270]) {
      expect(stil).toContain(".textebene[data-drehung='" + String(grad) + "']")
    }
  })

  it('reicht die Drehung an getViewport durch', () => {
    const seite = readFileSync('src/renderer/src/viewer/Seite.tsx', 'utf8')
    expect(seite).toMatch(/getViewport\(\{[^}]*rotation/)
  })

  // Die Textebene bekommt dieselbe Drehung wie das Canvas darunter. Stuende
  // hier ein zweiter Wert, liefen Ebene und Seite auseinander, ohne dass ein
  // Typfehler entstuende. Seit dem Befund vor S4.2b ist diese Drehung die
  // Summe aus Seiten- und Ansichtsdrehung (`effektiveDrehung`), als eine
  // Variable an beide Stellen gereicht.
  it('setzt data-drehung aus derselben Drehung wie getViewport', () => {
    const ebene = readFileSync('src/renderer/src/viewer/Textebene.tsx', 'utf8')
    expect(ebene).toMatch(/const drehung = effektiveDrehung\(seite\.rotate, rotation\)/)
    expect(ebene).toMatch(/getViewport\(\{[^}]*rotation:\s*drehung\s*\}\)/)
    expect(ebene).toMatch(/setzeEbenenmasse\(behaelter, ungedreht, drehung\)/)
    expect(ebene).toMatch(/setAttribute\('data-drehung',[^)]*rotation/)
  })

  // Jede Stelle, die pdf.js eine Drehung nennt, nennt die effektive: pdf.js
  // ersetzt mit `rotation` das `/Rotate` der Seite, statt es zu ergaenzen.
  it('gibt an getViewport nur die effektive Drehung weiter', () => {
    for (const datei of [
      'viewer/Seite.tsx',
      'viewer/Miniatur.tsx',
      'viewer/Textebene.tsx',
      'png-export.ts'
    ]) {
      const quelle = readFileSync(join('src', 'renderer', 'src', datei), 'utf8')
      const aufrufe = [...quelle.matchAll(/getViewport\(\{[^}]*rotation\b[^}]*\}\)/g)].map(
        (eintrag) => eintrag[0]
      )
      expect(aufrufe.length).toBeGreaterThan(0)
      for (const aufruf of aufrufe) {
        // Entweder die Summe oder ausdruecklich die ungedrehte Bezugsgroesse.
        expect(aufruf).toMatch(
          /rotation:\s*(effektiveDrehung\(seite\.rotate, rotation\)|drehung|0)\s*\}/
        )
      }
    }
    const matrix = readFileSync('src/renderer/src/viewer/seitenmatrix.ts', 'utf8')
    expect(matrix).toMatch(/baueTransformation\([^)]*effektiveDrehung\(ansicht\.rotate, rotation\)/)
  })
})
