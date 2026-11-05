// Sammelt die Lizenztexte der Laufzeit-Abhaengigkeiten.
//
// Was in den Installer gelangt, sind die Pakete, die `npm ls --omit=dev --all`
// aufzaehlt - samt Unterabhaengigkeiten. MIT, BSD und Apache-2.0 verlangen, dass
// Copyright-Hinweis und Lizenztext mitgeliefert werden; in `app.asar` liegen sie
// zwar bei den Paketen, aber dort sieht sie niemand. Diese Sammlung macht daraus
// eine Datei, die der Installer neben `LICENSE` und `NOTICE` ablegt.
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const LIZENZDATEI = /^(licen[sc]e|copying|unlicense)([.-].*)?$/i
const HINWEISDATEI = /^notice([.-].*)?$/i
// Starkes Copyleft wuerde die Weitergabe unter Apache-2.0 aendern; "LGPL" und
// "MPL" sind hier nicht gemeint.
const STARKES_COPYLEFT = /(^|[^L])GPL/

/**
 * Zwingt die Lizenz ein starkes Copyleft auf? Bei einer Doppellizenz
 * (`MIT OR GPL-3.0-or-later`, so bei jszip) waehlt der Empfaenger: erst wenn
 * jede Wahlmoeglichkeit Copyleft ist, bleibt keine.
 */
function erzwingtCopyleft(ausdruck) {
  const wahl = ausdruck.replace(/[()]/g, '').split(/\s+OR\s+/i)
  return wahl.every((option) => STARKES_COPYLEFT.test(option))
}

/** Verzeichnisse der Laufzeit-Pakete, ohne die Anwendung selbst. */
function laufzeitVerzeichnisse(wurzel) {
  let ausgabe
  try {
    ausgabe = execSync('npm ls --omit=dev --all --parseable', {
      cwd: wurzel,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (fehler) {
    // `npm ls` endet mit Fehlercode, sobald irgendein Paket ungueltig ist; die
    // Liste auf stdout ist trotzdem brauchbar.
    ausgabe = typeof fehler.stdout === 'string' ? fehler.stdout : ''
  }
  const zeilen = ausgabe
    .split(/\r?\n/)
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile.length > 0)
  return zeilen.filter((zeile) => resolve(zeile) !== resolve(wurzel))
}

function autorText(autor) {
  if (typeof autor === 'string') return autor
  if (autor !== null && typeof autor === 'object' && typeof autor.name === 'string')
    return autor.name
  return undefined
}

function lizenzText(feld) {
  if (typeof feld === 'string') return feld
  if (feld !== null && typeof feld === 'object' && typeof feld.type === 'string') return feld.type
  return undefined
}

function quelleText(feld) {
  if (typeof feld === 'string') return feld
  if (feld !== null && typeof feld === 'object' && typeof feld.url === 'string') return feld.url
  return undefined
}

/**
 * Liefert je Laufzeit-Paket Name, Version, Lizenzkennung, Autor, Quelle sowie
 * die gefundenen Lizenz- und Hinweisdateien (Inhalt als Text).
 */
export function sammleLaufzeitPakete(wurzel = process.cwd()) {
  const gesehen = new Set()
  const pakete = []
  for (const verzeichnis of laufzeitVerzeichnisse(wurzel)) {
    const manifest = join(verzeichnis, 'package.json')
    if (!existsSync(manifest)) continue
    const daten = JSON.parse(readFileSync(manifest, 'utf8'))
    const schluessel = String(daten.name) + '@' + String(daten.version)
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    const dateien = readdirSync(verzeichnis, { withFileTypes: true })
      .filter((eintrag) => eintrag.isFile())
      .map((eintrag) => eintrag.name)
    const lies = (name) => ({ datei: name, inhalt: readFileSync(join(verzeichnis, name), 'utf8') })
    pakete.push({
      name: String(daten.name),
      version: String(daten.version),
      lizenz: lizenzText(daten.license),
      autor: autorText(daten.author),
      quelle: quelleText(daten.repository),
      lizenztexte: dateien.filter((name) => LIZENZDATEI.test(name)).map(lies),
      hinweise: dateien.filter((name) => HINWEISDATEI.test(name)).map(lies)
    })
  }
  return pakete.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/**
 * Probleme, die der Guard meldet: ein Paket ohne jede Lizenzangabe oder mit
 * starkem Copyleft. Fehlt nur die Lizenzdatei, die Kennung aber steht in der
 * `package.json`, ist das kein Fehler - der Text wird dann aus Kennung, Autor
 * und Quelle zusammengesetzt.
 */
export function pruefePakete(pakete) {
  const probleme = []
  for (const paket of pakete) {
    const name = paket.name + '@' + paket.version
    if (paket.lizenz === undefined && paket.lizenztexte.length === 0) {
      probleme.push(name + ': weder Lizenzfeld noch Lizenzdatei')
    }
    if (paket.lizenz !== undefined && erzwingtCopyleft(paket.lizenz)) {
      probleme.push(name + ': starkes Copyleft (' + paket.lizenz + ')')
    }
  }
  return probleme
}

/** Der Text der Datei, die der Installer mitbringt. */
export function lizenzdatei(pakete) {
  const kopf = [
    'paperlane - third-party licenses',
    '',
    'paperlane itself is licensed under the Apache License 2.0 (see LICENSE and NOTICE).',
    'It includes the packages listed below. Each entry reproduces the license text',
    'shipped with the package; where a package ships none, the license identifier,',
    'author and source from its package.json are given instead. Where a package is',
    'offered under several licenses ("... OR ..."), paperlane uses it under the',
    'permissive one (MIT, BSD, Apache-2.0).',
    'Electron and Chromium licenses are in LICENSE.electron.txt and LICENSES.chromium.html.',
    ''
  ]
  const teile = pakete.map((paket) => {
    const zeilen = [
      '='.repeat(78),
      paket.name +
        ' ' +
        paket.version +
        (paket.lizenz !== undefined ? '  (' + paket.lizenz + ')' : ''),
      '='.repeat(78)
    ]
    if (paket.lizenztexte.length === 0) {
      zeilen.push(
        'No license file is shipped with this package.',
        'License: ' + (paket.lizenz ?? 'unknown'),
        'Author: ' + (paket.autor ?? 'not stated'),
        'Source: ' + (paket.quelle ?? 'not stated')
      )
    }
    for (const text of [...paket.lizenztexte, ...paket.hinweise]) {
      zeilen.push('', '--- ' + text.datei + ' ---', text.inhalt.trim())
    }
    return zeilen.join('\n')
  })
  return kopf.join('\n') + '\n' + teile.join('\n\n') + '\n'
}
