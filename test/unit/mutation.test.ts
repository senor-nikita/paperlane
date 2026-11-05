import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'
import {
  beschreibeMutation,
  pruefeMutation,
  reihenfolgeNachVerschieben,
  seiteNachMutation,
  seitenzahlNach,
  type Mutation
} from '../../src/shared/mutation'
import { wendeMutationAn } from '../../src/main/mutation'
import { wendeAenderungenAn } from '../../src/main/schreibpfad'
import {
  aktuellerStand,
  anzahlStaende,
  arbeitskopie,
  brauchtPlattenstand,
  DATEI_STAND,
  hatArbeitskopie,
  istSauber,
  merkeGespeichert,
  merkeStand,
  setzeArbeitskopienZurueck,
  stelleStandHer,
  vergissArbeitskopie
} from '../../src/main/arbeitskopie'

/**
 * Die Mutationspipeline (S4.0), electron-freier Teil: die Pruefung des
 * Auftrags, die Seitenrechnung fuer die Ansicht, das Anwenden mit pdf-lib
 * und die Arbeitskopie. Der Handler und der Renderer haben eigene Tests.
 */
let mehrseitig: Uint8Array

beforeAll(async () => {
  mehrseitig = new Uint8Array(await readFile(resolve('test/fixtures/large-500.pdf')))
})

describe('pruefeMutation', () => {
  it('nimmt die drei Arten mit einsbasierten, eindeutigen Seiten an', () => {
    expect(pruefeMutation({ art: 'seitenLoeschen', seiten: [3, 1] })).toEqual({
      art: 'seitenLoeschen',
      seiten: [3, 1]
    })
    expect(pruefeMutation({ art: 'seitenDrehen', seiten: [2], grad: 90 })).toEqual({
      art: 'seitenDrehen',
      seiten: [2],
      grad: 90
    })
    expect(pruefeMutation({ art: 'seitenAnordnen', reihenfolge: [2, 1, 3] })).toEqual({
      art: 'seitenAnordnen',
      reihenfolge: [2, 1, 3]
    })
  })

  it('lehnt alles ab, was keine saubere Seitenliste ist', () => {
    expect(pruefeMutation({ art: 'seitenLoeschen', seiten: [] })).toBeNull()
    expect(pruefeMutation({ art: 'seitenLoeschen', seiten: [0] })).toBeNull()
    expect(pruefeMutation({ art: 'seitenLoeschen', seiten: [1.5] })).toBeNull()
    expect(pruefeMutation({ art: 'seitenLoeschen', seiten: ['3'] })).toBeNull()
    expect(pruefeMutation({ art: 'seitenLoeschen', seiten: [2, 2] })).toBeNull()
    expect(pruefeMutation({ art: 'seitenLoeschen', seite: 3 })).toBeNull()
    expect(pruefeMutation({ art: 'seitenDrehen', seiten: [1], grad: 45 })).toBeNull()
    expect(pruefeMutation({ art: 'seitenDrehen', seiten: [1] })).toBeNull()
    expect(pruefeMutation({ art: 'seiteLoeschen', seite: 1 })).toBeNull()
    expect(pruefeMutation(null)).toBeNull()
    expect(pruefeMutation('seitenLoeschen')).toBeNull()
  })

  it('beschreibt die Mutation fuer Hinweis, Fortschritt und Historie', () => {
    expect(beschreibeMutation({ art: 'seitenLoeschen', seiten: [7] })).toBe('Seite 7 löschen')
    expect(beschreibeMutation({ art: 'seitenLoeschen', seiten: [7, 9] })).toBe('2 Seiten löschen')
    expect(beschreibeMutation({ art: 'seitenDrehen', seiten: [2], grad: 90 })).toBe(
      'Seite 2 um 90° drehen'
    )
    expect(beschreibeMutation({ art: 'seitenAnordnen', reihenfolge: [2, 1] })).toBe(
      'Seiten neu anordnen'
    )
  })

  it('kennt die Seitenzahl nach der Mutation', () => {
    expect(seitenzahlNach(10, { art: 'seitenLoeschen', seiten: [1, 2, 3] })).toBe(7)
    expect(seitenzahlNach(10, { art: 'seitenDrehen', seiten: [1], grad: 180 })).toBe(10)
    expect(seitenzahlNach(3, { art: 'seitenAnordnen', reihenfolge: [3, 2, 1] })).toBe(3)
  })
})

describe('seiteNachMutation', () => {
  const loesche = (...seiten: number[]): Mutation => ({ art: 'seitenLoeschen', seiten })
  it('rueckt die Zaehlung vor, wenn Seiten davor fallen', () => {
    expect(seiteNachMutation(5, loesche(2), 9)).toBe(4)
    expect(seiteNachMutation(5, loesche(1, 2, 8), 7)).toBe(3)
  })
  it('bleibt stehen, wenn eine Seite danach faellt', () => {
    expect(seiteNachMutation(5, loesche(8), 9)).toBe(5)
  })
  it('zeigt die nachrueckende Seite, wenn die aktuelle faellt', () => {
    expect(seiteNachMutation(5, loesche(5), 9)).toBe(5)
  })
  it('faellt auf die letzte zurueck, wenn die letzte faellt', () => {
    expect(seiteNachMutation(10, loesche(10), 9)).toBe(9)
  })
  it('liefert mindestens 1', () => {
    expect(seiteNachMutation(1, loesche(1), 1)).toBe(1)
    expect(seiteNachMutation(1, loesche(1), 0)).toBe(1)
  })
  it('folgt der Seite an ihren neuen Platz beim Anordnen', () => {
    expect(seiteNachMutation(1, { art: 'seitenAnordnen', reihenfolge: [3, 2, 1] }, 3)).toBe(3)
    expect(seiteNachMutation(2, { art: 'seitenAnordnen', reihenfolge: [3, 2, 1] }, 3)).toBe(2)
  })
  it('bleibt beim Drehen, wo sie ist', () => {
    expect(seiteNachMutation(4, { art: 'seitenDrehen', seiten: [4], grad: 90 }, 9)).toBe(4)
  })
})

describe('reihenfolgeNachVerschieben', () => {
  it('schiebt eine Seite vor eine andere', () => {
    expect(reihenfolgeNachVerschieben(5, [4], 2)).toEqual([1, 4, 2, 3, 5])
  })
  it('schiebt mehrere Seiten gemeinsam und in Dokumentreihenfolge ans Ende', () => {
    expect(reihenfolgeNachVerschieben(5, [3, 1], 6)).toEqual([2, 4, 5, 1, 3])
  })
  it('schiebt nach hinten, wenn das Ziel hinter der Quelle liegt', () => {
    expect(reihenfolgeNachVerschieben(5, [2], 5)).toEqual([1, 3, 4, 2, 5])
  })
  it('liefert null, wenn sich nichts aendert', () => {
    expect(reihenfolgeNachVerschieben(5, [2], 2)).toBeNull()
    expect(reihenfolgeNachVerschieben(5, [2], 3)).toBeNull()
    expect(reihenfolgeNachVerschieben(5, [1, 2], 1)).toBeNull()
  })
})

describe('wendeMutationAn', () => {
  it('loescht genau die genannte Seite', async () => {
    const vorher = await PDFDocument.load(mehrseitig)
    const seiten = vorher.getPageCount()
    const bytes = await wendeMutationAn(mehrseitig, { art: 'seitenLoeschen', seiten: [2] })
    const nachher = await PDFDocument.load(bytes)
    expect(nachher.getPageCount()).toBe(seiten - 1)
  })

  it('lehnt eine Seite ab, die es nicht gibt', async () => {
    await expect(
      wendeMutationAn(mehrseitig, { art: 'seitenLoeschen', seiten: [100000] })
    ).rejects.toThrow(/gibt es nicht/)
  })

  it('laesst die letzte Seite stehen', async () => {
    const einseitig = new Uint8Array(await readFile(resolve('test/fixtures/single-page.pdf')))
    await expect(
      wendeMutationAn(einseitig, { art: 'seitenLoeschen', seiten: [1] })
    ).rejects.toThrow(/letzte Seite/)
  })

  /**
   * Aufgabe 3, der Teil, den der Main verantwortet: eine ungespeicherte
   * Anmerkung wird **vor** der Mutation eingespielt und ueberlebt sie - auf
   * der richtigen Seite, auch wenn sich deren Nummer verschiebt.
   */
  it('behaelt eingespielte Anmerkungen, verschoben um die geloeschte Seite', async () => {
    const annotation: Annotation = {
      id: 'neu-1',
      seite: 3,
      typ: 'Text',
      subtyp: 'Text',
      rect: [70, 700, 90, 720],
      quadPoints: null,
      striche: null,
      farbe: { r: 255, g: 212, b: 0 },
      strichstaerke: null,
      opazitaet: 1,
      autor: 'Testperson',
      inhalt: 'ueberlebt die Mutation',
      erstellt: null,
      geaendert: null,
      versteckt: false,
      ziel: null,
      roh: null
    }
    const aenderungen: Aenderungen = { neue: [annotation], geaendert: [], geloescht: [] }
    const mitAnmerkung = await wendeAenderungenAn(mehrseitig, aenderungen)
    const bytes = await wendeMutationAn(mitAnmerkung, { art: 'seitenLoeschen', seiten: [1] })
    const dokument = await PDFDocument.load(bytes)
    // Seite 3 ist jetzt Seite 2.
    const annots = dokument.getPage(1).node.Annots()
    expect(annots).toBeDefined()
    const inhalte: string[] = []
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const dict = annots?.lookup(i, PDFDict)
      const wert = dict?.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)
      if (wert !== undefined) inhalte.push(wert.decodeText())
    }
    expect(inhalte).toContain('ueberlebt die Mutation')
    expect(dokument.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
  })
})

describe('wendeMutationAn (S4.1)', () => {
  it('loescht mehrere Seiten auf einmal, in beliebiger Reihenfolge genannt', async () => {
    const vorher = (await PDFDocument.load(mehrseitig)).getPageCount()
    const bytes = await wendeMutationAn(mehrseitig, { art: 'seitenLoeschen', seiten: [5, 1, 3] })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(vorher - 3)
  })

  it('lehnt es ab, alle Seiten zu loeschen', async () => {
    const zwei = await zweiSeiten()
    await expect(wendeMutationAn(zwei, { art: 'seitenLoeschen', seiten: [1, 2] })).rejects.toThrow(
      /letzte Seite/
    )
  })

  it('dreht dauerhaft und additiv', async () => {
    const einmal = await wendeMutationAn(mehrseitig, { art: 'seitenDrehen', seiten: [1], grad: 90 })
    expect((await PDFDocument.load(einmal)).getPage(0).getRotation().angle).toBe(90)
    const zweimal = await wendeMutationAn(einmal, { art: 'seitenDrehen', seiten: [1], grad: 270 })
    const doc = await PDFDocument.load(zweimal)
    expect(doc.getPage(0).getRotation().angle).toBe(0)
    // Nur die genannte Seite.
    expect(doc.getPage(1).getRotation().angle).toBe(0)
  })

  /**
   * Aufgabe 3: Anmerkungen folgen ihrer Seite. annotated.pdf traegt auf
   * Seite 1 Anmerkungen und auf Seite 2 keine; nach dem Tausch muss Seite 2
   * sie tragen.
   */
  it('ordnet Seiten neu an, und die Anmerkungen wandern mit', async () => {
    const annotiert = new Uint8Array(await readFile(resolve('test/fixtures/annotated.pdf')))
    const vorher = await PDFDocument.load(annotiert)
    const anzahlSeite1 = vorher.getPage(0).node.Annots()?.size() ?? 0
    expect(anzahlSeite1).toBeGreaterThan(0)
    expect(vorher.getPageCount()).toBe(2)

    const bytes = await wendeMutationAn(annotiert, { art: 'seitenAnordnen', reihenfolge: [2, 1] })
    const nachher = await PDFDocument.load(bytes)
    expect(nachher.getPageCount()).toBe(2)
    expect(nachher.getPage(1).node.Annots()?.size() ?? 0).toBe(anzahlSeite1)
    expect(nachher.getPage(0).node.Annots()?.size() ?? 0).toBe(
      vorher.getPage(1).node.Annots()?.size() ?? 0
    )
  })

  it('lehnt eine Reihenfolge ab, die nicht alle Seiten nennt', async () => {
    await expect(
      wendeMutationAn(mehrseitig, { art: 'seitenAnordnen', reihenfolge: [1, 2] })
    ).rejects.toThrow(/nennt 2 Seiten/)
  })

  /**
   * Aufgabe 3, Formulare: faellt die Seite mit den Widgets, faellt das Feld
   * aus dem AcroForm - sonst bliebe dort ein Feld ohne Erscheinung, das jeder
   * Formularexport und jedes Flachlegen ueber die Fuesse faellt.
   */
  it('entfernt Formularfelder, deren Seite geloescht wurde', async () => {
    const formular = await PDFDocument.load(
      new Uint8Array(await readFile(resolve('test/fixtures/acroform.pdf')))
    )
    const felderVorher = formular.getForm().getFields().length
    expect(felderVorher).toBeGreaterThan(0)
    // Eine leere Seite hinten anhaengen, dann die Formularseite loeschen.
    formular.addPage()
    const zweiseitig = await formular.save()
    const bytes = await wendeMutationAn(zweiseitig, { art: 'seitenLoeschen', seiten: [1] })
    const nachher = await PDFDocument.load(bytes)
    expect(nachher.getPageCount()).toBe(1)
    expect(nachher.getForm().getFields()).toHaveLength(0)
  })

  it('behaelt Formularfelder, deren Seite bleibt', async () => {
    const formular = await PDFDocument.load(
      new Uint8Array(await readFile(resolve('test/fixtures/acroform.pdf')))
    )
    const felderVorher = formular.getForm().getFields().length
    formular.addPage()
    const zweiseitig = await formular.save()
    const bytes = await wendeMutationAn(zweiseitig, { art: 'seitenLoeschen', seiten: [2] })
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(felderVorher)
  })
})

async function zweiSeiten(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(mehrseitig)
  while (doc.getPageCount() > 2) doc.removePage(doc.getPageCount() - 1)
  return doc.save()
}

describe('Arbeitskopie und Staende', () => {
  const pfad = 'C:\\dokumente\\a.pdf'
  const bytes = (n: number): Uint8Array => new Uint8Array([n])

  it('haelt die aktuelle Fassung je Pfad, bis sie vergessen wird', () => {
    setzeArbeitskopienZurueck()
    expect(hatArbeitskopie(pfad)).toBe(false)
    expect(aktuellerStand(pfad)).toBe(DATEI_STAND)
    const stand = merkeStand(pfad, bytes(1))
    expect(stand).toBe(1)
    expect(arbeitskopie(pfad)).toEqual(bytes(1))
    expect(aktuellerStand(pfad)).toBe(1)
    expect(hatArbeitskopie('C:\\dokumente\\b.pdf')).toBe(false)
    vergissArbeitskopie(pfad)
    expect(arbeitskopie(pfad)).toBeUndefined()
    expect(aktuellerStand(pfad)).toBe(DATEI_STAND)
  })

  /**
   * S4.1: Rueckgaengig ueber Staende. Stand 0 ist die Datei (null = "lies
   * die Platte"); ein gemerkter Stand kommt als Bytes zurueck; ein nie
   * gemerkter als undefined.
   */
  it('stellt fruehere und spaetere Staende wieder her', () => {
    setzeArbeitskopienZurueck()
    const s1 = merkeStand(pfad, bytes(1))
    const s2 = merkeStand(pfad, bytes(2))
    expect(anzahlStaende(pfad)).toBe(2)
    expect(stelleStandHer(pfad, s1)).toEqual(bytes(1))
    expect(aktuellerStand(pfad)).toBe(s1)
    expect(arbeitskopie(pfad)).toEqual(bytes(1))
    expect(stelleStandHer(pfad, DATEI_STAND)).toBeNull()
    expect(hatArbeitskopie(pfad)).toBe(false)
    expect(stelleStandHer(pfad, s2)).toEqual(bytes(2))
    expect(stelleStandHer(pfad, 99)).toBeUndefined()
    // Ein nicht vorhandener Stand aendert den aktuellen nicht.
    expect(aktuellerStand(pfad)).toBe(s2)
  })

  /**
   * S7: Rueckgaengig ueber das Speichern hinaus. Das Speichern haelt die
   * Staende, die geschriebenen Bytes werden ein neuer Stand und sind die Platte.
   */
  describe('Speichern haelt die Staende', () => {
    it('macht die geschriebenen Bytes zur Platte und behaelt die Staende davor', () => {
      setzeArbeitskopienZurueck()
      const s1 = merkeStand(pfad, bytes(1))
      expect(istSauber(pfad)).toBe(false)
      expect(brauchtPlattenstand(pfad)).toBe(true)

      merkeGespeichert(pfad, pfad, bytes(9), bytes(0))

      // Sauber: der aktuelle Stand ist die Platte, es gibt nichts zu schreiben.
      expect(istSauber(pfad)).toBe(true)
      expect(hatArbeitskopie(pfad)).toBe(false)
      expect(brauchtPlattenstand(pfad)).toBe(false)
      // Stand 0 gibt es jetzt als Bytes - die Platte ist ueberschrieben.
      const gespeichert = aktuellerStand(pfad)
      expect(stelleStandHer(pfad, DATEI_STAND)).toEqual(bytes(0))
      expect(istSauber(pfad)).toBe(false)
      expect(arbeitskopie(pfad)).toEqual(bytes(0))
      expect(stelleStandHer(pfad, s1)).toEqual(bytes(1))
      // Der gespeicherte Stand ist wieder die Platte.
      expect(stelleStandHer(pfad, gespeichert)).toEqual(bytes(9))
      expect(istSauber(pfad)).toBe(true)
      vergissArbeitskopie(pfad)
    })

    it('hat ohne Mutation nichts zu behalten', () => {
      setzeArbeitskopienZurueck()
      expect(brauchtPlattenstand(pfad)).toBe(false)
      merkeGespeichert(pfad, pfad, bytes(9), bytes(0))
      expect(anzahlStaende(pfad)).toBe(0)
      expect(istSauber(pfad)).toBe(true)
      expect(stelleStandHer(pfad, DATEI_STAND)).toBeNull()
    })

    it('legt den Stand 0 nur beim ersten Speichern fest', () => {
      setzeArbeitskopienZurueck()
      merkeStand(pfad, bytes(1))
      merkeGespeichert(pfad, pfad, bytes(9), bytes(0))
      merkeStand(pfad, bytes(2))
      // Ein zweites Speichern bringt andere "Plattenbytes" mit: Stand 0 bleibt die erste Datei.
      merkeGespeichert(pfad, pfad, bytes(8), bytes(7))
      expect(stelleStandHer(pfad, DATEI_STAND)).toEqual(bytes(0))
      vergissArbeitskopie(pfad)
    })

    it('zieht bei "Speichern unter" auf den neuen Pfad um', () => {
      setzeArbeitskopienZurueck()
      const neu = 'C:\\dokumente\\neu.pdf'
      const s1 = merkeStand(pfad, bytes(1))
      merkeGespeichert(pfad, neu, bytes(9), bytes(0))
      expect(anzahlStaende(pfad)).toBe(0)
      expect(istSauber(neu)).toBe(true)
      expect(stelleStandHer(neu, s1)).toEqual(bytes(1))
      expect(stelleStandHer(neu, DATEI_STAND)).toEqual(bytes(0))
      vergissArbeitskopie(neu)
    })

    it('verliert den Stand 0 ehrlich an das Budget, statt falsche Bytes zu liefern', () => {
      setzeArbeitskopienZurueck()
      const gross = (): Uint8Array => new Uint8Array(Math.ceil(512 * 1024 * 1024 * 0.4))
      merkeStand(pfad, gross())
      merkeGespeichert(pfad, pfad, gross(), gross())
      merkeStand(pfad, gross())
      // Der aelteste Stand - die Platte von vorher - ist dem Budget zum Opfer gefallen.
      expect(stelleStandHer(pfad, DATEI_STAND)).toBeUndefined()
      vergissArbeitskopie(pfad)
    })
  })

  it('haelt das Byte-Budget und laesst den aktuellen Stand immer stehen', () => {
    setzeArbeitskopienZurueck()
    // Drei Staende von je ~40 % des Budgets: der erste faellt beim dritten.
    const gross = (): Uint8Array => new Uint8Array(Math.ceil(512 * 1024 * 1024 * 0.4))
    const s1 = merkeStand(pfad, gross())
    merkeStand(pfad, gross())
    expect(anzahlStaende(pfad)).toBe(2)
    merkeStand(pfad, gross())
    expect(anzahlStaende(pfad)).toBe(2)
    expect(stelleStandHer(pfad, s1)).toBeUndefined()
    vergissArbeitskopie(pfad)
  })
})
