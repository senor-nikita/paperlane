import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BildPdfAuftrag,
  BildPdfErgebnis,
  ExtrahierAuftrag,
  ExtrahierErgebnis
} from '../../src/shared/ipc'

/**
 * Review M2, Security L6: neue Schreibwege ("Seiten extrahieren", "Bilder zu
 * PDF") pruefen wie "Speichern unter", ob das gewaehlte Ziel in einem anderen
 * Tab offen ist. Ohne diese Pruefung weicht die Arbeitskopie jenes Tabs still
 * von der Platte ab, und sein naechstes Speichern schreibt den alten Stand
 * zurueck.
 *
 * Attrappiertes Electron wie in `ipc-speichern.test.ts`; `merkeOffen` simuliert
 * hier direkt, dass ein Tab einen Pfad zeigt, ohne die Tab-UI aufzubauen.
 */
const attrappe = vi.hoisted(() => ({
  handler: new Map<string, (ereignis: unknown, eingabe: unknown) => unknown>(),
  showSaveDialog:
    vi.fn<(...argumente: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>>()
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
    showSaveDialog: (...argumente: unknown[]) => attrappe.showSaveDialog(...argumente),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  },
  shell: { openExternal: vi.fn() }
}))

const { registerIpcHandlers } = await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')
const { oeffnePfadGeprueft, setzeFreigabenZurueck, merkeOffen, vergissOffen } =
  await import('../../src/main/dokument')
const { setzeArbeitskopienZurueck } = await import('../../src/main/arbeitskopie')

const FIXTURE = resolve('test/fixtures/annotated.pdf')

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

async function geoeffnet(pfad: string): Promise<string> {
  const ergebnis = await oeffnePfadGeprueft(pfad)
  if (!ergebnis.ok) throw new Error('Testaufbau: ' + ergebnis.grund)
  return pfad
}

function rufe<T>(kanal: string, eingabe: unknown): Promise<T> {
  const behandler = attrappe.handler.get(kanal)
  if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
  return Promise.resolve(behandler({ sender: {} }, eingabe) as T)
}

let verzeichnis: string

beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-ipc-extrahieren-bilder-'))
})

beforeEach(() => {
  attrappe.handler.clear()
  attrappe.showSaveDialog.mockReset()
  setzeArbeitskopienZurueck()
  setzeFreigabenZurueck()
  log.error.mockClear()
  log.warn.mockClear()
  log.info.mockClear()
  registerIpcHandlers(dienste())
})

describe('seitenExtrahieren: Ziel in anderem Tab offen', () => {
  it('lehnt ab, wenn das gewaehlte Ziel in einem anderen Tab offen ist', async () => {
    const quelle = join(verzeichnis, 'extrahieren-quelle.pdf')
    copyFileSync(FIXTURE, quelle)
    await geoeffnet(quelle)

    const anderer = join(verzeichnis, 'extrahieren-anderer-tab.pdf')
    copyFileSync(FIXTURE, anderer)
    merkeOffen(anderer)
    try {
      attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: anderer })
      const auftrag: ExtrahierAuftrag = {
        quelle,
        seiten: [1],
        aenderungen: { neue: [], geaendert: [], geloescht: [] },
        formularwerte: {}
      }
      const ergebnis = await rufe<ExtrahierErgebnis>(IPC.seitenExtrahieren, auftrag)
      expect(ergebnis.art).toBe('abgelehnt')
      if (ergebnis.art !== 'abgelehnt') return
      expect(ergebnis.grund).toMatch(/in einem anderen Tab geöffnet/)
    } finally {
      vergissOffen(anderer)
    }
  })

  it('extrahiert normal, wenn das Ziel in keinem anderen Tab offen ist', async () => {
    const quelle = join(verzeichnis, 'extrahieren-quelle-2.pdf')
    copyFileSync(FIXTURE, quelle)
    await geoeffnet(quelle)
    const ziel = join(verzeichnis, 'extrahieren-ziel.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    const auftrag: ExtrahierAuftrag = {
      quelle,
      seiten: [1],
      aenderungen: { neue: [], geaendert: [], geloescht: [] },
      formularwerte: {}
    }
    const ergebnis = await rufe<ExtrahierErgebnis>(IPC.seitenExtrahieren, auftrag)
    expect(ergebnis.art).toBe('gespeichert')
  })
})

describe('bilderZuPdf: Ziel in anderem Tab offen', () => {
  // Echtes 1x1-PNG - pdf-lib dekodiert es beim Einbetten, ein reiner
  // Signaturkopf wie anderswo im Main reicht hier nicht.
  const PNG_1X1 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82
  ])

  function auftrag(vorschlag: string): BildPdfAuftrag {
    return {
      seiten: [{ format: 'png', bytes: PNG_1X1, breitePx: 1, hoehePx: 1 }],
      seitengroesse: 'bild',
      ausrichtung: 'auto',
      randMm: 10,
      vorschlag
    }
  }

  it('lehnt ab, wenn das gewaehlte Ziel in einem anderen Tab offen ist', async () => {
    const anderer = join(verzeichnis, 'bilder-anderer-tab.pdf')
    writeFileSync(anderer, 'platzhalter')
    merkeOffen(anderer)
    try {
      attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: anderer })
      const ergebnis = await rufe<BildPdfErgebnis>(IPC.bilderZuPdf, auftrag('bilder-anderer-tab'))
      expect(ergebnis.art).toBe('abgelehnt')
      if (ergebnis.art !== 'abgelehnt') return
      expect(ergebnis.grund).toMatch(/in einem anderen Tab geöffnet/)
    } finally {
      vergissOffen(anderer)
    }
  })

  it('speichert normal, wenn das Ziel in keinem anderen Tab offen ist', async () => {
    const ziel = join(verzeichnis, 'bilder-ziel.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    const ergebnis = await rufe<BildPdfErgebnis>(IPC.bilderZuPdf, auftrag('bilder-ziel'))
    expect(ergebnis.art).toBe('gespeichert')
  })
})
