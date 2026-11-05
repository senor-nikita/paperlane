// @vitest-environment node
import { inflateSync } from 'node:zlib'
import { degrees, PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { STANDARD_DRUCKOPTIONEN } from '../../src/shared/druck'
import {
  beschreibeMutation,
  pruefeMutation,
  seiteNachMutation,
  seitenzahlNach,
  type Mutation
} from '../../src/shared/mutation'
import { baueDruckvorlage } from '../../src/main/druck'
import { wendeMutationAn } from '../../src/main/mutation'
import { leseKasten, schneide, sichtbarerKasten } from '../../src/main/zuschnitt'
import {
  berechneZuschnitte,
  raenderAusRahmen,
  type Raender
} from '../../src/renderer/src/viewer/zuschnitt'

/**
 * S6.3 im Main: die Mutation `seitenZuschneiden` setzt `/CropBox` - und nur
 * die. Gegenprobe mit pdf.js: was der Renderer aus seinen Raendern
 * ausrechnet, kommt als `PDFPageProxy.view` genau so zurueck, auch auf
 * gedrehten Seiten und bei vorhandener CropBox mit Ursprung ≠ 0,0.
 */

async function dokument(
  seiten: { groesse?: [number, number]; drehung?: number; crop?: number[] }[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const { groesse, drehung = 0, crop } of seiten) {
    const seite = doc.addPage(groesse ?? [600, 800])
    seite.drawText('Inhalt', { x: 50, y: 50, size: 12 })
    if (drehung !== 0) seite.setRotation(degrees(drehung))
    if (crop !== undefined) {
      seite.setCropBox(
        crop[0] ?? 0,
        crop[1] ?? 0,
        (crop[2] ?? 0) - (crop[0] ?? 0),
        (crop[3] ?? 0) - (crop[1] ?? 0)
      )
    }
    // Eine Notiz ganz ausserhalb jedes spaeteren Zuschnitts, eine innerhalb.
    const notiz = (rect: number[]): unknown =>
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: 'x' })
      )
    seite.node.set(
      PDFName.of('Annots'),
      doc.context.obj([notiz([1, 1, 21, 21]), notiz([300, 400, 320, 420])] as never)
    )
  }
  return doc.save()
}

async function cropBox(bytes: Uint8Array, seite = 1): Promise<number[] | null> {
  const doc = await PDFDocument.load(bytes)
  const kasten = leseKasten(doc.getPage(seite - 1), 'CropBox')
  return kasten === null ? null : [...kasten]
}

// pdf.js kalt zu laden dauert auf dem CI-Runner laenger als das Standardlimit von
// 5 s (CI #65) - einmal vorab, mit eigenem Limit, statt im ersten Test.
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs')
}, 60000)

async function pdfjsSicht(bytes: Uint8Array): Promise<{ view: number[]; rotate: number }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const auftrag = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await auftrag.promise
  try {
    const seiten = []
    for (let i = 1; i <= doc.numPages; i++) {
      const seite = await doc.getPage(i)
      seiten.push({ view: [...seite.view], rotate: seite.rotate })
    }
    return seiten
  } finally {
    await auftrag.destroy()
  }
}

function zuschneiden(seite: number, rahmen: [number, number, number, number] | null): Mutation {
  return { art: 'seitenZuschneiden', zuschnitte: [{ seite, rahmen }] }
}

describe('pruefeMutation seitenZuschneiden', () => {
  it('nimmt Rahmen und Aufheben an', () => {
    const mutation = {
      art: 'seitenZuschneiden',
      zuschnitte: [
        { seite: 2, rahmen: [1, 2, 3, 4] },
        { seite: 1, rahmen: null }
      ]
    }
    expect(pruefeMutation(mutation)).toEqual(mutation)
  })

  it.each([
    { zuschnitte: [] },
    { zuschnitte: 'alle' },
    { zuschnitte: [null] },
    { zuschnitte: [{ seite: '1', rahmen: null }] },
    { zuschnitte: [{ seite: 0, rahmen: null }] },
    { zuschnitte: [{ seite: 1, rahmen: [1, 2, 3] }] },
    { zuschnitte: [{ seite: 1, rahmen: [3, 2, 1, 4] }] },
    { zuschnitte: [{ seite: 1, rahmen: [1, 4, 3, 2] }] },
    { zuschnitte: [{ seite: 1, rahmen: [1, 2, Number.NaN, 4] }] },
    { zuschnitte: [{ seite: 1, rahmen: [1, 2, 3, '4'] }] },
    { zuschnitte: [{ seite: 1 }] },
    {
      zuschnitte: [
        { seite: 1, rahmen: null },
        { seite: 1, rahmen: null }
      ]
    }
  ])('lehnt %j ab', (rest) => {
    expect(pruefeMutation({ art: 'seitenZuschneiden', ...rest })).toBeNull()
  })

  it('beschreibt Zuschneiden und Aufheben', () => {
    expect(beschreibeMutation(zuschneiden(3, [0, 0, 20, 20]))).toBe('Seite 3 zuschneiden')
    expect(
      beschreibeMutation({
        art: 'seitenZuschneiden',
        zuschnitte: [
          { seite: 1, rahmen: [0, 0, 20, 20] },
          { seite: 2, rahmen: [0, 0, 20, 20] }
        ]
      })
    ).toBe('2 Seiten zuschneiden')
    expect(beschreibeMutation(zuschneiden(4, null))).toBe('Zuschnitt aufheben (Seite 4)')
  })

  it('aendert weder Seitenzahl noch aktuelle Seite', () => {
    const mutation = zuschneiden(2, [0, 0, 20, 20])
    expect(seitenzahlNach(5, mutation)).toBe(5)
    expect(seiteNachMutation(4, mutation, 5)).toBe(4)
  })
})

describe('wendeMutationAn seitenZuschneiden', () => {
  it('setzt die CropBox und laesst MediaBox, Inhalt und Anmerkungen stehen', async () => {
    const vorher = await dokument([{}])
    const nachher = await wendeMutationAn(vorher, zuschneiden(1, [100, 200, 500, 700]))
    expect(await cropBox(nachher)).toEqual([100, 200, 500, 700])
    const doc = await PDFDocument.load(nachher)
    const seite = doc.getPage(0)
    expect(leseKasten(seite, 'MediaBox')).toEqual([0, 0, 600, 800])
    // Beide Notizen bleiben, auch die ausserhalb, unverschoben (Aufgabe 4).
    const annots = seite.node.Annots()
    expect(annots?.size()).toBe(2)
    const rect = doc.context.lookup(annots?.get(0)) as unknown as {
      lookup: (n: PDFName) => unknown
    }
    const r = rect.lookup(PDFName.of('Rect')) as PDFArray
    expect(r.asArray().map((z) => (z as PDFNumber).asNumber())).toEqual([1, 1, 21, 21])
  })

  it('begrenzt auf die MediaBox - nie groesser als die Seite', async () => {
    const nachher = await wendeMutationAn(
      await dokument([{}]),
      zuschneiden(1, [-50, 100, 900, 700])
    )
    expect(await cropBox(nachher)).toEqual([0, 100, 600, 700])
  })

  it('lehnt einen Rahmen ausserhalb der Seite oder unter der Mindestkante ab', async () => {
    const bytes = await dokument([{}])
    await expect(wendeMutationAn(bytes, zuschneiden(1, [700, 0, 800, 100]))).rejects.toThrow(
      'Seite 1 liegt außerhalb'
    )
    await expect(wendeMutationAn(bytes, zuschneiden(1, [0, 0, 5, 100]))).rejects.toThrow(
      'außerhalb'
    )
    await expect(wendeMutationAn(bytes, zuschneiden(2, [0, 0, 50, 50]))).rejects.toThrow(
      'Seite 2 gibt es nicht'
    )
  })

  it('schneidet nichts halb: ein ungueltiger Eintrag verhindert alle', async () => {
    const bytes = await dokument([{}, {}])
    await expect(
      wendeMutationAn(bytes, {
        art: 'seitenZuschneiden',
        zuschnitte: [
          { seite: 1, rahmen: [0, 0, 100, 100] },
          { seite: 2, rahmen: [900, 900, 950, 950] }
        ]
      })
    ).rejects.toThrow('Seite 2')
  })

  it('"Zuschnitt aufheben" setzt die CropBox auf die MediaBox, auch bei geerbter', async () => {
    const zugeschnitten = await wendeMutationAn(
      await dokument([{ crop: [50, 50, 300, 300] }]),
      zuschneiden(1, null)
    )
    expect(await cropBox(zugeschnitten)).toEqual([0, 0, 600, 800])

    // Eine vom Seitenbaum geerbte CropBox: ohne eigenen Eintrag gaelte sie weiter.
    const doc = await PDFDocument.load(await dokument([{}]))
    doc.catalog.Pages().set(PDFName.of('CropBox'), doc.context.obj([10, 10, 200, 200]))
    const geerbt = await doc.save()
    expect(await cropBox(geerbt)).toEqual([10, 10, 200, 200])
    const aufgehoben = await wendeMutationAn(geerbt, zuschneiden(1, null))
    expect(await cropBox(aufgehoben)).toEqual([0, 0, 600, 800])
    expect((await pdfjsSicht(aufgehoben))[0]?.view).toEqual([0, 0, 600, 800])
  })

  it('liest verkehrt herum notierte Boxen sortiert', async () => {
    const doc = await PDFDocument.load(await dokument([{}]))
    doc.getPage(0).node.set(PDFName.of('MediaBox'), doc.context.obj([600, 800, 0, 0]))
    const bytes = await doc.save()
    const nachher = await wendeMutationAn(bytes, zuschneiden(1, [-10, 10, 100, 900]))
    expect(await cropBox(nachher)).toEqual([0, 10, 100, 800])
  })
})

describe('Gegenprobe mit pdf.js: gedreht und mit versetzter CropBox', () => {
  const RAENDER: Raender = { links: 10, oben: 20, rechts: 30, unten: 40 }

  it.each([0, 90, 180, 270])(
    'Raender bei /Rotate %i ergeben die erwartete Sicht und laufen zurueck',
    async (drehung) => {
      const bytes = await dokument([{ drehung, crop: [100, 50, 500, 750] }])
      const [vorher] = await pdfjsSicht(bytes)
      expect(vorher?.view).toEqual([100, 50, 500, 750])
      const quelle = {
        getPage: () => Promise.resolve({ view: vorher?.view ?? [], rotate: drehung })
      }
      const ergebnis = await berechneZuschnitte(quelle, [1], RAENDER, 0)
      if (!('zuschnitte' in ergebnis)) throw new Error(ergebnis.fehler)
      const nachher = await wendeMutationAn(bytes, {
        art: 'seitenZuschneiden',
        zuschnitte: ergebnis.zuschnitte
      })
      const [sicht] = await pdfjsSicht(nachher)
      expect(sicht?.rotate).toBe(drehung)
      expect(sicht?.view).toEqual(ergebnis.zuschnitte[0]?.rahmen)
      // Aus der neuen Sicht gerechnet: dieselben Raender relativ zur alten Box.
      const zurueck = raenderAusRahmen(vorher?.view ?? [], drehung, sicht?.view as never)
      expect(zurueck).toEqual(RAENDER)
    }
  )
})

describe('Druckvorlage zeigt den Zuschnitt (S4.3 geprueft, nicht angenommen)', () => {
  it('behaelt die CropBox ohne "An Seite anpassen"', async () => {
    const bytes = await wendeMutationAn(await dokument([{}]), zuschneiden(1, [100, 200, 500, 700]))
    const vorlage = await baueDruckvorlage(bytes, { ...STANDARD_DRUCKOPTIONEN, anpassen: false })
    expect(await cropBox(vorlage.bytes)).toEqual([100, 200, 500, 700])
  })

  it('zeigt mit "An Seite anpassen" nur den Zuschnitt, skaliert und beschnitten', async () => {
    // Seite 1 bestimmt das Blatt (600 x 800), Seite 2 ist auf 400 x 400 zugeschnitten.
    const bytes = await wendeMutationAn(
      await dokument([{}, {}]),
      zuschneiden(2, [100, 300, 500, 700])
    )
    const vorlage = await baueDruckvorlage(bytes, STANDARD_DRUCKOPTIONEN)
    const doc = await PDFDocument.load(vorlage.bytes)
    const seite = doc.getPage(1)
    const sicht = sichtbarerKasten(seite)
    // Faktor 1,5 (600 / 400): der Zuschnitt [150, 450, 750, 1050] mittig auf 600 x 800.
    expect(sicht[2] - sicht[0]).toBeCloseTo(600, 3)
    expect(sicht[3] - sicht[1]).toBeCloseTo(800, 3)
    expect(sicht[0]).toBeCloseTo(150, 3)
    expect(sicht[1]).toBeCloseTo(350, 3)
    // Der Inhalt ist auf den Zuschnitt beschnitten: der erste Inhaltsstrom
    // setzt den Clip-Pfad.
    const inhalte = seite.node.Contents()
    expect(inhalte).toBeInstanceOf(PDFArray)
    const erster = doc.context.lookup((inhalte as PDFArray).get(0))
    expect(erster).toBeInstanceOf(PDFRawStream)
    const text = inflateSync((erster as PDFRawStream).contents).toString('latin1')
    expect(text).toMatch(/150 450 600 600 re\s+W\s+n/)
    // Die Notiz ganz ausserhalb faellt aus der Vorlage, die innerhalb bleibt.
    expect(seite.node.Annots()?.size()).toBe(1)
    // Seite 1 ohne Zuschnitt bleibt unbeschnitten und behaelt beide Notizen.
    expect(doc.getPage(0).node.Annots()?.size()).toBe(2)
    // Das Dokument selbst ist unberuehrt.
    expect(await cropBox(bytes, 2)).toEqual([100, 300, 500, 700])
  })

  it('richtet eine quer zugeschnittene Seite nach ihrem Zuschnitt aus', async () => {
    // Hochkante MediaBox, querer Zuschnitt: "hochkant" muss drehen.
    const bytes = await wendeMutationAn(await dokument([{}]), zuschneiden(1, [0, 0, 600, 300]))
    const vorlage = await baueDruckvorlage(bytes, {
      ...STANDARD_DRUCKOPTIONEN,
      ausrichtung: 'hochkant',
      anpassen: false
    })
    const doc = await PDFDocument.load(vorlage.bytes)
    expect(doc.getPage(0).getRotation().angle).toBe(90)
  })
})

describe('schneide', () => {
  it('liefert die Schnittmenge oder null', () => {
    expect(schneide([0, 0, 10, 10], [5, 5, 20, 20])).toEqual([5, 5, 10, 10])
    expect(schneide([0, 0, 10, 10], [10, 0, 20, 10])).toBeNull()
  })
})
