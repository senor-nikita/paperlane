import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { gibSchreibfrei, oeffnePfadGeprueft, setzeFreigabenZurueck } from '../../src/main/dokument'
import { leseFrage, MAX_GEZEIGTE_PFADE } from '../../src/main/lesen-bestaetigen'
import { MAX_TABNAME } from '../../src/main/schliessen'
import { t } from '../../src/shared/i18n'

/**
 * Die Rueckfrage vor dem Lesen einer Datei, die nur der Renderer nennt, und die
 * Regel dahinter in `oeffnePfadGeprueft`: der Dialog selbst ist modal und per
 * Test nicht zu bedienen (wie bei der Frage beim Beenden), also pruefen wir den
 * Text und die Entscheidung.
 */
describe('leseFrage', () => {
  it('fragt bei einer Datei nach und nennt ihren Pfad', () => {
    const frage = leseFrage(['C:\\ordner\\a.pdf'], false)
    expect(frage.message).toBe(t('lesen.frage', { anzahl: 1 }))
    expect(frage.detail).toBe('\u2022 C:\\ordner\\a.pdf')
    expect(frage.type).toBe('question')
  })

  it('nennt bei mehreren Dateien die Zahl und jede Datei', () => {
    const frage = leseFrage(['C:\\a.png', 'C:\\b.png'], false)
    expect(frage.message).toBe(t('lesen.frage', { anzahl: 2 }))
    expect(frage.detail).toBe('\u2022 C:\\a.png\n\u2022 C:\\b.png')
  })

  it('zeigt hoechstens zehn Pfade und zaehlt den Rest', () => {
    const pfade = Array.from(
      { length: 14 },
      (_, i) => 'C:\\ordner\\datei-' + String(i + 1) + '.png'
    )
    const frage = leseFrage(pfade, false)
    expect(frage.detail).toContain('datei-' + String(MAX_GEZEIGTE_PFADE) + '.png')
    expect(frage.detail).not.toContain('datei-11.png')
    expect(frage.detail).toContain(t('schliessen.weitere', { anzahl: 4 }))
  })

  it('kuerzt einen ueberlangen Pfad', () => {
    const frage = leseFrage(['x'.repeat(MAX_TABNAME * 4)], false)
    expect(frage.detail).toContain('...')
    expect(frage.detail.length).toBeLessThan(MAX_TABNAME + 20)
  })

  it('warnt bei einem Pfad auf einem anderen Rechner und ist mit Abbrechen vorbelegt', () => {
    const frage = leseFrage(['\\\\server\\freigabe\\a.pdf'], true)
    expect(frage.type).toBe('warning')
    expect(frage.detail).toContain(t('lesen.netzwerk'))
    expect(frage.defaultId).toBe(1)
    expect(frage.cancelId).toBe(1)
  })

  it('ist bei einer lokalen Datei mit "Oeffnen" vorbelegt, Abbrechen bleibt der Abbruch', () => {
    const frage = leseFrage(['C:\\a.pdf'], false)
    expect(frage.buttons).toEqual([t('lesen.oeffnen'), t('knopf.abbrechen')])
    expect(frage.defaultId).toBe(0)
    expect(frage.cancelId).toBe(1)
  })
})

describe('oeffnePfadGeprueft mit Rueckfrage', () => {
  let verzeichnis: string
  let pdf: string

  beforeAll(() => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'paperlane-lesen-'))
    pdf = join(verzeichnis, 'bericht.pdf')
    writeFileSync(pdf, '%PDF-1.7\n')
  })

  beforeEach(() => {
    setzeFreigabenZurueck()
  })

  it('fragt bei einem unbekannten lokalen Pfad und liest nach Zustimmung', async () => {
    const bestaetige = vi.fn().mockResolvedValue(true)
    const ergebnis = await oeffnePfadGeprueft(pdf, { bestaetige })
    expect(ergebnis.ok).toBe(true)
    expect(bestaetige).toHaveBeenCalledTimes(1)
    expect(bestaetige.mock.calls[0]?.[1]).toBe(false)
  })

  it('liest nichts, wenn die Rueckfrage abgelehnt wird, und meldet es als Entscheidung', async () => {
    const ergebnis = await oeffnePfadGeprueft(pdf, { bestaetige: () => Promise.resolve(false) })
    expect(ergebnis).toEqual({ ok: false, grund: t('pfad.abgebrochen'), abgebrochen: true })
  })

  it('fragt nicht, wenn der Main den Pfad aus einer eigenen Liste kennt', async () => {
    const bestaetige = vi.fn().mockResolvedValue(false)
    const ergebnis = await oeffnePfadGeprueft(pdf, { bekannt: () => true, bestaetige })
    expect(ergebnis.ok).toBe(true)
    expect(bestaetige).not.toHaveBeenCalled()
  })

  // Eine Datei, die die Anwendung selbst erzeugt hat (Zusammenfuehren, Teilen,
  // Bilder zu PDF): der Nutzer hat ihren Ort im Speichern-Dialog benannt, und sie
  // wird danach geoeffnet. Das darf keine Rueckfrage ausloesen.
  it('fragt nicht bei einem Pfad aus dem Speichern-Dialog', async () => {
    gibSchreibfrei(pdf)
    const bestaetige = vi.fn().mockResolvedValue(false)
    const ergebnis = await oeffnePfadGeprueft(pdf, { bestaetige })
    expect(ergebnis.ok).toBe(true)
    expect(bestaetige).not.toHaveBeenCalled()
  })

  it('uebergibt den kanonischen Pfad an `bekannt`', async () => {
    const bekannt = vi.fn().mockReturnValue(true)
    await oeffnePfadGeprueft(pdf, { bekannt })
    expect(bekannt).toHaveBeenCalledTimes(1)
    expect(String(bekannt.mock.calls[0]?.[0]).toLowerCase()).toContain('bericht.pdf')
  })

  it('meldet bei einem Netzwerkpfad "netz" an die Rueckfrage und liest bei Ablehnung nicht', async () => {
    const bestaetige = vi.fn().mockResolvedValue(false)
    const ergebnis = await oeffnePfadGeprueft('\\\\server.invalid\\freigabe\\a.pdf', { bestaetige })
    expect(bestaetige).toHaveBeenCalledTimes(1)
    expect(bestaetige.mock.calls[0]?.[1]).toBe(true)
    expect(ergebnis).toMatchObject({ ok: false, abgebrochen: true })
  })

  it('lehnt einen unbekannten Netzwerkpfad ab, wenn es keinen Weg zur Rueckfrage gibt', async () => {
    const ergebnis = await oeffnePfadGeprueft('\\\\server.invalid\\freigabe\\a.pdf')
    expect(ergebnis).toEqual({ ok: false, grund: t('pfad.netzwerk') })
  })

  it('fragt bei einem Geraetepfad gar nicht erst', async () => {
    const bestaetige = vi.fn().mockResolvedValue(true)
    const ergebnis = await oeffnePfadGeprueft('\\\\.\\pipe\\x.pdf', { bestaetige })
    expect(ergebnis).toEqual({ ok: false, grund: t('pfad.geraet') })
    expect(bestaetige).not.toHaveBeenCalled()
  })

  it('fragt bei einer Nicht-PDF-Datei nicht: die Endung wird zuerst geprueft', async () => {
    const bestaetige = vi.fn().mockResolvedValue(true)
    const ergebnis = await oeffnePfadGeprueft(join(verzeichnis, 'notiz.txt'), { bestaetige })
    expect(ergebnis.ok).toBe(false)
    expect(bestaetige).not.toHaveBeenCalled()
  })
})
