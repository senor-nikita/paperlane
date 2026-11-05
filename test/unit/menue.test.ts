import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  beschreibeBefehl,
  FENSTER_SCHLIESSEN,
  findeKuerzel,
  KUERZEL,
  type Befehl
} from '../../src/shared/tastatur'
import { baueMenueVorlage, type MenueUmgebung } from '../../src/main/menue'
import { setzeSprache } from '../../src/shared/i18n'

function umgebung(teil: Partial<MenueUmgebung> = {}): MenueUmgebung {
  return {
    plattform: 'win32',
    sende: () => undefined,
    ueberAnwendung: () => undefined,
    ...teil
  }
}

function untermenue(
  vorlage: MenuItemConstructorOptions[],
  beschriftung: string
): MenuItemConstructorOptions[] {
  const eintrag = vorlage.find((element) => element.label === beschriftung)
  if (eintrag === undefined) throw new Error('Kein Menue mit der Beschriftung: ' + beschriftung)
  const inhalt = eintrag.submenu
  if (!Array.isArray(inhalt)) throw new Error('Menue ohne Eintraege: ' + beschriftung)
  return inhalt
}

/**
 * Loest die Klick-Behandlung eines Eintrags aus.
 *
 * Electron reicht dem Klick drei Argumente; unsere Behandlungen benutzen keines
 * davon. Die Umdeutung auf eine parameterlose Funktion ist ehrlicher als drei
 * erfundene Attrappen.
 */
function klicke(eintrag: MenuItemConstructorOptions | undefined): void {
  const behandlung = eintrag?.click as (() => void) | undefined
  behandlung?.()
}

/** Alle Eintraege ueber alle Ebenen, flach. */
function alleEintraege(vorlage: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return vorlage.flatMap((eintrag) =>
    Array.isArray(eintrag.submenu) ? [eintrag, ...alleEintraege(eintrag.submenu)] : [eintrag]
  )
}

describe('baueMenueVorlage', () => {
  it('legt Datei, Bearbeiten, Ansicht und Hilfe an', () => {
    const vorlage = baueMenueVorlage(umgebung())
    expect(vorlage.map((eintrag) => eintrag.label)).toEqual([
      'Datei',
      'Bearbeiten',
      'Ansicht',
      'Hilfe'
    ])
  })

  // Der eigentliche Zweck von S1.3b: ein eigenes Menue verdraengt Electrons
  // Standardmenue. Fehlen diese Rollen, ist Strg+C auf der Textauswahl tot.
  it('behaelt Kopieren und Alles auswaehlen als Rollen', () => {
    const bearbeiten = untermenue(baueMenueVorlage(umgebung()), 'Bearbeiten')
    expect(bearbeiten.map((eintrag) => eintrag.role)).toContain('copy')
    expect(bearbeiten.map((eintrag) => eintrag.role)).toContain('selectAll')
  })

  // Eigene Eintraege sind die ohne Rolle; die Rolle `close` traegt seit
  // S6.1b einen eigenen Accelerator (Test unten).
  it('nimmt jeden Accelerator aus der Kuerzel-Map', () => {
    const erlaubt = new Set(KUERZEL.map((kuerzel) => kuerzel.accelerator))
    const eigene = alleEintraege(baueMenueVorlage(umgebung())).filter(
      (eintrag) => eintrag.accelerator !== undefined && eintrag.role === undefined
    )
    expect(eigene.length).toBeGreaterThan(0)
    for (const eintrag of eigene) {
      expect(erlaubt).toContain(eintrag.accelerator)
    }
  })

  // Registriert wuerde derselbe Tastendruck zweimal wirken: einmal ueber das
  // Menue, einmal ueber die Behandlung im Fenster (ADR 0002).
  it('registriert die eigenen Accelerators nicht beim System', () => {
    const eigene = alleEintraege(baueMenueVorlage(umgebung())).filter(
      (eintrag) => eintrag.accelerator !== undefined && eintrag.role === undefined
    )
    for (const eintrag of eigene) {
      expect(eintrag.registerAccelerator).toBe(false)
    }
  })

  it('schickt beim Klick den Befehl aus der Kuerzel-Map', () => {
    const sende = vi.fn<(befehl: Befehl) => void>()
    const ansicht = untermenue(baueMenueVorlage(umgebung({ sende })), 'Ansicht')
    const groesser = ansicht.find((eintrag) => eintrag.accelerator === 'CommandOrControl+Plus')
    klicke(groesser)
    expect(sende).toHaveBeenCalledWith('zoomGroesser')
  })

  it('bietet das Suchen im Bearbeiten-Menue an', () => {
    const bearbeiten = untermenue(baueMenueVorlage(umgebung()), 'Bearbeiten')
    expect(bearbeiten.some((eintrag) => eintrag.accelerator === 'CommandOrControl+F')).toBe(true)
  })

  // Seit S1.3c gibt es die Sidebar wirklich; vorher waere ein Eintrag, der
  // nichts umschaltet, eine Luege in der Oberflaeche gewesen.
  it('schaltet die Seitenleiste ueber das Ansicht-Menue um', () => {
    const sende = vi.fn<(befehl: Befehl) => void>()
    const ansicht = untermenue(baueMenueVorlage(umgebung({ sende })), 'Ansicht')
    const schalter = ansicht.find((eintrag) => /seitenleiste/i.test(eintrag.label ?? ''))
    expect(schalter?.accelerator).toBe('F4')
    klicke(schalter)
    expect(sende).toHaveBeenCalledWith('sidebarUmschalten')
  })

  // S6.1b: Strg+W schliesst den Tab. Die Rolle `close` braechte sonst
  // ihren Standard-Accelerator Strg+W mit und registrierte ihn nativ - dann
  // schloesse derselbe Tastendruck Tab und Fenster.
  it('schliesst mit Strg+W den Tab und das Fenster erst mit Strg+Umschalt+W', () => {
    const sende = vi.fn<(befehl: Befehl) => void>()
    const datei = untermenue(baueMenueVorlage(umgebung({ sende })), 'Datei')
    const tab = datei.find((eintrag) => eintrag.label === 'Tab schließen')
    expect(tab?.accelerator).toBe(findeKuerzel('tabSchliessen').accelerator)
    klicke(tab)
    expect(sende).toHaveBeenCalledWith('tabSchliessen')

    const fenster = datei.find((eintrag) => eintrag.role === 'close')
    expect(fenster?.label).toBe('Fenster schließen')
    expect(fenster?.accelerator).toBe(FENSTER_SCHLIESSEN.accelerator)
    // Kein Kuerzel der Map darf dieselbe Belegung tragen.
    expect(KUERZEL.map((kuerzel) => kuerzel.accelerator)).not.toContain(
      FENSTER_SCHLIESSEN.accelerator
    )
  })

  it('bietet Tab vor und zurueck im Ansicht-Menue an', () => {
    const sende = vi.fn<(befehl: Befehl) => void>()
    const ansicht = untermenue(baueMenueVorlage(umgebung({ sende })), 'Ansicht')
    for (const befehl of ['tabVor', 'tabZurueck'] as const) {
      const eintrag = ansicht.find((e) => e.accelerator === findeKuerzel(befehl).accelerator)
      klicke(eintrag)
      expect(sende).toHaveBeenCalledWith(befehl)
    }
    // Die Hauptbelegung, nicht die Zweitbelegung mit Bild-ab.
    expect(findeKuerzel('tabVor').accelerator).toBe('CommandOrControl+Tab')
  })

  it('oeffnet den Ueber-Dialog aus dem Hilfe-Menue', () => {
    const ueberAnwendung = vi.fn()
    const hilfe = untermenue(baueMenueVorlage(umgebung({ ueberAnwendung })), 'Hilfe')
    klicke(hilfe[hilfe.length - 1])
    expect(ueberAnwendung).toHaveBeenCalled()
  })

  // S5.2a: F1 und Strg+, stehen im Menue, damit Mausnutzer sie finden.
  it.each<[string, Befehl]>([
    ['Hilfe', 'kuerzeluebersicht'],
    ['Bearbeiten', 'einstellungen']
  ])('fuehrt im Menue %s den Befehl %s', (menue, befehl) => {
    const sende = vi.fn()
    const eintraege = untermenue(baueMenueVorlage(umgebung({ sende })), menue)
    const eintrag = eintraege.find((e) => e.label === beschreibeBefehl(befehl))
    expect(eintrag).toBeDefined()
    klicke(eintrag)
    expect(sende).toHaveBeenCalledWith(befehl)
  })
})

/**
 * Der macOS-Zweig wird auf einem Windows-Rechner sonst nie ausgefuehrt. Weil
 * die Plattform ein Parameter ist und nicht aus `process.platform` kommt, laesst
 * er sich hier trotzdem pruefen.
 */
describe('baueMenueVorlage auf macOS', () => {
  const vorlage = baueMenueVorlage(umgebung({ plattform: 'darwin' }))

  it('stellt das App-Menue voran', () => {
    expect(vorlage[0]?.label).toBe('paperlane')
  })

  it('legt Beenden ins App-Menue', () => {
    const app = untermenue(vorlage, 'paperlane')
    expect(app.map((eintrag) => eintrag.role)).toContain('quit')
  })

  it('wiederholt Beenden nicht im Datei-Menue', () => {
    const datei = untermenue(vorlage, 'Datei')
    expect(datei.map((eintrag) => eintrag.role)).not.toContain('quit')
  })
})

// S6.8: dieselbe Vorlage in der aktiven Sprache. Der Main baut sie nach einem
// Wechsel neu; die Befehle bleiben dieselben.
describe('Menue auf Englisch', () => {
  it('beschriftet Menues und Befehle englisch, bei gleichen Befehlen', () => {
    setzeSprache('en')
    try {
      const sende = vi.fn()
      const vorlage = baueMenueVorlage(umgebung({ sende }))
      expect(vorlage.map((eintrag) => eintrag.label)).toEqual(['File', 'Edit', 'View', 'Help'])
      const datei = untermenue(vorlage, 'File')
      const oeffnen = datei.find((eintrag) => eintrag.label === 'Open Document')
      klicke(oeffnen)
      expect(sende).toHaveBeenCalledWith('oeffnen')
      expect(untermenue(vorlage, 'Help').map((eintrag) => eintrag.label)).toContain(
        'About paperlane'
      )
    } finally {
      setzeSprache('de')
    }
  })
})
