import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternesZielErgebnis } from '../../src/shared/ipc'

/**
 * Der Handler fuer externe Verweise (S2.1, Aufgabe 3).
 *
 * Das Exit-Kriterium lautet: **oeffnet erst nach Bestaetigung.** Per E2E ist
 * das nicht zu belegen — der Dialog ist modal und haelt den Playwright-Lauf an
 * (derselbe Grund wie beim Renderer-Absturz in S1.5). Hier laeuft der Handler
 * deshalb gegen ein attrappiertes Electron, und die Reihenfolge von Frage und
 * Ausfuehrung wird mitgeschrieben.
 *
 * Der erste Test dieses Projekts, der `electron` ersetzt. Die Alternative
 * waere gewesen, das Kriterium ungeprueft zu lassen.
 */
const attrappe = vi.hoisted(() => ({
  handler: new Map<string, (ereignis: unknown, eingabe: unknown) => unknown>(),
  ablauf: [] as string[],
  // Ausdruecklich typisiert: ein untypisiertes `vi.fn()` liefert `any`
  // zurueck, und die Attrappe unten reichte das an den Handler weiter
  // (Invariante 1).
  showMessageBox: vi.fn<(...argumente: unknown[]) => Promise<{ response: number }>>(),
  openExternal: vi.fn<(...argumente: unknown[]) => Promise<void>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (kanal: string, behandler: (ereignis: unknown, eingabe: unknown) => unknown): void => {
      attrappe.handler.set(kanal, behandler)
    }
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showMessageBox: (...argumente: unknown[]) => {
      attrappe.ablauf.push('gefragt')
      return attrappe.showMessageBox(...argumente)
    }
  },
  shell: {
    openExternal: (...argumente: unknown[]) => {
      attrappe.ablauf.push('geoeffnet')
      return attrappe.openExternal(...argumente)
    }
  }
}))

const { registerIpcHandlers } = await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

function rufeAuf(ziel: unknown): Promise<ExternesZielErgebnis> {
  const behandler = attrappe.handler.get(IPC.externOeffnen)
  if (behandler === undefined) throw new Error('Handler nicht registriert')
  return Promise.resolve(behandler({ sender: {} }, ziel) as ExternesZielErgebnis)
}

beforeEach(() => {
  attrappe.handler.clear()
  attrappe.ablauf.length = 0
  attrappe.showMessageBox.mockReset()
  attrappe.openExternal.mockReset()
  attrappe.openExternal.mockResolvedValue(undefined)
  log.error.mockReset()
  log.warn.mockReset()
  log.info.mockReset()
  registerIpcHandlers({
    settings: { lies: () => ({}), aendere: () => ({}) } as never,
    log,
    startDokument: null,
    drucke: () => {
      throw new Error('Drucken nicht Teil dieses Tests')
    },
    melde: vi.fn()
  })
})

describe('externOeffnen', () => {
  it('fragt, bevor es oeffnet', async () => {
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    const ergebnis = await rufeAuf('https://example.org/')
    expect(ergebnis).toEqual({ art: 'geoeffnet' })
    // Die Reihenfolge ist die Aussage dieses Tests.
    expect(attrappe.ablauf).toEqual(['gefragt', 'geoeffnet'])
    expect(attrappe.openExternal).toHaveBeenCalledWith('https://example.org/')
  })

  it('oeffnet nichts, wenn der Nutzer abbricht', async () => {
    attrappe.showMessageBox.mockResolvedValue({ response: 1 })
    const ergebnis = await rufeAuf('https://example.org/')
    expect(ergebnis).toEqual({ art: 'abgebrochen' })
    expect(attrappe.openExternal).not.toHaveBeenCalled()
  })

  /**
   * Ein abgelehntes Schema erreicht den Dialog gar nicht erst. Wuerde erst
   * gefragt und dann abgelehnt, waere der Nutzer aufgefordert, etwas zu
   * bestaetigen, das ohnehin nicht passiert.
   */
  it.each([
    ['file:///C:/Windows/win.ini'],
    ['javascript:alert(1)'],
    ['ms-msdt:/id PCWDiagnostic'],
    ['kein Ziel']
  ])('lehnt %s ab, ohne zu fragen', async (ziel) => {
    const ergebnis = await rufeAuf(ziel)
    expect(ergebnis.art).toBe('abgelehnt')
    expect(attrappe.ablauf).toEqual([])
    expect(attrappe.openExternal).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalled()
  })

  /**
   * Der Dialog nennt das vollstaendige Ziel und den Host eigens. Bei
   * `https://bekannt.example@fremd.example/` ist alles vor dem `@` nur
   * Benutzerinformation — ohne den Host im Meldungstext liest der Nutzer den
   * falschen Namen und bestaetigt etwas anderes, als er glaubt.
   */
  it('zeigt das vollstaendige Ziel und benennt den echten Host', async () => {
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    await rufeAuf('https://bekannt.example@fremd.example/seite')
    const frage = attrappe.showMessageBox.mock.calls[0]?.[0] as {
      message: string
      detail: string
      buttons: string[]
      cancelId: number
      defaultId: number
    }
    expect(frage.message).toContain('fremd.example')
    expect(frage.detail).toContain('https://bekannt.example@fremd.example/seite')
    // Vorbelegt ist "Abbrechen": ein versehentliches Enter oeffnet nichts.
    expect(frage.buttons[frage.defaultId]).toBe('Abbrechen')
    expect(frage.buttons[frage.cancelId]).toBe('Abbrechen')
  })

  it('nimmt auch mailto an', async () => {
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await rufeAuf('mailto:jemand@example.org')).toEqual({ art: 'geoeffnet' })
  })

  // Etwa, wenn kein Programm fuer das Schema eingerichtet ist. Der Nutzer hat
  // gerade "Oeffnen" gedrueckt und darf nicht ins Leere schauen.
  it('meldet, wenn das System den Verweis nicht oeffnen kann', async () => {
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    attrappe.openExternal.mockRejectedValue(new Error('kein Programm'))
    const ergebnis = await rufeAuf('https://example.org/')
    expect(ergebnis.art).toBe('abgelehnt')
    expect(log.error).toHaveBeenCalled()
  })
})
