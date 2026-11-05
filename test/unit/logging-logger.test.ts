import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { erstelleLogger } from '../../src/main/logging/logger'
import { ERSATZ } from '../../src/main/logging/redact'

let datei: string
let verzeichnis: string

beforeEach(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-log-'))
  datei = join(verzeichnis, 'app.log')
})

function zeilen(): Array<Record<string, unknown>> {
  return readFileSync(datei, 'utf8')
    .split('\n')
    .filter((z) => z.length > 0)
    .map((z) => JSON.parse(z) as Record<string, unknown>)
}

describe('Logger', () => {
  it('schreibt eine Zeile je Eintrag mit Stufe und Zeitstempel', () => {
    const log = erstelleLogger({ datei, maxBytes: 1_000_000, archive: 3, konsole: false })
    log.info('gestartet')
    log.warn('achtung')
    const eintraege = zeilen()
    expect(eintraege).toHaveLength(2)
    expect(eintraege[0]?.['stufe']).toBe('info')
    expect(eintraege[1]?.['stufe']).toBe('warn')
    expect(typeof eintraege[0]?.['zeit']).toBe('string')
  })

  // Der eigentliche Zweck der Redaktion: das Geheimnis darf die Platte nicht
  // erreichen. Geprueft wird deshalb der Dateiinhalt, nicht der Rueckgabewert.
  it('schreibt kein Passwort auf die Platte', () => {
    const log = erstelleLogger({ datei, maxBytes: 1_000_000, archive: 3, konsole: false })
    log.error('Dokument konnte nicht geoeffnet werden', {
      datei: 'geheim.pdf',
      passwort: 'streng-geheim-123'
    })
    const inhalt = readFileSync(datei, 'utf8')
    expect(inhalt).not.toContain('streng-geheim-123')
    expect(inhalt).toContain(ERSATZ)
    expect(inhalt).toContain('geheim.pdf')
  })

  it('rotiert, wenn die Datei die Obergrenze erreicht', () => {
    const log = erstelleLogger({ datei, maxBytes: 200, archive: 2, konsole: false })
    for (let i = 0; i < 12; i++) log.info('Eintrag ' + String(i) + ' mit etwas Fuelltext dahinter')
    expect(existsSync(datei + '.1')).toBe(true)
    const archive = readdirSync(verzeichnis).filter((n) => /\.log\.\d+$/.test(n))
    expect(archive.length).toBeLessThanOrEqual(2)
  })

  it('legt fehlende Verzeichnisse an', () => {
    const tief = join(verzeichnis, 'a', 'b', 'app.log')
    erstelleLogger({ datei: tief, maxBytes: 1000, archive: 1, konsole: false }).info('x')
    expect(existsSync(tief)).toBe(true)
  })
})
