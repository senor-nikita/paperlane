import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AnwendungsEreignis } from '../../src/shared/ipc'
import {
  baueKontextmenueVorlage,
  kuerzeAuswahl,
  type KontextUmgebung
} from '../../src/main/kontextmenue'

function umgebung(teil: Partial<KontextUmgebung> = {}): KontextUmgebung {
  return { auswahl: '', kannKopieren: false, sende: () => undefined, ...teil }
}

/**
 * Loest die Klick-Behandlung eines Eintrags aus. Electron reicht dem Klick drei
 * Argumente; unsere Behandlungen benutzen keines davon.
 */
function klicke(eintrag: MenuItemConstructorOptions | undefined): void {
  const behandlung = eintrag?.click as (() => void) | undefined
  behandlung?.()
}

describe('kuerzeAuswahl', () => {
  it('macht die Auswahl einzeilig', () => {
    expect(kuerzeAuswahl('erste Zeile\nzweite  Zeile')).toBe('erste Zeile zweite Zeile')
  })

  // Ungekuerzt zoege ein markierter Absatz das Menue ueber den Bildschirmrand.
  it('kuerzt lange Auswahl', () => {
    const lang = 'a'.repeat(80)
    const gekuerzt = kuerzeAuswahl(lang)
    expect(gekuerzt.endsWith('…')).toBe(true)
    expect(gekuerzt.length).toBeLessThan(lang.length)
  })

  it('macht aus reinem Leerraum eine leere Auswahl', () => {
    expect(kuerzeAuswahl('  \n\t ')).toBe('')
  })
})

describe('baueKontextmenueVorlage', () => {
  it('bietet Kopieren an, wenn Text markiert ist', () => {
    const vorlage = baueKontextmenueVorlage(umgebung({ auswahl: 'Absatz', kannKopieren: true }))
    const kopieren = vorlage.find((eintrag) => eintrag.role === 'copy')
    expect(kopieren?.enabled).toBe(true)
  })

  it('graut Kopieren aus, wenn Electron es nicht erlaubt', () => {
    const vorlage = baueKontextmenueVorlage(umgebung({ auswahl: 'Absatz', kannKopieren: false }))
    expect(vorlage.find((eintrag) => eintrag.role === 'copy')?.enabled).toBe(false)
  })

  it('nennt die Auswahl im Sucheintrag', () => {
    const vorlage = baueKontextmenueVorlage(umgebung({ auswahl: 'Rechnung', kannKopieren: true }))
    expect(vorlage.some((eintrag) => eintrag.label === 'Nach „Rechnung“ suchen')).toBe(true)
  })

  it('schickt den ungekuerzten Text zur Suche', () => {
    const sende = vi.fn<(befehl: AnwendungsEreignis) => void>()
    const lang = 'Sehr langer markierter Abschnitt aus dem Dokument'
    const vorlage = baueKontextmenueVorlage(umgebung({ auswahl: lang, kannKopieren: true, sende }))
    const suchen = vorlage.find((eintrag) => eintrag.label?.startsWith('Nach '))
    klicke(suchen)
    expect(sende).toHaveBeenCalledWith({ art: 'sucheNachAuswahl', text: lang })
  })

  // Ein leeres Kontextmenue geht gar nicht erst auf - der Rechtsklick wirkte
  // dann kaputt statt leer.
  it('bleibt ohne Auswahl bei Alles auswaehlen', () => {
    const vorlage = baueKontextmenueVorlage(umgebung({ auswahl: '   ' }))
    expect(vorlage).toHaveLength(1)
    expect(vorlage[0]?.role).toBe('selectAll')
  })
})
