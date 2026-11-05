/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked(dialog.showMessageBox): die Attrappe braucht kein `this` */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BilderWahlErgebnis } from '../../src/shared/ipc'

/**
 * Review M4, Security M1: `bilderWaehlen` liest Pfade aus Drag & Drop, die
 * der Renderer nennt - anders als sonst im Main kein Pfad aus einem eigenen
 * Dialog. Ohne Pruefung koennte ein kompromittierter Renderer beliebige
 * Dateien des Nutzers lesen (UNC-Pfade sogar ueber das Netz, Invariante 7).
 *
 * Attrappiertes Electron wie in `ipc-speichern.test.ts`; der Dialogpfad
 * (`eingabe === null`) bleibt ungeprueft, weil er vom Main selbst kommt.
 */
const attrappe = vi.hoisted(() => ({
  handler: new Map<string, (ereignis: unknown, eingabe: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (kanal: string, behandler: (ereignis: unknown, eingabe: unknown) => unknown): void => {
      attrappe.handler.set(kanal, behandler)
    }
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  },
  shell: { openExternal: vi.fn() }
}))

const { dialog } = await import('electron')
const { registerIpcHandlers } = await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')
const { setzeFreigabenZurueck } = await import('../../src/main/dokument')
const { setzeArbeitskopienZurueck } = await import('../../src/main/arbeitskopie')
const { MAX_BILD_DATEI_BYTES, MAX_PFADE_JE_AUFTRAG } = await import('../../src/main/bilderpdf')

type Dienste = Parameters<typeof registerIpcHandlers>[0]
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

function dienste(): Dienste {
  return {
    settings: {
      lies: () => ({ zuletztGeoeffnet: [], sitzung: { tabs: [], aktiv: 0 } }),
      aendere: (patch: Record<string, unknown>) => patch
    } as unknown as Dienste['settings'],
    log,
    startDokument: null,
    melde: vi.fn(),
    drucke: vi.fn()
  }
}

function waehle(pfade: string[] | null): Promise<BilderWahlErgebnis> {
  const behandler = attrappe.handler.get(IPC.bilderWaehlen)
  if (behandler === undefined) throw new Error('Handler nicht registriert')
  return Promise.resolve(behandler({ sender: {} }, pfade) as BilderWahlErgebnis)
}

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82
])

let verzeichnis: string

beforeEach(() => {
  attrappe.handler.clear()
  // Drag & Drop fragt vor dem Lesen nach (Befund 2); die meisten Faelle hier
  // bestaetigen. Die Rueckfrage selbst prueft die Gruppe am Ende.
  vi.mocked(dialog.showMessageBox)
    .mockReset()
    .mockResolvedValue({ response: 0 } as never)
  setzeArbeitskopienZurueck()
  setzeFreigabenZurueck()
  log.error.mockClear()
  log.warn.mockClear()
  log.info.mockClear()
  registerIpcHandlers(dienste())
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-bilder-waehlen-'))
})

describe('bilderWaehlen: Pfadpruefung (Security M1)', () => {
  it('liest ein gueltiges lokales PNG', async () => {
    const pfad = join(verzeichnis, 'foto.png')
    writeFileSync(pfad, PNG_1X1)
    const ergebnis = await waehle([pfad])
    expect(ergebnis.art).toBe('gewaehlt')
    if (ergebnis.art !== 'gewaehlt') return
    expect(ergebnis.bilder.map((b) => b.name)).toEqual(['foto.png'])
    expect(ergebnis.abgelehnt).toEqual([])
  })

  it('lehnt einen UNC-Pfad ab, ohne die Datei anzufassen', async () => {
    const ergebnis = await waehle(['\\\\server\\freigabe\\foto.png'])
    expect(ergebnis.art).toBe('abgebrochen')
  })

  it('lehnt einen Geraetepfad (\\\\?\\ oder \\\\.\\) ab', async () => {
    expect((await waehle(['\\\\?\\C:\\foto.png'])).art).toBe('abgebrochen')
    expect((await waehle(['\\\\.\\C:\\foto.png'])).art).toBe('abgebrochen')
  })

  it('lehnt einen reservierten Geraetenamen ab', async () => {
    expect((await waehle(['C:\\ordner\\CON.png'])).art).toBe('abgebrochen')
    expect((await waehle(['C:\\ordner\\con'])).art).toBe('abgebrochen')
  })

  it('lehnt eine nicht unterstuetzte Endung ab, bevor gelesen wird', async () => {
    expect((await waehle(['C:\\ordner\\archiv.zip'])).art).toBe('abgebrochen')
  })

  it('lehnt mehr als das Hoechstmass an Pfaden ab', async () => {
    const zuViele = Array.from(
      { length: MAX_PFADE_JE_AUFTRAG + 1 },
      (_, i) => 'a' + String(i) + '.png'
    )
    expect((await waehle(zuViele)).art).toBe('abgebrochen')
  })

  it('lehnt eine Datei ab, die nicht existiert, statt zu werfen', async () => {
    const ergebnis = await waehle([join(verzeichnis, 'fehlt.png')])
    expect(ergebnis.art).toBe('gewaehlt')
    if (ergebnis.art !== 'gewaehlt') return
    expect(ergebnis.bilder).toEqual([])
    expect(ergebnis.abgelehnt).toHaveLength(1)
    expect(ergebnis.abgelehnt[0]?.grund).toMatch(/nicht lesen/)
  })

  it('lehnt ein Verzeichnis ab (keine reguläre Datei)', async () => {
    // Ein Verzeichnisname ohne Bildendung waere schon durch `pruefePfadListe`
    // abgelehnt (anderer Grund) - hier soll gezielt die `isFile()`-Pruefung
    // greifen, also mit einer Bildendung benannt.
    const fs = await import('node:fs')
    const ordner = join(verzeichnis, 'ordner.png')
    fs.mkdirSync(ordner)
    const ergebnis = await waehle([ordner])
    expect(ergebnis.art).toBe('gewaehlt')
    if (ergebnis.art !== 'gewaehlt') return
    expect(ergebnis.bilder).toEqual([])
    expect(ergebnis.abgelehnt[0]?.grund).toMatch(/reguläre Datei/)
  })

  it('lehnt eine Datei ueber dem Einzellimit ab, ohne sie voll zu lesen', async () => {
    const pfad = join(verzeichnis, 'riesig.png')
    // Sparse-Datei: die Groesse zaehlt fuer `stat`, ohne dass wirklich so viele
    // Bytes schreiben/lesen noetig sind.
    const fs = await import('node:fs')
    const handle = fs.openSync(pfad, 'w')
    fs.writeSync(handle, PNG_1X1, 0, PNG_1X1.length, 0)
    fs.ftruncateSync(handle, MAX_BILD_DATEI_BYTES + 1)
    fs.closeSync(handle)
    const ergebnis = await waehle([pfad])
    expect(ergebnis.art).toBe('gewaehlt')
    if (ergebnis.art !== 'gewaehlt') return
    expect(ergebnis.bilder).toEqual([])
    expect(ergebnis.abgelehnt[0]?.grund).toMatch(/größer/)
  })

  it('lehnt ein unbekanntes Format ab, ohne den Rest der Datei zu lesen', async () => {
    const pfad = join(verzeichnis, 'kein-bild.png')
    writeFileSync(pfad, 'nur Text, kein Bildkopf')
    const ergebnis = await waehle([pfad])
    expect(ergebnis.art).toBe('gewaehlt')
    if (ergebnis.art !== 'gewaehlt') return
    expect(ergebnis.bilder).toEqual([])
    expect(ergebnis.abgelehnt[0]?.grund).toMatch(/Bildformat/)
  })

  it('entfernt doppelte Pfade', async () => {
    const pfad = join(verzeichnis, 'einmal.png')
    writeFileSync(pfad, PNG_1X1)
    const ergebnis = await waehle([pfad, pfad])
    expect(ergebnis.art).toBe('gewaehlt')
    if (ergebnis.art !== 'gewaehlt') return
    expect(ergebnis.bilder).toHaveLength(1)
  })
})

/**
 * Befund 2: die Pfadliste aus Drag & Drop nennt der Renderer. Der Main kann ihr
 * nicht ansehen, ob ein Mensch die Dateien meinte - ein uebernommener Renderer
 * koennte jedes Bild der Platte anfordern. Deshalb fragt der Main vor dem Lesen
 * nach, einmal fuer alle neuen Dateien der Ablage.
 */
describe('bilderWaehlen: Rueckfrage bei Drag & Drop', () => {
  function bild(name: string): string {
    const pfad = join(verzeichnis, name)
    writeFileSync(pfad, PNG_1X1)
    return pfad
  }

  it('fragt vor dem Lesen und nennt die Dateien', async () => {
    const pfad = bild('foto.png')
    const ergebnis = await waehle([pfad])
    expect(ergebnis.art).toBe('gewaehlt')
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    const frage = vi.mocked(dialog.showMessageBox).mock.calls[0]?.[0] as unknown as {
      detail: string
    }
    expect(frage.detail).toContain(pfad)
  })

  it('liest nichts, wenn der Nutzer ablehnt', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1 } as never)
    const ergebnis = await waehle([bild('foto.png')])
    expect(ergebnis.art).toBe('abgebrochen')
  })

  it('fragt nur einmal, auch bei mehreren Dateien', async () => {
    const ergebnis = await waehle([bild('a.png'), bild('b.png'), bild('c.png')])
    expect(ergebnis.art).toBe('gewaehlt')
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('fragt nicht beim Dateidialog: dort hat der Nutzer die Dateien selbst gewaehlt', async () => {
    await waehle(null)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
})
