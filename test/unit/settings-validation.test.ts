import { describe, expect, it } from 'vitest'
import {
  MAX_LESEPOSITIONEN,
  MAX_SITZUNG_PFADLAENGE,
  MAX_SITZUNG_TABS,
  MAX_ZULETZT_GEOEFFNET,
  pruefePatch
} from '../../src/shared/settings'

/**
 * Diese Pruefung laeuft im Main-Prozess ueber Eingaben aus dem Renderer. Der
 * Renderer ist eine Sandbox fuer fremde Dokumente — seine Nachrichten sind
 * nicht vertrauenswuerdig.
 */
describe('pruefePatch', () => {
  it('nimmt eine gueltige Aenderung an', () => {
    expect(pruefePatch({ autorName: 'Nikita' })).toEqual({
      gueltig: true,
      patch: { autorName: 'Nikita' }
    })
  })

  it('lehnt unbekannte Schluessel ab und nennt sie', () => {
    const ergebnis = pruefePatch({ istAdmin: true })
    expect(ergebnis.gueltig).toBe(false)
    expect(ergebnis.gueltig === false && ergebnis.grund).toContain('istAdmin')
  })

  it('lehnt eine Mischung aus bekanntem und unbekanntem Schluessel ab', () => {
    expect(pruefePatch({ autorName: 'a', schadhaft: 1 }).gueltig).toBe(false)
  })

  it.each([[null], [42], ['text'], [['liste']], [undefined]])('lehnt %s als Wurzel ab', (roh) => {
    expect(pruefePatch(roh).gueltig).toBe(false)
  })

  it('lehnt eine leere Aenderung ab', () => {
    expect(pruefePatch({}).gueltig).toBe(false)
  })

  it('lehnt einen falschen Werttyp ab', () => {
    expect(pruefePatch({ autorName: 42 }).gueltig).toBe(false)
  })

  it('begrenzt die Laenge', () => {
    expect(pruefePatch({ autorName: 'x'.repeat(201) }).gueltig).toBe(false)
    expect(pruefePatch({ autorName: 'x'.repeat(200) }).gueltig).toBe(true)
  })
})

describe('pruefePatch fuer Fenstergeometrie', () => {
  const gueltig = { breite: 800, hoehe: 600, x: 10, y: 20, maximiert: false }

  it('nimmt eine vollstaendige Geometrie an', () => {
    expect(pruefePatch({ fenster: gueltig })).toEqual({
      gueltig: true,
      patch: { fenster: gueltig }
    })
  })

  it('erlaubt null fuer die Lage (erster Start ohne gemerkte Position)', () => {
    expect(pruefePatch({ fenster: { ...gueltig, x: null, y: null } }).gueltig).toBe(true)
  })

  it.each([
    [{ ...gueltig, breite: 'breit' }],
    [{ ...gueltig, maximiert: 'ja' }],
    [{ breite: 800 }],
    ['keine Geometrie'],
    [null]
  ])('lehnt %o ab', (wert) => {
    expect(pruefePatch({ fenster: wert }).gueltig).toBe(false)
  })

  it('lehnt unendliche Werte ab', () => {
    expect(pruefePatch({ fenster: { ...gueltig, breite: Number.POSITIVE_INFINITY } }).gueltig).toBe(
      false
    )
  })
})

describe('pruefePatch fuer Lesepositionen', () => {
  it('nimmt gueltige Eintraege an', () => {
    const wert = { 'C:/a.pdf': { seite: 3, zoom: 1.5 } }
    expect(pruefePatch({ zuletztGelesen: wert })).toEqual({
      gueltig: true,
      patch: { zuletztGelesen: wert }
    })
  })

  it('nimmt eine leere Sammlung an', () => {
    expect(pruefePatch({ zuletztGelesen: {} }).gueltig).toBe(true)
  })

  it.each([
    [{ 'C:/a.pdf': { seite: 'drei', zoom: 1 } }],
    [{ 'C:/a.pdf': { seite: 3 } }],
    [{ 'C:/a.pdf': null }],
    [['liste']]
  ])('lehnt %o ab', (wert) => {
    expect(pruefePatch({ zuletztGelesen: wert }).gueltig).toBe(false)
  })

  // Ohne Grenze waechst die Einstellungsdatei mit jedem je geoeffneten
  // Dokument.
  it('lehnt zu viele Eintraege ab', () => {
    const zuViele = Object.fromEntries(
      Array.from({ length: MAX_LESEPOSITIONEN + 1 }, (_, i) => [
        'C:/' + String(i) + '.pdf',
        { seite: 1, zoom: 1 }
      ])
    )
    expect(pruefePatch({ zuletztGelesen: zuViele }).gueltig).toBe(false)
  })
})

describe('pruefePatch fuer zuletztGeoeffnet', () => {
  it('nimmt eine Liste von Pfaden an', () => {
    const ergebnis = pruefePatch({ zuletztGeoeffnet: ['C:/a.pdf', 'C:/b.pdf'] })
    expect(ergebnis.gueltig).toBe(true)
    if (!ergebnis.gueltig) return
    expect(ergebnis.patch.zuletztGeoeffnet).toEqual(['C:/a.pdf', 'C:/b.pdf'])
  })

  it('nimmt eine leere Liste an', () => {
    expect(pruefePatch({ zuletztGeoeffnet: [] }).gueltig).toBe(true)
  })

  it.each([[{ '0': 'C:/a.pdf' }], ['C:/a.pdf'], [['C:/a.pdf', 42]], [[null]], [42]])(
    'lehnt %o ab',
    (wert) => {
      expect(pruefePatch({ zuletztGeoeffnet: wert }).gueltig).toBe(false)
    }
  )

  // Ohne Grenze waechst die Einstellungsdatei mit jedem je geoeffneten Dokument.
  it('lehnt zu viele Eintraege ab', () => {
    const zuViele = Array.from(
      { length: MAX_ZULETZT_GEOEFFNET + 1 },
      (_, i) => 'C:/' + String(i) + '.pdf'
    )
    expect(pruefePatch({ zuletztGeoeffnet: zuViele }).gueltig).toBe(false)
  })
})

describe('pruefePatch fuer die Ansicht', () => {
  it.each([['frei'], ['breite'], ['seite']])('nimmt die Passung %s an', (passung) => {
    expect(pruefePatch({ ansicht: { passung } })).toEqual({
      gueltig: true,
      patch: { ansicht: { passung } }
    })
  })

  // Der Renderer ist eine Sandbox: eine erfundene Passung darf die
  // Einstellungsdatei nicht erreichen, sonst liest sie die Ansicht spaeter.
  it.each([[{ passung: 'hoehe' }], [{ passung: 1 }], [{}], ['breite'], [null]])(
    'lehnt %o ab',
    (wert) => {
      expect(pruefePatch({ ansicht: wert }).gueltig).toBe(false)
    }
  )

  // Gate Phase 5, L1: gueltig heisst nicht "alles mitnehmen". Zusatzschluessel
  // aus dem Renderer reisten sonst bis in die Einstellungsdatei.
  it('uebernimmt nur die bekannten Felder', () => {
    expect(
      pruefePatch({
        ansicht: { passung: 'seite', fremd: 'x' },
        annotationen: { farbe: '#112233', strichstaerke: 2, fremd: 'y' }
      })
    ).toEqual({
      gueltig: true,
      patch: {
        ansicht: { passung: 'seite' },
        annotationen: { farbe: '#112233', strichstaerke: 2 }
      }
    })
  })
})

/**
 * Die Sitzung (S6.1): Pfade der offenen Tabs und der Index des aktiven. Sie
 * kommt vom Renderer und landet in der Einstellungsdatei; beim naechsten
 * Start werden die Pfade ueber `dokumentOeffnePfad` geprueft.
 */
describe('pruefePatch fuer die Sitzung', () => {
  it('nimmt eine gueltige Sitzung an und uebernimmt nur die bekannten Felder', () => {
    expect(
      pruefePatch({ sitzung: { tabs: ['C:/a.pdf', 'C:/b.pdf'], aktiv: 1, fremd: 'x' } })
    ).toEqual({
      gueltig: true,
      patch: { sitzung: { tabs: ['C:/a.pdf', 'C:/b.pdf'], aktiv: 1 } }
    })
  })

  it('nimmt eine leere Sitzung nur mit aktiv 0 an', () => {
    expect(pruefePatch({ sitzung: { tabs: [], aktiv: 0 } }).gueltig).toBe(true)
    expect(pruefePatch({ sitzung: { tabs: [], aktiv: 1 } }).gueltig).toBe(false)
  })

  it.each([
    [null],
    ['C:/a.pdf'],
    [['C:/a.pdf']],
    [{ tabs: 'C:/a.pdf', aktiv: 0 }],
    [{ tabs: ['C:/a.pdf', ''], aktiv: 0 }],
    [{ tabs: ['C:/a.pdf', 42], aktiv: 0 }],
    [{ tabs: ['C:/a.pdf'], aktiv: 1 }],
    [{ tabs: ['C:/a.pdf'], aktiv: -1 }],
    [{ tabs: ['C:/a.pdf'], aktiv: 0.5 }],
    [{ tabs: ['C:/a.pdf'], aktiv: '0' }],
    [{ tabs: ['C:/a.pdf'] }]
  ])('lehnt %o ab', (sitzung) => {
    const ergebnis = pruefePatch({ sitzung })
    expect(ergebnis.gueltig).toBe(false)
    if (ergebnis.gueltig) return
    expect(ergebnis.grund).toMatch(/sitzung/)
  })

  it('lehnt zu viele Tabs und ueberlange Pfade ab', () => {
    const tabs = Array.from({ length: MAX_SITZUNG_TABS + 1 }, (_, i) => 'C:/' + String(i) + '.pdf')
    expect(pruefePatch({ sitzung: { tabs, aktiv: 0 } }).gueltig).toBe(false)
    expect(pruefePatch({ sitzung: { tabs: tabs.slice(1), aktiv: 0 } }).gueltig).toBe(true)
    const lang = 'C:/' + 'x'.repeat(MAX_SITZUNG_PFADLAENGE)
    expect(pruefePatch({ sitzung: { tabs: [lang], aktiv: 0 } }).gueltig).toBe(false)
  })
})
