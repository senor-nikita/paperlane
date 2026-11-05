import { describe, expect, it } from 'vitest'
import { ERSATZ, redigiere } from '../../src/main/logging/redact'

describe('redigiere', () => {
  it.each(['passwort', 'password', 'Kennwort', 'apiToken', 'clientSecret', 'geheimnis'])(
    'ersetzt den Wert zu %s',
    (schluessel) => {
      const ergebnis = redigiere({ [schluessel]: 'geheim123' }) as Record<string, unknown>
      expect(ergebnis[schluessel]).toBe(ERSATZ)
    }
  )

  it('laesst unverfaengliche Werte stehen', () => {
    expect(redigiere({ datei: 'bericht.pdf', seiten: 12 })).toEqual({
      datei: 'bericht.pdf',
      seiten: 12
    })
  })

  it('wirkt auch verschachtelt und in Listen', () => {
    const ergebnis = redigiere({ dokumente: [{ name: 'a', passwort: 'x' }] }) as {
      dokumente: Array<Record<string, unknown>>
    }
    expect(ergebnis.dokumente[0]?.['passwort']).toBe(ERSATZ)
    expect(ergebnis.dokumente[0]?.['name']).toBe('a')
  })

  // Error-Eigenschaften sind nicht aufzaehlbar. Ohne Sonderbehandlung wuerde
  // aus einem protokollierten Fehler ein leeres Objekt.
  it('erhaelt Angaben eines Error', () => {
    const ergebnis = redigiere(new Error('kaputt')) as Record<string, unknown>
    expect(ergebnis['message']).toBe('kaputt')
    expect(ergebnis['name']).toBe('Error')
  })

  it('bricht bei zyklischen Referenzen nicht ab', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a['selbst'] = a
    expect(() => redigiere(a)).not.toThrow()
    expect((redigiere(a) as Record<string, unknown>)['selbst']).toBe('[zyklische Referenz]')
  })

  it('begrenzt die Verschachtelungstiefe', () => {
    let tief: unknown = 'grund'
    for (let i = 0; i < 20; i++) tief = { weiter: tief }
    expect(JSON.stringify(redigiere(tief))).toContain('zu tief')
  })
})
