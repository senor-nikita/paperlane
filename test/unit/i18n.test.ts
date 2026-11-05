import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  aktiveSprache,
  istSprachwahl,
  KATALOG_DE,
  KATALOG_EN,
  loeseSpracheAuf,
  setzeSprache,
  spracheAusLocale,
  t,
  uebersetze,
  zahl,
  type Plural
} from '../../src/shared/i18n'
import { main as deMain } from '../../src/shared/i18n/de/main'
import { menue as deMenue } from '../../src/shared/i18n/de/menue'
import { schale as deSchale } from '../../src/shared/i18n/de/schale'
import { viewer as deViewer } from '../../src/shared/i18n/de/viewer'
import { pruefePatch } from '../../src/shared/settings'
import { migriere } from '../../src/main/settings/schema'

/**
 * Die Uebersetzungsschicht (S6.8). Die Typpruefung stellt sicher, dass der
 * englische Katalog jeden Schluessel traegt; was sie nicht sieht, prueft
 * dieser Test: gleiche Platzhalter, keine doppelten Schluessel ueber die
 * Bereiche, kein ungenutzter Schluessel.
 */

afterEach(() => {
  setzeSprache('de')
})

function platzhalter(eintrag: string | Plural): string[] {
  const texte = typeof eintrag === 'string' ? [eintrag] : [eintrag.eins, eintrag.mehr]
  const namen = new Set<string>()
  for (const text of texte)
    for (const treffer of text.matchAll(/\{(\w+)\}/g)) namen.add(treffer[1] ?? '')
  return [...namen].sort()
}

describe('Kataloge', () => {
  it('haben dieselben Schluessel', () => {
    expect(Object.keys(KATALOG_EN).sort()).toEqual(Object.keys(KATALOG_DE).sort())
  })

  it('verlieren keinen Schluessel an einen gleichnamigen in einem anderen Bereich', () => {
    const summe = [deMenue, deMain, deSchale, deViewer].reduce(
      (anzahl, bereich) => anzahl + Object.keys(bereich).length,
      0
    )
    expect(Object.keys(KATALOG_DE)).toHaveLength(summe)
  })

  it('nennen in beiden Sprachen dieselben Platzhalter und dieselbe Art', () => {
    for (const schluessel of Object.keys(KATALOG_DE) as (keyof typeof KATALOG_DE)[]) {
      const de = KATALOG_DE[schluessel]
      const en = KATALOG_EN[schluessel]
      expect(typeof en, schluessel).toBe(typeof de)
      expect(platzhalter(en), schluessel).toEqual(platzhalter(de))
    }
  })

  it('haben keine leeren Texte', () => {
    for (const katalog of [KATALOG_DE, KATALOG_EN]) {
      for (const [schluessel, eintrag] of Object.entries(katalog)) {
        const texte = typeof eintrag === 'string' ? [eintrag] : [eintrag.eins, eintrag.mehr]
        for (const text of texte) expect(text.trim().length, schluessel).toBeGreaterThan(0)
      }
    }
  })

  it('schreiben Deutsch mit echten Umlauten, nicht umschrieben', () => {
    // Die Oberflaeche war bis S6.8 umschrieben; der Katalog nicht mehr.
    const umschrieben = /\b\w*(?:oeffn|loesch|liess|laesst|waehl|zurueck|fuer|ueber)\w*\b/i
    for (const [schluessel, eintrag] of Object.entries(KATALOG_DE)) {
      const texte = typeof eintrag === 'string' ? [eintrag] : [eintrag.eins, eintrag.mehr]
      for (const text of texte) {
        // Dateinamen im Vorschlag bleiben ohne Umlaute, sie landen im Dateisystem.
        if (schluessel.endsWith('.dateiname')) continue
        expect(umschrieben.test(text), schluessel + ': ' + text).toBe(false)
      }
    }
  })

  it('enthalten keinen Schluessel, den der Code nicht benutzt', () => {
    const dateien = (pfad: string): string[] =>
      statSync(pfad).isDirectory()
        ? readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
        : /\.tsx?$/.test(pfad)
          ? [pfad]
          : []
    const code = dateien('src')
      .filter((datei) => !datei.includes(join('shared', 'i18n')))
      .map((datei) => readFileSync(datei, 'utf8'))
      .join('\n')
    // Schluessel, die der Code aus einem Wert zusammensetzt (`befehl.${befehl}`).
    const zusammengesetzt = ['befehl.', 'werkzeug.', 'stempel.', 'ausrichtung.', 'anmerkung.']
    const ungenutzt = Object.keys(KATALOG_DE).filter(
      (schluessel) =>
        !code.includes("'" + schluessel + "'") &&
        !zusammengesetzt.some((vorsilbe) => schluessel.startsWith(vorsilbe))
    )
    expect(ungenutzt).toEqual([])
  })
})

describe('t und uebersetze', () => {
  it('uebersetzt in die aktive Sprache', () => {
    expect(t('menue.datei')).toBe('Datei')
    setzeSprache('en')
    expect(aktiveSprache()).toBe('en')
    expect(t('menue.datei')).toBe('File')
  })

  it('setzt Platzhalter ein', () => {
    expect(t('menue.ueber', { app: 'paperlane' })).toBe('Über paperlane')
    expect(uebersetze('en', 'menue.ueber', { app: 'paperlane' })).toBe('About paperlane')
  })

  it('waehlt Einzahl und Mehrzahl nach der Anzahl', () => {
    expect(t('seiten.anzahl', { anzahl: 1 })).toBe('1 Seite')
    expect(t('seiten.anzahl', { anzahl: 3 })).toBe('3 Seiten')
    expect(t('seiten.anzahl', { anzahl: 0 })).toBe('0 Seiten')
    expect(uebersetze('en', 'seiten.anzahl', { anzahl: 1 })).toBe('1 page')
    expect(uebersetze('en', 'seiten.anzahl', { anzahl: 2 })).toBe('2 pages')
  })

  it('schreibt Zahlen je Sprache mit Komma oder Punkt', () => {
    expect(zahl(12.5)).toBe('12,5')
    setzeSprache('en')
    expect(zahl(12.5)).toBe('12.5')
  })
})

describe('Sprachwahl', () => {
  it.each([
    ['de', 'de'],
    ['de-DE', 'de'],
    ['de-AT', 'de'],
    ['de_CH', 'de'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    ['', 'en'],
    ['dev', 'en']
  ])('bildet die Systemsprache %s auf %s ab', (locale, erwartet) => {
    expect(spracheAusLocale(locale)).toBe(erwartet)
  })

  it('folgt bei auto der Systemsprache, sonst der Wahl', () => {
    expect(loeseSpracheAuf('auto', 'de-DE')).toBe('de')
    expect(loeseSpracheAuf('auto', 'en-GB')).toBe('en')
    expect(loeseSpracheAuf('en', 'de-DE')).toBe('en')
    expect(loeseSpracheAuf('de', 'en-US')).toBe('de')
  })

  it('kennt nur auto, de und en', () => {
    expect(istSprachwahl('auto')).toBe(true)
    expect(istSprachwahl('en')).toBe(true)
    expect(istSprachwahl('fr')).toBe(false)
    expect(istSprachwahl(1)).toBe(false)
  })

  it('nimmt eine gueltige Sprachwahl in den Einstellungen an und lehnt andere ab', () => {
    expect(pruefePatch({ sprache: 'en' })).toEqual({ gueltig: true, patch: { sprache: 'en' } })
    expect(pruefePatch({ sprache: 'fr' }).gueltig).toBe(false)
  })

  it('beginnt eine Datei ohne Sprachwahl bei auto und behaelt eine gueltige', () => {
    const alt = migriere({ schemaVersion: 6, autorName: 'a' }, 'vorgabe')
    expect(alt.art === 'ok' && alt.settings.sprache).toBe('auto')
    const neu = migriere({ schemaVersion: 7, autorName: 'a', sprache: 'en' }, 'vorgabe')
    expect(neu.art === 'ok' && neu.settings.sprache).toBe('en')
    const kaputt = migriere({ schemaVersion: 7, autorName: 'a', sprache: 'xx' }, 'vorgabe')
    expect(kaputt.art === 'ok' && kaputt.settings.sprache).toBe('auto')
  })
})
