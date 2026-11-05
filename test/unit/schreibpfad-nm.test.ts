import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'
import { wendeAenderungenAn } from '../../src/main/schreibpfad'

/**
 * Eine Annotation, die in dieser Sitzung entstand, traegt ihre Kennung als
 * `/NM` in der Datei. Dadurch findet der Schreibpfad sie nach dem Speichern
 * wieder - die Datei vergab ihr eine Objektnummer, die der Renderer nicht
 * kennt. Ohne das gingen Aenderungen und Loeschungen an einer eben
 * gespeicherten Annotation beim naechsten Speichern still verloren, und ein
 * Rueckgaengig ueber das Speichern hinweg liefe ins Leere (S7).
 */
let leer: Uint8Array

beforeAll(async () => {
  leer = new Uint8Array(await readFile(resolve('test/fixtures/single-page.pdf')))
})

function notiz(id: string, inhalt: string): Annotation {
  return {
    id,
    seite: 1,
    typ: 'Text',
    subtyp: 'Text',
    rect: [70, 700, 90, 720],
    quadPoints: null,
    striche: null,
    farbe: { r: 255, g: 212, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt,
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: null
  }
}

const aenderung = (teil: Partial<Aenderungen>): Aenderungen => ({
  neue: [],
  geaendert: [],
  geloescht: [],
  ...teil
})

/** Kennung (/NM) und Inhalt jeder Annotation auf Seite 1, nach dem Neuladen. */
async function lies(bytes: Uint8Array): Promise<{ nm: string | null; inhalt: string }[]> {
  const dokument = await PDFDocument.load(bytes)
  const annots = dokument.getPage(0).node.Annots()
  const ergebnis: { nm: string | null; inhalt: string }[] = []
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const dict = annots?.lookup(i, PDFDict)
    const nm = dict?.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)
    const inhalt = dict?.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)
    ergebnis.push({ nm: nm?.decodeText() ?? null, inhalt: inhalt?.decodeText() ?? '' })
  }
  return ergebnis
}

describe('/NM fuer in dieser Sitzung erzeugte Annotationen', () => {
  it('schreibt die Kennung als /NM', async () => {
    const bytes = await wendeAenderungenAn(
      leer,
      aenderung({ neue: [notiz('neu-abc12345-1', 'erste')] })
    )
    expect(await lies(bytes)).toEqual([{ nm: 'neu-abc12345-1', inhalt: 'erste' }])
  })

  it('findet die gespeicherte Annotation fuer eine Aenderung wieder', async () => {
    const gespeichert = await wendeAenderungenAn(
      leer,
      aenderung({ neue: [notiz('neu-abc12345-1', 'vorher')] })
    )
    const bytes = await wendeAenderungenAn(
      gespeichert,
      aenderung({ geaendert: [notiz('neu-abc12345-1', 'nachher')] })
    )
    // Eine Annotation, kein Duplikat, mit dem neuen Inhalt.
    expect(await lies(bytes)).toEqual([{ nm: 'neu-abc12345-1', inhalt: 'nachher' }])
  })

  it('findet die gespeicherte Annotation fuer das Loeschen wieder', async () => {
    const gespeichert = await wendeAenderungenAn(
      leer,
      aenderung({ neue: [notiz('neu-abc12345-1', 'bleibt'), notiz('neu-abc12345-2', 'geht')] })
    )
    const bytes = await wendeAenderungenAn(
      gespeichert,
      aenderung({ geloescht: ['neu-abc12345-2'] })
    )
    expect(await lies(bytes)).toEqual([{ nm: 'neu-abc12345-1', inhalt: 'bleibt' }])
  })

  it('verwechselt keine Kennung einer frueheren Sitzung mit der eigenen', async () => {
    // Zwei Sitzungen vergaben beide "-1": das Sitzungskennzeichen unterscheidet sie.
    const gespeichert = await wendeAenderungenAn(
      leer,
      aenderung({ neue: [notiz('neu-sitzungA-1', 'alt')] })
    )
    const bytes = await wendeAenderungenAn(
      gespeichert,
      aenderung({ geloescht: ['neu-sitzungB-1'] })
    )
    expect(await lies(bytes)).toEqual([{ nm: 'neu-sitzungA-1', inhalt: 'alt' }])
  })

  it('laesst unbekannte Kennungen in Ruhe', async () => {
    const bytes = await wendeAenderungenAn(
      leer,
      aenderung({
        geaendert: [notiz('neu-gibtsnicht-1', 'x')],
        geloescht: ['neu-gibtsnicht-2', '999R', 'unbekannt']
      })
    )
    expect(await lies(bytes)).toEqual([])
  })

  it('Kennungen aus der Datei (Objektnummer) funktionieren wie bisher', async () => {
    const gespeichert = await wendeAenderungenAn(
      leer,
      aenderung({ neue: [notiz('neu-abc12345-1', 'wird per Objektnummer geloescht')] })
    )
    // Die Objektnummer, die die Datei der Annotation gab.
    const dokument = await PDFDocument.load(gespeichert)
    const ref = dokument.getPage(0).node.Annots()?.get(0)
    const nummer = ref !== undefined && 'objectNumber' in ref ? ref.objectNumber : -1
    const bytes = await wendeAenderungenAn(
      gespeichert,
      aenderung({ geloescht: [String(nummer) + 'R'] })
    )
    expect(await lies(bytes)).toEqual([])
  })
})
