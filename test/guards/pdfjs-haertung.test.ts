import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANNOTATIONSMODUS_AUS,
  PDFJS_HAERTUNG,
  PDFJS_RENDER_HAERTUNG
} from '../../src/renderer/src/pdf-haertung'

/**
 * Invariante 6. Die Haertung von pdf.js liegt an genau einer Stelle; dieser
 * Test friert sie ein und stellt sicher, dass niemand daneben einen zweiten
 * Ladeweg aufmacht.
 */
describe('pdf.js-Haertung', () => {
  it.each([
    ['enableScripting', false],
    ['isEvalSupported', false],
    ['enableXfa', false]
  ])('%s ist %s', (schluessel, erwartet) => {
    expect(PDFJS_HAERTUNG[schluessel as keyof typeof PDFJS_HAERTUNG]).toBe(erwartet)
  })

  it('erlaubt OffscreenCanvas', () => {
    expect(PDFJS_HAERTUNG.isOffscreenCanvasSupported).toBe(true)
  })
})

/**
 * Der ab S2.1 scharfe Teil von Invariante 6.
 *
 * Ohne `annotationMode: DISABLE` malt pdf.js Annotationen mit
 * Appearance-Stream in die Canvas, und die Annotationsebene zeichnet sie ein
 * zweites Mal darueber. In S2.2 waere die Folge schlimmer: eine geloeschte
 * Annotation bliebe sichtbar, weil sie im Bild steckt.
 */
describe('Annotationsmodus', () => {
  it('steht auf DISABLE', () => {
    expect(PDFJS_RENDER_HAERTUNG.annotationMode).toBe(ANNOTATIONSMODUS_AUS)
  })

  // Die Konstante ist eine Zahl, damit pdf-haertung.ts ohne pdf.js-Import
  // auskommt. Damit sie nicht stillschweigend veraltet, wird sie hier gegen
  // die Bibliothek selbst gehalten.
  it('entspricht AnnotationMode.DISABLE aus pdf.js', () => {
    const quelle = readFileSync('node_modules/pdfjs-dist/build/pdf.mjs', 'utf8')
    const block = /const AnnotationMode = \{([^}]*)\}/.exec(quelle)
    expect(block).not.toBeNull()
    const treffer = /DISABLE:\s*(\d+)/.exec(block?.[1] ?? '')
    expect(treffer).not.toBeNull()
    expect(Number(treffer?.[1])).toBe(ANNOTATIONSMODUS_AUS)
  })

  /**
   * Eine Konstante, die niemand benutzt, haertet nichts — und eine, die nur
   * die Hauptansicht benutzt, haertet die halbe Anwendung. Deshalb wird jede
   * Stelle aufgezaehlt, die eine Seite zeichnet, und jede muss die Haertung
   * mitgeben. Eine neue Renderpipeline faellt hier auf, bevor sie ein
   * Annotationsbild einbrennt.
   */
  it('wird an jeder Stelle mitgegeben, die eine Seite zeichnet', () => {
    const zeichnende = dateien('src')
      .filter((pfad) => pfad.endsWith('.ts') || pfad.endsWith('.tsx'))
      .filter((pfad) => /\.render\(\{/.test(readFileSync(pfad, 'utf8')))
      .map((pfad) => pfad.split(sep).join(String.fromCharCode(47)))
    expect(zeichnende).toEqual([
      'src/renderer/src/png-export.ts',
      'src/renderer/src/viewer/Miniatur.tsx',
      'src/renderer/src/viewer/Seite.tsx'
    ])
    for (const pfad of zeichnende) {
      expect(readFileSync(pfad, 'utf8')).toMatch(/\.render\(\{[^)]*PDFJS_RENDER_HAERTUNG/)
    }
  })
})

function dateien(pfad: string): string[] {
  return statSync(pfad).isFile()
    ? [pfad]
    : readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
}

describe('Ladeweg', () => {
  // Ein zweiter getDocument-Aufruf wuerde die Haertung umgehen, ohne dass ein
  // Test es merkt. Deshalb wird die Anzahl der Fundstellen festgeschrieben.
  it('ruft getDocument nur in der Factory auf', () => {
    const treffer = dateien('src')
      .filter((pfad) => pfad.endsWith('.ts') || pfad.endsWith('.tsx'))
      .filter((pfad) => /getDocument\s*\(/.test(readFileSync(pfad, 'utf8')))
      .map((pfad) => pfad.split(sep).join(String.fromCharCode(47)))
    expect(treffer).toEqual(['src/renderer/src/dokument-store.ts'])
  })
})
