import { resolve } from 'node:path'
import { bildeZeilen, type TextElement, type TextZeile } from '../../src/shared/textzeilen'

/**
 * Das unabhaengige Orakel fuer "Text bearbeiten" (S6.6b, ADR 0005 Punkt 6):
 * pdf.js liest das Ergebnis, nicht der eigene Parser. Legacy-Build, damit es
 * unter Node laeuft; die Aufrufer laden ihn im `beforeAll` vor (CI-Limit).
 */
export async function pdfjsZeilen(bytes: Uint8Array, seite = 1): Promise<TextZeile[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const auftrag = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/',
    verbosity: 0
  })
  const doc = await auftrag.promise
  try {
    const page = await doc.getPage(seite)
    const inhalt = await page.getTextContent()
    const elemente: TextElement[] = []
    for (const item of inhalt.items) {
      if ('str' in item)
        elemente.push({ str: item.str, transform: item.transform as number[], width: item.width })
    }
    return bildeZeilen(elemente)
  } finally {
    await auftrag.destroy()
  }
}

export function findeZeile(zeilen: readonly TextZeile[], text: string): TextZeile {
  const zeile = zeilen.find((z) => z.text === text)
  if (zeile === undefined) {
    throw new Error(
      'Zeile "' + text + '" nicht gefunden unter: ' + zeilen.map((z) => z.text).join(' | ')
    )
  }
  return zeile
}
