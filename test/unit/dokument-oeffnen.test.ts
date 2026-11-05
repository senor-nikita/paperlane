import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  istLesefreigegeben,
  istSchreibfreigegeben,
  merkeSystempfad,
  oeffnePfadGeprueft,
  setzeFreigabenZurueck
} from '../../src/main/dokument'

let verzeichnis: string
let pdf: string
let text: string

beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-oeffnen-'))
  pdf = join(verzeichnis, 'bericht.pdf')
  text = join(verzeichnis, 'notiz.txt')
  writeFileSync(pdf, '%PDF-1.7\n')
  writeFileSync(text, 'kein PDF')
})

describe('oeffnePfadGeprueft', () => {
  it('liest ein PDF und gibt es frei', async () => {
    const ergebnis = await oeffnePfadGeprueft(pdf)
    expect(ergebnis.ok).toBe(true)
    if (!ergebnis.ok) return
    expect(ergebnis.dokument.name).toBe('bericht.pdf')
    expect(ergebnis.dokument.bytes.byteLength).toBeGreaterThan(0)
    // Lesen ja - schreiben nicht: der Pfad kam aus dem Renderer.
    expect(istLesefreigegeben(pdf)).toBe(true)
    expect(istSchreibfreigegeben(pdf)).toBe(false)
  })

  // Exit-Kriterium des Schritts: eine Nicht-PDF-Datei erzeugt eine Meldung
  // statt eines Fehlers. Der Grund nennt die Datei, sonst raet der Nutzer.
  it('lehnt eine Datei ab, die kein PDF ist', async () => {
    const ergebnis = await oeffnePfadGeprueft(text)
    expect(ergebnis.ok).toBe(false)
    if (ergebnis.ok) return
    expect(ergebnis.grund).toMatch(/Nur PDF/)
    expect(ergebnis.grund).toContain('notiz.txt')
    expect(istLesefreigegeben(text)).toBe(false)
  })

  it('meldet eine fehlende Datei', async () => {
    const ergebnis = await oeffnePfadGeprueft(join(verzeichnis, 'gibtesnicht.pdf'))
    expect(ergebnis.ok).toBe(false)
    if (ergebnis.ok) return
    expect(ergebnis.grund).toMatch(/nicht gefunden/)
  })

  // Der Renderer ist eine Sandbox fuer fremde Dokumente; was von dort kommt,
  // wird geprueft und nicht geglaubt.
  it.each([[null], [undefined], [42], [''], ['   ']])('lehnt %o ab', async (eingabe) => {
    const ergebnis = await oeffnePfadGeprueft(eingabe)
    expect(ergebnis.ok).toBe(false)
  })

  it('nimmt die Endung unabhaengig von der Schreibweise', async () => {
    const gross = join(verzeichnis, 'GROSS.PDF')
    writeFileSync(gross, '%PDF-1.7\n')
    expect((await oeffnePfadGeprueft(gross)).ok).toBe(true)
  })
})

/**
 * Invariante 11, scharf ab S2.3a. Bis S2.1 trug jeder gelesene Pfad sich in
 * eine gemeinsame Freigabeliste ein — ab dem Schreibpfad waere das eine
 * Rechteausweitung: der Renderer nennt beim Oeffnen ueber Drag & Drop oder die
 * Zuletzt-Liste einen Pfad, und derselbe waere damit beschreibbar.
 */
describe('Freigaben zum Schreiben', () => {
  beforeEach(() => {
    setzeFreigabenZurueck()
  })

  it('gibt einen vom Renderer genannten Pfad nur zum Lesen frei', async () => {
    await oeffnePfadGeprueft(pdf)
    expect(istLesefreigegeben(pdf)).toBe(true)
    expect(istSchreibfreigegeben(pdf)).toBe(false)
  })

  // "Oeffnen mit" und die zweite Instanz: den Pfad hat der Main-Prozess selbst
  // vom Betriebssystem, nicht aus dem Renderer.
  it('gibt einen Systempfad auch zum Schreiben frei', async () => {
    merkeSystempfad(pdf)
    await oeffnePfadGeprueft(pdf)
    expect(istSchreibfreigegeben(pdf)).toBe(true)
  })

  it('gibt nichts frei, was gar nicht gelesen werden konnte', async () => {
    const fehlt = join(verzeichnis, 'gibtesnicht.pdf')
    merkeSystempfad(fehlt)
    await oeffnePfadGeprueft(fehlt)
    expect(istSchreibfreigegeben(fehlt)).toBe(false)
  })
})
