import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Exit-Kriterium aus S1.3b: alle Menue-Accelerators stammen aus der Kuerzel-Map,
 * kein Literal im Menuecode.
 *
 * Zwei Quellen driften auseinander — dann steht im Menue "Strg+Umschalt+R" und
 * die Anwendung hoert auf etwas anderes. Der Test verbietet deshalb beides:
 * einen Accelerator, der als Zeichenkette zugewiesen wird, und die
 * Electron-Schreibweise selbst irgendwo ausserhalb der Kuerzel-Map.
 */
const QUELLE_DER_KUERZEL = 'src/shared/tastatur.ts'

function dateien(pfad: string): string[] {
  return statSync(pfad).isFile()
    ? [pfad]
    : readdirSync(pfad).flatMap((eintrag) => dateien(join(pfad, eintrag)))
}

function quelldateien(): { pfad: string; inhalt: string }[] {
  return dateien('src')
    .filter((pfad) => pfad.endsWith('.ts') || pfad.endsWith('.tsx'))
    .map((pfad) => ({ pfad: pfad.split(sep).join('/'), inhalt: readFileSync(pfad, 'utf8') }))
    .filter((datei) => datei.pfad !== QUELLE_DER_KUERZEL)
}

describe('Menue-Accelerators', () => {
  it('weist nirgends einen Accelerator als Zeichenkette zu', () => {
    const treffer = quelldateien()
      .filter((datei) => /\baccelerator\s*:\s*['"`]/.test(datei.inhalt))
      .map((datei) => datei.pfad)
    expect(treffer).toEqual([])
  })

  it('nennt die Electron-Schreibweise nur in der Kuerzel-Map', () => {
    const treffer = quelldateien()
      .filter((datei) => datei.inhalt.includes('CommandOrControl'))
      .map((datei) => datei.pfad)
    expect(treffer).toEqual([])
  })

  it('liest im Menue tatsaechlich aus der Kuerzel-Map', () => {
    expect(readFileSync('src/main/menue.ts', 'utf8')).toMatch(/findeKuerzel\(/)
  })
})
