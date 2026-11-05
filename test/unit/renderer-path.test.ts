import { describe, expect, it } from 'vitest'
import { join, sep } from 'node:path'
import { resolveRendererFile } from '../../src/main/renderer-path'

const ROOT = join('C:', 'app', 'out', 'renderer')

describe('resolveRendererFile', () => {
  it('loest den Einstiegspunkt auf', () => {
    expect(resolveRendererFile('app://bundle/index.html', ROOT)).toBe(join(ROOT, 'index.html'))
  })

  it('loest Unterverzeichnisse auf', () => {
    expect(resolveRendererFile('app://bundle/assets/index.js', ROOT)).toBe(
      join(ROOT, 'assets', 'index.js')
    )
  })

  it('dekodiert prozentkodierte Zeichen im Dateinamen', () => {
    expect(resolveRendererFile('app://bundle/a%20b.js', ROOT)).toBe(join(ROOT, 'a b.js'))
  })

  // WHATWG-URL normalisiert Punktsegmente bereits beim Parsen weg — auch
  // prozentkodierte. Diese Payloads koennen das Verzeichnis nicht verlassen;
  // sie landen innerhalb und laufen spaeter in ein 404. Festgehalten, damit
  // eine spaetere Aenderung der Parsing-Semantik hier auffaellt.
  it.each([
    ['app://bundle/../main/index.js', join(ROOT, 'main', 'index.js')],
    ['app://bundle/%2E%2E/%2E%2E/secret.txt', join(ROOT, 'secret.txt')],
    ['app://bundle/../renderer-evil/x.js', join(ROOT, 'renderer-evil', 'x.js')]
  ])('normalisiert Punktsegmente in %s', (url, expected) => {
    expect(resolveRendererFile(url, ROOT)).toBe(expected)
  })

  // Der reale Angriff: kodierte Slashes ueberleben die Normalisierung und
  // werden erst durch decodeURIComponent wieder zu Pfadtrennern.
  it('weist kodierte Slashes ab, die aus dem Verzeichnis fuehren', () => {
    expect(resolveRendererFile('app://bundle/..%2F..%2Fsecret.txt', ROOT)).toBeNull()
  })

  it('weist ein Geschwisterverzeichnis mit gemeinsamem Praefix ab', () => {
    expect(resolveRendererFile('app://bundle/..%2Frenderer-evil%2Fx.js', ROOT)).toBeNull()
  })
})

describe('resolveRendererFile, fehlerhafte Eingaben', () => {
  // decodeURIComponent wirft bei kaputter Prozentkodierung einen URIError.
  // Im Protokoll-Handler waere das eine unbehandelte Ablehnung.
  it.each(['app://bundle/%ZZ', 'app://bundle/%E0%A4%A', 'app://bundle/%'])(
    'gibt null zurueck statt zu werfen fuer %s',
    (url) => {
      expect(() => resolveRendererFile(url, ROOT)).not.toThrow()
      expect(resolveRendererFile(url, ROOT)).toBeNull()
    }
  )

  it('gibt null zurueck statt zu werfen fuer eine unparsbare URL', () => {
    expect(resolveRendererFile('keine-url', ROOT)).toBeNull()
  })

  it('traegt auch bei einem Verzeichnis mit Schraegstrichen', () => {
    const mitSchraegstrichen = ROOT.split(sep).join(String.fromCharCode(47))
    expect(resolveRendererFile('app://bundle/index.html', mitSchraegstrichen)).toBe(
      join(ROOT, 'index.html')
    )
  })
})
