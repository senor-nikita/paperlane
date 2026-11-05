import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { redigiere } from './redact'
import { planeRotation } from './rotation'

export type Stufe = 'error' | 'warn' | 'info'

export interface LoggerOptionen {
  /** Zielpfad. Wird uebergeben, damit der Logger ohne Electron testbar ist. */
  datei: string
  maxBytes: number
  archive: number
  /** Zusaetzlich auf die Konsole schreiben. In Tests abschaltbar. */
  konsole: boolean
}

export interface Logger {
  error: (nachricht: string, daten?: unknown) => void
  warn: (nachricht: string, daten?: unknown) => void
  info: (nachricht: string, daten?: unknown) => void
}

export const STANDARD_MAX_BYTES = 2 * 1024 * 1024
export const STANDARD_ARCHIVE = 3

export function erstelleLogger(optionen: LoggerOptionen): Logger {
  mkdirSync(dirname(optionen.datei), { recursive: true })

  function rotiereBeiBedarf(): void {
    if (!existsSync(optionen.datei)) return
    const plan = planeRotation(
      optionen.datei,
      statSync(optionen.datei).size,
      optionen.maxBytes,
      optionen.archive
    )
    if (!plan.rotieren) return
    for (const pfad of plan.loeschen) {
      if (existsSync(pfad)) rmSync(pfad)
    }
    for (const { von, nach } of plan.verschieben) {
      if (existsSync(von)) renameSync(von, nach)
    }
  }

  function schreibe(stufe: Stufe, nachricht: string, daten?: unknown): void {
    const eintrag = {
      zeit: new Date().toISOString(),
      stufe,
      nachricht,
      daten: daten === undefined ? undefined : redigiere(daten)
    }
    try {
      rotiereBeiBedarf()
      appendFileSync(optionen.datei, JSON.stringify(eintrag) + '\n', 'utf8')
    } catch (fehler) {
      // Ein fehlgeschlagenes Protokoll darf die Anwendung nicht anhalten, aber
      // auch nicht spurlos verschwinden.
      console.error('Protokoll konnte nicht geschrieben werden:', fehler)
    }
    if (optionen.konsole) {
      const ausgabe =
        daten === undefined ? nachricht : nachricht + ' ' + JSON.stringify(eintrag.daten)
      if (stufe === 'error') console.error(ausgabe)
      else if (stufe === 'warn') console.warn(ausgabe)
      else console.info(ausgabe)
    }
  }

  return {
    error: (nachricht, daten) => {
      schreibe('error', nachricht, daten)
    },
    warn: (nachricht, daten) => {
      schreibe('warn', nachricht, daten)
    },
    info: (nachricht, daten) => {
      schreibe('info', nachricht, daten)
    }
  }
}
