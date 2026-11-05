import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ueberwache } from '../../src/main/wache'

function warte(ms: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, ms))
}

describe('ueberwache', () => {
  it('meldet, wenn die Datei geloescht wird', async () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-wache-'))
    const datei = join(verzeichnis, 'dokument.pdf')
    writeFileSync(datei, '%PDF-1.7\n')

    const gemeldet = vi.fn()
    const wache = ueberwache(datei, gemeldet)
    rmSync(datei)

    // fs.watch meldet asynchron; ein kurzer Moment genuegt.
    await vi.waitFor(() => {
      expect(gemeldet).toHaveBeenCalled()
    })
    wache.beende()
  })

  // Ein Loeschen erzeugt je nach Betriebssystem mehrere Ereignisse. Ohne
  // Sperre bekaeme der Renderer denselben Hinweis mehrfach.
  it('meldet nur einmal', async () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-wache-'))
    const datei = join(verzeichnis, 'dokument.pdf')
    writeFileSync(datei, '%PDF-1.7\n')

    const gemeldet = vi.fn()
    const wache = ueberwache(datei, gemeldet)
    rmSync(datei)
    await vi.waitFor(() => {
      expect(gemeldet).toHaveBeenCalled()
    })
    await warte(50)
    expect(gemeldet).toHaveBeenCalledTimes(1)
    wache.beende()
  })

  // Nicht jedes Dateisystem laesst sich beobachten. Das ist kein Grund, das
  // Oeffnen scheitern zu lassen.
  it('scheitert nicht an einem Pfad, den es nicht gibt', () => {
    const gemeldet = vi.fn()
    expect(() =>
      ueberwache(join(tmpdir(), 'gibt-es-nicht-12345.pdf'), gemeldet).beende()
    ).not.toThrow()
  })

  it('meldet nach dem Beenden nicht mehr', async () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-wache-'))
    const datei = join(verzeichnis, 'dokument.pdf')
    writeFileSync(datei, '%PDF-1.7\n')

    const gemeldet = vi.fn()
    ueberwache(datei, gemeldet).beende()
    rmSync(datei)
    await warte(80)
    expect(gemeldet).not.toHaveBeenCalled()
  })
})
