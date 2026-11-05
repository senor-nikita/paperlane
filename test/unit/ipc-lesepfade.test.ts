import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OeffnenErgebnis } from '../../src/shared/ipc'
import type { Settings } from '../../src/shared/settings'

/**
 * Pfade, die der Renderer nennt: nicht ins Netz (Befund 1), nicht ohne
 * Rueckfrage (Befund 2).
 *
 * Der Renderer ist eine Sandbox fuer fremde Dokumente. Wer ihn uebernimmt,
 * ruft `dokumentOeffnePfad` mit `\\server\freigabe\x.pdf` auf und laesst den
 * Main DNS und SMB/NTLM sprechen - die Content-Security-Policy gilt nur im
 * Renderer - oder liest jede PDF der Platte. Dieselbe Wirkung hat ein Pfad in
 * `zuletztGeoeffnet` (existsSync bei jedem Start) oder in der Sitzung.
 *
 * Alle Netzwerkziele hier sind `.invalid`; die Rueckfrage zu ihnen wird
 * abgelehnt, gelesen wird nie.
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
  dialog: {
    showMessageBox: (...argumente: unknown[]) => attrappe.showMessageBox(...argumente),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../../src/main/wache', () => ({
  ueberwache: () => ({ beende: () => undefined })
}))

const { registerIpcHandlers, bereinigeSitzung } = await import('../../src/main/ipc')
const { setzeFreigabenZurueck, istLesefreigegeben, merkeSystempfad } =
  await import('../../src/main/dokument')
const { IPC } = await import('../../src/shared/ipc')
const { t } = await import('../../src/shared/i18n')

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
let stand: Settings
let verzeichnis: string
let pdf: string

const NEIN = { response: 1 }
const JA = { response: 0 }

function rufe<T>(kanal: string, eingabe?: unknown): Promise<T> {
  const behandler = attrappe.handler.get(kanal)
  if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
  return Promise.resolve(behandler({ sender: {} }, eingabe) as T)
}

/** Die Frage, die der Main zuletzt gestellt hat. */
function letzteFrage(): { type: string; detail: string; defaultId: number } {
  const aufrufe = attrappe.showMessageBox.mock.calls
  return aufrufe[aufrufe.length - 1]?.[0] as { type: string; detail: string; defaultId: number }
}

beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-lesepfade-'))
  pdf = join(verzeichnis, 'bericht.pdf')
  writeFileSync(pdf, '%PDF-1.7\n')
})

beforeEach(() => {
  attrappe.handler.clear()
  attrappe.showMessageBox.mockReset().mockResolvedValue(JA)
  log.warn.mockClear()
  setzeFreigabenZurueck()
  stand = { zuletztGeoeffnet: [], sitzung: { tabs: [], aktiv: 0 } } as unknown as Settings
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
    melde: vi.fn()
  })
})

describe('Befund 1: Netzwerk- und Geraetepfade', () => {
  it.each([
    ['\\\\server.invalid\\freigabe\\a.pdf'],
    ['//server.invalid/freigabe/a.pdf'],
    ['/\\server.invalid\\freigabe\\a.pdf'],
    ['\\/server.invalid/freigabe/a.pdf']
  ])(
    'fragt bei dem Netzwerkpfad %s mit Warnung nach und liest ihn nicht, wenn abgelehnt',
    async (pfad) => {
      attrappe.showMessageBox.mockResolvedValue(NEIN)
      const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pfad)
      expect(ergebnis).toEqual({ ok: false, grund: t('pfad.abgebrochen'), abgebrochen: true })
      const frage = letzteFrage()
      expect(frage.type).toBe('warning')
      expect(frage.detail).toContain(t('lesen.netzwerk'))
      // Bei einem Netzwerkpfad ist "Abbrechen" vorbelegt.
      expect(frage.defaultId).toBe(1)
    }
  )

  it.each([
    ['\\\\?\\C:\\x\\a.pdf'],
    ['\\\\.\\pipe\\x.pdf'],
    ['\\??\\UNC\\server.invalid\\s\\a.pdf'],
    ['C:\\x\\CON.pdf']
  ])('lehnt den Geraetepfad %s ab, ohne zu fragen', async (pfad) => {
    const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pfad)
    expect(ergebnis).toEqual({ ok: false, grund: t('pfad.geraet') })
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
  })

  it('meldet Netzwerkpfade der Zuletzt-Liste als nicht vorhanden, lokale Dateien als vorhanden', async () => {
    // Dass `existsSync` auf Netzwerkpfaden gar nicht aufgerufen wird, laesst sich
    // hier nicht zeigen (ein unerreichbarer Rechner meldet ebenfalls "nicht da");
    // es folgt aus dem Kurzschluss `pfadklasse(pfad) === 'lokal' && existsSync(pfad)`.
    stand = {
      ...stand,
      zuletztGeoeffnet: [pdf, '\\\\server.invalid\\freigabe\\a.pdf', '/\\server.invalid\\x\\b.pdf']
    }
    const liste = await rufe<{ pfad: string; existiert: boolean }[]>(IPC.zuletztGeoeffnet)
    expect(liste.map((eintrag) => eintrag.existiert)).toEqual([true, false, false])
  })

  it('laesst den Renderer die Zuletzt-Liste nicht beschreiben', async () => {
    await rufe(IPC.settingsSet, { zuletztGeoeffnet: ['\\\\server.invalid\\s\\a.pdf'] })
    expect(stand.zuletztGeoeffnet).toEqual([])
    expect(log.warn).toHaveBeenCalledWith('Zuletzt-Liste vom Renderer ignoriert')
  })
})

describe('Befund 2: Rueckfrage bei Pfaden, die der Main nicht kennt', () => {
  it('fragt bei einer unbekannten Datei nach, nennt den Pfad und liest nach Bestaetigung', async () => {
    const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pdf)
    expect(ergebnis.ok).toBe(true)
    expect(attrappe.showMessageBox).toHaveBeenCalledTimes(1)
    const frage = letzteFrage()
    expect(frage.type).toBe('question')
    expect(frage.detail).toContain('bericht.pdf')
    expect(frage.detail).not.toContain(t('lesen.netzwerk'))
  })

  it('liest nichts und gibt nichts frei, wenn der Nutzer ablehnt', async () => {
    attrappe.showMessageBox.mockResolvedValue(NEIN)
    const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pdf)
    expect(ergebnis).toEqual({ ok: false, grund: t('pfad.abgebrochen'), abgebrochen: true })
    expect(istLesefreigegeben(pdf)).toBe(false)
  })

  it('fragt dieselbe Datei nur einmal: danach kennt der Main sie', async () => {
    await rufe(IPC.dokumentOeffnePfad, pdf)
    await rufe(IPC.dokumentOeffnePfad, pdf)
    expect(attrappe.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('fragt nicht bei einem Pfad der Zuletzt-Liste', async () => {
    stand = { ...stand, zuletztGeoeffnet: [pdf] }
    const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pdf)
    expect(ergebnis.ok).toBe(true)
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
  })

  it('fragt nicht bei einem Pfad der gemerkten Sitzung', async () => {
    stand = { ...stand, sitzung: { tabs: [pdf], aktiv: 0 } }
    const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pdf)
    expect(ergebnis.ok).toBe(true)
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
  })

  it('fragt nicht bei einem Pfad, den das Betriebssystem uebergeben hat', async () => {
    merkeSystempfad(pdf)
    const ergebnis = await rufe<OeffnenErgebnis>(IPC.dokumentOeffnePfad, pdf)
    expect(ergebnis.ok).toBe(true)
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
  })

  it('fragt trotzdem, wenn nur ein anderer Pfad in der Liste steht', async () => {
    stand = { ...stand, zuletztGeoeffnet: [join(verzeichnis, 'andere.pdf')] }
    await rufe(IPC.dokumentOeffnePfad, pdf)
    expect(attrappe.showMessageBox).toHaveBeenCalledTimes(1)
  })
})

describe('Sitzung', () => {
  it('behaelt ueber settingsSet nur Pfade, die der Main-Prozess kennt', async () => {
    // Den Pfad kennt der Main, sobald er ihn gelesen hat.
    await rufe(IPC.dokumentOeffnePfad, pdf)
    await rufe(IPC.settingsSet, {
      sitzung: { tabs: [pdf, 'C:\\fremd\\unbekannt.pdf', '\\\\server.invalid\\s\\a.pdf'], aktiv: 0 }
    })
    expect(stand.sitzung.tabs).toEqual([pdf])
    expect(stand.sitzung.aktiv).toBe(0)
  })

  it('verschiebt den aktiven Index mit, wenn davor etwas wegfaellt', async () => {
    await rufe(IPC.dokumentOeffnePfad, pdf)
    expect(bereinigeSitzung({ tabs: ['C:\\fremd\\a.pdf', pdf], aktiv: 1 })).toEqual({
      tabs: [pdf],
      aktiv: 0
    })
  })

  it('setzt den aktiven Tab auf eine gueltige Stelle, wenn er selbst wegfaellt', async () => {
    await rufe(IPC.dokumentOeffnePfad, pdf)
    expect(bereinigeSitzung({ tabs: [pdf, 'C:\\fremd\\a.pdf'], aktiv: 1 })).toEqual({
      tabs: [pdf],
      aktiv: 0
    })
  })

  it('kommt mit einer leeren Sitzung zurecht', () => {
    expect(bereinigeSitzung({ tabs: [], aktiv: 0 })).toEqual({ tabs: [], aktiv: 0 })
  })
})
