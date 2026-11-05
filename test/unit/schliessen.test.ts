import { describe, expect, it, vi } from 'vitest'
import {
  anzeigeNamen,
  baueSchliessWaechter,
  MAX_TABNAME,
  schliessFrage,
  tabSchliessFrage,
  type SchliessbaresFenster
} from '../../src/main/schliessen'

/**
 * Die Warnung bei ungespeicherten Aenderungen (S2.3a, Aufgabe 5).
 *
 * Per E2E nicht zu belegen: der Dialog ist modal und hielte den Lauf an
 * (derselbe Grund wie bei den externen Verweisen in S2.1). Geprueft wird
 * deshalb die Regel selbst — und vor allem ihre Reihenfolge: aufhalten,
 * fragen, erst dann schliessen.
 */
function fenster(): SchliessbaresFenster & { geschlossen: () => number } {
  let mal = 0
  return {
    isDestroyed: () => false,
    close: () => {
      mal++
    },
    geschlossen: () => mal
  }
}

function ereignis(): { preventDefault: () => void; aufgehalten: () => boolean } {
  let gehalten = false
  return {
    preventDefault: () => {
      gehalten = true
    },
    aufgehalten: () => gehalten
  }
}

describe('baueSchliessWaechter', () => {
  it('laesst ein sauberes Dokument ohne Nachfrage schliessen', () => {
    const frage = vi.fn<() => Promise<boolean>>()
    const waechter = baueSchliessWaechter({ anzahlAenderungen: () => 0, frage })
    const e = ereignis()

    waechter(fenster(), e)

    expect(e.aufgehalten()).toBe(false)
    expect(frage).not.toHaveBeenCalled()
  })

  it('haelt das Schliessen auf und fragt nach', async () => {
    const frage = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const waechter = baueSchliessWaechter({ anzahlAenderungen: () => 1, frage })
    const f = fenster()
    const e = ereignis()

    waechter(f, e)

    expect(e.aufgehalten()).toBe(true)
    await vi.waitFor(() => {
      expect(frage).toHaveBeenCalledTimes(1)
    })
    // Abgebrochen: das Fenster bleibt offen.
    expect(f.geschlossen()).toBe(0)
  })

  it('schliesst nach der Bestaetigung und fragt dabei kein zweites Mal', async () => {
    const frage = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
    const waechter = baueSchliessWaechter({ anzahlAenderungen: () => 1, frage })
    const f = fenster()

    waechter(f, ereignis())
    await vi.waitFor(() => {
      expect(f.geschlossen()).toBe(1)
    })

    // Das erneute `close` laeuft durch denselben Zuhoerer. Ohne die Marke
    // fragte er wieder und das Fenster liesse sich nie schliessen.
    const zweites = ereignis()
    waechter(f, zweites)
    expect(zweites.aufgehalten()).toBe(false)
    expect(frage).toHaveBeenCalledTimes(1)
  })

  it('laesst ein bereits zerstoertes Fenster in Ruhe', async () => {
    const frage = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
    const waechter = baueSchliessWaechter({ anzahlAenderungen: () => 1, frage })
    const f = { ...fenster(), isDestroyed: () => true }

    waechter(f, ereignis())
    await vi.waitFor(() => {
      expect(frage).toHaveBeenCalled()
    })
    expect(f.geschlossen()).toBe(0)
  })

  it('merkt sich die Bestaetigung je Fenster', async () => {
    const frage = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
    const waechter = baueSchliessWaechter({ anzahlAenderungen: () => 1, frage })
    const eines = fenster()
    const anderes = fenster()

    waechter(eines, ereignis())
    await vi.waitFor(() => {
      expect(eines.geschlossen()).toBe(1)
    })

    const e = ereignis()
    waechter(anderes, e)
    // Das zweite Fenster hat nichts bestaetigt.
    expect(e.aufgehalten()).toBe(true)
  })
})

/**
 * S6.1: mehrere Tabs. Die Frage beim Beenden nennt die Zahl der Dokumente
 * mit Aenderungen, wenn es mehr als eines ist; der Waechter reicht sie durch.
 */
describe('Beenden mit mehreren Dokumenten', () => {
  it('reicht die Anzahl an die Frage weiter', async () => {
    const frage =
      vi.fn<(f: SchliessbaresFenster, anzahl: number, namen: string[]) => Promise<boolean>>()
    frage.mockResolvedValue(false)
    const waechter = baueSchliessWaechter({ anzahlAenderungen: () => 3, frage })
    const e = ereignis()
    waechter(fenster(), e)
    expect(e.aufgehalten()).toBe(true)
    await vi.waitFor(() => {
      expect(frage).toHaveBeenCalledWith(expect.anything(), 3, [])
    })
  })

  it('reicht die Namen der Dokumente mit Aenderungen an die Frage weiter', async () => {
    const frage =
      vi.fn<(f: SchliessbaresFenster, anzahl: number, namen: string[]) => Promise<boolean>>()
    frage.mockResolvedValue(false)
    const waechter = baueSchliessWaechter({
      anzahlAenderungen: () => 2,
      namen: () => ['a.pdf', 'b.pdf'],
      frage
    })
    waechter(fenster(), ereignis())
    await vi.waitFor(() => {
      expect(frage).toHaveBeenCalledWith(expect.anything(), 2, ['a.pdf', 'b.pdf'])
    })
  })

  it('nennt die Zahl erst ab zwei Dokumenten', () => {
    expect(schliessFrage(1).message).not.toMatch(/\d/)
    const mehrere = schliessFrage(3)
    expect(mehrere.message).toMatch(/^3 Dokumente/)
    expect(mehrere.detail).toMatch(/verloren/)
    expect(mehrere.buttons).toEqual(schliessFrage(1).buttons)
    expect(mehrere.defaultId).toBe(1)
    expect(mehrere.cancelId).toBe(1)
  })
})

/**
 * Wer viele Dokumente offen hat, muss in der Rueckfrage sehen, in welchen noch
 * gespeichert werden muss.
 */
describe('Namen in der Rueckfrage beim Beenden', () => {
  it('nennt jedes Dokument mit einem Punkt, auch bei nur einem', () => {
    const eines = schliessFrage(1, ['bericht.pdf'])
    expect(eines.detail).toContain('\u2022 bericht.pdf')
    expect(eines.detail).toMatch(/verloren/)

    const mehrere = schliessFrage(2, ['a.pdf', 'b.pdf'])
    expect(mehrere.detail).toContain('\u2022 a.pdf\n\u2022 b.pdf')
  })

  it('bleibt ohne Namen beim bisherigen Text', () => {
    expect(schliessFrage(2).detail).toBe(schliessFrage(2, []).detail)
    expect(schliessFrage(2).detail).not.toContain('\u2022')
  })

  it('zeigt hoechstens zehn Namen und zaehlt den Rest', () => {
    const namen = Array.from({ length: 14 }, (_, i) => 'datei-' + String(i + 1) + '.pdf')
    const detail = schliessFrage(14, namen).detail
    expect(detail).toContain('\u2022 datei-10.pdf')
    expect(detail).not.toContain('datei-11.pdf')
    expect(detail).toContain('4 weitere')
  })

  it('kuerzt einen ueberlangen Namen', () => {
    const detail = schliessFrage(1, ['x'.repeat(MAX_TABNAME * 4)]).detail
    expect(detail).toContain('...')
    expect(detail.length).toBeLessThan(MAX_TABNAME + 400)
  })
})

describe('anzeigeNamen', () => {
  it('nimmt den Dateinamen und sortiert alphabetisch', () => {
    expect(anzeigeNamen(['C:\\x\\zeta.pdf', 'C:\\y\\Alpha.pdf', 'C:\\z\\beta.pdf'])).toEqual([
      'Alpha.pdf',
      'beta.pdf',
      'zeta.pdf'
    ])
  })

  it('haengt bei gleichen Namen den Ordner an', () => {
    expect(
      anzeigeNamen([
        'C:\\Projekte\\Nord\\bericht.pdf',
        'C:\\Projekte\\Sued\\bericht.pdf',
        'C:\\a\\x.pdf'
      ])
    ).toEqual(['bericht.pdf (Nord)', 'bericht.pdf (Sued)', 'x.pdf'])
  })

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(anzeigeNamen([])).toEqual([])
  })
})

describe('tabSchliessFrage', () => {
  it('nennt den Namen und ist mit Abbrechen vorbelegt', () => {
    const frage = tabSchliessFrage('bericht.pdf')
    expect(frage.message).toContain('„bericht.pdf“')
    expect(frage.detail).toMatch(/verloren/)
    expect(frage.buttons).toEqual(['Verwerfen und schließen', 'Abbrechen'])
    expect(frage.defaultId).toBe(1)
    expect(frage.cancelId).toBe(1)
  })

  it('kuerzt einen ueberlangen Namen', () => {
    const frage = tabSchliessFrage('x'.repeat(MAX_TABNAME * 4))
    expect(frage.message.length).toBeLessThan(MAX_TABNAME + 50)
    expect(frage.message).toContain('...')
  })
})

describe('schliessFrage(1)', () => {
  it('sagt, was verloren geht', () => {
    expect(schliessFrage(1).detail).toMatch(/verloren/)
  })

  // Vorbelegt ist "Abbrechen": Arbeit zu verlieren soll niemandem aus Versehen
  // passieren.
  it('ist mit Abbrechen vorbelegt', () => {
    const frage = schliessFrage(1)
    expect(frage.buttons[0]).toMatch(/Verwerfen/)
    expect(frage.defaultId).toBe(1)
    expect(frage.cancelId).toBe(1)
  })
})
