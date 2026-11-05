// Guard fuer S6.8: kein deutscher Oberflaechentext ausserhalb der Kataloge.
//
// Seit S6.8 stehen alle Texte der Oberflaeche in src/shared/i18n/de/*.ts und
// en/*.ts. Ein neuer Text direkt im Code faellt in keiner Typpruefung auf -
// er waere auf einem englischen System schlicht deutsch. Dieser Guard liest
// den Quelltext zeilenweise und meldet Zeichenketten und JSX-Text, die nach
// deutscher Sprache aussehen.
//
// Es ist eine Stichprobe, keine Sprachanalyse: erkannt wird an Umlauten, an
// umschriebenen Umlauten in gaengigen Woertern und an haeufigen deutschen
// Funktionswoertern. Was er nicht sieht, sieht die E2E-Stichprobe auf
// Englisch.
//
// Ausnahmen, jeweils begruendet:
// - Protokollzeilen (log.*, console.*): das Protokoll ist fuer Entwickler und
//   bleibt deutsch, wie die Kommentare.
// - Zeilen mit der Markierung KEIN-UI-TEXT: Meldungen, die keine Oberflaeche
//   erreichen (Invarianten, Pruefgruende fuer das Protokoll). Die Markierung
//   steht auf der Zeile selbst oder auf einer der drei Zeilen davor - eine
//   mehrzeilige Zeichenkette gehoert zur Anweisung, die sie traegt.
// - Dateien in AUSGENOMMEN, mit Grund.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const ZIEL = 'src'
const FREIGABE = 'KEIN-UI-TEXT'

const AUSGENOMMEN = new Map([
  [join('src', 'shared', 'i18n'), 'die Kataloge selbst'],
  [join('src', 'main', 'logging'), 'nur Protokoll'],
  [join('src', 'main', 'settings', 'store.ts'), 'Hinweise gehen nur ins Protokoll']
])

const ENDUNGEN = /\.(?:ts|tsx)$/

// Woerter, an denen deutscher Text zuverlaessig zu erkennen ist. Umschriebene
// Umlaute (oe, ae, ue) nur in ganzen Woertern, die im Projekt vorkamen -
// ein allgemeines Muster traefe "Blue", "queue" oder "does".
const WOERTER = [
  'der',
  'die',
  'das',
  'und',
  'oder',
  'nicht',
  'ist',
  'sich',
  'ein',
  'eine',
  'einen',
  'wird',
  'werden',
  'kein',
  'keine',
  'bitte',
  'mit',
  'fuer',
  'für',
  'ueber',
  'über',
  'Seite',
  'Seiten',
  'Datei',
  'Dateien',
  'Dokument',
  'Dokumente',
  'Fehler',
  'oeffnen',
  'öffnen',
  'loeschen',
  'löschen',
  'speichern',
  'Speichern',
  'Abbrechen',
  'Schliessen',
  'Schließen',
  'zurueck',
  'zurück',
  'geoeffnet',
  'geöffnet',
  'liess',
  'ließ',
  'laesst',
  'lässt',
  'waehlen',
  'wählen',
  'Anmerkung',
  'Anmerkungen',
  'Bild',
  'Bilder',
  'gibt',
  'noch',
  'schon',
  'nur',
  'auf',
  'aus'
]
const WORT = new RegExp('(?<![\\w.])(?:' + WOERTER.join('|') + ')(?![\\w])')
const UMLAUT = /[äöüÄÖÜß]/

// Zeichenketten in einfachen, doppelten oder Backtick-Anfuehrungszeichen und
// JSX-Text zwischen > und <.
const LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g

// Zeilen ohne Oberflaechenbezug, unabhaengig vom Inhalt.
const TECHNISCH =
  /^\s*(?:import |export \{|export \* from)|\blog\.(?:info|warn|error)\(|\bconsole\.\w+\(/

function dateien(pfad) {
  if (!existsSync(pfad)) return []
  for (const vorsilbe of AUSGENOMMEN.keys()) {
    if (pfad === vorsilbe || pfad.startsWith(vorsilbe + sep)) return []
  }
  if (statSync(pfad).isFile()) return ENDUNGEN.test(pfad) ? [pfad] : []
  return readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
}

function istDeutsch(text) {
  const inhalt = text.slice(1, -1)
  // Mindestens ein Wort aus Buchstaben; reine Bezeichner, Pfade, CSS und
  // Formatbezeichner fallen so heraus.
  if (!/[A-Za-zÄÖÜäöüß]{2,}\s+[A-Za-zÄÖÜäöüß]/.test(inhalt) && !UMLAUT.test(inhalt)) return false
  return UMLAUT.test(inhalt) || WORT.test(inhalt)
}

let treffer = 0
for (const datei of dateien(ZIEL)) {
  const zeilen = readFileSync(datei, 'utf8').split('\n')
  let imKommentar = false
  let imBlock = false
  zeilen.forEach((zeile, index) => {
    const knapp = zeile.trim()
    if (knapp.includes(FREIGABE + '-BEGINN')) imBlock = true
    if (knapp.includes(FREIGABE + '-ENDE')) imBlock = false
    if (imBlock) return
    if (imKommentar) {
      if (knapp.includes('*/')) imKommentar = false
      return
    }
    if (knapp.startsWith('/*') || knapp.startsWith('{/*')) {
      imKommentar = !knapp.includes('*/')
      return
    }
    if (knapp.startsWith('//') || knapp.startsWith('*')) return
    if (TECHNISCH.test(zeile)) return
    // Drei Zeilen davor (Markierung ueber einer mehrzeiligen Anweisung) und
    // zwei danach (Prettier bricht eine lange Zeile um, der Kommentar am Ende
    // wandert mit in die letzte Zeile).
    const umfeld = zeilen.slice(Math.max(0, index - 3), index + 3).join('\n')
    if (umfeld.includes(FREIGABE)) return
    // Kommentare am Zeilenende und JSX-Kommentare gehoeren nicht zum Text.
    const code = zeile.replace(/\s\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '')
    const fund = (code.match(LITERAL) ?? []).find(istDeutsch)
    if (fund === undefined) return
    console.error(datei + ':' + String(index + 1) + '  ' + knapp)
    treffer += 1
  })
}

if (treffer > 0) {
  console.error(
    '\n' +
      String(treffer) +
      ' Zeile(n) mit deutschem Text ausserhalb der Kataloge. Text nach src/shared/i18n ' +
      'verschieben und ueber t() holen - oder, wenn er keine Oberflaeche erreicht, mit ' +
      FREIGABE +
      ' und Grund markieren.'
  )
  process.exit(1)
}
console.log('guard:sprache: kein deutscher Oberflaechentext ausserhalb der Kataloge.')
