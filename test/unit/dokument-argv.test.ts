import { describe, expect, it } from 'vitest'
import { pdfPfadAusArgv } from '../../src/main/dokument'

/**
 * In S0.2 empirisch festgestellt: Electron haengt eigene Schalter an die argv
 * an. Eine echte Argumentliste sah so aus:
 *
 *   electron.exe --allow-file-access-from-files --secure-schemes=app
 *   --fetch-schemes=app --standard-schemes=app . C:/beispiel.pdf
 *
 * argv[1] oder das letzte Element blind zu nehmen waere also falsch.
 */
describe('pdfPfadAusArgv', () => {
  it('findet den Pfad zwischen Electron-Schaltern', () => {
    const argv = [
      'C:/app/electron.exe',
      '--allow-file-access-from-files',
      '--secure-schemes=app',
      '--standard-schemes=app',
      '.',
      'C:/beispiel.pdf'
    ]
    expect(pdfPfadAusArgv(argv)).toBe('C:/beispiel.pdf')
  })

  it('ignoriert die ausfuehrbare Datei, auch wenn sie .pdf hiesse', () => {
    expect(pdfPfadAusArgv(['C:/seltsam.pdf'])).toBeNull()
  })

  it('ignoriert den Projektpunkt aus dem Entwicklungsmodus', () => {
    expect(pdfPfadAusArgv(['electron.exe', '.'])).toBeNull()
  })

  it('nimmt das erste Dokument, wenn mehrere uebergeben wurden', () => {
    expect(pdfPfadAusArgv(['e.exe', 'a.pdf', 'b.pdf'])).toBe('a.pdf')
  })

  it.each([['dokument.txt'], ['ordner'], ['--pdf']])('ignoriert %s', (wert) => {
    expect(pdfPfadAusArgv(['e.exe', wert])).toBeNull()
  })

  it('erkennt die Endung unabhaengig von Gross- und Kleinschreibung', () => {
    expect(pdfPfadAusArgv(['e.exe', 'Bericht.PDF'])).toBe('Bericht.PDF')
  })

  it('liefert null ohne Argumente', () => {
    expect(pdfPfadAusArgv([])).toBeNull()
  })
})
