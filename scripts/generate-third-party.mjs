// Erzeugt THIRD_PARTY.md aus den tatsaechlichen Paketmetadaten.
//
// Von Hand gepflegt waere die Tabelle nach der zweiten Aenderung falsch.
// Der Guard scripts/assert-third-party.mjs prueft, dass sie aktuell ist.
import { readFileSync, writeFileSync } from 'node:fs'

const ZWECK = {
  react: 'UI-Bibliothek (Renderer)',
  'react-dom': 'DOM-Renderer fuer React',
  electron: 'Desktop-Laufzeit',
  'electron-vite': 'Build-Orchestrierung Main/Preload/Renderer',
  'electron-builder': 'Paketierung und Installer (S5.3)',
  vite: 'Bundler',
  '@vitejs/plugin-react': 'React-Unterstuetzung fuer Vite',
  typescript: 'Typsystem',
  'typescript-eslint': 'Typgestuetzte Lint-Regeln (Invariante 1)',
  eslint: 'Linter',
  prettier: 'Formatierung',
  vitest: 'Testrunner (Unit)',
  '@vitest/coverage-v8': 'Coverage-Provider',
  jsdom: 'DOM-Umgebung fuer Unit-Tests',
  '@testing-library/react': 'Komponententests',
  '@playwright/test': 'E2E gegen die gebaute Anwendung und gegen echten Chrome',
  'pdf-lib': 'Erzeugt den Testkorpus; ab S2.3a auch Schreibpfad zur Laufzeit',
  '@pdf-lib/fontkit': 'Einbetten eigener Schriften im Performance-Fixture',
  '@pdf-lib/standard-fonts':
    'Standard-14-Metriken und WinAnsi-Pruefung fuer /FreeText (S6.5, D22) — bisher nur transitiv ueber pdf-lib',
  'npm-run-all2': 'Skript-Verkettung in verify',
  '@types/node': 'Typen Node',
  '@types/react': 'Typen React',
  '@types/react-dom': 'Typen React-DOM',
  'pdfjs-dist': 'PDF-Anzeige: Parsen und Rendern',
  zustand: 'Zustandsverwaltung im Renderer (ADR 0001)',
  docx: 'Schreibt die .docx beim Export nach Word (S6.7, D19)',
  mammoth: 'Liest die erzeugte .docx im Test unabhaengig zurueck (S6.7)'
}

const PROSA = `
## Versionsbindungen (D3)

Alle Versionen sind **exakt** gepinnt, keine \`^\`-Ranges. Zwei Obergrenzen sind nicht frei
waehlbar, sondern von der Toolchain erzwungen:

### Vite bleibt bei 7, obwohl 8 stable ist

\`electron-vite@5.0.0\` verlangt als Peer \`vite@^5 || ^6 || ^7\`. Umgekehrt verlangt
\`@vitejs/plugin-react@6\` bereits \`vite@^8\`. Beide zusammen sind unerfuellbar, deshalb:
Vite 7.3.6 **und** plugin-react 5.2.0.
**Upgrade-Trigger:** sobald \`electron-vite\` Vite 8 unterstuetzt.

### TypeScript bleibt bei 6.0.3, obwohl 7.0.2 stable ist

\`typescript-eslint@8.69.0\` deklariert als Peer \`typescript@>=4.8.4 <6.1.0\`. Ohne
\`typescript-eslint\` ist Invariante 1 nicht durchsetzbar — \`strict\` allein verbietet kein
\`any\`; die Regeln \`no-explicit-any\` und \`no-unsafe-*\` stammen ausschliesslich von dort.
Die Lint-Kette gibt damit den TypeScript-Major vor, nicht umgekehrt.
**Upgrade-Trigger:** sobald \`typescript-eslint\` TypeScript 7 unterstuetzt.

### pdfjs-dist und zustand sind Laufzeitabhaengigkeiten

Beide werden im Renderer gebraucht: pdfjs-dist zum Anzeigen, zustand fuer den
Dokumentzustand. Der pdf.js-Worker wird ueber Vites ?worker-Import gebuendelt.

### pdf-lib steht noch unter devDependencies

Zur Laufzeit wird es erst ab S2.3a gebraucht (Schreibpfad). Bis dahin nutzt es nur der
Fixture-Generator. Der Umzug nach \`dependencies\` gehoert in S2.3a.

### Ermittelt, aber noch nicht installiert

\`pdfjs-dist@6.3.289\` (S1.1), \`electron-builder@26.15.3\` (S5.3).

## Nicht als Paket eingebunden

- **Google Chrome** wird von den E2E-Tests ueber \`channel: 'chrome'\` benutzt. Playwrights
  gebuendeltes Chromium enthaelt keinen PDF-Viewer und taugt fuer die
  Fremdviewer-Gegenprobe deshalb nicht. Chrome wird nicht mitgeliefert; fehlt er,
  ueberspringt der betreffende Test sichtbar.
- **Systemschriften** werden beim Erzeugen von \`large-heavy.pdf\` lokal gelesen und in
  diese Datei eingebettet. Die Datei ist in \`.gitignore\` und wird nie verteilt.
`

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const zeilen = []
for (const [bereich, deps] of [
  ['Laufzeit', pkg.dependencies ?? {}],
  ['Entwicklung', pkg.devDependencies ?? {}]
]) {
  for (const [name, version] of Object.entries(deps)) {
    let lizenz = 'unbekannt'
    try {
      const meta = JSON.parse(readFileSync('node_modules/' + name + '/package.json', 'utf8'))
      lizenz = meta.license ?? 'unbekannt'
    } catch {
      lizenz = 'unbekannt'
    }
    zeilen.push(
      '| ' +
        name +
        ' | ' +
        version +
        ' | ' +
        lizenz +
        ' | ' +
        bereich +
        ' | ' +
        (ZWECK[name] ?? '') +
        ' |'
    )
  }
}

const kopf = [
  '# Drittanbieter-Abhaengigkeiten',
  '',
  'Die Tabelle wird aus den tatsaechlichen Paketmetadaten erzeugt:',
  '`npm run third-party`. Nicht von Hand pflegen.',
  '',
  '| Paket | Version | Lizenz | Bereich | Zweck |',
  '|---|---|---|---|---|'
]

writeFileSync('THIRD_PARTY.md', kopf.concat(zeilen.sort()).join('\n') + '\n' + PROSA)
console.log('THIRD_PARTY.md erzeugt: ' + String(zeilen.length) + ' Pakete')
