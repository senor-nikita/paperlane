# ADR 0004 — Kein Auto-Update; Invariante 7 bleibt unveraendert (D8)

**Status:** entschieden · **Datum:** 2026-09-22 · **Schritt:** S5.3

## Kontext

Invariante 7 („Kein Netzwerk") besteht aus zwei Haelften: der CSP-Direktive
`connect-src 'none'` fuer den Renderer und dem Verbot von `fetch`, `XHR` und
`node:http(s)` in `src/` — also auch im Main-Prozess. Jede Form von
Auto-Update laeuft im Main ueber `node:https`. Die CSP bliebe dabei
unberuehrt, die zweite Haelfte der Invariante nicht. Es gibt keine Variante,
die ohne ADR auskommt; §7 des Plans nennt das stillschweigende Lockern einer
Invariante ausdruecklich einen Fehler.

Der Plan (S5.3, Aufgabe 5) verlangt diese ADR in **beiden** Ausgaengen: auch
der Verzicht ist zu begruenden, nicht nur die Erweiterung.

Zur Wahl standen:

- **(a)** Kein Auto-Update. Invariante 7 bleibt, wie sie ist.
- **(b)** Invariante 7 per ADR um genau einen Update-Endpunkt erweitern
  (`electron-updater`, fester Host, nur im Main, nur auf Nutzerklick).
- **(c)** Nur eine Versionspruefung ohne Download — kleinerer Endpunkt,
  aber ebenfalls ein Netzwerkaufruf und damit derselbe ADR-Zwang wie (b).

## Entscheidung

Variante **(a)**: paperlane bekommt kein Auto-Update und keine
Versionspruefung. Invariante 7 bleibt unveraendert und vollstaendig.
Aktualisierungen laufen ueber den normalen Weg: neue Version herunterladen,
Installer ausfuehren.

## Verworfene Alternativen

**(b) Update-Endpunkt.** Der Gewinn steht nicht im Verhaeltnis zum Preis. Die
Anwendung ist ein lokaler Betrachter ohne Konto, ohne Synchronisierung und
ohne Daten, die veralten; niemand verliert etwas, wenn eine Version zwei
Wochen alt ist. Dagegen stuenden: eine benannte Ausnahme im Guard, ein
Angriffsziel mehr fuer S5.2b, und vor allem die Kopplung an D9. Ohne
Code-Signing-Zertifikat liefert ein Updater unsignierte Pakete aus und
installiert sie selbsttaetig — die SmartScreen-Warnung traefe dann nicht nur
die Erstinstallation, sondern jedes Update. Ein Update-Mechanismus, der
unsignierten Code nachlaedt, ist schlechter als gar keiner.

**(c) Versionspruefung.** Kostet dieselbe Aufweichung der Invariante wie (b)
und liefert dafuer nur einen Hinweis, den der Nutzer ohnehin auf der
Release-Seite findet. Der halbe Preis fuer ein Zehntel des Nutzens.

## Folgen

- **Invariante 7 wird vollstaendig scharfgeschaltet.** `eslint.config.js`
  verbietet nur die Globals `fetch` und `XMLHttpRequest`; die im
  Invariantentext genannten Node-Module waren von keiner Regel gedeckt. S5.3
  schliesst die Luecke mit `scripts/assert-kein-netzwerk.mjs`
  (`npm run guard:netzwerk`, Teil von `guards` und damit von `verify`). Der
  Guard prueft `src/` und `scripts/` zeilenweise auf die sieben
  Netzwerkmodule (`http`, `https`, `http2`, `net`, `tls`, `dgram`, `dns`,
  jeweils mit und ohne `node:`-Praefix), auf die Globals `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource` und auf `process.binding`.

  Bewusst ein Guard statt einer ESLint-Regel, aus zwei Gruenden. Sachlich:
  ein Textvergleich sieht auch, was `no-restricted-imports` entgeht —
  CommonJS-Aufrufe, dynamische Importe, `process.binding` — und er erfasst
  `scripts/`, das `eslint.config.js` ausdruecklich ignoriert. Praktisch:
  `eslint.config.js` liegt unter einem Schutzhaken, der jede Aenderung
  ablehnt.

  Eine Zeile darf eine Netzwerk-API tragen, wenn sie mit `INVARIANTE-7`
  markiert und begruendet ist — nach dem Muster von `assert-brand.mjs`.
  Heute gibt es genau eine solche Stelle: `src/main/index.ts` ruft im
  `app://`-Handler `net.fetch` auf einer `file:`-URL aus `pathToFileURL`
  (ADR 0000). Die Markierung deckt eine lokal arbeitende API, keinen echten
  Aufruf; der braucht weiterhin eine eigene ADR.

- **README** nennt unter den bekannten Grenzen, dass die Anwendung nicht nach
  Updates sucht, und wo neue Versionen liegen.
- **D9 bleibt auf die Erstinstallation beschraenkt.** Ein Zertifikat
  verbessert dann den ersten Start, ist aber fuer keinen laufenden Mechanismus
  Voraussetzung.
- **S5.2b** greift Invariante 7 gegen genau eine markierte Stelle an, nicht
  gegen eine wachsende Ausnahmeliste: die `INVARIANTE-7`-Markierungen sind mit
  `npm run guard:netzwerk` jederzeit aufzaehlbar.
- Die Entscheidung ist umkehrbar: sie nimmt nichts weg, sie fuegt nur nichts
  hinzu. Ein spaeteres Auto-Update braucht dann eine eigene ADR, die diese
  hier ersetzt.

## Anmerkung zur Nummer

Der Plan schreibt fuer D8 „ADR 0002". Diese Nummer ist seit S1.3b an die
Menuebefehle vergeben, 0003 an das Drucken. Die ADR laeuft daher unter
**0004**; der Plan ist entsprechend korrigiert (Aenderungshistorie
2026-09-22).
