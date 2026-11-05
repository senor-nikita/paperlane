import { describe, expect, it } from 'vitest'
import { IPC, EREIGNIS_KANAL, pruefeEreignis } from '../../src/shared/ipc'

describe('IPC-Contract', () => {
  it('vergibt eindeutige Kanalnamen', () => {
    const namen = Object.values(IPC)
    expect(new Set(namen).size).toBe(namen.length)
  })

  it('praefixt jeden Kanal, damit er nicht mit Electron-internen kollidiert', () => {
    for (const kanal of Object.values(IPC)) {
      expect(kanal).toMatch(/^app:/)
    }
  })

  it('praefixt auch den Menuekanal', () => {
    expect(EREIGNIS_KANAL).toMatch(/^app:/)
    expect(Object.values(IPC)).not.toContain(EREIGNIS_KANAL)
  })
})

/**
 * Der Menuekanal ist der einzige Weg, auf dem etwas ungeprueft in die
 * Befehlsausfuehrung des Renderers geraten koennte (ADR 0002).
 */
describe('pruefeEreignis', () => {
  it('nimmt den Druckfortschritt nur mit bekannter Phase an (S4.3)', () => {
    expect(pruefeEreignis({ art: 'druckFortschritt', phase: 'laden' })).toEqual({
      art: 'druckFortschritt',
      phase: 'laden'
    })
    expect(pruefeEreignis({ art: 'druckFortschritt', phase: 'fertig' })).toBeNull()
  })

  it('nimmt einen Befehl aus der Kuerzel-Map an', () => {
    expect(pruefeEreignis({ art: 'befehl', befehl: 'zoomGroesser' })).toEqual({
      art: 'befehl',
      befehl: 'zoomGroesser'
    })
  })

  it('nimmt eine Suche nach Auswahl an', () => {
    expect(pruefeEreignis({ art: 'sucheNachAuswahl', text: 'Rechnung' })).toEqual({
      art: 'sucheNachAuswahl',
      text: 'Rechnung'
    })
  })

  it.each([
    ['unbekannter Befehl', { art: 'befehl', befehl: 'formatiereFestplatte' }],
    ['fehlender Befehl', { art: 'befehl' }],
    ['Befehl ist keine Zeichenkette', { art: 'befehl', befehl: 42 }],
    ['Suchtext fehlt', { art: 'sucheNachAuswahl' }],
    ['unbekannte Art', { art: 'etwasAnderes' }],
    ['kein Objekt', 'zoomGroesser'],
    ['null', null]
  ])('verwirft %s', (_beschreibung, eingabe) => {
    expect(pruefeEreignis(eingabe)).toBeNull()
  })
})
