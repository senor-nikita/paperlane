import { describe, expect, it } from 'vitest'
import { deuteFehler } from '../../src/shared/errors'

/** Baut eine Ausnahme, wie pdf.js sie wirft. */
function pdfFehler(name: string, nachricht: string, code?: number): Error {
  const fehler = new Error(nachricht)
  fehler.name = name
  if (code !== undefined) Object.assign(fehler, { code })
  return fehler
}

/** Baut einen Node-Dateifehler. */
function dateiFehler(code: string): Error {
  return Object.assign(new Error(code + ': operation failed'), { code })
}

describe('deuteFehler', () => {
  it('erkennt ein noetiges Passwort', () => {
    const gedeutet = deuteFehler(pdfFehler('PasswordException', 'No password given', 1))
    expect(gedeutet.art).toBe('passwortNoetig')
    expect(gedeutet.nutzertext).toMatch(/passwortgeschützt/)
  })

  // Ohne die Unterscheidung wiederholte die Oberflaeche dieselbe Frage
  // kommentarlos, und der Nutzer wuesste nicht, dass er sich vertippt hat.
  it('unterscheidet ein falsches Passwort von einem fehlenden', () => {
    const gedeutet = deuteFehler(pdfFehler('PasswordException', 'Incorrect Password', 2))
    expect(gedeutet.art).toBe('passwortFalsch')
    expect(gedeutet.nutzertext).toMatch(/erneut/)
  })

  it('erkennt ein beschaedigtes Dokument und nennt einen Ausweg', () => {
    const gedeutet = deuteFehler(
      pdfFehler('InvalidPDFException', 'Invalid PDF structure'),
      'kaputt.pdf'
    )
    expect(gedeutet.art).toBe('beschaedigt')
    expect(gedeutet.nutzertext).toContain('kaputt.pdf')
    expect(gedeutet.nutzertext).toMatch(/anderes Dokument/)
  })

  // Fall 3 des Schritts: die Meldung muss "nicht gefunden" von "kein Zugriff"
  // unterscheiden - sonst sucht der Nutzer an der falschen Stelle.
  it('unterscheidet nicht gefunden von keinem Zugriff', () => {
    expect(deuteFehler(dateiFehler('ENOENT')).art).toBe('nichtGefunden')
    expect(deuteFehler(dateiFehler('EACCES')).art).toBe('keinZugriff')
    expect(deuteFehler(dateiFehler('EPERM')).art).toBe('keinZugriff')
    expect(deuteFehler(dateiFehler('EACCES')).nutzertext).toMatch(/Zugriffsrechte/)
  })

  it('erkennt eine fehlende Datei auch aus pdf.js', () => {
    expect(deuteFehler(pdfFehler('MissingPDFException', 'Missing PDF')).art).toBe('nichtGefunden')
  })

  it('erkennt Speichermangel', () => {
    const fehler = pdfFehler('RangeError', 'Array buffer allocation failed')
    expect(deuteFehler(fehler).art).toBe('speichermangel')
  })

  // Verschluckt wird nichts: eine unbekannte Ausnahme behaelt ihre
  // Originalmeldung im Detail fuers Protokoll.
  it('faellt auf unbekannt zurueck und behaelt das Detail', () => {
    const gedeutet = deuteFehler(pdfFehler('WasAuchImmer', 'etwas Merkwuerdiges'))
    expect(gedeutet.art).toBe('unbekannt')
    expect(gedeutet.detail).toContain('etwas Merkwuerdiges')
  })

  it('kommt auch mit etwas zurecht, das kein Error ist', () => {
    const gedeutet = deuteFehler('nur ein Text')
    expect(gedeutet.art).toBe('unbekannt')
    expect(gedeutet.detail).toBe('nur ein Text')
  })

  // Das technische Detail gehoert ins Protokoll, nicht ins Fenster.
  it('haelt Nutzertext und technisches Detail auseinander', () => {
    const gedeutet = deuteFehler(pdfFehler('InvalidPDFException', 'xref table missing'))
    expect(gedeutet.nutzertext).not.toContain('xref')
    expect(gedeutet.detail).toContain('xref')
  })

  it('stellt den Dateinamen voran, wenn einer bekannt ist', () => {
    expect(deuteFehler(dateiFehler('ENOENT'), 'a.pdf').nutzertext).toMatch(/^a\.pdf: /)
    expect(deuteFehler(dateiFehler('ENOENT')).nutzertext).not.toMatch(/^:/)
  })
})

// S6.10, Fund des Fuzzers: ein Wert, dessen `toString` wirft, liess die
// Fehlerdeutung selbst werfen.
describe('deuteFehler mit feindlichen Werten', () => {
  it('wirft nicht, auch wenn String() des Werts wirft', () => {
    const boese = Object.create(Uint8Array.prototype) as unknown
    expect(() => deuteFehler(boese)).not.toThrow()
    expect(deuteFehler(boese).art).toBe('unbekannt')
    const fehler = new Error('x')
    Object.defineProperty(fehler, 'message', { value: boese })
    expect(() => deuteFehler(fehler)).not.toThrow()
  })
})
