// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WordAuftrag } from '../../src/shared/ipc'
import { kleinesPng } from '../helpers/png'

/**
 * PDF nach Word im Main (S6.7): die Eingabepruefung - der Renderer ist nicht
 * vertrauenswuerdig - und der Handler mit Dialog und Schreibpfad
 * (Invariante 11) gegen ein attrappiertes Electron.
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
    showSaveDialog: (...argumente: unknown[]) => attrappe.showSaveDialog(...argumente),
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

const word = await import('../../src/main/word')
const { registerIpcHandlers } = await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')
const { oeffnePfadGeprueft, setzeFreigabenZurueck } = await import('../../src/main/dokument')

const PNG = new Uint8Array(kleinesPng(3, 2))

function auftrag(teil: Partial<WordAuftrag> = {}): WordAuftrag {
  return {
    quelle: 'C:\\d\\a.pdf',
    seitenumbruch: true,
    seiten: [
      {
        breitePt: 595,
        hoehePt: 842,
        bloecke: [
          {
            art: 'absatz',
            ebene: 1,
            laeufe: [{ text: 'Titel', fett: true, kursiv: false, groessePt: 20 }]
          },
          { art: 'bild', png: PNG, breitePt: 100, hoehePt: 50 }
        ]
      }
    ],
    ...teil
  }
}

/** Setzt einen Wert tief im Auftrag - fuer die Ablehnungsfaelle. */
function mit(pfad: (string | number)[], wert: unknown): unknown {
  const kopie = structuredClone(auftrag()) as unknown as Record<string | number, unknown>
  let ziel = kopie
  for (const schluessel of pfad.slice(0, -1)) ziel = ziel[schluessel] as typeof ziel
  const letzter = pfad[pfad.length - 1]
  if (letzter !== undefined) ziel[letzter] = wert
  return kopie
}

describe('istPng', () => {
  it('prueft Signatur, IHDR und Masse', () => {
    expect(word.istPng(PNG)).toBe(true)
    expect(word.istPng(PNG.slice(0, 20))).toBe(false)
    const falsch = PNG.slice()
    falsch[1] = 0
    expect(word.istPng(falsch)).toBe(false)
    const keinIhdr = PNG.slice()
    keinIhdr[12] = 0x58
    expect(word.istPng(keinIhdr)).toBe(false)
    const nullBreit = PNG.slice()
    nullBreit.set([0, 0, 0, 0], 16)
    expect(word.istPng(nullBreit)).toBe(false)
  })
})

describe('bereinigeText', () => {
  it('entfernt Zeichen, die XML 1.0 verbietet', () => {
    expect(word.bereinigeText('a\u0000b\u0007c\u001Fd\uFFFEe\uFFFF')).toBe('abcde')
    expect(word.bereinigeText('a\tb\nc\rd')).toBe('a b c d')
    expect(word.bereinigeText('x\uD800y\uDC00z')).toBe('xyz')
    expect(word.bereinigeText('Umlaut \u00e4 und \uD83D\uDE00')).toBe(
      'Umlaut \u00e4 und \uD83D\uDE00'
    )
  })
})

describe('pruefeWordAuftrag', () => {
  it('nimmt einen gueltigen Auftrag an und baut ihn neu auf', () => {
    const eingabe = { ...auftrag(), fremd: 'weg' }
    const ergebnis = word.pruefeWordAuftrag(eingabe)
    expect(ergebnis.ok).toBe(true)
    if (!ergebnis.ok) return
    expect(ergebnis.auftrag).not.toHaveProperty('fremd')
    expect(ergebnis.auftrag.seiten[0]?.bloecke[1]).toMatchObject({ art: 'bild', breitePt: 100 })
  })

  it('klemmt die Schriftgroesse und bereinigt den Text', () => {
    const ergebnis = word.pruefeWordAuftrag(
      mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0], {
        text: 'a\u0001b',
        fett: false,
        kursiv: false,
        groessePt: 5000
      })
    )
    expect(ergebnis.ok && ergebnis.auftrag.seiten[0]?.bloecke[0]).toEqual({
      art: 'absatz',
      ebene: 1,
      laeufe: [{ text: 'ab', fett: false, kursiv: false, groessePt: word.MAX_SCHRIFT_PT }]
    })
  })

  it.each([
    ['kein Objekt', null],
    ['Liste', []],
    ['ohne Quelle', mit(['quelle'], '')],
    ['Quelle keine Zeichenkette', mit(['quelle'], 7)],
    ['Umbruch kein Wahrheitswert', mit(['seitenumbruch'], 'ja')],
    ['keine Seiten', mit(['seiten'], [])],
    ['Seiten keine Liste', mit(['seiten'], {})],
    ['Seite kein Objekt', mit(['seiten', 0], 1)],
    ['Seite ohne Masse', mit(['seiten', 0, 'breitePt'], 0)],
    ['Seite unendlich', mit(['seiten', 0, 'hoehePt'], Infinity)],
    ['Seite zu gross', mit(['seiten', 0, 'hoehePt'], 20000)],
    ['Bloecke keine Liste', mit(['seiten', 0, 'bloecke'], null)],
    ['Block kein Objekt', mit(['seiten', 0, 'bloecke', 0], 'x')],
    ['Block unbekannt', mit(['seiten', 0, 'bloecke', 0, 'art'], 'tabelle')],
    ['Ebene ungueltig', mit(['seiten', 0, 'bloecke', 0, 'ebene'], 4)],
    ['Laeufe keine Liste', mit(['seiten', 0, 'bloecke', 0, 'laeufe'], 'x')],
    ['Lauf kein Objekt', mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0], 3)],
    ['Lauf ohne Text', mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0, 'text'], 1)],
    ['Lauf fett ungueltig', mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0, 'fett'], 1)],
    ['Lauf Groesse null', mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0, 'groessePt'], 0)],
    ['Lauf Groesse NaN', mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0, 'groessePt'], NaN)],
    ['Bild ohne Bytes', mit(['seiten', 0, 'bloecke', 1, 'png'], [1, 2])],
    ['Bild kein PNG', mit(['seiten', 0, 'bloecke', 1, 'png'], new Uint8Array(40))],
    ['Bild ohne Masse', mit(['seiten', 0, 'bloecke', 1, 'hoehePt'], -1)]
  ])('lehnt ab: %s', (_fall, eingabe) => {
    expect(word.pruefeWordAuftrag(eingabe).ok).toBe(false)
  })

  it('begrenzt Seiten, Laeufe, Bildgroesse und Textmenge', () => {
    const seite = auftrag().seiten[0]
    expect(
      word.pruefeWordAuftrag({ ...auftrag(), seiten: new Array(word.MAX_SEITEN + 1).fill(seite) })
        .ok
    ).toBe(false)
    const lauf = { text: 'x', fett: false, kursiv: false, groessePt: 11 }
    expect(
      word.pruefeWordAuftrag(
        mit(
          ['seiten', 0, 'bloecke', 0, 'laeufe'],
          new Array(word.MAX_LAEUFE_JE_ABSATZ + 1).fill(lauf)
        )
      ).ok
    ).toBe(false)
    const riesig = new Uint8Array(word.MAX_BILD_BYTES + 1)
    riesig.set(PNG)
    expect(word.pruefeWordAuftrag(mit(['seiten', 0, 'bloecke', 1, 'png'], riesig)).ok).toBe(false)
    const langerText = { ...lauf, text: 'x'.repeat(word.MAX_ZEICHEN + 1) }
    const zuViel = word.pruefeWordAuftrag(mit(['seiten', 0, 'bloecke', 0, 'laeufe', 0], langerText))
    expect(zuViel).toEqual({
      ok: false,
      grund: 'Das Dokument enthält zu viel Text für den Export.'
    })
  })

  it('zaehlt Bloecke und Bilder ueber alle Seiten', () => {
    const block = { art: 'bild', png: PNG, breitePt: 10, hoehePt: 10 }
    const seiten = [
      { breitePt: 100, hoehePt: 100, bloecke: new Array(word.MAX_BILDER + 1).fill(block) }
    ]
    expect(word.pruefeWordAuftrag({ ...auftrag(), seiten })).toEqual({
      ok: false,
      grund: 'Das Dokument hat zu viele Bilder für den Export.'
    })
  })
})

describe('rand und bildMasse', () => {
  it('nimmt einen Zoll Rand, auf kleinen Seiten weniger', () => {
    expect(word.rand(1000, 1200)).toBe(72)
    expect(word.rand(595, 842)).toBe(60)
    expect(word.rand(142, 85)).toBe(9)
    expect(word.rand(300, 200)).toBe(20)
  })

  it('passt Bilder in den Satzspiegel und rechnet in 96 dpi', () => {
    expect(word.bildMasse(72, 36, 451, 698)).toEqual({ breite: 96, hoehe: 48 })
    expect(word.bildMasse(902, 451, 451, 698)).toEqual({ breite: 601, hoehe: 301 })
    expect(word.bildMasse(100, 1400, 451, 698)).toEqual({ breite: 66, hoehe: 931 })
  })
})

describe('baueDocx', () => {
  it('schreibt ein leeres Dokument mit einem Absatz', async () => {
    const bytes = await word.baueDocx(
      { quelle: 'x', seitenumbruch: false, seiten: [{ breitePt: 595, hoehePt: 842, bloecke: [] }] },
      { titel: 'x' }
    )
    const gelesen = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    expect(gelesen.value.trim()).toBe('')
  })

  it('traegt Ueberschrift, fett und Bild', async () => {
    const bytes = await word.baueDocx(auftrag(), { titel: 'a' })
    const html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value
    expect(html).toMatch(/^<h1><strong>Titel<\/strong><\/h1><p><img src="data:image\/png;base64,/)
  })
})

describe('Handler wordExportieren', () => {
  let verzeichnis: string
  let quelle: string
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

  beforeEach(async () => {
    attrappe.handler.clear()
    attrappe.showSaveDialog.mockReset()
    setzeFreigabenZurueck()
    verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-word-'))
    quelle = join(verzeichnis, 'bericht.pdf')
    writeFileSync(quelle, readFileSync('test/fixtures/word.pdf'))
    registerIpcHandlers({
      settings: {
        lies: () => ({ zuletztGeoeffnet: [] }),
        aendere: () => ({})
      } as unknown as Parameters<typeof registerIpcHandlers>[0]['settings'],
      log,
      startDokument: null,
      melde: vi.fn(),
      drucke: vi.fn()
    })
    await oeffnePfadGeprueft(quelle)
  })

  const rufe = (eingabe: unknown) =>
    attrappe.handler.get(IPC.wordExportieren)?.({ sender: {} }, eingabe) as Promise<unknown>

  it('fragt nach dem Ziel und schreibt die .docx atomar', async () => {
    const ziel = join(verzeichnis, 'bericht.docx')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    const ergebnis = await rufe(auftrag({ quelle }))
    expect(ergebnis).toMatchObject({ art: 'gespeichert', name: 'bericht.docx' })
    expect(attrappe.showSaveDialog.mock.calls[0]?.[0]).toMatchObject({
      defaultPath: join(verzeichnis, 'bericht.docx'),
      filters: [{ extensions: ['docx'] }]
    })
    const text = await mammoth.extractRawText({ path: ziel })
    expect(text.value.trim()).toBe('Titel')
    expect(existsSync(ziel + '.paperlane-tmp')).toBe(false)
  })

  it('lehnt eine Quelle ab, die der Main nicht herausgegeben hat', async () => {
    const ergebnis = await rufe(auftrag({ quelle: join(verzeichnis, 'fremd.pdf') }))
    expect(ergebnis).toEqual({
      art: 'abgelehnt',
      grund: 'Die genannte Quelle ist nicht das geöffnete Dokument.'
    })
    expect(attrappe.showSaveDialog).not.toHaveBeenCalled()
  })

  it('lehnt einen kaputten Auftrag vor dem Dialog ab', async () => {
    expect(await rufe({ quelle })).toMatchObject({ art: 'abgelehnt' })
    expect(attrappe.showSaveDialog).not.toHaveBeenCalled()
  })

  it('bricht ab, wenn der Dialog abgebrochen wird', async () => {
    attrappe.showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await rufe(auftrag({ quelle }))).toEqual({ art: 'abgebrochen' })
  })

  it('schreibt nur .docx (Invariante 11)', async () => {
    const ziel = join(verzeichnis, 'bericht.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    expect(await rufe(auftrag({ quelle }))).toEqual({
      art: 'abgelehnt',
      grund: 'Es lassen sich nur DOCX-Dateien schreiben: bericht.pdf'
    })
    expect(readFileSync(ziel)).toEqual(readFileSync('test/fixtures/word.pdf'))
  })

  it('meldet einen Schreibfehler als Ablehnung', async () => {
    const ziel = join(verzeichnis, 'fehlt', 'bericht.docx')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    const ergebnis = (await rufe(auftrag({ quelle }))) as { art: string; grund: string }
    expect(ergebnis.art).toBe('abgelehnt')
    expect(ergebnis.grund).toMatch(/^Das Word-Dokument ließ sich nicht schreiben: /)
  })
})
