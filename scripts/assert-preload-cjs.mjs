// Guard: Electron laedt unter `sandbox: true` kein ESM-Preload. Das Symptom
// waere `window.api === undefined` zur Laufzeit, kein Build-Fehler. Deshalb
// wird das gebaute Artefakt hier explizit geprueft.
import { readFileSync, existsSync } from 'node:fs'

const ARTIFACT = 'out/preload/index.cjs'

if (!existsSync(ARTIFACT)) {
  console.error(`FEHLT: ${ARTIFACT}\nZuerst bauen:  npm run build`)
  process.exit(1)
}

const source = readFileSync(ARTIFACT, 'utf8')
const esmStatement = /^\s*(import|export)\s/m

if (esmStatement.test(source)) {
  console.error(
    `${ARTIFACT} enthaelt ESM-Syntax auf oberster Ebene.\n` +
      'Electron laedt das unter `sandbox: true` nicht — `window.api` bliebe undefined.\n' +
      'Pruefe build.rollupOptions.output.format in electron.vite.config.ts.'
  )
  process.exit(1)
}

if (!source.includes('require(')) {
  console.error(`${ARTIFACT} enthaelt kein require() — vermutlich kein CommonJS-Bundle.`)
  process.exit(1)
}

console.log(`OK  ${ARTIFACT} ist CommonJS.`)
