import { describe, expect, it, vi } from 'vitest'

/**
 * Das Signaturbild im Main (S3.2, Aufgabe 4): Dateikopf und Groesse werden
 * dort geprueft, wo auch eingebettet wird. `bild.ts` zieht `electron` fuer
 * den Dialog herein; hier laeuft nur die Pruefung, also genuegt eine Attrappe.
 */
const showOpenDialog =
  vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>()
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

const { alsDataUrl, bildart, ladeBildUeberDialog, pruefeBild } = await import('../../src/main/bild')
const { MAX_BILD_BYTES } = await import('../../src/main/speichern')

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe('bildart', () => {
  it('erkennt PNG und JPEG am Kopf', () => {
    expect(bildart(PNG)).toBe('png')
    expect(bildart(JPEG)).toBe('jpg')
  })

  it('lehnt alles Uebrige ab — auch eine Datei, die nur so heisst', () => {
    expect(bildart(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull() // GIF
    expect(bildart(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull() // <svg
    expect(bildart(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull() // %PDF
    expect(bildart(new Uint8Array([]))).toBeNull()
    // Ein zu kurzer Kopf ist kein Treffer, auch wenn der Anfang passt.
    expect(bildart(new Uint8Array([0x89, 0x50]))).toBeNull()
  })
})

describe('alsDataUrl', () => {
  it('nennt den Medientyp, den der Renderer und der Speicherpfad verstehen', () => {
    expect(alsDataUrl(PNG, 'png')).toMatch(/^data:image\/png;base64,iVBOR/)
    expect(alsDataUrl(JPEG, 'jpg')).toMatch(/^data:image\/jpeg;base64,/)
  })
})

describe('pruefeBild', () => {
  it('liefert fuer ein gueltiges Bild die Data-URL', () => {
    expect(pruefeBild(PNG)).toEqual({ art: 'geladen', url: alsDataUrl(PNG, 'png') })
  })

  it('lehnt leere, zu grosse und fremde Dateien mit einem Grund ab', () => {
    expect(pruefeBild(new Uint8Array([]))).toMatchObject({ art: 'abgelehnt', grund: /leer/ })
    const riesig = new Uint8Array(MAX_BILD_BYTES + 1)
    riesig.set(PNG)
    expect(pruefeBild(riesig)).toMatchObject({ art: 'abgelehnt', grund: /groesser/ })
    expect(pruefeBild(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toMatchObject({
      art: 'abgelehnt',
      grund: /weder ein PNG noch ein JPEG/
    })
  })
})

describe('ladeBildUeberDialog', () => {
  it('meldet einen abgebrochenen Dialog als abgebrochen, nicht als Fehler', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(ladeBildUeberDialog(null)).resolves.toEqual({ art: 'abgebrochen' })
  })

  it('bietet nur PNG und JPEG an', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await ladeBildUeberDialog(null)
    const optionen = showOpenDialog.mock.calls[0]?.[0] as { filters: { extensions: string[] }[] }
    expect(optionen.filters.flatMap((f) => f.extensions).sort()).toEqual(['jpeg', 'jpg', 'png'])
  })
})
