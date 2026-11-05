import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aenderungen } from '../../src/shared/aenderungen'
import type { MutationsErgebnis, SpeicherErgebnis, StandErgebnis } from '../../src/shared/ipc'

/**
 * Mehrere Dokumente zugleich (S6.1a, Main-Seite). Der Main fuehrt den Stand
 * je Pfad: Wache, "verschwunden", ungespeichert, offen, Arbeitskopie. Geprueft
 * wird, dass die Tabs sich nicht gegenseitig in die Quere kommen - der echte
 * Handler gegen ein attrappiertes Electron, wie in ipc-speichern.test.ts.
 *
 * Die Dateiwache ist hier eine Attrappe: ob `fs.watch` ein Loeschen meldet,
 * prueft wache.test.ts; hier zaehlt nur, welcher Pfad gemeldet wird.
 */
const attrappe = vi.hoisted(() => ({
  handler: new Map<string, (ereignis: unknown, eingabe: unknown) => unknown>(),
  showMessageBox: vi.fn<(...argumente: unknown[]) => Promise<{ response: number }>>(),
  showSaveDialog:
    vi.fn<(...argumente: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>>(),
  showOpenDialog:
    vi.fn<(...argumente: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
  fenster: null as object | null,
  wachen: [] as { pfad: string; melde: () => void; beendet: boolean }[]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (kanal: string, behandler: (ereignis: unknown, eingabe: unknown) => unknown): void => {
      attrappe.handler.set(kanal, behandler)
    }
  },
  BrowserWindow: { fromWebContents: () => attrappe.fenster },
  dialog: {
    showMessageBox: (...argumente: unknown[]) => attrappe.showMessageBox(...argumente),
    showSaveDialog: (...argumente: unknown[]) => attrappe.showSaveDialog(...argumente),
    showOpenDialog: (...argumente: unknown[]) => attrappe.showOpenDialog(...argumente)
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../../src/main/wache', () => ({
  ueberwache: (pfad: string, beiVerschwinden: () => void) => {
    const eintrag = { pfad, melde: beiVerschwinden, beendet: false }
    attrappe.wachen.push(eintrag)
    return {
      beende: () => {
        eintrag.beendet = true
      }
    }
  }
}))

const { registerIpcHandlers, anzahlUngespeicherterDokumente, setzeDokumentstandZurueck } =
  await import('../../src/main/ipc')
const { IPC } = await import('../../src/shared/ipc')
const { gibSchreibfrei, kanonisch, istOffen, oeffnePfadGeprueft, setzeFreigabenZurueck } =
  await import('../../src/main/dokument')
const { gehalteneBytes, hatArbeitskopie, setzeArbeitskopienZurueck, setzeGesamtgrenze } =
  await import('../../src/main/arbeitskopie')

type Dienste = Parameters<typeof registerIpcHandlers>[0]

const MEHRSEITIG = resolve('test/fixtures/large-500.pdf')
const NICHTS: Aenderungen = { neue: [], geaendert: [], geloescht: [] }
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const melde = vi.fn()

let verzeichnis: string
let einstellungen: { zuletztGeoeffnet: string[]; sitzung: { tabs: string[]; aktiv: number } }
let zaehler = 0

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
    melde,
    drucke: vi.fn()
  }
}

function rufe<T>(kanal: string, eingabe: unknown): Promise<T> {
  const behandler = attrappe.handler.get(kanal)
  if (behandler === undefined) throw new Error('Handler nicht registriert: ' + kanal)
  return Promise.resolve(behandler({ sender: {} }, eingabe) as T)
}

/** Eine eigene Kopie der mehrseitigen Fixture, geoeffnet wie per Drop. */
async function oeffne(name: string): Promise<string> {
  zaehler += 1
  const pfad = join(verzeichnis, String(zaehler) + '-' + name)
  copyFileSync(MEHRSEITIG, pfad)
  // Wie per Drop: der Main kennt den Pfad nicht und fragt nach (Befund 2).
  attrappe.showMessageBox.mockResolvedValueOnce({ response: 0 })
  const ergebnis = await rufe<{ ok: boolean }>(IPC.dokumentOeffnePfad, pfad)
  if (!ergebnis.ok) throw new Error('Testaufbau: nicht geoeffnet')
  return pfad
}

function loescheSeite(pfad: string): Promise<MutationsErgebnis> {
  return rufe<MutationsErgebnis>(IPC.dokumentMutieren, {
    quelle: pfad,
    mutation: { art: 'seitenLoeschen', seiten: [1] },
    aenderungen: NICHTS,
    formularwerte: {}
  })
}

function meldeGeaendert(pfad: string, geaendert: boolean): Promise<void> {
  return rufe<undefined>(IPC.dokumentGeaendert, { pfad, geaendert })
}

beforeAll(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-ipc-tabs-'))
})

beforeEach(() => {
  attrappe.handler.clear()
  attrappe.showMessageBox.mockReset()
  attrappe.showSaveDialog.mockReset()
  attrappe.showOpenDialog.mockReset()
  attrappe.fenster = null
  attrappe.wachen.length = 0
  log.warn.mockClear()
  melde.mockClear()
  einstellungen = { zuletztGeoeffnet: [], sitzung: { tabs: [], aktiv: 0 } }
  setzeFreigabenZurueck()
  setzeArbeitskopienZurueck()
  setzeDokumentstandZurueck()
  registerIpcHandlers(dienste())
})

describe('Aenderungsstand je Pfad', () => {
  it('zaehlt jeden Pfad einmal und setzt mit leerem Pfad alle zurueck', async () => {
    const a = await oeffne('a.pdf')
    const b = await oeffne('b.pdf')
    await meldeGeaendert(a, true)
    await meldeGeaendert(a, true)
    await meldeGeaendert(b, true)
    expect(anzahlUngespeicherterDokumente()).toBe(2)
    await meldeGeaendert(b, false)
    expect(anzahlUngespeicherterDokumente()).toBe(1)
    // "Alle geaendert" ergibt keinen Sinn und aendert nichts.
    await meldeGeaendert('', true)
    expect(anzahlUngespeicherterDokumente()).toBe(1)
    await meldeGeaendert('', false)
    expect(anzahlUngespeicherterDokumente()).toBe(0)
  })

  it('kennt denselben Pfad auch in anderer Schreibweise', async () => {
    const a = await oeffne('schreibweise.pdf')
    await meldeGeaendert(a, true)
    // Der Renderer koennte den Pfad in einer anderen Form nennen, als der
    // Main ihn fuehrt (auf dem CI-Runner: 8.3-Kurzname gegen Langform) - der
    // kanonische Schluessel faengt das ab. Hier nachgestellt mit anderer
    // Schreibweise des Verzeichnisses, die `realpath` wieder vereinheitlicht.
    const anders =
      process.platform === 'win32'
        ? join(dirname(a).toUpperCase(), basename(a)).split('\\').join('/')
        : dirname(a) + '/./' + basename(a)
    expect(anders).not.toBe(a)
    await meldeGeaendert(anders, false)
    expect(anzahlUngespeicherterDokumente()).toBe(0)
  })

  it.each([[null], [true], ['a.pdf'], [{ pfad: 1, geaendert: true }], [{ pfad: 'a.pdf' }]])(
    'ignoriert die kaputte Nutzlast %o',
    async (eingabe) => {
      await expect(rufe(IPC.dokumentGeaendert, eingabe)).resolves.toBeUndefined()
      expect(anzahlUngespeicherterDokumente()).toBe(0)
      expect(log.warn).toHaveBeenCalledWith('Aenderungsmeldung verworfen')
    }
  )
})

describe('Tab schliessen', () => {
  it('laesst den Stand eines anderen Tabs unberuehrt', async () => {
    const a = await oeffne('bleibt.pdf')
    const b = await oeffne('geht.pdf')
    expect((await loescheSeite(a)).art).toBe('angewendet')
    expect((await loescheSeite(b)).art).toBe('angewendet')
    await meldeGeaendert(a, true)
    await meldeGeaendert(b, true)

    await rufe(IPC.dokumentSchliessen, b)

    expect(anzahlUngespeicherterDokumente()).toBe(1)
    expect(hatArbeitskopie(kanonisch(a))).toBe(true)
    expect(hatArbeitskopie(kanonisch(b))).toBe(false)
    expect(istOffen(a)).toBe(true)
    expect(istOffen(b)).toBe(false)
    const wacheA = attrappe.wachen.find((w) => w.pfad === kanonisch(a))
    const wacheB = attrappe.wachen.find((w) => w.pfad === kanonisch(b))
    expect(wacheA?.beendet).toBe(false)
    expect(wacheB?.beendet).toBe(true)
  })

  it('schliesst nur Pfade, die der Main herausgegeben hat', async () => {
    const a = await oeffne('eigen.pdf')
    await loescheSeite(a)
    const fremd = join(verzeichnis, 'fremd.pdf')
    for (const eingabe of [fremd, '', 42, null, 'x'.repeat(40000)]) {
      await expect(rufe(IPC.dokumentSchliessen, eingabe)).resolves.toBeUndefined()
    }
    expect(hatArbeitskopie(kanonisch(a))).toBe(true)
    expect(log.warn).toHaveBeenCalledWith('Schliessen abgelehnt', expect.anything())
  })

  it('fragt modal am Fenster des Absenders und schliesst nur bei Verwerfen', async () => {
    attrappe.fenster = { id: 1 }
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await rufe<boolean>(IPC.tabSchliessenFragen, 'bericht.pdf')).toBe(true)
    const [fenster, frage] = attrappe.showMessageBox.mock.calls[0] ?? []
    expect(fenster).toBe(attrappe.fenster)
    expect((frage as { message: string }).message).toContain('bericht.pdf')
    expect((frage as { cancelId: number }).cancelId).toBe(1)

    attrappe.showMessageBox.mockResolvedValue({ response: 1 })
    expect(await rufe<boolean>(IPC.tabSchliessenFragen, 'bericht.pdf')).toBe(false)
  })

  it('fragt auch ohne Fenster und lehnt einen fehlenden Namen ohne Dialog ab', async () => {
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await rufe<boolean>(IPC.tabSchliessenFragen, 'ohne-fenster.pdf')).toBe(true)
    expect(attrappe.showMessageBox.mock.calls[0]).toHaveLength(1)
    attrappe.showMessageBox.mockClear()
    for (const eingabe of [null, 42, '']) {
      expect(await rufe<boolean>(IPC.tabSchliessenFragen, eingabe)).toBe(false)
    }
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
  })
})

describe('Wache je Pfad', () => {
  it('beendet beim Oeffnen eines zweiten Dokuments nicht die Wache des ersten', async () => {
    const a = await oeffne('wache-a.pdf')
    const b = await oeffne('wache-b.pdf')
    expect(attrappe.wachen.map((w) => [w.pfad, w.beendet])).toEqual([
      [kanonisch(a), false],
      [kanonisch(b), false]
    ])
  })

  it('meldet den kanonischen Pfad der verschwundenen Datei', async () => {
    const a = await oeffne('verschwindet.pdf')
    await oeffne('bleibt-da.pdf')
    attrappe.wachen.find((w) => w.pfad === kanonisch(a))?.melde()
    expect(melde).toHaveBeenCalledTimes(1)
    expect(melde).toHaveBeenCalledWith({ art: 'dokumentVerschwunden', pfad: kanonisch(a) })
  })

  it('sperrt nur das Speichern in die verschwundene Datei', async () => {
    const a = await oeffne('weg.pdf')
    attrappe.wachen.find((w) => w.pfad === kanonisch(a))?.melde()
    const ergebnis = await rufe<SpeicherErgebnis>(IPC.dokumentSpeichern, {
      quelle: a,
      ziel: a,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(ergebnis.art === 'abgelehnt' && ergebnis.grund).toMatch(/verschwunden/)
  })
})

describe('erneutes Oeffnen eines offenen Pfads', () => {
  it('behaelt die Arbeitskopie und liefert ihre Bytes', async () => {
    const a = await oeffne('offen.pdf')
    const mutiert = await loescheSeite(a)
    expect(mutiert.art).toBe('angewendet')
    if (mutiert.art !== 'angewendet') return

    const wieder = await oeffnePfadGeprueft(a)
    expect(wieder.ok).toBe(true)
    if (!wieder.ok) return
    expect(hatArbeitskopie(kanonisch(a))).toBe(true)
    // Was der Tab zeigt, ist was beim Speichern geschrieben wuerde.
    expect(wieder.dokument.bytes).toBe(mutiert.dokument.bytes)
  })
})

describe('Speichern unter', () => {
  it('lehnt ein Ziel ab, das in einem anderen Tab offen ist, bevor geschrieben wird', async () => {
    const a = await oeffne('quelle.pdf')
    const b = await oeffne('anderer-tab.pdf')
    // Die Rueckfragen beim Oeffnen zaehlen hier nicht: geprueft wird, dass das
    // Speichern selbst keinen Dialog zeigt.
    attrappe.showMessageBox.mockClear()
    const vorher = readFileSync(b)
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: b })

    const ergebnis = await rufe<SpeicherErgebnis>(IPC.dokumentSpeichern, {
      quelle: a,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })

    expect(ergebnis.art).toBe('abgelehnt')
    if (ergebnis.art !== 'abgelehnt') return
    expect(ergebnis.grund).toMatch(/in einem anderen Tab geöffnet/)
    expect(readFileSync(b)).toEqual(vorher)
    expect(attrappe.showMessageBox).not.toHaveBeenCalled()
  })

  it('zieht den Tab auf den neuen Pfad um', async () => {
    const a = await oeffne('umzug.pdf')
    await loescheSeite(a)
    const neu = join(verzeichnis, 'umzug-neu.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: neu })

    const ergebnis = await rufe<SpeicherErgebnis>(IPC.dokumentSpeichern, {
      quelle: a,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })

    expect(ergebnis.art).toBe('gespeichert')
    expect(istOffen(a)).toBe(false)
    expect(istOffen(neu)).toBe(true)
    expect(anzahlUngespeicherterDokumente()).toBe(0)
    expect(attrappe.wachen.find((w) => w.pfad === kanonisch(a))?.beendet).toBe(true)
    expect(attrappe.wachen.some((w) => w.pfad === kanonisch(neu) && !w.beendet)).toBe(true)
    const seiten = (await PDFDocument.load(new Uint8Array(readFileSync(neu)))).getPageCount()
    const original = (await PDFDocument.load(new Uint8Array(readFileSync(a)))).getPageCount()
    expect(seiten).toBe(original - 1)
  })
})

describe('gemeinsames Budget der Arbeitskopien', () => {
  it('lehnt eine Mutation ab, die neben den anderen Tabs nicht mehr passt', async () => {
    const a = await oeffne('budget-a.pdf')
    const b = await oeffne('budget-b.pdf')
    const erste = await loescheSeite(a)
    expect(erste.art).toBe('angewendet')
    if (erste.art !== 'angewendet') return
    // Knapp unter zwei Fassungen: der aktuelle Stand von a ist unverzichtbar,
    // eine Fassung von b passt daneben nicht mehr.
    setzeGesamtgrenze(erste.dokument.bytes.byteLength * 1.5)

    const zweite = await loescheSeite(b)

    expect(zweite.art).toBe('abgelehnt')
    if (zweite.art !== 'abgelehnt') return
    expect(zweite.grund).toMatch(/Speichern oder schließen/)
    expect(hatArbeitskopie(kanonisch(b))).toBe(false)
    expect(hatArbeitskopie(kanonisch(a))).toBe(true)
  })

  it('opfert aeltere Staende, bevor es ablehnt', async () => {
    const a = await oeffne('budget-verlauf.pdf')
    const erste = await loescheSeite(a)
    if (erste.art !== 'angewendet') throw new Error('Testaufbau')
    setzeGesamtgrenze(erste.dokument.bytes.byteLength * 1.5)

    // Die zweite Fassung desselben Pfads verdraengt die erste: der Pfad
    // selbst traegt seine Last, die Mutation geht durch.
    const zweite = await loescheSeite(a)
    expect(zweite.art).toBe('angewendet')
    expect(gehalteneBytes()).toBeLessThanOrEqual(erste.dokument.bytes.byteLength * 1.5)
    if (zweite.art !== 'angewendet') return
    const zurueck = await rufe<{ art: string }>(IPC.dokumentStandHerstellen, {
      quelle: a,
      stand: zweite.stand.vorher
    })
    expect(zurueck.art).toBe('abgelehnt')
  })

  it('verdraengt zuletzt auch aeltere Staende anderer Tabs, nie ihre aktuellen', async () => {
    const a = await oeffne('fremd-verlauf-a.pdf')
    const b = await oeffne('fremd-verlauf-b.pdf')
    const a1 = await loescheSeite(a)
    const a2 = await loescheSeite(a)
    if (a1.art !== 'angewendet' || a2.art !== 'angewendet') throw new Error('Testaufbau')
    // Platz fuer drei Fassungen: a haelt zwei, b kommt mit einer dazu und
    // muss dafuer den aelteren Stand von a verdraengen.
    setzeGesamtgrenze(a1.dokument.bytes.byteLength * 2.5)
    const b1 = await loescheSeite(b)
    expect(b1.art).toBe('angewendet')
    expect(hatArbeitskopie(kanonisch(a))).toBe(true)
    const zurueck = await rufe<{ art: string }>(IPC.dokumentStandHerstellen, {
      quelle: a,
      stand: a2.stand.vorher
    })
    expect(zurueck.art).toBe('abgelehnt')
  })
})

/**
 * S7: Rueckgaengig reicht ueber das Speichern hinaus. Das Speichern haelt die
 * Staende der Arbeitskopie, statt sie zu vergessen; ein Rueckgaengig bis vor
 * das Speichern liefert wieder die frueheren Bytes und macht das Dokument
 * ungespeichert.
 */
describe('Rueckgaengig ueber das Speichern', () => {
  const seitenZahl = async (pfad: string): Promise<number> =>
    (await PDFDocument.load(new Uint8Array(readFileSync(pfad)))).getPageCount()
  // Strg+S in die geoeffnete Datei: der Nutzer hat sie einmal ueber "Speichern
  // unter" freigegeben, hier setzt der Test die Freigabe.
  const speichere = (pfad: string): Promise<SpeicherErgebnis> => {
    gibSchreibfrei(kanonisch(pfad))
    return rufe<SpeicherErgebnis>(IPC.dokumentSpeichern, {
      quelle: pfad,
      ziel: pfad,
      verschluesselt: false,
      aenderungen: NICHTS
    })
  }
  const stelleHer = (pfad: string, stand: number): Promise<StandErgebnis> =>
    rufe<StandErgebnis>(IPC.dokumentStandHerstellen, { quelle: pfad, stand })

  it('stellt den Stand vor dem Speichern wieder her und meldet ihn als ungespeichert', async () => {
    const a = await oeffne('s7-zurueck.pdf')
    const original = await seitenZahl(a)
    const mutiert = await loescheSeite(a)
    if (mutiert.art !== 'angewendet') throw new Error('Testaufbau')
    // Das Original ueberschreiben, weil Seiten fehlen: der Nutzer bestaetigt.
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })

    expect((await speichere(a)).art).toBe('gespeichert')
    expect(await seitenZahl(a)).toBe(original - 1)
    expect(hatArbeitskopie(kanonisch(a))).toBe(false)
    expect(anzahlUngespeicherterDokumente()).toBe(0)

    // Zurueck vor die Mutation. Die Platte hat jetzt eine Seite weniger, der
    // Stand 0 - die Datei, wie sie geoeffnet wurde - kommt aus dem Speicher.
    const zurueck = await stelleHer(a, mutiert.stand.vorher)
    expect(zurueck.art).toBe('hergestellt')
    if (zurueck.art !== 'hergestellt') return
    expect((await PDFDocument.load(zurueck.dokument.bytes)).getPageCount()).toBe(original)
    expect(zurueck.sauber).toBe(false)
    expect(hatArbeitskopie(kanonisch(a))).toBe(true)
    expect(anzahlUngespeicherterDokumente()).toBe(1)

    // Speichern schreibt den zurueckgenommenen Stand wieder in die Datei.
    expect((await speichere(a)).art).toBe('gespeichert')
    expect(await seitenZahl(a)).toBe(original)
  })

  it('wiederholt nach dem Speichern: der geschriebene Stand ist wieder die Platte', async () => {
    const a = await oeffne('s7-wiederholen.pdf')
    const original = await seitenZahl(a)
    const mutiert = await loescheSeite(a)
    if (mutiert.art !== 'angewendet') throw new Error('Testaufbau')
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    await speichere(a)

    const zurueck = await stelleHer(a, mutiert.stand.vorher)
    expect(zurueck.art).toBe('hergestellt')
    const vor = await stelleHer(a, mutiert.stand.nachher)
    expect(vor.art).toBe('hergestellt')
    if (vor.art !== 'hergestellt') return
    expect((await PDFDocument.load(vor.dokument.bytes)).getPageCount()).toBe(original - 1)
  })

  it('haelt die Platte als Stand 0 fest, auch wenn es zuvor schon eine Arbeitskopie gab', async () => {
    const a = await oeffne('s7-zwei-mutationen.pdf')
    const original = await seitenZahl(a)
    const erste = await loescheSeite(a)
    const zweite = await loescheSeite(a)
    if (erste.art !== 'angewendet' || zweite.art !== 'angewendet') throw new Error('Testaufbau')
    attrappe.showMessageBox.mockResolvedValue({ response: 0 })
    await speichere(a)
    expect(await seitenZahl(a)).toBe(original - 2)

    // Schritt fuer Schritt zurueck, ueber das Speichern hinweg.
    const einsZurueck = await stelleHer(a, zweite.stand.vorher)
    const nullZurueck = await stelleHer(a, erste.stand.vorher)
    if (einsZurueck.art !== 'hergestellt' || nullZurueck.art !== 'hergestellt') {
      throw new Error('Stand nicht wiederhergestellt')
    }
    expect((await PDFDocument.load(einsZurueck.dokument.bytes)).getPageCount()).toBe(original - 1)
    expect((await PDFDocument.load(nullZurueck.dokument.bytes)).getPageCount()).toBe(original)
  })

  it('zieht die Staende bei "Speichern unter" auf den neuen Pfad um', async () => {
    const a = await oeffne('s7-unter-quelle.pdf')
    const original = await seitenZahl(a)
    const mutiert = await loescheSeite(a)
    if (mutiert.art !== 'angewendet') throw new Error('Testaufbau')
    const neu = join(verzeichnis, 's7-unter-neu.pdf')
    attrappe.showSaveDialog.mockResolvedValue({ canceled: false, filePath: neu })

    const ergebnis = await rufe<SpeicherErgebnis>(IPC.dokumentSpeichern, {
      quelle: a,
      ziel: null,
      verschluesselt: false,
      aenderungen: NICHTS
    })
    expect(ergebnis.art).toBe('gespeichert')

    // Der Tab lebt unter dem neuen Pfad weiter; dorthin geht auch das Rueckgaengig.
    const zurueck = await stelleHer(neu, mutiert.stand.vorher)
    expect(zurueck.art).toBe('hergestellt')
    if (zurueck.art !== 'hergestellt') return
    expect((await PDFDocument.load(zurueck.dokument.bytes)).getPageCount()).toBe(original)
    expect(zurueck.sauber).toBe(false)
    // Die Quelldatei ist nicht angetastet worden.
    expect(await seitenZahl(a)).toBe(original)
  })
})
