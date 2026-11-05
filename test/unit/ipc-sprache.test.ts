import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../src/shared/settings'

/**
 * Die Sprache im Main (S6.8): `spracheGet` liefert die aufgeloeste Sprache,
 * eine Aenderung der Sprachwahl ueber `settingsSet` loest den Neuaufbau aus,
 * und Dialoge des Main sprechen danach die neue Sprache.
 */
const attrappe = vi.hoisted(() => ({
  handler: new Map<string, (ereignis: unknown, eingabe: unknown) => unknown>(),
  showMessageBox: vi.fn<(...argumente: unknown[]) => Promise<{ response: number }>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (kanal: string, behandler: (ereignis: unknown, eingabe: unknown) => unknown): void => {
      attrappe.handler.set(kanal, behandler)
    }
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: (...argumente: unknown[]) => attrappe.showMessageBox(...argumente) },
  shell: { openExternal: vi.fn() }
}))

const { registerIpcHandlers } = await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')
const { setzeSprache } = await import('../../src/shared/i18n')

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const wendeSpracheAn = vi.fn()
let stand = { sprache: 'auto' } as unknown as Settings

function rufe(kanal: string, eingabe?: unknown): unknown {
  const behandler = attrappe.handler.get(kanal)
  if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
  return behandler({ sender: {} }, eingabe)
}

beforeEach(() => {
  attrappe.handler.clear()
  attrappe.showMessageBox.mockReset().mockResolvedValue({ response: 1 })
  wendeSpracheAn.mockReset()
  stand = { sprache: 'auto' } as unknown as Settings
  registerIpcHandlers({
    settings: {
      lies: () => stand,
      aendere: (patch) => {
        stand = { ...stand, ...patch }
        return stand
      }
    },
    log,
    startDokument: null,
    drucke: () => {
      throw new Error('Drucken nicht Teil dieses Tests')
    },
    melde: vi.fn(),
    wendeSpracheAn
  })
})

afterEach(() => {
  setzeSprache('de')
})

describe('Sprache im Main', () => {
  it('liefert die aktive Sprache', () => {
    expect(rufe(IPC.spracheGet)).toBe('de')
    setzeSprache('en')
    expect(rufe(IPC.spracheGet)).toBe('en')
  })

  it('wendet eine geaenderte Sprachwahl an, andere Aenderungen nicht', () => {
    rufe(IPC.settingsSet, { autorName: 'Anna' })
    expect(wendeSpracheAn).not.toHaveBeenCalled()
    rufe(IPC.settingsSet, { sprache: 'en' })
    expect(wendeSpracheAn).toHaveBeenCalledTimes(1)
    expect(stand.sprache).toBe('en')
  })

  it('lehnt eine unbekannte Sprache ab, ohne sie anzuwenden', () => {
    expect(() => rufe(IPC.settingsSet, { sprache: 'fr' })).toThrow()
    expect(wendeSpracheAn).not.toHaveBeenCalled()
  })

  it('fragt vor einem Verweis in der aktiven Sprache', async () => {
    setzeSprache('en')
    await rufe(IPC.externOeffnen, 'https://example.org/')
    const frage = attrappe.showMessageBox.mock.calls[0]?.[0] as {
      message: string
      buttons: string[]
    }
    expect(frage.message).toBe('Open this link to “example.org”?')
    expect(frage.buttons).toEqual(['Open', 'Cancel'])
  })
})
