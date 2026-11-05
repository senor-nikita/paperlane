import { describe, expect, it } from 'vitest'
import { wandleFeld, wandleFelder } from '../../src/renderer/src/viewer/formularfelder'

/**
 * Widgets von pdf.js als Formularfelder (S3.1, Aufgabe 1).
 *
 * Die Rohdatensaetze hier sind so aufgebaut, wie pdf.js sie fuer
 * `acroform.pdf` tatsaechlich liefert — vor dem Schreiben dieses Tests
 * nachgesehen, nicht geraten: `fieldValue` einer Gruppe ist `null`, einer
 * Auswahlliste ein Feld, `actions` eine `Map`.
 */
function widget(teile: Record<string, unknown>): Record<string, unknown> {
  return {
    subtype: 'Widget',
    id: '11R',
    fieldName: 'feld',
    fieldType: 'Tx',
    fieldValue: '',
    rect: [71.5, 699.5, 372.5, 724.5],
    readOnly: false,
    required: false,
    hidden: false,
    maxLen: 0,
    actions: null,
    ...teile
  }
}

describe('wandleFeld', () => {
  it('liest ein Textfeld mit Wert', () => {
    const feld = wandleFeld(widget({ fieldValue: 'Erika Muster' }), 1)
    expect(feld).toMatchObject({
      art: 'text',
      name: 'feld',
      seite: 1,
      ausgangswert: 'Erika Muster',
      maxLaenge: null
    })
  })

  it('liest Pflicht, Schreibschutz, Laenge und Mehrzeiligkeit', () => {
    const feld = wandleFeld(
      widget({ required: true, readOnly: true, maxLen: 40, multiLine: true, password: true }),
      1
    )
    expect(feld).toMatchObject({
      pflicht: true,
      schreibgeschuetzt: true,
      maxLaenge: 40,
      mehrzeilig: true,
      passwort: true
    })
  })

  it('liest ein Kontrollkaestchen mit An-Zustand', () => {
    const aus = wandleFeld(
      widget({ fieldType: 'Btn', checkBox: true, fieldValue: 'Off', exportValue: 'Yes' }),
      1
    )
    expect(aus).toMatchObject({ art: 'kontrollkaestchen', exportwert: 'Yes', ausgangswert: false })
    const an = wandleFeld(
      widget({ fieldType: 'Btn', checkBox: true, fieldValue: 'Yes', exportValue: 'Yes' }),
      1
    )
    expect(an?.ausgangswert).toBe(true)
  })

  /** Aufgabe 5: die Gruppe und ihr `/Off`. */
  it('liest einen Auswahlknopf ohne Wahl als Off', () => {
    const feld = wandleFeld(
      widget({ fieldType: 'Btn', radioButton: true, fieldValue: null, buttonValue: 'frau' }),
      1
    )
    expect(feld).toMatchObject({ art: 'auswahlknopf', exportwert: 'frau', ausgangswert: 'Off' })
  })

  it('liest den gewaehlten Auswahlknopf ueber den Gruppenwert', () => {
    const feld = wandleFeld(
      widget({ fieldType: 'Btn', radioButton: true, fieldValue: 'herr', buttonValue: 'herr' }),
      1
    )
    expect(feld?.ausgangswert).toBe('herr')
  })

  it('unterscheidet eine Schaltflaeche', () => {
    expect(wandleFeld(widget({ fieldType: 'Btn', pushButton: true }), 1)?.art).toBe('schaltflaeche')
  })

  it('liest eine Auswahlliste mit Optionen', () => {
    const feld = wandleFeld(
      widget({
        fieldType: 'Ch',
        combo: true,
        multiSelect: false,
        fieldValue: [],
        options: [
          { exportValue: 'DE', displayValue: 'Deutschland' },
          { exportValue: 'CH', displayValue: '' }
        ]
      }),
      1
    )
    expect(feld).toMatchObject({
      art: 'auswahlliste',
      kombiniert: true,
      mehrfach: false,
      ausgangswert: [],
      optionen: [
        { export: 'DE', anzeige: 'Deutschland' },
        // Ohne Anzeigetext steht der Exportwert - nicht ein leerer Eintrag.
        { export: 'CH', anzeige: 'CH' }
      ]
    })
  })

  it('nimmt einen einzelnen Auswahlwert als Liste', () => {
    expect(wandleFeld(widget({ fieldType: 'Ch', fieldValue: 'DE' }), 1)?.ausgangswert).toEqual([
      'DE'
    ])
  })

  it('erkennt ein Signaturfeld', () => {
    expect(wandleFeld(widget({ fieldType: 'Sig' }), 1)?.art).toBe('signatur')
  })

  /** Aufgabe 4: das Format kommt aus den Skripten, ohne sie auszufuehren. */
  it('liest das Format aus den Aktionen', () => {
    const zahl = wandleFeld(
      widget({ actions: new Map([['Format', ['AFNumber_Format(2, 0, 0, 0, "", true);']]]) }),
      1
    )
    expect(zahl?.format).toEqual({ art: 'zahl', nachkommastellen: 2 })
    const skript = wandleFeld(widget({ actions: new Map([['Validate', ['app.alert("x");']]]) }), 1)
    expect(skript?.format).toEqual({ art: 'skript' })
  })

  it('laesst Aktionen ausserhalb der Formatereignisse ausser Acht', () => {
    // Ein Skript beim Mausklick sagt nichts ueber das Format des Wertes.
    const feld = wandleFeld(widget({ actions: new Map([['MouseDown', ['app.beep();']]]) }), 1)
    expect(feld?.format).toBeNull()
  })

  it('verwirft, was kein Widget ist', () => {
    expect(wandleFeld(widget({ subtype: 'Highlight' }), 1)).toBeNull()
    expect(wandleFeld(null, 1)).toBeNull()
    expect(wandleFeld('x', 1)).toBeNull()
  })

  it('verwirft ein Widget ohne Rechteck oder Namen', () => {
    expect(wandleFeld(widget({ rect: [1, 2] }), 1)).toBeNull()
    expect(wandleFeld(widget({ rect: [1, 2, 'x', 4] }), 1)).toBeNull()
    expect(wandleFeld(widget({ fieldName: '' }), 1)).toBeNull()
  })

  it('traegt den Hilfetext', () => {
    expect(wandleFeld(widget({ alternativeText: 'Ihr Name' }), 1)?.hilfetext).toBe('Ihr Name')
    expect(wandleFeld(widget({ alternativeText: '' }), 1)?.hilfetext).toBeNull()
  })
})

describe('wandleFelder', () => {
  /** Die Reihenfolge ist die Tab-Reihenfolge (Aufgabe 3). */
  it('behaelt die Reihenfolge des Dokuments', () => {
    const felder = wandleFelder(
      [
        widget({ id: '1R', fieldName: 'zweites' }),
        { subtype: 'Highlight', rect: [0, 0, 1, 1] },
        widget({ id: '2R', fieldName: 'erstes' })
      ],
      1
    )
    expect(felder.map((feld) => feld.name)).toEqual(['zweites', 'erstes'])
  })

  it('kommt mit Nicht-Listen zurecht', () => {
    expect(wandleFelder(null, 1)).toEqual([])
  })
})
