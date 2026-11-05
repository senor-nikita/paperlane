import { describe, expect, it } from 'vitest'
import {
  ERLAUBTE_SCHEMATA,
  MAX_URL_LAENGE,
  pruefeExternesZiel
} from '../../src/shared/externe-links'

/**
 * Die Allowlist fuer externe Verweise (S2.1, Aufgabe 3).
 *
 * Sie ist die einzige Schranke zwischen einem fremden Dokument und
 * `shell.openExternal`, das an das Betriebssystem uebergibt. Entsprechend
 * ausfuehrlich geprueft.
 */
describe('pruefeExternesZiel — erlaubt', () => {
  it.each([
    ['https://example.org/pfad?a=1', 'example.org'],
    ['http://example.org/', 'example.org'],
    ['mailto:jemand@example.org', '']
  ])('laesst %s durch', (eingabe, host) => {
    const geprueft = pruefeExternesZiel(eingabe)
    expect(geprueft.ok).toBe(true)
    if (geprueft.ok) expect(geprueft.host).toBe(host)
  })

  it('liefert die normalisierte Adresse zurueck', () => {
    const geprueft = pruefeExternesZiel('HTTPS://Example.ORG')
    expect(geprueft.ok && geprueft.url).toBe('https://example.org/')
  })

  /**
   * Bei `https://bekannt.example@fremd.example/` ist alles vor dem `@` nur
   * Benutzerinformation — geoeffnet wird `fremd.example`. Der Dialog nennt
   * deshalb den Host eigens; ohne ihn liest der Nutzer den falschen Namen.
   */
  it('nennt bei Benutzerinformation vor dem @ den echten Host', () => {
    const geprueft = pruefeExternesZiel('https://bekannt.example@fremd.example/seite')
    expect(geprueft.ok && geprueft.host).toBe('fremd.example')
  })
})

describe('pruefeExternesZiel — abgelehnt', () => {
  /**
   * `file:` ist der Fall aus dem Exit-Kriterium. Die uebrigen stehen
   * stellvertretend fuer alles, was unter Windows als Protokoll registriert
   * sein und ein Programm starten kann.
   */
  it.each([
    ['file:///C:/Windows/win.ini'],
    ['javascript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['ms-msdt:/id PCWDiagnostic'],
    ['ftp://example.org/datei.txt'],
    ['tel:+4930123456'],
    // R12 nennt `smb:` ausdruecklich: ein Klick wuerde unter Windows eine
    // Netzwerkfreigabe ansprechen und dabei Anmeldedaten mitschicken.
    // Funktional deckt die Freigabeliste den Fall schon ab - aber eine
    // Regression genau hier faellt nur auf, wenn der Fall einen Namen hat.
    ['smb://server.example/freigabe/datei.pdf'],
    // Ein eigener Handler, wie ihn Fremdprogramme registrieren.
    ['eigenes-programm://oeffne?datei=x']
  ])('lehnt %s ab', (eingabe) => {
    expect(pruefeExternesZiel(eingabe).ok).toBe(false)
  })

  // Die Meldung muss sagen, was los ist: ein Verweis, der beim Klick nichts
  // tut, sieht nach einem kaputten Programm aus.
  it('nennt das abgelehnte Schema in der Begruendung', () => {
    const geprueft = pruefeExternesZiel('file:///C:/Windows/win.ini')
    expect(geprueft.ok).toBe(false)
    if (!geprueft.ok) {
      expect(geprueft.grund).toContain('file')
      for (const schema of ERLAUBTE_SCHEMATA) {
        expect(geprueft.grund).toContain(schema.replace(':', ''))
      }
    }
  })

  it.each([
    ['leere Zeichenkette', ''],
    ['nur Leerraum', '   '],
    ['relative Angabe', '/kapitel/3'],
    ['keine Adresse', 'einfach nur Text'],
    ['keine Zeichenkette', 42],
    ['null', null],
    ['undefined', undefined]
  ])('lehnt %s ab', (_beschreibung, eingabe) => {
    expect(pruefeExternesZiel(eingabe).ok).toBe(false)
  })

  it('lehnt eine unverhaeltnismaessig lange Adresse ab', () => {
    const lang = 'https://example.org/' + 'a'.repeat(MAX_URL_LAENGE)
    expect(pruefeExternesZiel(lang).ok).toBe(false)
  })

  it('laesst eine Adresse knapp unter der Grenze durch', () => {
    const gerade = 'https://example.org/' + 'a'.repeat(MAX_URL_LAENGE - 20)
    expect(pruefeExternesZiel(gerade).ok).toBe(true)
  })
})
