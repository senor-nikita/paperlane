// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mammoth from 'mammoth'
import { describe, expect, it } from 'vitest'
import { baueDocx, pruefeWordAuftrag } from '../../src/main/word'
import type { WordAuftrag, WordSeite } from '../../src/shared/ipc'
import { baueWordSeiten, BILDART, OP, type RohSeite } from '../../src/renderer/src/word-export'
import { extrahiereSeite, type PngWandler } from '../../src/renderer/src/word-extraktion'
import { kleinesPng } from '../helpers/png'

/**
 * PDF nach Word (S6.7), Aufgabe 6: der ganze Weg vom Fixture bis zur `.docx`
 * und zurueck - ohne Word. pdf.js liest `word.pdf` wie im Renderer (nur das
 * Canvas fuer die Bilder ist ersetzt, jsdom hat keins), die Gruppierung
 * bildet Absaetze, der Main prueft und baut die Datei, und **mammoth** liest
 * sie als zweiter, unabhaengiger Leser zurueck: eigener Parser fuer
 * `word/document.xml` (xmldom), eigene Deutung von Stilen, Laeufen und
 * Bildern. Verglichen werden Textfolge, Absatzfolge und Bildanzahl.
 */

const ERWARTET = [
  { tag: 'h1', text: 'Bericht zur Messreihe' },
  {
    tag: 'p',
    text:
      'Dieser Bericht fasst die Ergebnisse der ersten Messreihe zusammen. Die Werte wurden ' +
      'an drei Tagen erhoben und stimmen gut mit der Erwartung ueberein.'
  },
  { tag: 'img', text: '' },
  { tag: 'h2', text: 'Methode' },
  {
    tag: 'p',
    text: 'Gemessen wurde mit einem geeichten Geraet. Jeder Wert ist der Mittelwert aus fuenf Einzelmessungen.'
  },
  { tag: 'p', text: 'Hinweis: Ausreisser wurden nicht entfernt.' },
  { tag: 'h2', text: 'Ergebnis' },
  { tag: 'p', text: 'Die Abweichung liegt unter zwei Prozent.' },
  { tag: 'img', text: '' },
  { tag: 'p', text: 'Damit ist die Messreihe abgeschlossen.' }
]

const PNG: PngWandler = () => Promise.resolve(new Uint8Array(kleinesPng(4, 3)))

async function lies(name: string, wandle: PngWandler = PNG) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const auftrag = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(resolve('test/fixtures', name)))
  })
  const doc = await auftrag.promise
  try {
    const roh: RohSeite[] = []
    for (let nummer = 1; nummer <= doc.numPages; nummer++) {
      roh.push(await extrahiereSeite(await doc.getPage(nummer), wandle))
    }
    return { roh, OPS: pdfjs.OPS, ImageKind: pdfjs.ImageKind }
  } finally {
    await auftrag.destroy()
  }
}

/** Die `.docx` als Folge von Bloecken, gelesen von mammoth. */
async function zurueckgelesen(bytes: Uint8Array): Promise<{ tag: string; text: string }[]> {
  const ergebnis = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
  const bloecke: { tag: string; text: string }[] = []
  for (const treffer of ergebnis.value.matchAll(/<(h\d|p)>(.*?)<\/\1>/g)) {
    const inhalt = treffer[2] ?? ''
    for (let i = 0; i < (inhalt.match(/<img /g) ?? []).length; i++) {
      bloecke.push({ tag: 'img', text: '' })
    }
    const text = inhalt.replace(/<[^>]+>/g, '')
    if (text.length > 0) bloecke.push({ tag: treffer[1] ?? '', text })
  }
  return bloecke
}

/**
 * `word/document.xml` aus dem ZIP - fuer das, was mammoth nicht meldet
 * (Seitenumbruch, Seitengroesse). JSZip kommt mit mammoth und docx mit.
 */
async function dokumentXml(bytes: Uint8Array): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

async function docxAus(seiten: WordSeite[], seitenumbruch = true): Promise<Uint8Array> {
  const auftrag: WordAuftrag = { quelle: 'C:\\d\\word.pdf', seiten, seitenumbruch }
  const geprueft = pruefeWordAuftrag(auftrag)
  if (!geprueft.ok) throw new Error(geprueft.grund)
  return baueDocx(geprueft.auftrag, { titel: 'word' })
}

describe('word.pdf nach .docx und zurueck', () => {
  it('ergibt Textfolge, Absaetze, Ueberschriften und beide Bilder', async () => {
    const { roh } = await lies('word.pdf')
    expect(roh.map((seite) => seite.bilder.length)).toEqual([1, 1])
    const bytes = await docxAus(baueWordSeiten(roh))
    expect(await zurueckgelesen(bytes)).toEqual(ERWARTET)
  })

  it('traegt fett und kursiv aus den Schriftnamen', async () => {
    const { roh } = await lies('word.pdf')
    const html = (
      await mammoth.convertToHtml({ buffer: Buffer.from(await docxAus(baueWordSeiten(roh))) })
    ).value
    // Das Leerzeichen zwischen den Schnitten haengt am vorigen Lauf.
    expect(html).toContain('<p><strong>Hinweis: </strong><em>')
    expect(html).toContain('<h1><strong>Bericht zur Messreihe</strong></h1>')
    expect(html).toContain('<em>Ausreisser wurden nicht entfernt.</em>')
  })

  it('meldet keine Warnungen beim Zuruecklesen', async () => {
    const { roh } = await lies('word.pdf')
    const ergebnis = await mammoth.convertToHtml({
      buffer: Buffer.from(await docxAus(baueWordSeiten(roh)))
    })
    expect(ergebnis.messages).toEqual([])
  })

  it('setzt Seitenumbrueche nur auf Wunsch', async () => {
    const { roh } = await lies('word.pdf')
    const seiten = baueWordSeiten(roh)
    // Den Umbruch kennt mammoth nicht; also direkt in word/document.xml.
    const umbrueche = async (bytes: Uint8Array): Promise<number> => {
      const xml = await dokumentXml(bytes)
      return (xml.match(/<w:pageBreakBefore\/>/g) ?? []).length
    }
    expect(await umbrueche(await docxAus(seiten, true))).toBe(1)
    expect(await umbrueche(await docxAus(seiten, false))).toBe(0)
  })

  it('setzt die Seitengroesse aus der ersten Seite', async () => {
    const { roh } = await lies('word.pdf')
    const xml = await dokumentXml(await docxAus(baueWordSeiten(roh)))
    // A4 in Twips: 595 x 842 Punkt mal 20.
    expect(xml).toMatch(/<w:pgSz w:w="11900" w:h="16840"/)
  })

  it('erkennt beim gescannten Dokument nur ein Bild und keinen Text', async () => {
    const { roh } = await lies('scanned.pdf')
    expect(roh[0]?.stuecke.filter((s) => s.text.trim().length > 0)).toEqual([])
    const bytes = await docxAus(baueWordSeiten(roh))
    expect(await zurueckgelesen(bytes)).toEqual([{ tag: 'img', text: '' }])
  })

  it('ueberspringt ein Bild, das sich nicht wandeln laesst', async () => {
    const { roh } = await lies('word.pdf', () => Promise.resolve(null))
    expect(roh.flatMap((seite) => seite.bilder)).toEqual([])
    expect(roh.flatMap((seite) => seite.stuecke).length).toBeGreaterThan(0)
  })
})

describe('Konstanten gegen pdf.js', () => {
  it('OP und BILDART entsprechen OPS und ImageKind', async () => {
    const { OPS, ImageKind } = await lies('single-page.pdf')
    for (const [name, wert] of Object.entries(OP)) {
      expect(OPS[name as keyof typeof OPS]).toBe(wert)
    }
    expect(ImageKind.GRAYSCALE_1BPP).toBe(BILDART.grau1bit)
    expect(ImageKind.RGB_24BPP).toBe(BILDART.rgb)
    expect(ImageKind.RGBA_32BPP).toBe(BILDART.rgba)
  })
})
