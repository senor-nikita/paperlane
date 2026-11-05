// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PDFDocument, PDFName } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { pruefeBild } from '../../src/main/bild'
import {
  bildformat,
  bildPixelmasse,
  jpegPixelmasse,
  pngPixelmasse,
  pruefeBildPdfAuftrag,
  pruefePfadListe
} from '../../src/main/bilderpdf'
import { migriere } from '../../src/main/settings/schema'
import { zerlege } from '../../src/main/textbearbeitung/lexer'
import { ersetzeTextDirekt } from '../../src/main/textbearbeitung/textersetzen'
import { leseToUnicode } from '../../src/main/textbearbeitung/tounicode'
import { pruefeWordAuftrag } from '../../src/main/word'
import { pruefeBereiche, pruefeSeitenliste } from '../../src/main/zusammenfuehren'
import { parseBereiche } from '../../src/shared/bereiche'
import { pruefeDruckOptionen } from '../../src/shared/druck'
import { deuteFehler } from '../../src/shared/errors'
import { ERLAUBTE_SCHEMATA, pruefeExternesZiel } from '../../src/shared/externe-links'
import { pruefeEreignis } from '../../src/shared/ipc'
import { pruefeMutation } from '../../src/shared/mutation'
import { istSitzung, pruefePatch } from '../../src/shared/settings'
import { pruefeTextZeile } from '../../src/shared/textzeilen'
import { standardDokument } from '../helpers/textfixtures'

/**
 * Fuzzing der Stellen, an denen fremde Eingaben ankommen (S6.10).
 *
 * Zwei Grenzen: Dateien (PDF-Inhalte, Bilder, die Einstellungsdatei) und der
 * Renderer, der fremde Dokumente anzeigt und deshalb als nicht
 * vertrauenswuerdig gilt - alles, was er ueber IPC schickt, laeuft durch die
 * `pruefe*`-Funktionen. Fuer jede gilt hier: keine unerwartete Ausnahme, kein
 * Stapelueberlauf, keine Laufzeit ueber der Grenze, und was angenommen wird,
 * haelt die zugesagten Bedingungen ein.
 *
 * Zufall mit festem Startwert: jeder Lauf ist wiederholbar. Im normalen
 * Testlauf wenige Runden; `FUZZ_RUNDEN=20000` fuer einen Tiefenlauf,
 * `FUZZ_SAAT` fuer andere Folgen.
 */
const RUNDEN = Number(process.env['FUZZ_RUNDEN'] ?? 150)
const SAAT = Number(process.env['FUZZ_SAAT'] ?? 0x5eed)
const ZEITGRENZE_MS = 1000

type Zufall = () => number

function mulberry32(saat: number): Zufall {
  let a = saat >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ganz = (z: Zufall, bis: number): number => Math.floor(z() * bis)
const eines = <T>(z: Zufall, liste: readonly T[]): T => liste[ganz(z, liste.length)] as T

const kodierer = new TextEncoder()

/** Bausteine, die Parser an ihre Kanten fuehren. */
const TOKENS = [
  'BT',
  'ET',
  'Tf',
  'Tj',
  'TJ',
  "'",
  '"',
  'Td',
  'TD',
  'Tm',
  'T*',
  'Tc',
  'Tw',
  'Tz',
  'TL',
  'Ts',
  'Tr',
  'q',
  'Q',
  'cm',
  'Do',
  'BI',
  'ID',
  'EI',
  'BDC',
  'EMC',
  'gs',
  'rg',
  'RG',
  'sc',
  'scn',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '<<',
  '>>',
  '/F1',
  '/',
  '%',
  '\\',
  '\\(',
  '\\)',
  '\\\\',
  '1e308',
  '-0',
  'NaN',
  '99999999999999999999',
  '.',
  '-',
  '+',
  '((((((((',
  '[[[[[[[[',
  '<<<<<<<<',
  'beginbfchar',
  'endbfchar',
  'beginbfrange',
  'endbfrange',
  'begincodespacerange',
  'endcodespacerange',
  '<0000>',
  '<FFFF>',
  '<00>',
  '<FFFFFFFFFFFFFFFF>',
  'null',
  'true',
  '\n',
  '\r',
  ' ',
  '\0'
] as const

function zufallsBytes(z: Zufall, laenge: number): Uint8Array {
  const b = new Uint8Array(laenge)
  for (let i = 0; i < laenge; i++) b[i] = ganz(z, 256)
  return b
}

function zufallsToken(z: Zufall, anzahl: number): Uint8Array {
  const teile: string[] = []
  for (let i = 0; i < anzahl; i++) {
    teile.push(z() < 0.2 ? String(ganz(z, 1000) - 500) : eines(z, TOKENS))
  }
  return kodierer.encode(teile.join(z() < 0.5 ? ' ' : ''))
}

/** Veraendert vorhandene Bytes: kippen, einfuegen, loeschen, verdoppeln. */
function mutiere(z: Zufall, basis: Uint8Array): Uint8Array {
  let b = Array.from(basis)
  const schritte = 1 + ganz(z, 8)
  for (let s = 0; s < schritte; s++) {
    const stelle = ganz(z, Math.max(1, b.length))
    switch (ganz(z, 6)) {
      case 0:
        b[stelle] = ganz(z, 256)
        break
      case 1:
        b.splice(stelle, 0, ...zufallsToken(z, 1 + ganz(z, 4)))
        break
      case 2:
        b.splice(stelle, 1 + ganz(z, 32))
        break
      case 3:
        b.splice(stelle, 0, ...b.slice(stelle, stelle + ganz(z, 64)))
        break
      case 4:
        b = b.slice(0, stelle)
        break
      default:
        b.splice(stelle, 0, ...zufallsBytes(z, 1 + ganz(z, 16)))
    }
  }
  return new Uint8Array(b)
}

/** Beliebige Werte, wie sie ein feindlicher Renderer schicken koennte. */
function zufallsWert(z: Zufall, tiefe = 0): unknown {
  const art = ganz(z, tiefe > 3 ? 8 : 11)
  switch (art) {
    case 0:
      return null
    case 1:
      return undefined
    case 2:
      return z() < 0.5
    case 3:
      return eines(z, [0, -1, 1, 0.5, -0, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 31), 1e308])
    case 4:
      return ganz(z, 2000) - 1000
    case 5:
      return eines(z, [
        '',
        'a',
        '../../etc/passwd',
        'C:\\Windows\\x.pdf',
        '\\\\server\\x.pdf',
        'file:///C:/x',
        'javascript:alert(1)',
        'https://example.org/',
        'x'.repeat(70000),
        '__proto__',
        'constructor',
        '\u0000',
        '1-3, 5',
        'auto',
        'de',
        'en',
        'textErsetzen',
        'seitenLoeschen',
        'befehl',
        'oeffnen',
        'png',
        'jpeg'
      ])
    case 6:
      return new TextDecoder().decode(zufallsBytes(z, ganz(z, 40)))
    case 7:
      return zufallsBytes(z, ganz(z, 64))
    case 8: {
      const liste: unknown[] = []
      const n = ganz(z, 6)
      for (let i = 0; i < n; i++) liste.push(zufallsWert(z, tiefe + 1))
      return liste
    }
    default: {
      const objekt: Record<string, unknown> = {}
      const n = ganz(z, 6)
      const schluessel = [
        'art',
        'seite',
        'seiten',
        'quelle',
        'bereiche',
        'reihenfolge',
        'grad',
        'zuschnitte',
        'rahmen',
        'text',
        'zeile',
        'grundlinie',
        'von',
        'winkel',
        'befehl',
        'pfad',
        'sprache',
        'autorName',
        'fenster',
        'sitzung',
        'tabs',
        'aktiv',
        'annotationen',
        'farbe',
        'strichstaerke',
        'format',
        'bytes',
        'breitePt',
        'hoehePt',
        'bloecke',
        'laeufe',
        'png',
        'ebene',
        'seitenumbruch',
        'ausrichtung',
        'anpassen',
        'kommentare',
        '__proto__',
        'constructor',
        'phase'
      ]
      for (let i = 0; i < n; i++) objekt[eines(z, schluessel)] = zufallsWert(z, tiefe + 1)
      return objekt
    }
  }
}

/** Fuehrt aus, misst, und laesst nur erwartete Fehler durch. */
function pruefeAufruf<T>(
  name: string,
  aufruf: () => T,
  erlaubt: (fehler: unknown) => boolean = () => false
): T | undefined {
  const start = performance.now()
  try {
    return aufruf()
  } catch (fehler) {
    if (fehler instanceof RangeError && /call stack/i.test(fehler.message)) {
      throw new Error(name + ': Stapelueberlauf')
    }
    if (!erlaubt(fehler)) {
      throw new Error(name + ': unerwartete Ausnahme: ' + String(fehler), { cause: fehler })
    }
    return undefined
  } finally {
    const dauer = performance.now() - start
    if (dauer > ZEITGRENZE_MS) throw new Error(name + ': ' + String(Math.round(dauer)) + ' ms')
  }
}

const istFehler = (fehler: unknown): boolean => fehler instanceof Error

describe('Fuzzing: Dateiinhalte', () => {
  it('Content-Stream-Lexer', () => {
    const z = mulberry32(SAAT)
    const basis = kodierer.encode(
      'q 1 0 0 1 72 700 cm BT /F1 12 Tf 0 0 Td (Hallo \\(Welt\\)) Tj [(A) -120 (B)] TJ ET Q ' +
        'BI /W 2 /H 2 /BPC 8 /CS /G ID \u0000\u0001\u0002\u0003 EI /Fm0 Do'
    )
    for (let i = 0; i < RUNDEN; i++) {
      const eingabe = i % 3 === 0 ? zufallsToken(z, ganz(z, 400)) : mutiere(z, basis)
      const ops = pruefeAufruf('zerlege', () => zerlege(eingabe), istFehler)
      if (ops !== undefined) {
        for (const op of ops) {
          if (op.ende > eingabe.length || op.start < 0 || op.start > op.ende) {
            // Mit der Eingabe, damit sich der Fund als Unit-Test festhalten laesst.
            throw new Error(
              op.op +
                ' [' +
                String(op.start) +
                ', ' +
                String(op.ende) +
                ') bei Laenge ' +
                String(eingabe.length) +
                ': ' +
                Buffer.from(eingabe).toString('hex')
            )
          }
          expect(op.start).toBeGreaterThanOrEqual(0)
          expect(op.ende).toBeLessThanOrEqual(eingabe.length)
          expect(op.start).toBeLessThanOrEqual(op.ende)
        }
      }
    }
  })

  it('Lexer mit tiefer Verschachtelung und vielen Operanden', () => {
    for (const eingabe of [
      '['.repeat(100000),
      '('.repeat(100000),
      '<<'.repeat(50000),
      '1 '.repeat(500000),
      '/a '.repeat(300000) + 'Tj'
    ]) {
      pruefeAufruf('zerlege', () => zerlege(kodierer.encode(eingabe)), istFehler)
    }
  })

  it('ToUnicode-CMaps', () => {
    const z = mulberry32(SAAT + 1)
    const basis =
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
      '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
      '2 beginbfchar <0003> <0020> <0024> <0041> endbfchar\n' +
      '1 beginbfrange <0025> <0030> <0042> endbfrange\n' +
      '1 beginbfrange <0031> <0032> [<0061> <0062006300640065>] endbfrange\n' +
      'endcmap CMapName currentdict /CMap defineresource pop end end'
    for (let i = 0; i < RUNDEN; i++) {
      const bytes = i % 3 === 0 ? zufallsToken(z, ganz(z, 300)) : mutiere(z, kodierer.encode(basis))
      const text = new TextDecoder('latin1').decode(bytes)
      pruefeAufruf('leseToUnicode', () => leseToUnicode(text), istFehler)
    }
    // Ein Bereich ueber den ganzen Coderaum darf nicht Millionen Eintraege bauen.
    pruefeAufruf(
      'leseToUnicode',
      () => leseToUnicode('1 beginbfrange <00000000> <FFFFFFFF> <0041> endbfrange'),
      istFehler
    )
  })

  it('Bilderkennung und Pixelmasse', () => {
    const z = mulberry32(SAAT + 2)
    const basen = ['bild-a.png', 'bild-b.jpg', 'bild-c.bmp'].map(
      (name) => new Uint8Array(readFileSync('test/fixtures/bilder/' + name))
    )
    for (let i = 0; i < RUNDEN; i++) {
      const eingabe = mutiere(z, eines(z, basen).slice(0, 4096))
      pruefeAufruf('bildformat', () => bildformat(eingabe))
      pruefeAufruf('pngPixelmasse', () => pngPixelmasse(eingabe))
      pruefeAufruf('jpegPixelmasse', () => jpegPixelmasse(eingabe))
      const format = bildformat(eingabe)
      if (format === 'png' || format === 'jpeg') {
        pruefeAufruf('bildPixelmasse', () => bildPixelmasse(format, eingabe), istFehler)
      }
      const geprueft = pruefeAufruf('pruefeBild', () => pruefeBild(eingabe))
      if (geprueft?.art === 'geladen')
        expect(geprueft.url).toMatch(/^data:image\/(png|jpeg);base64,/)
    }
  })

  it('Einstellungsdatei', () => {
    const z = mulberry32(SAAT + 3)
    for (let i = 0; i < RUNDEN; i++) {
      const roh = zufallsWert(z)
      const ergebnis = pruefeAufruf('migriere', () => migriere(roh, 'vorgabe'))
      if (ergebnis?.art === 'ok') {
        const s = ergebnis.settings
        expect(istSitzung(s.sitzung)).toBe(true)
        expect(['auto', 'de', 'en']).toContain(s.sprache)
        expect(typeof s.autorName).toBe('string')
        expect(Array.isArray(s.zuletztGeoeffnet)).toBe(true)
      }
    }
  })
})

describe('Fuzzing: Nachrichten des Renderers', () => {
  it('lehnt ab oder nimmt nur Gueltiges an', () => {
    const z = mulberry32(SAAT + 4)
    for (let i = 0; i < RUNDEN * 4; i++) {
      const w = zufallsWert(z)

      const patch = pruefeAufruf('pruefePatch', () => pruefePatch(w))
      if (patch?.gueltig === true) {
        for (const schluessel of Object.keys(patch.patch)) {
          expect([
            'autorName',
            'fenster',
            'zuletztGelesen',
            'zuletztGeoeffnet',
            'annotationen',
            'ansicht',
            'sitzung',
            'sprache'
          ]).toContain(schluessel)
        }
      }

      const mutation = pruefeAufruf('pruefeMutation', () => pruefeMutation(w))
      if (mutation !== null && mutation !== undefined && 'seiten' in mutation) {
        for (const seite of mutation.seiten)
          expect(Number.isInteger(seite) && seite >= 1).toBe(true)
      }

      const ziel = pruefeAufruf('pruefeExternesZiel', () => pruefeExternesZiel(w))
      if (ziel?.ok === true) {
        expect(ERLAUBTE_SCHEMATA as readonly string[]).toContain(new URL(ziel.url).protocol)
      }

      pruefeAufruf('pruefeEreignis', () => pruefeEreignis(w))
      pruefeAufruf('pruefeDruckOptionen', () => pruefeDruckOptionen(w))
      pruefeAufruf('pruefeTextZeile', () => pruefeTextZeile(w))
      pruefeAufruf('pruefeWordAuftrag', () => pruefeWordAuftrag(w))
      pruefeAufruf('pruefeBildPdfAuftrag', () => pruefeBildPdfAuftrag(w))
      pruefeAufruf('deuteFehler', () => deuteFehler(w))

      const pfade = pruefeAufruf('pruefePfadListe', () => pruefePfadListe(w))
      if (pfade !== null && pfade !== undefined) {
        for (const pfad of pfade)
          expect(pfad.startsWith('\\\\') || pfad.startsWith('//')).toBe(false)
      }

      const seitenzahl = 1 + ganz(z, 50)
      const bereiche = pruefeAufruf('pruefeBereiche', () => pruefeBereiche(w, seitenzahl))
      if (bereiche !== null && bereiche !== undefined) {
        for (const [von, bis] of bereiche) {
          expect(von >= 1 && von <= bis && bis <= seitenzahl).toBe(true)
        }
      }
      const liste = pruefeAufruf('pruefeSeitenliste', () => pruefeSeitenliste(w, seitenzahl))
      if (liste !== null && liste !== undefined) {
        for (const seite of liste) expect(seite >= 1 && seite <= seitenzahl).toBe(true)
      }

      if (typeof w === 'string') {
        const geparst = pruefeAufruf('parseBereiche', () => parseBereiche(w, seitenzahl))
        if (geparst?.ok === true) {
          for (const [von, bis] of geparst.bereiche) {
            expect(von >= 1 && von <= bis && bis <= seitenzahl).toBe(true)
          }
        }
      }
    }
  })

  it('Seitenbereiche aus der Eingabezeile', () => {
    const z = mulberry32(SAAT + 5)
    const zeichen = '0123456789-,; ' + 'a\u00a0'
    for (let i = 0; i < RUNDEN * 4; i++) {
      let text = ''
      const n = ganz(z, 40)
      for (let k = 0; k < n; k++) text += zeichen[ganz(z, zeichen.length)]
      if (z() < 0.05) text = '1-' + '9'.repeat(400)
      const seitenzahl = 1 + ganz(z, 1000)
      const ergebnis = pruefeAufruf('parseBereiche', () => parseBereiche(text, seitenzahl))
      if (ergebnis?.ok === true) {
        for (const [von, bis] of ergebnis.bereiche) {
          expect(von >= 1 && von <= bis && bis <= seitenzahl).toBe(true)
        }
      }
    }
  })
})

describe('Fuzzing: Text direkt aendern auf verdorbenen Seiteninhalten', () => {
  let vorlage: Uint8Array

  beforeAll(async () => {
    vorlage = await standardDokument()
  }, 60000)

  it('lehnt ab oder liefert ein ladbares Dokument, in der Zeitgrenze', async () => {
    const z = mulberry32(SAAT + 6)
    const inhalt = kodierer.encode(
      'BT /F1 18 Tf 72 720 Td (Rechnung Nr. 2026-041) Tj ET q 1 0 0 1 0 0 cm Q'
    )
    const runden = Math.max(10, Math.floor(RUNDEN / 5))
    for (let i = 0; i < runden; i++) {
      const doc = await PDFDocument.load(vorlage)
      const neu = doc.context.stream(mutiere(z, inhalt))
      doc.getPage(0).node.set(PDFName.of('Contents'), doc.context.register(neu))
      const bytes = await doc.save()
      const start = performance.now()
      try {
        const ergebnis = await ersetzeTextDirekt(bytes, {
          art: 'textErsetzen',
          seite: 1,
          zeile: {
            text: 'Rechnung Nr. 2026-041',
            winkel: 0,
            dx: 1,
            dy: 0,
            grundlinie: 720,
            von: 72,
            bis: 290,
            groesse: 18
          },
          text: eines(z, ['Rechnung Nr. 2026-042', '', '\uF0B7 Punkt', 'Ä€ß', 'x'.repeat(500)])
        })
        // Angenommen: das Ergebnis muss wieder ladbar sein.
        await PDFDocument.load(ergebnis.bytes)
      } catch (fehler) {
        expect(fehler).toBeInstanceOf(Error)
        if (fehler instanceof RangeError) expect(fehler.message).not.toMatch(/call stack/i)
      }
      expect(performance.now() - start).toBeLessThan(10000)
    }
  }, 600000)
})
