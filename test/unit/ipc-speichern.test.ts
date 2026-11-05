import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'
import { STANDARD_DRUCKOPTIONEN } from '../../src/shared/druck'
import { verschluesseltText } from '../../src/shared/errors'
import type {
  BildErgebnis,
  Dokumentquelle,
  DruckAntwort,
  MutationsErgebnis,
  PngSchreibErgebnis,
  PngZielErgebnis,
  SpeicherErgebnis,
  TeilErgebnis,
  ZusammenfuehrErgebnis
} from '../../src/shared/ipc'

/**
 * Der Speichern-Handler (S2.3a, Aufgaben 2 bis 6).
 *
 * Drei Exit-Kriterien des Schritts haengen an modalen Dialogen — die
 * Signaturwarnung, der Speichern-Dialog und die Frage beim Schliessen. Ein
 * Playwright-Lauf bliebe daran haengen (derselbe Grund wie bei den externen
 * Verweisen in S2.1). Hier laeuft der echte Handler gegen ein attrappiertes
 * Electron, und die **Reihenfolge** von Fragen und Schreiben wird
 * mitgeschrieben: erst ablehnen, was nicht gehen darf, dann fragen, dann
 * schreiben.
 */
const attrappe = vi.hoisted(() => ({
  handler: new Map<string, (ereignis: unknown, eingabe: unknown) => unknown>(),
  ablauf: [] as string[],
  showMessageBox: vi.fn<(...argumente: unknown[]) => Promise<{ response: number }>>(),
  showSaveDialog:
    vi.fn<(...argumente: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>>(),
  showOpenDialog:
    vi.fn<(...argumente: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>()
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
      attrappe.ablauf.push('gewarnt')
      return attrappe.showMessageBox(...argumente)
    },
    showSaveDialog: (...argumente: unknown[]) => {
      attrappe.ablauf.push('gefragt')
      return attrappe.showSaveDialog(...argumente)
    },
    showOpenDialog: (...argumente: unknown[]) => attrappe.showOpenDialog(...argumente)
  },
  shell: { openExternal: vi.fn() }
}))

const { registerIpcHandlers } = await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')
const { kanonisch, oeffnePfadGeprueft, setzeFreigabenZurueck } =
  await import('../../src/main/dokument')
const { hatArbeitskopie, setzeArbeitskopienZurueck } = await import('../../src/main/arbeitskopie')
type DruckfensterAuftrag = import('../../src/main/druckfenster').DruckAuftrag
type DruckErgebnis = import('../../src/main/druckfenster').DruckErgebnis
type DruckLauf = import('../../src/main/druckfenster').DruckLauf

const FIXTURE = resolve('test/fixtures/annotated.pdf')
const NICHTS: Aenderungen = { neue: [], geaendert: [], geloescht: [] }

type Dienste = Parameters<typeof registerIpcHandlers>[0]

let verzeichnis: string
let einstellungen: { zuletztGeoeffnet: string[]; sitzung: { tabs: string[]; aktiv: number } }

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

/**
 * Das Druckfenster (S4.3) als Attrappe: der Handler baut die Vorlage und
 * reicht sie weiter; was das Fenster daraus macht, entscheidet der Test.
 */
const druckAttrappe = {
  auftraege: [] as DruckfensterAuftrag[],
  antwort: { art: 'gedruckt' } as DruckErgebnis,
  abgebrochen: 0
}
function drucke(auftrag: DruckfensterAuftrag): DruckLauf {
  druckAttrappe.auftraege.push(auftrag)
  return {
    ergebnis: Promise.resolve(druckAttrappe.antwort),
    abbrechen: () => {
      druckAttrappe.abgebrochen++
    }
  }
}

function dienste(): Dienste {
  return {
    settings: {
      lies: () => einstellungen,
      aendere: (patch: Record<string, unknown>) => {
        einstellungen = { ...einstellungen, ...patch }
        return einstellungen
      }
    } as unknown as Dienste['settings'],
    log,
    startDokument: null,
    melde: vi.fn(),
    drucke
  }
}

function annotation(id: string, seite: number, inhalt: string): Annotation {
  return {
    id,
    seite,
    typ: 'Text',
    subtyp: 'Text',
    rect: [70, 700, 90, 720],
    quadPoints: null,
    striche: null,
    farbe: { r: 255, g: 212, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt,
    erstellt: 'D:20260101120000Z',
    geaendert: 'D:20260101120000Z',
    versteckt: false,
    ziel: null,
    roh: null
  }
}

function speichere(auftrag: unknown): Promise<SpeicherErgebnis> {
  const behandler = attrappe.handler.get(IPC.dokumentSpeichern)
  if (behandler === undefined) throw new Error('Handler nicht registriert')
  return Promise.resolve(behandler({ sender: {} }, auftrag) as SpeicherErgebnis)
}

/**
 * "Das geoeffnete Dokument": seit Gate Phase 2 (H2) muss auch die Quelle ein
 * Pfad sein, den der Main selbst herausgegeben hat. Der Weg hier ist derselbe
 * wie bei Drag & Drop - er gibt zum Lesen frei, nicht zum Schreiben.
 */
async function geoeffnet(pfad: string): Promise<string> {
  const ergebnis = await oeffnePfadGeprueft(pfad)
  if (!ergebnis.ok) throw new Error('Testaufbau: ' + ergebnis.grund)
  return pfad
}

/** Eine eigene Kopie der Fixture, ueber den Dialog zum Schreiben freigegeben. */
async function eigeneKopie(name: string): Promise<string> {
  const pfad = join(verzeichnis, name)
  copyFileSync(FIXTURE, pfad)
  await geoeffnet(pfad)
  // Der Dialog ist der einzige Weg in die Schreib-Allowlist (Invariante 11).
  attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pfad })
  await speichere({ quelle: pfad, ziel: null, verschluesselt: false, aenderungen: NICHTS })
  attrappe.ablauf.length = 0
  return pfad
}

beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-ipc-speichern-'))
})

beforeEach(() => {
  attrappe.handler.clear()
  attrappe.ablauf.length = 0
  attrappe.showMessageBox.mockReset()
  attrappe.showSaveDialog.mockReset()
  attrappe.showOpenDialog.mockReset()
  setzeArbeitskopienZurueck()
  log.error.mockClear()
  log.warn.mockClear()
  log.info.mockClear()
  einstellungen = { zuletztGeoeffnet: [], sitzung: { tabs: [], aktiv: 0 } }
  setzeFreigabenZurueck()
  registerIpcHandlers(dienste())
})

describe('Auftragspruefung', () => {
  it.each([
    [null],
    ['ein String'],
    [{ ziel: null }],
    [{ quelle: '', ziel: null, aenderungen: NICHTS }],
    [{ quelle: 'x.pdf', ziel: 42, aenderungen: NICHTS }],
    [{ quelle: 'x.pdf', ziel: null, aenderungen: { neue: 'keine Liste' } }]
  ])('lehnt %o ab, bevor irgendetwas geschieht', async (eingabe) => {
    const ergebnis = await speichere(eingabe)
    expect(ergebnis.art).toBe('abgelehnt')
    expect(attrappe.ablauf).toEqual([])
  })
})

/**
 * Aufgabe 4: pdf-lib kann verschluesselte Dokumente nicht entschluesseln. Mit
 * `ignoreEncryption` kaemen unentschluesselte Streams heraus und das neu
 * geschriebene Dokument waere beschaedigt.
 */
/**
 * Gate Phase 2, H2: Invariante 11 gilt auch fuer die Quelle. Ein Pfad, den der
 * Main nie herausgegeben hat, wird nicht gelesen - sonst koennte ein
 * kompromittierter Renderer ein beliebiges PDF als Quelle nennen und es ueber
 * ein freigegebenes Ziel schreiben.
 */
describe('Quelle', () => {
  it('lehnt eine Quelle ab, die der Main nie herausgegeben hat', async () => {
    const fremd = join(verzeichnis, 'nie-geoeffnet.pdf')
    copyFileSync(FIXTURE, fremd)
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: fremd })

    const ergebnis = await speichere({
      quelle: fremd,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })

    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/nicht das geöffnete Dokument/)
    // Vor jedem Dialog: nichts, was anschliessend abgelehnt wird, wird gefragt.
    expect(attrappe.ablauf).toEqual([])
  })

  it('nimmt einen per "Speichern unter" gewaehlten Pfad beim naechsten Mal als Quelle an', async () => {
    const neu = join(verzeichnis, 'neuer-ort.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: neu })
    const erstes = await speichere({
      quelle: await geoeffnet(FIXTURE),
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(erstes.art).toBe('gespeichert')

    // Der neue Ort steht nur in der Schreibliste - und ist jetzt die Quelle.
    const zweites = await speichere({
      quelle: neu,
      ziel: neu,
      verschluesselt: false,
      aenderungen: { ...NICHTS, neue: [annotation('neu-1', 1, 'nach dem Umzug')] }
    })
    expect(zweites.art).toBe('gespeichert')
  })
})

describe('verschluesselte Dokumente', () => {
  it('lehnt ab, ohne nach einem Ort zu fragen', async () => {
    const ergebnis = await speichere({
      quelle: await geoeffnet(FIXTURE),
      ziel: null,
      verschluesselt: true,
      aenderungen: NICHTS
    })
    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/Passwortgeschützte Dokumente/)
    // Kein Dialog: ein Dialog fuer etwas, das anschliessend abgelehnt wird,
    // waere eine Zumutung.
    expect(attrappe.ablauf).toEqual([])
  })
})

describe('Speichern unter', () => {
  it('fragt nach dem Ort und schreibt dorthin', async () => {
    const ziel = join(verzeichnis, 'kopie.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })

    const ergebnis = await speichere({
      quelle: await geoeffnet(FIXTURE),
      ziel: null,
      verschluesselt: false,
      aenderungen: { ...NICHTS, neue: [annotation('neu-1', 1, 'aus dem Test')] }
    })

    expect(attrappe.ablauf).toEqual(['gefragt'])
    expect(ergebnis.art).toBe('gespeichert')
    if (ergebnis.art !== 'gespeichert') return
    expect(ergebnis.name).toBe('kopie.pdf')
    // Exit-Kriterium: die geschriebene Datei ist ein gueltiges PDF.
    await expect(PDFDocument.load(new Uint8Array(readFileSync(ziel)))).resolves.toBeDefined()
  })

  it('meldet einen Abbruch als Abbruch und nicht als Fehler', async () => {
    attrappe.showSaveDialog.mockResolvedValue({ canceled: true })
    const ergebnis = await speichere({
      quelle: await geoeffnet(FIXTURE),
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(ergebnis.art).toBe('abgebrochen')
  })
})

/**
 * Invariante 11 im Zusammenspiel: ein Pfad, den nur der Renderer nennt, kommt
 * nicht durch. Die Pfadpruefung selbst hat ihren eigenen Guard.
 */
describe('Speichern in die geoeffnete Datei', () => {
  it('lehnt ein Ziel ohne Freigabe ab', async () => {
    const fremd = join(verzeichnis, 'fremd.pdf')
    copyFileSync(FIXTURE, fremd)
    // Per Drag & Drop gelesen: Lesen ja, Schreiben nein.
    await geoeffnet(fremd)

    const ergebnis = await speichere({
      quelle: fremd,
      ziel: fremd,
      verschluesselt: false,
      aenderungen: NICHTS
    })

    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/keine Freigabe zum Schreiben/)
  })

  it('schreibt in ein freigegebenes Ziel und zaehlt die Anmerkung mit', async () => {
    const pfad = await eigeneKopie('eigenes.pdf')
    const vorher = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
    const anzahlVorher = vorher.getPage(0).node.Annots()?.size() ?? 0

    const ergebnis = await speichere({
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: { ...NICHTS, neue: [annotation('neu-1', 1, 'dazugekommen')] }
    })

    expect(ergebnis.art).toBe('gespeichert')
    const nachher = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
    expect(nachher.getPage(0).node.Annots()?.size()).toBe(anzahlVorher + 1)
  })
})

/**
 * Aufgabe 3. **Nicht abschaltbar** und mit "Abbrechen" vorbelegt: D7 macht
 * jede vorhandene Signatur ungueltig, und das ist nichts, was jemand aus
 * Versehen tun sollte.
 */
describe('Signaturwarnung', () => {
  /** Eine Datei mit dem Merkmal, an dem die Warnung haengt: `/ByteRange`. */
  async function mitSignaturmerkmal(name: string): Promise<string> {
    const pfad = await eigeneKopie(name)
    const roh = readFileSync(pfad)
    writeFileSync(pfad, Buffer.concat([roh, Buffer.from('\n% /ByteRange [0 1 2 3]\n')]))
    return pfad
  }

  it('warnt, bevor geschrieben wird', async () => {
    const pfad = await mitSignaturmerkmal('signiert.pdf')
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })

    const ergebnis = await speichere({
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: NICHTS
    })

    expect(attrappe.ablauf).toEqual(['gewarnt'])
    expect(ergebnis.art).toBe('gespeichert')
  })

  it('nennt in der Warnung, was passiert', async () => {
    const pfad = await mitSignaturmerkmal('signiert-2.pdf')
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    await speichere({ quelle: pfad, ziel: pfad, verschluesselt: false, aenderungen: NICHTS })

    const frage = attrappe.showMessageBox.mock.calls[0]?.[0] as {
      detail: string
      defaultId: number
      cancelId: number
    }
    expect(frage.detail).toMatch(/ungültig/)
    // Vorbelegt ist "Abbrechen".
    expect(frage.defaultId).toBe(1)
    expect(frage.cancelId).toBe(1)
  })

  it('schreibt nichts, wenn die Warnung abgelehnt wird', async () => {
    const pfad = await mitSignaturmerkmal('signiert-3.pdf')
    const vorher = readFileSync(pfad)
    attrappe.showMessageBox.mockResolvedValue({ response: 1 })

    const ergebnis = await speichere({
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: { ...NICHTS, neue: [annotation('neu-1', 1, 'darf nicht landen')] }
    })

    expect(ergebnis.art).toBe('abgebrochen')
    expect(readFileSync(pfad)).toEqual(vorher)
  })
})

describe('Aenderungsstand und Ausweichweg', () => {
  it('nimmt den Aenderungsstand des Renderers an', () => {
    const behandler = attrappe.handler.get(IPC.dokumentGeaendert)
    expect(behandler).toBeDefined()
    // Der Wert wird beim Schliessen des Fensters gebraucht; hier genuegt, dass
    // der Kanal ihn annimmt, ohne zu werfen.
    expect(() => behandler?.({ sender: {} }, { pfad: 'a.pdf', geaendert: true })).not.toThrow()
    expect(() => behandler?.({ sender: {} }, { pfad: '', geaendert: false })).not.toThrow()
    // Eine kaputte Nutzlast wird ignoriert, nicht geworfen.
    expect(() => behandler?.({ sender: {} }, true)).not.toThrow()
  })

  // Aufgabe 6: ein anderer Zielort ist der Ausweg, wenn die Originaldatei
  // verschwunden ist.
  it('laesst "Speichern unter" an einen neuen Ort zu', async () => {
    const ziel = join(verzeichnis, 'ausweichen.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    const ergebnis = await speichere({
      quelle: await geoeffnet(FIXTURE),
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(ergebnis.art).toBe('gespeichert')
    expect(existsSync(ziel)).toBe(true)
  })
})

describe('Fehler beim Schreiben', () => {
  it('meldet einen Fehlschlag mit Grund, statt still zu scheitern', async () => {
    // Ein Ziel in einem Verzeichnis, das es nicht gibt: das Schreiben der
    // temporaeren Datei scheitert mit ENOENT.
    const fehlt = join(verzeichnis, 'gibtesnicht', 'ziel.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: fehlt })

    const ergebnis = await speichere({
      quelle: await geoeffnet(FIXTURE),
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })

    expect(ergebnis.art).toBe('abgelehnt')
    expect(log.error).toHaveBeenCalled()
  })
})

/**
 * S3.2, Aufgabe 2: Flachlegen fragt vorher - nicht abschaltbar, mit
 * "Abbrechen" vorbelegt. Per E2E nicht pruefbar (modal), deshalb hier gegen
 * das attrappierte Electron, mit mitgeschriebener Reihenfolge.
 */
describe('Flachlegen', () => {
  const ACROFORM = resolve('test/fixtures/acroform.pdf')

  async function eigenesFormular(name: string): Promise<string> {
    const pfad = join(verzeichnis, name)
    copyFileSync(ACROFORM, pfad)
    await geoeffnet(pfad)
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pfad })
    await speichere({ quelle: pfad, ziel: null, verschluesselt: false, aenderungen: NICHTS })
    attrappe.ablauf.length = 0
    return pfad
  }

  it('warnt, bevor geschrieben wird, und ist mit Abbrechen vorbelegt', async () => {
    const pfad = await eigenesFormular('flach-1.pdf')
    attrappe.showMessageBox.mockResolvedValue({ response: 1 })
    const vorher = readFileSync(pfad)

    const ergebnis = await speichere({
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: NICHTS,
      formularwerte: { 'person.name': 'Max Muster' },
      flachlegen: true
    })

    expect(attrappe.ablauf).toEqual(['gewarnt'])
    expect(ergebnis.art).toBe('abgebrochen')
    // Nichts geschrieben - auch nicht der Feldwert.
    expect(readFileSync(pfad)).toEqual(vorher)

    const frage = attrappe.showMessageBox.mock.calls[0]?.[0] as {
      defaultId: number
      cancelId: number
      buttons: string[]
    }
    expect(frage.defaultId).toBe(1)
    expect(frage.cancelId).toBe(1)
    expect(frage.buttons[1]).toBe('Abbrechen')
  })

  it('legt nach Bestaetigung flach und die Datei hat keine Felder mehr', async () => {
    const pfad = await eigenesFormular('flach-2.pdf')
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })

    const ergebnis = await speichere({
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: NICHTS,
      formularwerte: { 'person.name': 'Max Muster' },
      flachlegen: true
    })

    expect(ergebnis.art).toBe('gespeichert')
    const dokument = await PDFDocument.load(new Uint8Array(readFileSync(pfad)))
    expect(dokument.getForm().getFields()).toHaveLength(0)
  })

  it('lehnt einen Auftrag mit falsch geformten Formularwerten ab', async () => {
    const pfad = await eigenesFormular('flach-3.pdf')
    const ergebnis = await speichere({
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: NICHTS,
      formularwerte: { 'person.name': 42 }
    })
    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/erwartete Form/)
  })
})

/** S3.2, Aufgabe 3: FDF-Export ueber den Dialog, mit denselben Regeln wie Speichern. */
describe('FDF-Export', () => {
  const ACROFORM = resolve('test/fixtures/acroform.pdf')

  function exportiere(auftrag: unknown): Promise<SpeicherErgebnis> {
    const behandler = attrappe.handler.get(IPC.formularFdfExportieren)
    if (behandler === undefined) throw new Error('Handler nicht registriert')
    return Promise.resolve(behandler({ sender: {} }, auftrag) as SpeicherErgebnis)
  }

  it('lehnt eine Quelle ab, die der Main nie herausgegeben hat', async () => {
    const fremd = join(verzeichnis, 'fremd-fdf.pdf')
    copyFileSync(ACROFORM, fremd)
    const ergebnis = await exportiere({ quelle: fremd, formularwerte: {} })
    expect(ergebnis.art).toBe('abgelehnt')
    expect(attrappe.ablauf).toEqual([])
  })

  it('fragt nach dem Ziel und schreibt die FDF-Datei', async () => {
    const pfad = join(verzeichnis, 'export.pdf')
    copyFileSync(ACROFORM, pfad)
    await geoeffnet(pfad)
    const ziel = join(verzeichnis, 'export.fdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })

    const ergebnis = await exportiere({
      quelle: pfad,
      formularwerte: { 'person.name': 'Max Muster' }
    })

    expect(attrappe.ablauf).toEqual(['gefragt'])
    expect(ergebnis.art).toBe('gespeichert')
    const inhalt = readFileSync(ziel, 'latin1')
    expect(inhalt.startsWith('%FDF-1.2')).toBe(true)
    expect(inhalt).toContain('/Root 1 0 R')
    // Die Quelle bleibt unveraendert: ein Export schreibt nicht ins PDF.
    expect(readFileSync(pfad)).toEqual(readFileSync(ACROFORM))
  })

  it('meldet einen Abbruch als Abbruch', async () => {
    const pfad = join(verzeichnis, 'export-2.pdf')
    copyFileSync(ACROFORM, pfad)
    await geoeffnet(pfad)
    attrappe.showSaveDialog.mockResolvedValue({ canceled: true })
    expect((await exportiere({ quelle: pfad, formularwerte: {} })).art).toBe('abgebrochen')
  })

  it('lehnt ein Dokument ohne Felder ab', async () => {
    const pfad = join(verzeichnis, 'ohne-felder.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    attrappe.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: join(verzeichnis, 'ohne.fdf')
    })
    const ergebnis = await exportiere({ quelle: pfad, formularwerte: {} })
    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/keine Formularfelder/)
  })
})

/**
 * S3.2, Aufgabe 4: das Signaturbild kommt ueber den Main — Dialog, Lesen,
 * Pruefung. Der Renderer bekommt eine Data-URL, nie den Pfad.
 */
describe('Signaturbild laden', () => {
  function lade(): Promise<BildErgebnis> {
    const behandler = attrappe.handler.get(IPC.bildLaden)
    if (behandler === undefined) throw new Error('Handler nicht registriert')
    return Promise.resolve(behandler({ sender: {} }, undefined) as BildErgebnis)
  }

  it('liest ein PNG und liefert die Data-URL', async () => {
    const pfad = join(verzeichnis, 'unterschrift.png')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    writeFileSync(pfad, png)
    attrappe.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [pfad] })

    const ergebnis = await lade()
    expect(ergebnis.art).toBe('geladen')
    if (ergebnis.art !== 'geladen') return
    expect(ergebnis.url).toBe('data:image/png;base64,' + png.toString('base64'))
    expect(ergebnis.url).not.toContain(verzeichnis)
  })

  it('lehnt eine Datei ab, die nur wie ein Bild heisst, und protokolliert das', async () => {
    const pfad = join(verzeichnis, 'kein-bild.png')
    writeFileSync(pfad, '%PDF-1.7 nicht wirklich')
    attrappe.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [pfad] })

    const ergebnis = await lade()
    expect(ergebnis.art).toBe('abgelehnt')
    expect(log.warn).toHaveBeenCalledWith('Signaturbild abgelehnt', expect.anything())
  })

  it('gibt einen Abbruch still zurueck', async () => {
    attrappe.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(lade()).resolves.toEqual({ art: 'abgebrochen' })
    expect(log.warn).not.toHaveBeenCalled()
  })
})

/**
 * S4.0: der Mutations-Handler als eine Einheit - Quellpruefung, Einspielen
 * der ungespeicherten Anmerkungen, Arbeitskopie, und das Zusammenspiel mit
 * dem Speichern: was gespeichert wird, ist die Arbeitskopie, nicht die Datei.
 */
describe('Mutation', () => {
  const MEHRSEITIG = resolve('test/fixtures/large-500.pdf')

  function mutiere(auftrag: unknown): Promise<MutationsErgebnis> {
    const behandler = attrappe.handler.get(IPC.dokumentMutieren)
    if (behandler === undefined) throw new Error('Handler nicht registriert')
    return Promise.resolve(behandler({ sender: {} }, auftrag) as MutationsErgebnis)
  }

  async function seitenzahl(bytes: Uint8Array): Promise<number> {
    return (await PDFDocument.load(bytes)).getPageCount()
  }

  it('lehnt eine Quelle ab, die der Main nie herausgegeben hat', async () => {
    const fremd = join(verzeichnis, 'fremd-mutation.pdf')
    copyFileSync(MEHRSEITIG, fremd)
    const ergebnis = await mutiere({
      quelle: fremd,
      mutation: { art: 'seitenLoeschen', seiten: [1] },
      aenderungen: NICHTS,
      formularwerte: {}
    })
    expect(ergebnis.art).toBe('abgelehnt')
    expect(hatArbeitskopie(kanonisch(fremd))).toBe(false)
  })

  it('lehnt einen Auftrag ohne gueltige Mutation ab', async () => {
    const pfad = join(verzeichnis, 'form-mutation.pdf')
    copyFileSync(MEHRSEITIG, pfad)
    await geoeffnet(pfad)
    const ergebnis = await mutiere({
      quelle: pfad,
      mutation: { art: 'seitenLoeschen', seiten: [0] }
    })
    expect(ergebnis.art).toBe('abgelehnt')
  })

  it('wendet die Mutation an, spielt Anmerkungen ein und haelt eine Arbeitskopie', async () => {
    const pfad = join(verzeichnis, 'mutiert.pdf')
    copyFileSync(MEHRSEITIG, pfad)
    const vorher = await seitenzahl(new Uint8Array(readFileSync(pfad)))
    await geoeffnet(pfad)

    const ergebnis = await mutiere({
      quelle: pfad,
      mutation: { art: 'seitenLoeschen', seiten: [1] },
      aenderungen: { ...NICHTS, neue: [annotation('neu-1', 2, 'vor der Mutation')] },
      formularwerte: {}
    })
    expect(ergebnis.art).toBe('angewendet')
    if (ergebnis.art !== 'angewendet') return
    expect(ergebnis.dokument.pfad).toBe(pfad)
    expect(await seitenzahl(ergebnis.dokument.bytes)).toBe(vorher - 1)
    // Die Datei auf der Platte ist unveraendert: die Mutation lebt in der
    // Arbeitskopie, bis gespeichert wird.
    expect(await seitenzahl(new Uint8Array(readFileSync(pfad)))).toBe(vorher)
    expect(hatArbeitskopie(kanonisch(pfad))).toBe(true)
    // Die Anmerkung von Seite 2 steht jetzt auf Seite 1.
    const dokument = await PDFDocument.load(ergebnis.dokument.bytes)
    expect(dokument.getPage(0).node.Annots()?.size()).toBe(1)

    // Eine zweite Mutation baut auf der Arbeitskopie auf.
    const zweite = await mutiere({
      quelle: pfad,
      mutation: { art: 'seitenLoeschen', seiten: [1] },
      aenderungen: NICHTS,
      formularwerte: {}
    })
    expect(zweite.art).toBe('angewendet')
    if (zweite.art !== 'angewendet') return
    expect(await seitenzahl(zweite.dokument.bytes)).toBe(vorher - 2)

    // Speichern schreibt die Arbeitskopie und wirft sie danach weg. Das Ziel
    // kommt aus dem Dialog: ein per Pfad geoeffnetes Dokument traegt nur das
    // Leserecht (Invariante 11). Und weil das Ziel die Quelle ist, fragt der
    // Main vorher (S4.1, Aufgabe 4) - hier bestaetigt.
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pfad })
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    const gespeichert = await speichere({
      quelle: pfad,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(gespeichert.art).toBe('gespeichert')
    expect(await seitenzahl(new Uint8Array(readFileSync(pfad)))).toBe(vorher - 2)
    expect(hatArbeitskopie(kanonisch(pfad))).toBe(false)
  })

  /**
   * S4.1, Aufgabe 4: das Original wird nur auf ausdrueckliche Bestaetigung
   * ueberschrieben. Ohne sie bleibt die Datei, wie sie war - und die
   * Arbeitskopie bleibt, damit "Speichern unter" sie noch schreiben kann.
   */
  it('ueberschreibt das Original nach einer Mutation nur mit Bestaetigung', async () => {
    const pfad = join(verzeichnis, 'nicht-ueberschreiben.pdf')
    copyFileSync(MEHRSEITIG, pfad)
    const vorher = await seitenzahl(new Uint8Array(readFileSync(pfad)))
    await geoeffnet(pfad)
    const ergebnis = await mutiere({
      quelle: pfad,
      mutation: { art: 'seitenLoeschen', seiten: [1] },
      aenderungen: NICHTS,
      formularwerte: {}
    })
    expect(ergebnis.art).toBe('angewendet')

    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pfad })
    attrappe.showMessageBox.mockResolvedValue({ response: 1 })
    const abgebrochen = await speichere({
      quelle: pfad,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(abgebrochen.art).toBe('abgebrochen')
    expect(await seitenzahl(new Uint8Array(readFileSync(pfad)))).toBe(vorher)
    expect(hatArbeitskopie(kanonisch(pfad))).toBe(true)

    // "Speichern unter" an einen anderen Ort fragt nicht.
    const anderswo = join(verzeichnis, 'kopie-ohne-seite-1.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: anderswo })
    attrappe.showMessageBox.mockReset()
    const kopiert = await speichere({
      quelle: pfad,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(kopiert.art).toBe('gespeichert')
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
    expect(await seitenzahl(new Uint8Array(readFileSync(anderswo)))).toBe(vorher - 1)
  })

  it('vergisst die Arbeitskopie, wenn der Pfad erneut gelesen wird', async () => {
    const pfad = join(verzeichnis, 'neu-gelesen.pdf')
    copyFileSync(MEHRSEITIG, pfad)
    await geoeffnet(pfad)
    const ergebnis = await mutiere({
      quelle: pfad,
      mutation: { art: 'seitenLoeschen', seiten: [1] },
      aenderungen: NICHTS,
      formularwerte: {}
    })
    expect(ergebnis.art).toBe('angewendet')
    expect(hatArbeitskopie(kanonisch(pfad))).toBe(true)
    // Seit S6.1 erst, wenn kein Tab den Pfad mehr zeigt: das Schliessen
    // verwirft die Kopie selbst, das erneute Lesen beginnt bei der Platte.
    await attrappe.handler.get(IPC.dokumentSchliessen)?.({ sender: {} }, pfad)
    await geoeffnet(pfad)
    expect(hatArbeitskopie(kanonisch(pfad))).toBe(false)
  })

  it('gibt einen Fehler von pdf-lib als Ablehnung weiter', async () => {
    const pfad = join(verzeichnis, 'einseitig.pdf')
    copyFileSync(resolve('test/fixtures/single-page.pdf'), pfad)
    await geoeffnet(pfad)
    const ergebnis = await mutiere({
      quelle: pfad,
      mutation: { art: 'seitenLoeschen', seiten: [1] },
      aenderungen: NICHTS,
      formularwerte: {}
    })
    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/letzte Seite/)
    expect(hatArbeitskopie(kanonisch(pfad))).toBe(false)
  })
})

/**
 * S4.2a: Zusammenfuehren und Teilen ueber die Handler. Quellen nur aus dem
 * Dialog des Main (Leserecht), Ziel aus dem Dialog (Schreibrecht), beim
 * Teilen ein Verzeichnis und daraus berechnete Dateinamen.
 */
describe('Zusammenfuehren und Teilen', () => {
  const ANNOTIERT = resolve('test/fixtures/annotated.pdf')
  const FORMULAR = resolve('test/fixtures/acroform.pdf')

  function rufe<T>(kanal: string, eingabe: unknown): Promise<T> {
    const behandler = attrappe.handler.get(kanal)
    if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
    return Promise.resolve(behandler({ sender: {} }, eingabe) as T)
  }

  it('waehlt Dokumente im Dialog, gibt sie zum Lesen frei und zaehlt ihre Seiten', async () => {
    const a = join(verzeichnis, 'wahl-a.pdf')
    const b = join(verzeichnis, 'wahl-b.pdf')
    copyFileSync(ANNOTIERT, a)
    copyFileSync(FORMULAR, b)
    attrappe.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [a, b] })
    const quellen = await rufe<Dokumentquelle[] | null>(IPC.dokumenteWaehlen, undefined)
    expect(quellen?.map((q) => [q.name, q.seiten])).toEqual([
      ['wahl-a.pdf', 2],
      ['wahl-b.pdf', 1]
    ])
    // Danach duerfen sie zusammengefuehrt werden - Ziel aus dem Speichern-Dialog.
    const ziel = join(verzeichnis, 'zusammen.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    const ergebnis = await rufe<ZusammenfuehrErgebnis>(IPC.dokumenteZusammenfuehren, {
      quellen: [b, a]
    })
    expect(ergebnis.art).toBe('gespeichert')
    if (ergebnis.art !== 'gespeichert') return
    expect(ergebnis.seiten).toBe(3)
    const doc = await PDFDocument.load(new Uint8Array(readFileSync(ziel)))
    expect(doc.getPageCount()).toBe(3)
    // Reihenfolge wie im Auftrag: das Formular zuerst.
    expect(doc.getForm().getFields().length).toBeGreaterThan(0)
    expect(doc.getPage(1).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
  })

  it('lehnt Quellen ab, die nie ueber einen Dialog kamen', async () => {
    const fremd = join(verzeichnis, 'fremd-zusammen.pdf')
    copyFileSync(ANNOTIERT, fremd)
    const ergebnis = await rufe<ZusammenfuehrErgebnis>(IPC.dokumenteZusammenfuehren, {
      quellen: [fremd, fremd]
    })
    expect(ergebnis.art).toBe('abgelehnt')
    expect(attrappe.showSaveDialog).not.toHaveBeenCalled()
  })

  it('gibt einen abgebrochenen Dialog als abgebrochen zurueck', async () => {
    attrappe.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await rufe(IPC.dokumenteWaehlen, undefined)).toBeNull()
  })

  it('teilt in den gewaehlten Ordner und gibt jede Datei einzeln frei', async () => {
    const pfad = join(verzeichnis, 'teilen.pdf')
    copyFileSync(ANNOTIERT, pfad)
    await geoeffnet(pfad)
    const ordner = join(verzeichnis, 'teile')
    mkdirSync(ordner, { recursive: true })
    attrappe.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [ordner] })

    const ergebnis = await rufe<TeilErgebnis>(IPC.dokumentTeilen, {
      quelle: pfad,
      bereiche: 'einzelseiten'
    })
    expect(ergebnis.art).toBe('gespeichert')
    if (ergebnis.art !== 'gespeichert') return
    expect(ergebnis.dateien.map((d) => basename(d))).toEqual(['teilen-S1.pdf', 'teilen-S2.pdf'])
    for (const datei of ergebnis.dateien) {
      expect(existsSync(datei)).toBe(true)
      expect((await PDFDocument.load(new Uint8Array(readFileSync(datei)))).getPageCount()).toBe(1)
    }

    // Vorhandene Dateien: Rueckfrage; "Abbrechen" laesst sie stehen.
    attrappe.showMessageBox.mockResolvedValue({ response: 1 })
    const zweites = await rufe<TeilErgebnis>(IPC.dokumentTeilen, {
      quelle: pfad,
      bereiche: 'einzelseiten'
    })
    expect(zweites.art).toBe('abgebrochen')
    expect(attrappe.showMessageBox).toHaveBeenCalledTimes(1)
    // Ein Bereich, dessen Datei es noch nicht gibt, fragt nicht.
    attrappe.showMessageBox.mockClear()
    const bereichsteil = await rufe<TeilErgebnis>(IPC.dokumentTeilen, {
      quelle: pfad,
      bereiche: [[1, 2]]
    })
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
    expect(bereichsteil.art).toBe('gespeichert')
    if (bereichsteil.art !== 'gespeichert') return
    expect(bereichsteil.dateien.map((d) => basename(d))).toEqual(['teilen-S1-S2.pdf'])
  })

  it('lehnt ungueltige Bereiche und fremde Quellen ab', async () => {
    const pfad = join(verzeichnis, 'teilen-ungueltig.pdf')
    copyFileSync(ANNOTIERT, pfad)
    await geoeffnet(pfad)
    const ergebnis = await rufe<TeilErgebnis>(IPC.dokumentTeilen, {
      quelle: pfad,
      bereiche: [[1, 5]]
    })
    expect(ergebnis.art).toBe('abgelehnt')
    expect(attrappe.showOpenDialog).not.toHaveBeenCalled()
    const fremd = join(verzeichnis, 'fremd-teilen.pdf')
    copyFileSync(ANNOTIERT, fremd)
    const fremdes = await rufe<TeilErgebnis>(IPC.dokumentTeilen, {
      quelle: fremd,
      bereiche: 'einzelseiten'
    })
    expect(fremdes.art).toBe('abgelehnt')
  })

  /**
   * pdf-lib kann verschluesselte Dokumente nicht lesen. Beide Handler lehnen
   * mit der Erklaerung ab statt mit der pdf-lib-Meldung - und bevor ein
   * Dialog nach dem Ziel fragt.
   */
  it('lehnt eine verschluesselte Quelle vor dem Ziel-Dialog ab', async () => {
    const verschluesselt = join(verzeichnis, 'zusammen-verschluesselt.pdf')
    const offen = join(verzeichnis, 'zusammen-offen.pdf')
    copyFileSync(resolve('test/fixtures/encrypted.pdf'), verschluesselt)
    copyFileSync(ANNOTIERT, offen)
    await geoeffnet(verschluesselt)
    await geoeffnet(offen)
    const ergebnis = await rufe<ZusammenfuehrErgebnis>(IPC.dokumenteZusammenfuehren, {
      quellen: [offen, verschluesselt]
    })
    expect(ergebnis.art === 'abgelehnt' && ergebnis.grund).toContain(verschluesseltText())
    expect(attrappe.showSaveDialog).not.toHaveBeenCalled()
  })

  it('teilt ein verschluesseltes Dokument nicht und fragt nach keinem Ordner', async () => {
    const pfad = join(verzeichnis, 'teilen-verschluesselt.pdf')
    copyFileSync(resolve('test/fixtures/encrypted.pdf'), pfad)
    await geoeffnet(pfad)
    const ergebnis = await rufe<TeilErgebnis>(IPC.dokumentTeilen, {
      quelle: pfad,
      bereiche: 'einzelseiten'
    })
    expect(ergebnis.art === 'abgelehnt' && ergebnis.grund).toContain(verschluesseltText())
    expect(attrappe.showOpenDialog).not.toHaveBeenCalled()
  })
})

/**
 * PNG-Export (S4.2b, Aufgabe 3): die Pfade entstehen im Main. Eine Seite
 * fragt nach einer Datei, mehrere nach einem Ordner; geschrieben wird nur
 * auf freigegebene Pfade und nur, was am Kopf ein PNG ist.
 */
describe('PNG-Export', () => {
  beforeEach(() => {
    setzeFreigabenZurueck()
    setzeArbeitskopienZurueck()
    attrappe.showMessageBox.mockReset()
    attrappe.showSaveDialog.mockReset()
    attrappe.showOpenDialog.mockReset()
    registerIpcHandlers(dienste())
  })

  function rufe<T>(kanal: string, eingabe: unknown): Promise<T> {
    const behandler = attrappe.handler.get(kanal)
    if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
    return Promise.resolve(behandler({ sender: {} }, eingabe) as T)
  }

  /** Ein PNG am Kopf; der Rest ist fuer den Handler unerheblich. */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

  it('fragt fuer eine Seite nach einer Datei und schreibt nur dorthin', async () => {
    const pfad = join(verzeichnis, 'png-eins.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    const ziel = join(verzeichnis, 'png-eins-S2.png')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })

    const ziele = await rufe<PngZielErgebnis>(IPC.pngZieleWaehlen, { quelle: pfad, seiten: [2] })
    expect(ziele.art).toBe('freigegeben')
    if (ziele.art !== 'freigegeben') return
    expect(ziele.ziele).toEqual([{ seite: 2, pfad: kanonisch(ziel) }])
    // Der Vorschlag folgt dem Namensschema des Teilens.
    const optionen = attrappe.showSaveDialog.mock.calls[0]?.[0] as { defaultPath: string }
    expect(basename(optionen.defaultPath)).toBe('png-eins-S2.png')
    expect(attrappe.showOpenDialog).not.toHaveBeenCalled()

    const geschrieben = await rufe<PngSchreibErgebnis>(IPC.pngSchreiben, {
      pfad: ziele.ziele[0]?.pfad,
      bytes: PNG
    })
    expect(geschrieben.art).toBe('geschrieben')
    expect(new Uint8Array(readFileSync(ziel))).toEqual(PNG)

    // Ein Pfad, den kein Dialog herausgab, wird nicht beschrieben.
    const fremd = join(verzeichnis, 'png-fremd.png')
    const abgelehnt = await rufe<PngSchreibErgebnis>(IPC.pngSchreiben, { pfad: fremd, bytes: PNG })
    expect(abgelehnt.art).toBe('abgelehnt')
    expect(existsSync(fremd)).toBe(false)
    // Und auf einen freigegebenen nur ein PNG.
    const keinPng = await rufe<PngSchreibErgebnis>(IPC.pngSchreiben, {
      pfad: ziele.ziele[0]?.pfad,
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
    expect(keinPng.art).toBe('abgelehnt')
    expect(new Uint8Array(readFileSync(ziel))).toEqual(PNG)
  })

  it('fragt fuer mehrere Seiten nach einem Ordner und gibt jede Datei einzeln frei', async () => {
    const pfad = join(verzeichnis, 'png-viele.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    const ordner = join(verzeichnis, 'bilder')
    attrappe.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [ordner] })

    const ziele = await rufe<PngZielErgebnis>(IPC.pngZieleWaehlen, {
      quelle: pfad,
      seiten: [2, 1, 2]
    })
    expect(ziele.art).toBe('freigegeben')
    if (ziele.art !== 'freigegeben') return
    // Sortiert und ohne Doppelte.
    expect(ziele.ziele.map((z) => [z.seite, basename(z.pfad)])).toEqual([
      [1, 'png-viele-S1.png'],
      [2, 'png-viele-S2.png']
    ])
    expect(attrappe.showSaveDialog).not.toHaveBeenCalled()
    for (const ziel of ziele.ziele) {
      const ergebnis = await rufe<PngSchreibErgebnis>(IPC.pngSchreiben, {
        pfad: ziel.pfad,
        bytes: PNG
      })
      expect(ergebnis.art).toBe('geschrieben')
      expect(existsSync(ziel.pfad)).toBe(true)
    }

    // Vorhandene Dateien: Rueckfrage, "Abbrechen" laesst sie stehen.
    attrappe.showMessageBox.mockResolvedValue({ response: 1 })
    const zweites = await rufe<PngZielErgebnis>(IPC.pngZieleWaehlen, {
      quelle: pfad,
      seiten: [1, 2]
    })
    expect(zweites.art).toBe('abgebrochen')
    expect(attrappe.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('lehnt fremde Quellen, leere Auftraege und ungueltige Seiten ab', async () => {
    const fremd = join(verzeichnis, 'png-fremd.pdf')
    copyFileSync(FIXTURE, fremd)
    expect(
      (await rufe<PngZielErgebnis>(IPC.pngZieleWaehlen, { quelle: fremd, seiten: [1] })).art
    ).toBe('abgelehnt')
    const pfad = join(verzeichnis, 'png-form.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    for (const seiten of [[], [0], [1.5], ['1']]) {
      expect((await rufe<PngZielErgebnis>(IPC.pngZieleWaehlen, { quelle: pfad, seiten })).art).toBe(
        'abgelehnt'
      )
    }
    expect(attrappe.showSaveDialog).not.toHaveBeenCalled()
    expect(attrappe.showOpenDialog).not.toHaveBeenCalled()
  })
})

/**
 * Drucken (S4.3): der Handler prueft die Quelle, baut die Vorlage aus
 * Arbeitskopie plus ungespeicherten Aenderungen und reicht sie dem
 * Druckfenster; fuer die Datei fragt er vorher nach dem Ziel.
 */
describe('Drucken', () => {
  beforeEach(() => {
    setzeFreigabenZurueck()
    setzeArbeitskopienZurueck()
    attrappe.showMessageBox.mockReset()
    attrappe.showSaveDialog.mockReset()
    druckAttrappe.auftraege = []
    druckAttrappe.antwort = { art: 'gedruckt' }
    druckAttrappe.abgebrochen = 0
    registerIpcHandlers(dienste())
  })

  function rufe<T>(kanal: string, eingabe: unknown): Promise<T> {
    const behandler = attrappe.handler.get(kanal)
    if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
    return Promise.resolve(behandler({ sender: {} }, eingabe) as T)
  }

  const auftrag = (
    quelle: string,
    rest: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    quelle,
    optionen: STANDARD_DRUCKOPTIONEN,
    ziel: 'drucker',
    aenderungen: NICHTS,
    formularwerte: {},
    ...rest
  })

  it('baut die Vorlage mit den ungespeicherten Anmerkungen und druckt', async () => {
    const pfad = join(verzeichnis, 'drucken.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    const antwort = await rufe<DruckAntwort>(
      IPC.dokumentDrucken,
      auftrag(pfad, {
        optionen: { ...STANDARD_DRUCKOPTIONEN, seiten: [[2, 2]] },
        aenderungen: { neue: [annotation('n1', 2, 'Gedruckt')], geaendert: [], geloescht: [] }
      })
    )
    expect(antwort).toEqual({ art: 'gedruckt' })
    expect(druckAttrappe.auftraege).toHaveLength(1)
    const vorlage = druckAttrappe.auftraege[0]?.vorlage
    expect(vorlage?.seiten).toBe(1)
    const doc = await PDFDocument.load(vorlage?.bytes ?? new Uint8Array())
    expect(doc.getPageCount()).toBe(1)
    // Die neue Notiz steht auf der einzigen Seite der Vorlage.
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBeGreaterThan(0)
    expect(druckAttrappe.auftraege[0]?.ziel).toEqual({ art: 'drucker' })
  })

  it('fragt fuer die Datei nach dem Ziel und schuetzt das Original', async () => {
    const pfad = join(verzeichnis, 'drucken-datei.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    const ziel = join(verzeichnis, 'drucken-datei-druck.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: ziel })
    druckAttrappe.antwort = { art: 'gespeichert', pfad: ziel, seiten: 2 }
    const antwort = await rufe<DruckAntwort>(IPC.dokumentDrucken, auftrag(pfad, { ziel: 'datei' }))
    expect(antwort).toEqual({ art: 'gespeichert', pfad: ziel, name: basename(ziel), seiten: 2 })
    expect(druckAttrappe.auftraege[0]?.ziel).toEqual({ art: 'datei', pfad: kanonisch(ziel) })

    // Das geoeffnete Dokument als Ziel: abgelehnt, bevor etwas gebaut wird.
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pfad })
    const zurueck = await rufe<DruckAntwort>(IPC.dokumentDrucken, auftrag(pfad, { ziel: 'datei' }))
    expect(zurueck.art).toBe('abgelehnt')
    expect(druckAttrappe.auftraege).toHaveLength(1)
    // Abbruch im Dialog: abgebrochen, kein Druck.
    attrappe.showSaveDialog.mockResolvedValue({ canceled: true })
    const abgebrochen = await rufe<DruckAntwort>(
      IPC.dokumentDrucken,
      auftrag(pfad, { ziel: 'datei' })
    )
    expect(abgebrochen.art).toBe('abgebrochen')
  })

  it('lehnt fremde Quellen und unvollstaendige Auftraege ab und bricht nur Laufendes ab', async () => {
    const fremd = join(verzeichnis, 'drucken-fremd.pdf')
    copyFileSync(FIXTURE, fremd)
    expect((await rufe<DruckAntwort>(IPC.dokumentDrucken, auftrag(fremd))).art).toBe('abgelehnt')
    const pfad = join(verzeichnis, 'drucken-form.pdf')
    copyFileSync(FIXTURE, pfad)
    await geoeffnet(pfad)
    const halb = await rufe<DruckAntwort>(
      IPC.dokumentDrucken,
      auftrag(pfad, { optionen: { seiten: 'alle' } })
    )
    expect(halb.art).toBe('abgelehnt')
    const fax = await rufe<DruckAntwort>(IPC.dokumentDrucken, auftrag(pfad, { ziel: 'fax' }))
    expect(fax.art).toBe('abgelehnt')
    expect(druckAttrappe.auftraege).toHaveLength(0)
    expect(await rufe<boolean>(IPC.druckAbbrechen, undefined)).toBe(false)
  })

  it('druckt ein verschluesseltes Dokument nicht und nennt den Grund', async () => {
    const pfad = join(verzeichnis, 'drucken-verschluesselt.pdf')
    copyFileSync(resolve('test/fixtures/encrypted.pdf'), pfad)
    await geoeffnet(pfad)
    const antwort = await rufe<DruckAntwort>(IPC.dokumentDrucken, auftrag(pfad))
    expect(antwort.art === 'abgelehnt' && antwort.grund).toContain(verschluesseltText())
    expect(druckAttrappe.auftraege).toHaveLength(0)
  })
})
