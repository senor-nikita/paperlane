# Drittanbieter-Abhaengigkeiten

Die Tabelle wird aus den tatsaechlichen Paketmetadaten erzeugt:
`npm run third-party`. Nicht von Hand pflegen.

| Paket                     | Version | Lizenz       | Bereich     | Zweck                                                                                                     |
| ------------------------- | ------- | ------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| @axe-core/playwright      | 4.13.0  | MPL-2.0      | Entwicklung |                                                                                                           |
| @pdf-lib/fontkit          | 1.1.1   | MIT          | Entwicklung | Einbetten eigener Schriften im Performance-Fixture                                                        |
| @pdf-lib/standard-fonts   | 1.0.0   | MIT          | Laufzeit    | Standard-14-Metriken und WinAnsi-Pruefung fuer /FreeText (S6.5, D22) — bisher nur transitiv ueber pdf-lib |
| @playwright/test          | 1.62.1  | Apache-2.0   | Entwicklung | E2E gegen die gebaute Anwendung und gegen echten Chrome                                                   |
| @testing-library/react    | 16.3.3  | MIT          | Entwicklung | Komponententests                                                                                          |
| @types/node               | 26.4.1  | MIT          | Entwicklung | Typen Node                                                                                                |
| @types/react              | 19.2.18 | MIT          | Entwicklung | Typen React                                                                                               |
| @types/react-dom          | 19.2.5  | MIT          | Entwicklung | Typen React-DOM                                                                                           |
| @vitejs/plugin-react      | 5.2.0   | MIT          | Entwicklung | React-Unterstuetzung fuer Vite                                                                            |
| @vitest/coverage-v8       | 4.1.11  | MIT          | Entwicklung | Coverage-Provider                                                                                         |
| docx                      | 9.7.2   | MIT          | Laufzeit    | Schreibt die .docx beim Export nach Word (S6.7, D19)                                                      |
| electron                  | 44.1.1  | MIT          | Entwicklung | Desktop-Laufzeit                                                                                          |
| electron-builder          | 26.15.3 | MIT          | Entwicklung | Paketierung und Installer (S5.3)                                                                          |
| electron-vite             | 5.0.0   | MIT          | Entwicklung | Build-Orchestrierung Main/Preload/Renderer                                                                |
| eslint                    | 10.9.1  | MIT          | Entwicklung | Linter                                                                                                    |
| eslint-plugin-react-hooks | 7.1.1   | MIT          | Entwicklung |                                                                                                           |
| jsdom                     | 30.0.1  | MIT          | Entwicklung | DOM-Umgebung fuer Unit-Tests                                                                              |
| mammoth                   | 1.12.3  | BSD-2-Clause | Entwicklung | Liest die erzeugte .docx im Test unabhaengig zurueck (S6.7)                                               |
| npm-run-all2              | 9.0.3   | MIT          | Entwicklung | Skript-Verkettung in verify                                                                               |
| pdf-lib                   | 1.17.1  | MIT          | Laufzeit    | Erzeugt den Testkorpus; ab S2.3a auch Schreibpfad zur Laufzeit                                            |
| pdfjs-dist                | 6.3.289 | Apache-2.0   | Laufzeit    | PDF-Anzeige: Parsen und Rendern                                                                           |
| prettier                  | 3.9.6   | MIT          | Entwicklung | Formatierung                                                                                              |
| react                     | 19.2.8  | MIT          | Laufzeit    | UI-Bibliothek (Renderer)                                                                                  |
| react-dom                 | 19.2.8  | MIT          | Laufzeit    | DOM-Renderer fuer React                                                                                   |
| typescript                | 6.0.3   | Apache-2.0   | Entwicklung | Typsystem                                                                                                 |
| typescript-eslint         | 8.69.0  | MIT          | Entwicklung | Typgestuetzte Lint-Regeln (Invariante 1)                                                                  |
| vite                      | 7.3.6   | MIT          | Entwicklung | Bundler                                                                                                   |
| vitest                    | 4.1.11  | MIT          | Entwicklung | Testrunner (Unit)                                                                                         |
| zustand                   | 5.0.15  | MIT          | Laufzeit    | Zustandsverwaltung im Renderer (ADR 0001)                                                                 |

## Versionsbindungen (D3)

Alle Versionen sind **exakt** gepinnt, keine `^`-Ranges. Zwei Obergrenzen sind nicht frei
waehlbar, sondern von der Toolchain erzwungen:

### Vite bleibt bei 7, obwohl 8 stable ist

`electron-vite@5.0.0` verlangt als Peer `vite@^5 || ^6 || ^7`. Umgekehrt verlangt
`@vitejs/plugin-react@6` bereits `vite@^8`. Beide zusammen sind unerfuellbar, deshalb:
Vite 7.3.6 **und** plugin-react 5.2.0.
**Upgrade-Trigger:** sobald `electron-vite` Vite 8 unterstuetzt.

### TypeScript bleibt bei 6.0.3, obwohl 7.0.2 stable ist

`typescript-eslint@8.69.0` deklariert als Peer `typescript@>=4.8.4 <6.1.0`. Ohne
`typescript-eslint` ist Invariante 1 nicht durchsetzbar — `strict` allein verbietet kein
`any`; die Regeln `no-explicit-any` und `no-unsafe-*` stammen ausschliesslich von dort.
Die Lint-Kette gibt damit den TypeScript-Major vor, nicht umgekehrt.
**Upgrade-Trigger:** sobald `typescript-eslint` TypeScript 7 unterstuetzt.

### pdfjs-dist und zustand sind Laufzeitabhaengigkeiten

Beide werden im Renderer gebraucht: pdfjs-dist zum Anzeigen, zustand fuer den
Dokumentzustand. Der pdf.js-Worker wird ueber Vites ?worker-Import gebuendelt.

### pdf-lib steht noch unter devDependencies

Zur Laufzeit wird es erst ab S2.3a gebraucht (Schreibpfad). Bis dahin nutzt es nur der
Fixture-Generator. Der Umzug nach `dependencies` gehoert in S2.3a.

### Ermittelt, aber noch nicht installiert

`pdfjs-dist@6.3.289` (S1.1), `electron-builder@26.15.3` (S5.3).

## Nicht als Paket eingebunden

- **Google Chrome** wird von den E2E-Tests ueber `channel: 'chrome'` benutzt. Playwrights
  gebuendeltes Chromium enthaelt keinen PDF-Viewer und taugt fuer die
  Fremdviewer-Gegenprobe deshalb nicht. Chrome wird nicht mitgeliefert; fehlt er,
  ueberspringt der betreffende Test sichtbar.
- **Systemschriften** werden beim Erzeugen von `large-heavy.pdf` lokal gelesen und in
  diese Datei eingebettet. Die Datei ist in `.gitignore` und wird nie verteilt.
