import { describe, expect, it } from 'vitest'
import { migriere, vorgaben } from '../../src/main/settings/schema'
import {
  SCHEMA_VERSION,
  STANDARD_ANNOTATIONEN,
  STANDARD_ANSICHT,
  STANDARD_FENSTER,
  MAX_SITZUNG_TABS
} from '../../src/shared/settings'

describe('vorgaben', () => {
  it('traegt die aktuelle Schemaversion', () => {
    expect(vorgaben('nikita').schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('uebernimmt den vorgegebenen Autor', () => {
    expect(vorgaben('nikita').autorName).toBe('nikita')
  })

  it('beginnt mit einer leeren Sitzung', () => {
    expect(vorgaben('nikita').sitzung).toEqual({ tabs: [], aktiv: 0 })
  })
})

describe('migriere', () => {
  it('liest eine aktuelle Datei unveraendert', () => {
    const datei = {
      schemaVersion: SCHEMA_VERSION,
      autorName: 'a',
      fenster: { breite: 900, hoehe: 700, x: 10, y: 20, maximiert: true },
      zuletztGelesen: { 'C:/a.pdf': { seite: 5, zoom: 1.5 } },
      zuletztGeoeffnet: ['C:/a.pdf'],
      annotationen: { farbe: '#ff0000', strichstaerke: 3 },
      ansicht: { passung: 'seite' },
      sitzung: { tabs: ['C:/a.pdf', 'C:/b.pdf'], aktiv: 1 },
      sprache: 'en' as const
    }
    expect(migriere(datei, 'vorgabe')).toEqual({ art: 'ok', settings: datei, angehoben: false })
  })

  it('hebt eine Datei ohne Schemaversion an (Altfall Version 0)', () => {
    expect(migriere({ autorName: 'alt' }, 'vorgabe')).toEqual({
      art: 'ok',
      settings: {
        schemaVersion: SCHEMA_VERSION,
        autorName: 'alt',
        fenster: STANDARD_FENSTER,
        zuletztGelesen: {},
        zuletztGeoeffnet: [],
        annotationen: STANDARD_ANNOTATIONEN,
        ansicht: STANDARD_ANSICHT,
        sitzung: { tabs: [], aktiv: 0 },
        sprache: 'auto'
      },
      angehoben: true
    })
  })

  // Version 2 kannte die Liste der zuletzt geoeffneten Dokumente nicht. Sie
  // beginnt dann leer, der Rest der Datei bleibt erhalten.
  it('hebt eine Datei aus Version 2 an', () => {
    const ergebnis = migriere(
      {
        schemaVersion: 2,
        autorName: 'nikita',
        zuletztGelesen: { 'C:/a.pdf': { seite: 2, zoom: 1 } }
      },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.angehoben).toBe(true)
    expect(ergebnis.settings.zuletztGeoeffnet).toEqual([])
    expect(ergebnis.settings.zuletztGelesen).toEqual({ 'C:/a.pdf': { seite: 2, zoom: 1 } })
  })

  // Version 3 kannte die Vorgaben fuer Annotationen nicht (S2.2). Sie
  // bekommen die Standardwerte, der Rest der Datei bleibt erhalten.
  it('hebt eine Datei aus Version 3 an', () => {
    const ergebnis = migriere({ schemaVersion: 3, autorName: 'nikita' }, 'vorgabe')
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.angehoben).toBe(true)
    expect(ergebnis.settings.annotationen).toEqual(STANDARD_ANNOTATIONEN)
    expect(ergebnis.settings.autorName).toBe('nikita')
  })

  // Version 4 kannte die Vorgaben fuer die Ansicht nicht (S5.2a). Sie
  // bekommen die Standardwerte, der Rest der Datei bleibt erhalten.
  it('hebt eine Datei aus Version 4 an', () => {
    const ergebnis = migriere(
      {
        schemaVersion: 4,
        autorName: 'nikita',
        annotationen: { farbe: '#00ff00', strichstaerke: 1 }
      },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.angehoben).toBe(true)
    expect(ergebnis.settings.ansicht).toEqual(STANDARD_ANSICHT)
    expect(ergebnis.settings.annotationen).toEqual({ farbe: '#00ff00', strichstaerke: 1 })
  })

  // Version 5 kannte keine Sitzung (S6.1). Sie beginnt leer, der Rest der
  // Datei bleibt erhalten.
  it('hebt eine Datei aus Version 5 an', () => {
    const ergebnis = migriere(
      {
        schemaVersion: 5,
        autorName: 'nikita',
        zuletztGeoeffnet: ['C:/a.pdf'],
        ansicht: { passung: 'seite' }
      },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.angehoben).toBe(true)
    expect(ergebnis.settings.schemaVersion).toBe(SCHEMA_VERSION)
    expect(ergebnis.settings.sitzung).toEqual({ tabs: [], aktiv: 0 })
    expect(ergebnis.settings.zuletztGeoeffnet).toEqual(['C:/a.pdf'])
    expect(ergebnis.settings.ansicht).toEqual({ passung: 'seite' })
  })

  it.each([
    ['kein Objekt', 'kaputt'],
    ['eine Liste', ['C:/a.pdf']],
    ['null', null]
  ])('setzt eine unbrauchbare Sitzung (%s) auf leer', (_fall, sitzung) => {
    const ergebnis = migriere({ schemaVersion: SCHEMA_VERSION, sitzung }, 'vorgabe')
    expect(ergebnis.art === 'ok' && ergebnis.settings.sitzung).toEqual({ tabs: [], aktiv: 0 })
  })

  // Aus einer von Hand verdorbenen Liste bleiben die brauchbaren Pfade; ein
  // Index, der nicht mehr passt, zeigt auf den ersten Tab.
  it('uebernimmt aus der Sitzung nur brauchbare Pfade und einen passenden Index', () => {
    const ergebnis = migriere(
      {
        schemaVersion: SCHEMA_VERSION,
        sitzung: { tabs: ['C:/a.pdf', 42, '', null, 'C:/b.pdf'], aktiv: 3, fremd: true }
      },
      'vorgabe'
    )
    expect(ergebnis.art === 'ok' && ergebnis.settings.sitzung).toEqual({
      tabs: ['C:/a.pdf', 'C:/b.pdf'],
      aktiv: 0
    })
    const ohneListe = migriere(
      { schemaVersion: SCHEMA_VERSION, sitzung: { tabs: 'C:/a.pdf', aktiv: 1.5 } },
      'vorgabe'
    )
    expect(ohneListe.art === 'ok' && ohneListe.settings.sitzung).toEqual({ tabs: [], aktiv: 0 })
    const passend = migriere(
      { schemaVersion: SCHEMA_VERSION, sitzung: { tabs: ['C:/a.pdf', 'C:/b.pdf'], aktiv: 1 } },
      'vorgabe'
    )
    expect(passend.art === 'ok' && passend.settings.sitzung.aktiv).toBe(1)
  })

  it('kuerzt eine ueberlange Sitzung auf die Obergrenze', () => {
    const tabs = Array.from({ length: MAX_SITZUNG_TABS + 5 }, (_, i) => 'C:/d' + String(i) + '.pdf')
    const ergebnis = migriere(
      { schemaVersion: SCHEMA_VERSION, sitzung: { tabs, aktiv: 0 } },
      'vorgabe'
    )
    expect(ergebnis.art === 'ok' && ergebnis.settings.sitzung.tabs).toHaveLength(MAX_SITZUNG_TABS)
  })

  // Eine von Hand eingetragene Passung, die das Programm nicht kennt, darf
  // nicht bis in die Ansicht durchsickern.
  it('verwirft eine unbekannte Passung zugunsten der Vorgabe', () => {
    const ergebnis = migriere(
      { schemaVersion: SCHEMA_VERSION, ansicht: { passung: 'hoehe' } },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.settings.ansicht).toEqual(STANDARD_ANSICHT)
  })

  // Gate Phase 5, L1: von Hand eingetragene Zusatzschluessel bleiben draussen.
  it('uebernimmt aus Ansicht und Annotationen nur die bekannten Felder', () => {
    const ergebnis = migriere(
      {
        schemaVersion: SCHEMA_VERSION,
        ansicht: { passung: 'seite', fremd: 1 },
        annotationen: { farbe: '#112233', strichstaerke: 3, fremd: 2 }
      },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.settings.ansicht).toEqual({ passung: 'seite' })
    expect(ergebnis.settings.annotationen).toEqual({ farbe: '#112233', strichstaerke: 3 })
  })

  // Ganz oder gar nicht: eine halbe Angabe ergaebe eine Mischung aus fremder
  // Datei und Vorgabe, die niemand mehr nachvollzieht.
  it('verwirft halbe Annotationsvorgaben zugunsten der Standardwerte', () => {
    const ergebnis = migriere(
      { schemaVersion: SCHEMA_VERSION, annotationen: { farbe: 'blau' } },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.settings.annotationen).toEqual(STANDARD_ANNOTATIONEN)
  })

  // Das Feld kommt aus einer Datei, die auch von Hand bearbeitet sein kann.
  it('wirft untaugliche Eintraege aus der Pfadliste', () => {
    const ergebnis = migriere(
      { schemaVersion: 3, autorName: 'a', zuletztGeoeffnet: ['C:/gut.pdf', 42, null, 'C:/b.pdf'] },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.settings.zuletztGeoeffnet).toEqual(['C:/gut.pdf', 'C:/b.pdf'])
  })

  it('nimmt eine Pfadliste, die gar keine Liste ist, als leer', () => {
    const ergebnis = migriere({ schemaVersion: 3, zuletztGeoeffnet: 'C:/a.pdf' }, 'vorgabe')
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.settings.zuletztGeoeffnet).toEqual([])
  })

  // Der eigentliche Zweck der Migration: Version 1 kannte weder
  // Fenstergeometrie noch Lesepositionen. Beide bekommen Vorgaben, der
  // vorhandene Autorenname bleibt erhalten.
  it('hebt eine Datei aus Version 1 an', () => {
    const ergebnis = migriere({ schemaVersion: 1, autorName: 'nikita' }, 'vorgabe')
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(ergebnis.angehoben).toBe(true)
    expect(ergebnis.settings.autorName).toBe('nikita')
    expect(ergebnis.settings.fenster).toEqual(STANDARD_FENSTER)
    expect(ergebnis.settings.zuletztGelesen).toEqual({})
  })

  it('verwirft unbrauchbare Lesepositionen einzeln, statt alles zu verlieren', () => {
    const ergebnis = migriere(
      {
        schemaVersion: 2,
        autorName: 'a',
        zuletztGelesen: {
          'C:/gut.pdf': { seite: 3, zoom: 1 },
          'C:/kaputt.pdf': { seite: 'drei' },
          'C:/leer.pdf': null
        }
      },
      'vorgabe'
    )
    expect(ergebnis.art).toBe('ok')
    if (ergebnis.art !== 'ok') return
    expect(Object.keys(ergebnis.settings.zuletztGelesen)).toEqual(['C:/gut.pdf'])
  })

  it('faellt bei unbrauchbarer Geometrie auf die Vorgabe zurueck', () => {
    const ergebnis = migriere({ schemaVersion: 2, autorName: 'a', fenster: 'kaputt' }, 'vorgabe')
    expect(ergebnis.art === 'ok' && ergebnis.settings.fenster).toEqual(STANDARD_FENSTER)
  })

  it('faellt bei fehlendem Autor auf die Vorgabe zurueck', () => {
    const ergebnis = migriere({ schemaVersion: SCHEMA_VERSION }, 'vorgabe')
    expect(ergebnis.art === 'ok' && ergebnis.settings.autorName).toBe('vorgabe')
  })

  // Ohne diesen Fall wuerde eine aeltere Programmversion die Konfiguration
  // einer neueren beim naechsten Speichern zerstoeren.
  it('meldet eine neuere Schemaversion und verweigert das Zurueckschreiben', () => {
    const ergebnis = migriere({ schemaVersion: SCHEMA_VERSION + 5, autorName: 'x' }, 'vorgabe')
    expect(ergebnis).toEqual({ art: 'zukunft', gefundeneVersion: SCHEMA_VERSION + 5 })
  })

  it.each([[null], [42], ['text'], [['liste']]])('lehnt %s als Wurzel ab', (roh) => {
    expect(migriere(roh, 'vorgabe').art).toBe('vorgaben')
  })
})
