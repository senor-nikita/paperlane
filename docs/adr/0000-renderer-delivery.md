# ADR 0000 — Auslieferung des Renderers im Produktionsbuild

**Status:** entschieden · **Datum:** 2026-09-02 · **Schritt:** S0.1

## Kontext

Die Anwendung oeffnet fremde, potenziell boesartige PDF-Dateien. Der Renderer laeuft
deshalb als Sandbox, und in S0.2 wird eine strikte Content-Security-Policy gesetzt, die
in allen weiteren Schritten per Guard-Test eingefroren bleibt (Invariante 7).

Diese CSP arbeitet durchgehend mit dem Schluesselwort `'self'` — unter anderem fuer
`script-src` und `worker-src`. `worker-src` ist nicht optional: pdf.js laedt seinen
Parser in S1.1 als Worker.

Damit `'self'` ueberhaupt etwas bedeutet, braucht das Renderer-Dokument eine definierte
Origin. Unter `file://` ist die Origin opak. `script-src 'self'` und `worker-src 'self'`
greifen dann nicht verlaesslich, und der Bruch faellt typischerweise erst im
Produktionsbuild auf, weil der Vite-Dev-Server ueber `http://localhost` ausliefert und
dort eine echte Origin hat. Genau dieses Muster ist im Plan als Risiko R2 gefuehrt.

## Entscheidung

Der Renderer wird im Produktionsbuild ueber ein eigenes, privilegiertes Schema `app://`
ausgeliefert:

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])
```

`standard: true` erzeugt eine echte, vergleichbare Origin; `secure: true` stellt das
Schema den sicheren Kontexten gleich. Der Einstiegspunkt ist `app://bundle/index.html`,
bedient von einem `protocol.handle`-Handler, der Dateien aus `out/renderer` liest.

Im Entwicklungsmodus wird weiterhin die von `electron-vite` bereitgestellte URL geladen
(`process.env.ELECTRON_RENDERER_URL`).

## Verworfene Alternative

`win.loadFile('out/renderer/index.html')` — der Standardweg von `electron-vite`. Kostet
null Aufwand, macht aber die CSP aus S0.2 in ihrem Kern wirkungslos und verschiebt den
Fehler in den Produktionsbuild.

## Konsequenzen

- **Bewusste Abweichung vom Framework-Default.** `electron-vite` laedt in Produktion per
  `loadFile()`. Diese Ueberschreibung ist Absicht und hier dokumentiert.
- **Zusaetzliche Angriffsflaeche:** ein Protokoll-Handler, der Pfade aufloest. Deshalb
  liegt die Aufloesung in `src/main/renderer-path.ts` als reine, Electron-freie Funktion
  mit eigener Testabdeckung.
- **Traversal-Schutz ist noetig und wirksam:** WHATWG-`URL` normalisiert `..` und
  `%2E%2E` bereits beim Parsen weg. Kodierte Slashes (`..%2F..%2F`) ueberstehen die
  Normalisierung jedoch und werden erst durch `decodeURIComponent` wieder zu
  Pfadtrennern. Die Grenzpruefung gegen das Renderer-Verzeichnis faengt genau diesen Fall
  ab; beide Verhaltensweisen sind in `test/unit/renderer-path.test.ts` festgehalten,
  damit eine spaetere Aenderung der Parsing-Semantik auffaellt.
- **Voraussetzung fuer S0.2 und S1.1:** die CSP kann jetzt mit `'self'` formuliert werden,
  und der pdf.js-Worker laedt im Build.
