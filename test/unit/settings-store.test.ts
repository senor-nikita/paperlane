import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { lade, speichere } from '../../src/main/settings/store'
import {
  SCHEMA_VERSION,
  STANDARD_ANNOTATIONEN,
  STANDARD_ANSICHT,
  STANDARD_FENSTER,
  type Settings
} from '../../src/shared/settings'

const einstellungen = (autorName: string): Settings => ({
  schemaVersion: SCHEMA_VERSION,
  autorName,
  fenster: { ...STANDARD_FENSTER },
  zuletztGelesen: {},
  zuletztGeoeffnet: [],
  annotationen: { ...STANDARD_ANNOTATIONEN },
  ansicht: { ...STANDARD_ANSICHT },
  sitzung: { tabs: [], aktiv: 0 },
  sprache: 'auto'
})

let verzeichnis: string
let datei: string

beforeEach(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-settings-'))
  datei = join(verzeichnis, 'settings.json')
})

describe('lade', () => {
  it('liefert Vorgaben, wenn die Datei fehlt', () => {
    const zustand = lade(datei, 'nikita')
    expect(zustand.settings.autorName).toBe('nikita')
    expect(zustand.schreibbar).toBe(true)
    expect(zustand.hinweis).toBeNull()
  })

  it('liest zurueck, was gespeichert wurde', () => {
    speichere(datei, einstellungen('gespeichert'))
    expect(lade(datei, 'vorgabe').settings.autorName).toBe('gespeichert')
  })

  it('legt eine unlesbare Datei beiseite, statt sie zu loeschen', () => {
    writeFileSync(datei, '{ kaputt', 'utf8')
    const zustand = lade(datei, 'nikita')
    expect(zustand.settings.autorName).toBe('nikita')
    expect(zustand.hinweis).toContain('gesichert unter')
    const gesichert = readdirSync(verzeichnis).filter((n) => n.includes('beschaedigt'))
    expect(gesichert).toHaveLength(1)
    expect(readFileSync(join(verzeichnis, gesichert[0] as string), 'utf8')).toBe('{ kaputt')
  })

  it('schreibt eine Datei aus neuerer Schemaversion nicht zurueck', () => {
    writeFileSync(datei, JSON.stringify({ schemaVersion: 99, autorName: 'neu' }), 'utf8')
    const zustand = lade(datei, 'vorgabe')
    expect(zustand.schreibbar).toBe(false)
    expect(zustand.hinweis).toContain('neueren Programmversion')
  })

  it('meldet eine Anhebung aus dem Altfall ohne Schemaversion', () => {
    writeFileSync(datei, JSON.stringify({ autorName: 'alt' }), 'utf8')
    const zustand = lade(datei, 'vorgabe')
    expect(zustand.settings.autorName).toBe('alt')
    expect(zustand.hinweis).toContain('angehoben')
  })
})

describe('speichere', () => {
  it('hinterlaesst keine temporaere Datei', () => {
    speichere(datei, einstellungen('a'))
    expect(readdirSync(verzeichnis)).toEqual(['settings.json'])
  })

  it('legt fehlende Verzeichnisse an', () => {
    const tief = join(verzeichnis, 'a', 'b', 'settings.json')
    speichere(tief, einstellungen('a'))
    expect(existsSync(tief)).toBe(true)
  })

  // Belegt die Atomaritaet: eine halb geschriebene Nachbardatei darf die
  // gueltige Datei nicht beschaedigen.
  it('laesst die gueltige Datei unversehrt, wenn ein Schreibversuch abbricht', () => {
    speichere(datei, einstellungen('gueltig'))
    writeFileSync(datei + '.tmp', '{ abgebrochen', 'utf8')
    expect(lade(datei, 'vorgabe').settings.autorName).toBe('gueltig')
  })
})
