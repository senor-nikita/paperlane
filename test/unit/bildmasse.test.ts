import { describe, expect, it } from 'vitest'
import { begrenzeDpi, DPI_MAX, hoechsteDpi, pixelmasse, pngName } from '../../src/shared/bildmasse'

/** A4 in Punkten. */
const A4 = { breite: 595, hoehe: 842 }

describe('bildmasse (S4.2b)', () => {
  it('rechnet Punkte bei 300 DPI in die erwartete Pixelgroesse um', () => {
    // Das Exit-Kriterium: 595 pt * 300 / 72 = 2479,17 → 2479 Pixel.
    expect(pixelmasse(A4, 300)).toEqual({ breite: 2479, hoehe: 3508 })
    expect(pixelmasse(A4, 72)).toEqual({ breite: 595, hoehe: 842 })
  })

  it('nennt die hoechste DPI, bei der die laengste Kante unter der Grenze bleibt', () => {
    // 16384 * 72 / 842 = 1401,0 → 1401; bei 1402 DPI waere die Hoehe 16395.
    expect(hoechsteDpi(A4, 16384)).toBe(1401)
    expect(pixelmasse(A4, 1401).hoehe).toBeLessThanOrEqual(16384)
    expect(pixelmasse(A4, 1402).hoehe).toBeGreaterThan(16384)
    // Eine Seite ohne Masse begrenzt nichts.
    expect(hoechsteDpi({ breite: 0, hoehe: 0 }, 16384)).toBe(DPI_MAX)
  })

  it('begrenzt nur, wenn die Grenze greift, und sagt es dann', () => {
    expect(begrenzeDpi(A4, 300, 16384)).toEqual({ dpi: 300, begrenzt: false })
    expect(begrenzeDpi(A4, 5000, 16384)).toEqual({ dpi: 1401, begrenzt: true })
    // Eine sehr breite Seite (200 Zoll) kippt schon bei kleinen Werten.
    expect(begrenzeDpi({ breite: 14400, hoehe: 72 }, 300, 16384)).toEqual({
      dpi: 81,
      begrenzt: true
    })
  })

  it('leitet den Dateinamen aus Dokumentname und Seite ab', () => {
    expect(pngName('bericht.pdf', 3)).toBe('bericht-S3.png')
    expect(pngName('Bericht.PDF', 12)).toBe('Bericht-S12.png')
    expect(pngName('ohne-endung', 1)).toBe('ohne-endung-S1.png')
  })
})
