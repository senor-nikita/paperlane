import { describe, expect, it } from 'vitest'
import {
  anzahl,
  gleich,
  istLeer,
  ohneRohdaten,
  sammleAenderungen,
  type Aenderungen
} from '../../src/shared/aenderungen'
import type { Annotation } from '../../src/shared/annotations'

/**
 * Der Aenderungssatz (S2.3a).
 *
 * Die Aussage dieses Tests ist die Begruendung des Entwurfs: der Satz wird
 * **abgeleitet** und nicht mitgeschrieben. Deshalb pruefen die wichtigsten
 * Faelle nicht einzelne Aktionen, sondern Zustaende — darunter der, der ein
 * Protokoll zuverlaessig falsch machen wuerde: hin und wieder zurueck.
 */
function annotation(teile: Partial<Annotation> & Pick<Annotation, 'id' | 'seite'>): Annotation {
  return {
    typ: 'Highlight',
    subtyp: 'Highlight',
    rect: [10, 20, 30, 40],
    quadPoints: null,
    striche: null,
    farbe: { r: 255, g: 212, b: 0 },
    strichstaerke: null,
    opazitaet: 1,
    autor: 'Testperson',
    inhalt: '',
    erstellt: null,
    geaendert: null,
    versteckt: false,
    ziel: null,
    roh: null,
    ...teile
  }
}

type Bestand = Record<number, readonly Annotation[]>

describe('sammleAenderungen', () => {
  it('meldet nichts, wenn sich nichts geaendert hat', () => {
    const bestand: Bestand = { 1: [annotation({ id: '10R', seite: 1 })] }
    const ergebnis = sammleAenderungen(bestand, bestand)
    expect(istLeer(ergebnis)).toBe(true)
    expect(anzahl(ergebnis)).toBe(0)
  })

  it('findet eine neue Annotation', () => {
    const alt: Bestand = { 1: [] }
    const neu: Bestand = { 1: [annotation({ id: 'neu-1', seite: 1 })] }
    const ergebnis = sammleAenderungen(neu, alt)
    expect(ergebnis.neue.map((eintrag) => eintrag.id)).toEqual(['neu-1'])
    expect(ergebnis.geaendert).toEqual([])
    expect(ergebnis.geloescht).toEqual([])
  })

  it('findet eine geloeschte Annotation an ihrer Kennung', () => {
    const alt: Bestand = { 1: [annotation({ id: '10R', seite: 1 })] }
    const ergebnis = sammleAenderungen({ 1: [] }, alt)
    expect(ergebnis.geloescht).toEqual(['10R'])
    expect(anzahl(ergebnis)).toBe(1)
  })

  it('findet eine veraenderte Annotation und liefert den neuen Stand', () => {
    const alt: Bestand = { 1: [annotation({ id: '10R', seite: 1, inhalt: 'alt' })] }
    const jetzt: Bestand = { 1: [annotation({ id: '10R', seite: 1, inhalt: 'neu' })] }
    const ergebnis = sammleAenderungen(jetzt, alt)
    expect(ergebnis.geaendert).toHaveLength(1)
    expect(ergebnis.geaendert[0]?.inhalt).toBe('neu')
  })

  /**
   * Der Fall, an dem ein mitgeschriebenes Protokoll scheitert: erstellen,
   * aendern, alles zuruecknehmen. Am Ende steht wieder der Anfangszustand —
   * und genau das soll herauskommen.
   */
  it('meldet nichts, wenn alle Schritte zurueckgenommen wurden', () => {
    const ursprung: Bestand = { 1: [annotation({ id: '10R', seite: 1, inhalt: 'alt' })] }
    const zwischendurch: Bestand = {
      1: [
        annotation({ id: '10R', seite: 1, inhalt: 'veraendert' }),
        annotation({ id: 'neu-1', seite: 1 })
      ]
    }
    expect(anzahl(sammleAenderungen(zwischendurch, ursprung))).toBe(2)

    // Zurueck auf Anfang - dieselben Werte, ein anderes Objekt.
    const zurueck: Bestand = { 1: [annotation({ id: '10R', seite: 1, inhalt: 'alt' })] }
    expect(istLeer(sammleAenderungen(zurueck, ursprung))).toBe(true)
  })

  /**
   * Die Zusage, ohne die ein Speichern Daten vernichtet: was nie gelesen
   * wurde, steht nicht im Ursprung — und bleibt damit unberuehrt.
   */
  it('laesst ungelesene Seiten vollstaendig aus', () => {
    const ursprung: Bestand = { 1: [annotation({ id: '10R', seite: 1 })] }
    // Seite 7 kennt der Renderer nicht; im Dokument stehen dort Anmerkungen.
    const ergebnis = sammleAenderungen({ 1: [annotation({ id: '10R', seite: 1 })] }, ursprung)
    expect(ergebnis.geloescht).toEqual([])
    expect(istLeer(ergebnis)).toBe(true)
  })

  it('behandelt eine gelesene, aber geleerte Seite als Loeschung', () => {
    const ursprung: Bestand = {
      2: [annotation({ id: '11R', seite: 2 }), annotation({ id: '12R', seite: 2 })]
    }
    const ergebnis = sammleAenderungen({ 2: [] }, ursprung)
    expect(ergebnis.geloescht).toEqual(['11R', '12R'])
  })

  it('sammelt ueber mehrere Seiten hinweg', () => {
    const ursprung: Bestand = {
      1: [annotation({ id: '10R', seite: 1 })],
      2: [annotation({ id: '20R', seite: 2, inhalt: 'alt' })]
    }
    const jetzt: Bestand = {
      1: [annotation({ id: '10R', seite: 1 }), annotation({ id: 'neu-1', seite: 1 })],
      2: [annotation({ id: '20R', seite: 2, inhalt: 'neu' })]
    }
    const ergebnis = sammleAenderungen(jetzt, ursprung)
    expect(ergebnis.neue).toHaveLength(1)
    expect(ergebnis.geaendert).toHaveLength(1)
    expect(ergebnis.geloescht).toEqual([])
  })

  // Eine Seite, die der Renderer gar nicht mehr fuehrt, ist nicht dasselbe wie
  // eine geleerte - aber im Ergebnis dasselbe: was gelesen wurde und jetzt
  // fehlt, gilt als geloescht.
  it('wertet eine verschwundene Seite wie eine geleerte', () => {
    const ursprung: Bestand = { 3: [annotation({ id: '30R', seite: 3 })] }
    const ergebnis = sammleAenderungen({}, ursprung)
    expect(ergebnis.geloescht).toEqual(['30R'])
  })
})

describe('gleich', () => {
  it('ignoriert die Rohdaten von pdf.js', () => {
    const a = annotation({ id: '10R', seite: 1, roh: { irgendwas: 1 } })
    const b = annotation({ id: '10R', seite: 1, roh: new Float32Array([1, 2, 3]) })
    expect(gleich(a, b)).toBe(true)
  })

  it('sieht einen Unterschied in einem gefuehrten Feld', () => {
    const a = annotation({ id: '10R', seite: 1, opazitaet: 1 })
    const b = annotation({ id: '10R', seite: 1, opazitaet: 0.5 })
    expect(gleich(a, b)).toBe(false)
  })

  it('sieht einen Unterschied im Rechteck', () => {
    const a = annotation({ id: '10R', seite: 1 })
    const b = annotation({ id: '10R', seite: 1, rect: [11, 20, 31, 40] })
    expect(gleich(a, b)).toBe(false)
  })
})

describe('ohneRohdaten', () => {
  it('setzt roh auf null und laesst alles Uebrige stehen', () => {
    const mitRoh = annotation({ id: '10R', seite: 1, inhalt: 'Text', roh: { gross: true } })
    const ohne = ohneRohdaten(mitRoh)
    expect(ohne.roh).toBeNull()
    expect(ohne.inhalt).toBe('Text')
    // Das Original bleibt unberuehrt - der Store haelt es weiter.
    expect(mitRoh.roh).toEqual({ gross: true })
  })
})

describe('istLeer und anzahl', () => {
  it('zaehlt alle drei Kategorien', () => {
    const satz: Aenderungen = {
      neue: [annotation({ id: 'neu-1', seite: 1 })],
      geaendert: [annotation({ id: '10R', seite: 1 })],
      geloescht: ['11R', '12R']
    }
    expect(anzahl(satz)).toBe(4)
    expect(istLeer(satz)).toBe(false)
  })

  it('nennt einen leeren Satz leer', () => {
    expect(istLeer({ neue: [], geaendert: [], geloescht: [] })).toBe(true)
  })
})
