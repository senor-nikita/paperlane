# paperlane

Desktop-PDF-Betrachter mit Anmerkungen, Formularen, Seitenoperationen und Druck —
eine funktionale Alternative zu kommerziellen Readern, gebaut ausschliesslich auf
offenen Standards (ISO 32000) und quelloffenen Bibliotheken.

paperlane arbeitet vollstaendig lokal: kein Konto, kein Cloud-Sync, keine Telemetrie,
keine Netzwerkaufrufe. Die Architekturentscheidungen stehen in [`docs/adr/`](docs/adr/).

Fertige Windows-Installer gibt es unter
[github.com/senor-nikita/paperlane](https://github.com/senor-nikita/paperlane/releases/latest).
Fragen und Fehler zum Programm bitte als [Issue](../../issues) hier im Repository melden;
wie man mithilft, steht in [`CONTRIBUTING.md`](CONTRIBUTING.md), und
Sicherheitsluecken meldet man nach [`SECURITY.md`](SECURITY.md).

## Installation

**Den fertigen Installer** laedt man von der
[Releases-Seite](https://github.com/senor-nikita/paperlane/releases/latest):
`paperlane Setup <Version>.exe` herunterladen und starten. Der Installer ist nicht
signiert, Windows zeigt beim ersten Start deshalb eine SmartScreen-Warnung — siehe
[Bekannte Grenzen](#bekannte-grenzen).

**Aus dem Quellcode** entsteht das Paket so:

```bash
npm ci
npm run dist:win
```

Der Installer liegt danach unter `release/` (`paperlane Setup <version>.exe`).

**Systemvoraussetzungen**

| Punkt          | Wert                                                              |
| -------------- | ----------------------------------------------------------------- |
| Betriebssystem | Windows, **x64** (`electron-builder.yml`: `win.target: nsis/x64`) |
| Laufzeit       | mitgeliefert — Electron 44.1.1 (`package.json`)                   |
| Zum Bauen      | Node.js 24 (die Version, gegen die die CI baut) und npm           |

macOS (dmg) und Linux (AppImage) stehen in `electron-builder.yml` als Konfiguration,
sind aber **nicht nachgewiesen**: eine Maschine dafuer gibt es im Projekt nicht.

**Der Installationsdurchlauf.** Kein Ein-Klick-Installer: der Installer zeigt die
Apache-2.0-Lizenz, laesst das **Zielverzeichnis waehlen** und bietet auf einer eigenen
Seite die **Dateizuordnung fuer `.pdf`** an — vorausgewaehlt, aber **abwaehlbar**. Ist
sie gesetzt, oeffnet ein Doppelklick auf eine PDF-Datei paperlane mit diesem Dokument.
Installiert wird fuer den aktuellen Benutzer (`perMachine: false`); Verknuepfungen im
Startmenue und auf dem Schreibtisch legt der Installer an. Beim Deinstallieren bleiben
die Einstellungen im Benutzerprofil erhalten (`deleteAppDataOnUninstall: false`).

Beim **ersten Start warnt Windows SmartScreen** — siehe [Bekannte
Grenzen](#bekannte-grenzen).

## Funktionsumfang

**Anzeigen.** Virtualisierter Renderer auf pdf.js: es haengen hoechstens sechs
Canvas-Elemente im DOM, auch bei 300 Seiten. Zoom, Passung auf Breite oder Seite,
Ansichtsdrehung (aendert das Dokument nicht). Auswaehlbare und kopierbare Textebene.
Verschluesselte Dokumente lassen sich mit Passwort oeffnen.

**Navigation.** Seitenfeld, Anfang und Ende, Tastenkuerzel; Gliederung (Lesezeichen)
und Miniaturen in der Seitenleiste. Die Sitzung wird wiederhergestellt:
Fenstergeometrie und die zuletzt gelesene Seite je Dokument.

**Suche.** Volltextsuche ueber das ganze Dokument mit Zwischenspeicher,
Trefferzaehlung, Sprung zum Treffer und Trefferrechtecken auf der Seite.

**Anmerkungen anzeigen.** `Highlight`, `Underline`, `StrikeOut`, `Text`, `Ink`,
`Stamp`, `Square`, `Circle` und `Link`; dazu eine Anmerkungsliste in der Seitenleiste.
Externe Verweise oeffnen sich nur nach Rueckfrage und nur mit den Schemata `http`,
`https` und `mailto`.

**Anmerkungen erstellen und bearbeiten.** Acht Werkzeuge: Auswahl, Markieren,
Unterstreichen, Durchstreichen, Notiz (mit bearbeitbarem Zettel), Freihand (mit
Glaettung), Stempel und Signatur. Verschieben und Groesse aendern ueber Griffe,
Farbe und Strichstaerke einstellbar.

**Rueckgaengig und Wiederholen.** Eine gemeinsame Kommandohistorie fuer Anmerkungen
**und** Seitenoperationen — Strg+Z gilt der Anwendung, nicht dem gerade fokussierten
Bereich.

**Speichern.** Atomares Schreiben; „Speichern" ueber die Originaldatei und „Speichern
unter". Schreibrecht entsteht nur ausserhalb des Renderers (Dateidialog, Befehlszeile,
Systemzuordnung), deshalb laesst sich ein per Drag & Drop geoeffnetes Dokument nur mit
„Speichern unter" sichern. Traegt das Dokument eine digitale Signatur, erscheint vorher
eine **nicht abschaltbare Warnung**.

**Formulare.** AcroForm-Felder ausfuellen; beim Speichern werden nur die geaenderten
Felder geschrieben, schreibgeschuetzte uebersprungen. **Flachlegen** fragt vorher nach
(Vorgabe: Abbrechen), denn es ist nicht umkehrbar. **FDF-Export** nach PDF 32000-1
§12.7.7.

**Grafische Signatur.** Mit der Maus gezeichnet oder aus einer PNG-/JPEG-Datei geladen,
in ein Signaturfeld eingepasst oder frei platziert. Das ist **ein Bild, keine
kryptografische Signatur** — es belegt nicht, wer unterschrieben hat. Dieser Satz steht
auch in der Oberflaeche.

**Seitenoperationen.** Seiten loeschen (auch mehrere), dauerhaft drehen und per Drag &
Drop in der Miniaturenleiste umordnen; Mehrfachauswahl nach Dateimanager-Regeln.

**Zusammenfuehren und Teilen.** Mehrere Dokumente zu einem verbinden; ein Dokument
nach Seitenbereichen in mehrere Dateien teilen.

**PNG-Export.** Aktuelle Seite oder getippte Seitenbereiche, Aufloesung 18–2400 DPI
(Vorgabe 150).

**Drucken.** Siehe [Drucken](#drucken).

**Einstellungen.** Strg+Komma oder Menue „Bearbeiten": Autorenname, Farbe und
Strichstaerke neuer Anmerkungen, Passung beim Oeffnen. Die Konfiguration traegt eine
Schemaversion und wird migriert; eine hoehere Version wird gelesen, aber nie
zurueckgeschrieben.

**Barrierefreiheit.** Seitenleiste als `tablist` mit Pfeiltasten, Miniaturen als
`listbox`, Kuerzeluebersicht (F1), durchgaengiger Fokusring, Sprungmarke, Landmarken,
Seitenwechsel als Live-Region, gepruefte Kontraste. `@axe-core/playwright` laeuft in
der E2E-Suite ueber fuenf Ansichten gegen WCAG 2.x A/AA — ohne Verstoesse. Eine
Stichprobe mit einem Screenreader (NVDA) steht aus.

**Oberflaechensprache** ist Deutsch oder Englisch. Die Einstellung „Sprache“ steht auf
„Automatisch“ (folgt der Systemsprache) und laesst sich auf eine der beiden festlegen
([ADR 0006](docs/adr/0006-oberflaechensprache.md)).

## Bekannte Grenzen

Dieser Abschnitt ist bewusst vollstaendig. Was hier steht, kann die Anwendung nicht.

**Digitale Signaturen werden beim Speichern ungueltig.** paperlane schreibt Dokumente
beim Speichern **vollstaendig neu**; inkrementelles Speichern kann pdf-lib nicht (D7 —
Sachzwang, keine Wahl). Jede vorhandene kryptografische Signatur bricht damit. Die
Anwendung warnt vor dem Schreiben, aber sie kann es nicht verhindern. Wer eine
signierte Datei unveraendert braucht, speichert mit „Speichern unter" in eine Kopie —
die Signatur ist auch dort ungueltig; das Original bleibt nur unangetastet, wenn gar
nicht darueber gespeichert wird.

**Kryptografische Signaturen werden nicht geprueft.** Es gibt keine
Signaturvalidierung und kein Zertifikatsmanagement. Was paperlane „Signatur" nennt,
ist ein Bild.

**Verschluesselte PDFs sind nur lesbar.** Sie lassen sich mit Passwort oeffnen,
anzeigen, durchsuchen und kommentieren, aber nicht speichern, flachlegen, drucken,
zusammenfuehren, teilen oder ueber Seitenoperationen veraendern: all das schreibt das
Dokument ueber pdf-lib neu, pdf-lib kann es nicht entschluesseln, und die
Verschluesselung liesse sich dabei nicht erhalten. Die betroffenen Befehle sind
gesperrt und nennen den Grund; eine verschluesselte Datei, die erst im
Zusammenfuehren-Dialog dazukommt, wird vor der Zielabfrage abgelehnt.

**Kein Auto-Update und keine Versionspruefung.** paperlane sucht nicht nach neuen
Versionen und meldet keine. Das ist eine Entscheidung, kein Versaeumnis: die Invariante
„keine Netzwerkaufrufe" bleibt dadurch vollstaendig, und ohne Code-Signing-Zertifikat
wuerde ein Updater unsignierte Pakete nachladen. Begruendung in
[ADR 0004](docs/adr/0004-kein-auto-update.md); ein Guard (`npm run guard:netzwerk`)
haelt den Zustand fest, und das Paket enthaelt keine `app-update.yml`.
**An neue Versionen kommt man so:** den neuen Installer von der
[Releases-Seite](https://github.com/senor-nikita/paperlane/releases) laden und
ueber die vorhandene Installation laufen lassen (oder aus dem Quellcode mit
`npm run dist:win` bauen). Einstellungen und Sitzungsdaten bleiben dabei erhalten.

**Der Installer ist nicht signiert.** Es gibt vorerst kein Code-Signing-Zertifikat (D9, entschieden am 2026-09-23).
Windows SmartScreen zeigt deshalb beim ersten Start „Der Computer wurde durch Windows
geschuetzt"; der Weg dahinter fuehrt ueber „Weitere Informationen" → „Trotzdem
ausfuehren". Der Ist-Zustand und die Optionen sind in
[`docs/signierung.md`](docs/signierung.md) beschrieben.

**Keine OCR.** Ein gescanntes Dokument ohne Textebene bleibt ein Bild: keine Suche,
keine Textauswahl, kein Kopieren.

**Kein Cloud-Sync, kein Konto, keine Telemetrie, keine Netzwerkaufrufe.** Es gibt
keinen Abgleich zwischen Geraeten und keine Absturzberichte (D14). Alles liegt lokal.

**Kein PDF-JavaScript, kein XFA.** Eingebettetes Dokument-JavaScript wird nicht
ausgefuehrt (`enableScripting: false`), XFA-Formulare werden nicht dargestellt
(`enableXfa: false`); die Anwendung erkennt den XFA-Fall und erklaert ihn, statt eine
leere Seite zu zeigen. Aus Dokumenten, die gedruckt werden, entfernt paperlane
Skript-Einsprungpunkte vorher aus der Druckvorlage.

**Keine PDF-Erzeugung aus anderen Formaten.** paperlane wandelt nichts um; es oeffnet
PDFs.

**Die Bearbeitungsebene ist nicht per Tastatur bedienbar** (dokumentierte Grenze aus
S5.2a). Zeichnen, die Groessengriffe und das Umordnen der Miniaturen bleiben
zeigerbasiert. Anmerkungen lassen sich per Tastatur auswaehlen und loeschen, aber nicht
verschieben oder skalieren.

**Nicht dargestellte Anmerkungen.** Andere Subtypen als die neun oben genannten bleiben
beim Speichern erhalten, werden aber nicht gezeichnet. Ein gespeicherter Bildstempel
erscheint nach dem Neuoeffnen in paperlane als gestrichelter Kasten mit Text: pdf.js
gibt das Bild aus dem Appearance-Stream nicht heraus, und die Canvas zeichnet
Appearance-Streams bewusst nicht. In fremden Betrachtern ist das Bild da.

**Drucken** hat keine Seitenbeschraenkung (D12 fiel auf Variante (b), die keine Grenze
braucht — ADR 0003). Zwei Einschraenkungen bleiben trotzdem: waehrend des Drucks liegt
die Druckvorlage kurz als Datei im temporaeren Verzeichnis des Nutzers (Zufallsname,
Modus 0600, danach geloescht), und es laeuft hoechstens ein Druckauftrag zugleich.

**Der FDF-Export ist nicht gegen ein Drittwerkzeug gefahren.** Er ist strukturell gegen
PDF 32000-1 §12.7.7 geprueft; ein Lauf durch qpdf, pdftk oder mutool steht aus.

**Nur Windows ist nachgewiesen.** macOS und Linux sind konfiguriert, aber ungetestet.

## Drucken

Gedruckt wird nicht die Anzeige, sondern das PDF selbst (ADR 0003): der
Main-Prozess baut aus dem Dokument samt ungespeicherter Aenderungen eine
Druckvorlage — Seitenbereich, Ausrichtung, „An Seite anpassen", mit oder ohne
Kommentare, ohne Dokument-Skripte — und der Chromium-eigene PDF-Betrachter
druckt sie in einem versteckten Fenster: an den Drucker (Systemdialog) oder als
PDF-Datei. Es gibt keine Seitengrenze; 500 Seiten brauchen rund zwei Sekunden.
Waehrend des Drucks liegt die Vorlage kurz im temporaeren Verzeichnis des
Nutzers und wird danach geloescht.

## Abgrenzung zu Adobe-Produkten

paperlane ist ein **unabhaengiges Projekt**. Es ist **nicht verbunden mit, nicht
unterstuetzt von und nicht gesponsert durch Adobe Inc.** oder einen anderen Hersteller,
dessen Dateiformate es liest. „Adobe", „Acrobat" und „Adobe Reader" sind Marken der
Adobe Inc.; andere genannte Produktnamen und Marken gehoeren ihren jeweiligen
Inhabern. Sie werden hier ausschliesslich benannt, um zu sagen, wovon dieses Projekt
sich abgrenzt.

paperlane verwendet keine fremden Marken, Logos, Symbole oder Namensbestandteile im
Produkt: eigener Name, selbst erzeugte Icons, eigene Oberflaeche. Gelesen und
geschrieben wird gegen die offene Spezifikation ISO 32000-1 (PDF 1.7), nicht gegen ein
fremdes Programm; Adobe-Binaries werden nicht analysiert oder nachgebaut.

Abgesichert ist das durch `npm run guard:brand`
([`scripts/assert-brand.mjs`](scripts/assert-brand.mjs)): Fremdmarken sind in `src/`,
`package.json` und `electron-builder.yml` verboten. **Diese Datei liegt bewusst
ausserhalb des Geltungsbereichs** — eine Abgrenzungserklaerung muss benennen koennen,
wovon sie abgrenzt. Der Guard schuetzt das Produkt, nicht seine Dokumentation.

## Lizenz

**Apache-2.0** (D10, entschieden am 2026-09-22). Der vollstaendige Text steht in
[`LICENSE`](LICENSE), die Urhebervermerke in [`NOTICE`](NOTICE); beide liegen im
Wurzelverzeichnis und werden mit dem Paket ausgeliefert, wie es Apache-2.0 §4(a) und
§4(d) verlangen.

Apache-2.0 deckt sich mit `pdfjs-dist`, der wichtigsten Laufzeitabhaengigkeit, und
bringt zwei Dinge mit, die MIT fehlen: eine ausdrueckliche Patentlizenz und die
Markenklausel in §6, die zur Abgrenzung oben passt.

Die Lizenzen aller Abhaengigkeiten stehen in [`THIRD_PARTY.md`](THIRD_PARTY.md). Die
Tabelle wird aus den Paketmetadaten erzeugt (`npm run third-party`) und von
`npm run guard:third-party` gegen `package.json` geprueft.

---

## Fuer Entwickler

### Stack

Electron 44 · TypeScript 6 (strict) · React 19 · Vite 7 · Vitest ·
pdf.js (Anzeige) · pdf-lib (Schreiben) · zustand (Zustand) ·
Playwright (E2E) · electron-builder (Paketierung)

Alle Versionen sind exakt gepinnt. Zwei Obergrenzen sind von der Toolchain erzwungen
und in [`THIRD_PARTY.md`](THIRD_PARTY.md) samt Upgrade-Trigger begruendet.

### Befehle

```bash
npm run dev          # Entwicklungsmodus mit HMR
npm run build        # Produktionsbuild nach out/
npm start            # gebaute Anwendung starten
npm run verify       # Typen, Lint, Tests mit Coverage, Quellcode-Guards
npm run verify:full  # build + verify + Artefakt-Guards + E2E + Performance
npm run dist:win     # Windows-Build und NSIS-Installer nach release/
npm run dist         # Build und Paket fuer die laufende Plattform
npm run test:e2e     # Playwright gegen die gebaute App und gegen echten Chrome
npm run test:perf    # Performance-Budgets (lokal scharf, in CI informativ)
npm run icons        # erzeugt build/icon.{svg,png,ico,icns} ohne Zusatzabhaengigkeit
npm run fixtures     # erzeugt die Test-PDFs (deterministisch)
npm run third-party  # erzeugt THIRD_PARTY.md aus den Paketmetadaten neu
npm run format       # Prettier schreibend
```

Darunter liegen `typecheck` (drei Typwelten), `lint` (ESLint und Prettier pruefend),
`test` (Vitest) und `test:cov` (Coverage plus Gate auf die geaenderten Dateien).

`verify:full` ist die Exit-Bedingung jedes Planschritts.

### Guards

Jeder Guard ist ein eigenes Skript in `scripts/` und einzeln aufrufbar. `npm run
guards` faehrt alle `guard:*` (Quellcode) und ist Teil von `verify`; `npm run
guards:build` faehrt die `guard-build:*` (Build-Artefakte) und braucht einen Build.

| Skript                    | Prueft                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `guard:brand`             | keine Fremdmarken in `src/`, `package.json`, `electron-builder.yml` (Invariante 8)                      |
| `guard:netzwerk`          | keine Netzwerkmodule, -Globals oder `process.binding` in `src/` und `scripts/` (Invariante 7, ADR 0004) |
| `guard:kein-updater`      | das gebaute Paket enthaelt keine Update-Zusage (`app-update.yml`)                                       |
| `guard:third-party`       | `THIRD_PARTY.md` deckt sich mit `package.json`                                                          |
| `guard:fixtures`          | die Test-PDFs sind vorhanden und deterministisch                                                        |
| `guard-build:preload-cjs` | das gebaute Preload-Artefakt ist CommonJS (siehe Fallstricke)                                           |

Ausnahmen sind moeglich, aber sichtbar: eine Zeile darf einen verbotenen Begriff
tragen, wenn sie mit `MARKENABGRENZUNG` (Marken) beziehungsweise `INVARIANTE-7`
(Netzwerk) markiert und begruendet ist. Beide Listen sind damit jederzeit
aufzaehlbar.

### Aufbau

| Pfad            | Inhalt                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| `src/main/`     | Main-Prozess: Fenster, `app://`-Protokoll, Datei-I/O, Schreibpfad, Druck, Menue |
| `src/preload/`  | contextBridge — **muss CommonJS bleiben**, siehe unten                          |
| `src/renderer/` | React-Oberflaeche (Sandbox, kein Node-Zugriff)                                  |
| `src/shared/`   | Typen und reine Funktionen fuer beide Seiten                                    |
| `test/unit/`    | Unit-Tests                                                                      |
| `test/e2e/`     | Playwright gegen die gebaute Anwendung und gegen echten Chrome                  |
| `test/perf/`    | Performance-Budgets                                                             |
| `scripts/`      | Guard- und Hilfsskripte                                                         |
| `build/`        | Icons und `installer.nsh` (Seite fuer die abwaehlbare Dateizuordnung)           |
| `release/`      | Ergebnis von `npm run dist:win` — der Installer                                 |
| `docs/adr/`     | Architekturentscheidungen                                                       |

Die Typwelten sind getrennt: `tsconfig.node.json` (Main/Preload, Node-Typen),
`tsconfig.web.json` (Renderer, DOM-Typen, **keine** Node-Typen),
`tsconfig.test.json` (Tests, beides).

### Zwei Fallstricke, die als Guard abgesichert sind

**Preload muss CommonJS sein.** Electron laedt unter `sandbox: true` kein ESM-Preload.
Der Fehler zeigt sich nicht beim Build, sondern zur Laufzeit als
`window.api === undefined`. `npm run guard-build:preload-cjs` prueft das gebaute
Artefakt.

**Der Renderer wird ueber `app://` ausgeliefert, nicht ueber `file://`.** Begruendung in
[ADR 0000](docs/adr/0000-renderer-delivery.md).

### Architekturentscheidungen

| ADR                                        | Thema                                              |
| ------------------------------------------ | -------------------------------------------------- |
| [0000](docs/adr/0000-renderer-delivery.md) | Renderer ueber `app://` statt `file://`            |
| [0001](docs/adr/0001-dokument-pipeline.md) | Dokument-Pipeline: Transport, Zustand, Handles     |
| [0002](docs/adr/0002-menuebefehle.md)      | Menuebefehle ueber einen Ereigniskanal             |
| [0003](docs/adr/0003-drucken.md)           | Druckstrategie                                     |
| [0004](docs/adr/0004-kein-auto-update.md)  | Kein Auto-Update; Invariante 7 bleibt unveraendert |
