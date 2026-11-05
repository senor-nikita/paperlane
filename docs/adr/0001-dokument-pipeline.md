# ADR 0001 — Dokument-Pipeline: Transport, Zustand, Schreibpfad, Handles

**Status:** entschieden · **Datum:** 2026-09-03 · **Schritt:** S1.1

Vier Entscheidungen, die zusammen getroffen werden muessen, weil sie voneinander
abhaengen. Einzeln entschieden geraten sie in Widerspruch.

---

## 1. Datei-Transport (D4): ganzer ArrayBuffer ueber IPC

### Kontext

Die urspruengliche Empfehlung war ein Range-Transport, begruendet mit dem
Akzeptanzkriterium "500 Seiten, erste Seite unter 2 s". Zwei Korrekturen haben
diese Begruendung Stueck fuer Stueck entwertet:

1. Die erste Fassung, ein eigenes `doc://`-Protokoll, ist mit Invariante 7
   unvereinbar: `connect-src 'none'` verbietet jeden Ladevorgang von pdf.js,
   auch ueber ein eigenes Schema. Zudem waehlt pdf.js seinen Transport ueber
   `isValidFetchUrl()`, das nur `http:` und `https:` akzeptiert.
2. Blieb `PDFDataRangeTransport` ueber den bestehenden IPC-Kanal. Auch dafuer
   fehlte der Beleg, dass er ueberhaupt schneller ist.

### Messung

`scripts/measure-transport.mjs`, gegen `test/fixtures/large-heavy.pdf`
(64,8 MB, 300 Seiten, eingebettete Bilder und Schriften), drei Laeufe,
gemessen bis `getOperatorList()` der ersten Seite:

| Variante                 | Mittel    | min   | max   |
| ------------------------ | --------- | ----- | ----- |
| A: ganzer ArrayBuffer    | **38 ms** | 17 ms | 82 ms |
| B: PDFDataRangeTransport | 71 ms     | 66 ms | 79 ms |

Variante B forderte dabei **306 Bereiche** an, zusammen 19,1 MB von 64,8 MB.

### Entscheidung

**Variante A.** Die Datei wird im Main-Prozess vollstaendig gelesen und als
`ArrayBuffer` ueber IPC an den Renderer gegeben.

### Begruendung

- B ist bei lokalen Dateien fast doppelt so langsam. Es dominiert das Parsen
  von Querverweistabelle und Seitenbaum, nicht der Transfer von der SSD.
- Die 306 Bereiche waeren ueber IPC 306 Rundreisen zwischen zwei Prozessen. In
  der Messung liefen sie als synchrone Dateizugriffe im selben Prozess und
  waren trotzdem teurer.
- B spart nicht einmal viel Ein- und Ausgabe: 19,1 von 64,8 MB wurden ohnehin
  gelesen.
- Beide Varianten liegen um Faktor 26 unter dem Budget. Die Entscheidung faellt
  damit nicht ueber Geschwindigkeit, sondern ueber Einfachheit — und A ist
  erheblich einfacher.

### Preis und Grenze

A kostet Spitzenspeicher: waehrend der Uebergabe liegt das Dokument kurzzeitig
zweimal vor. Fuer 64,8 MB ist das vertretbar, fuer ein Dokument von mehreren
hundert Megabyte nicht.

**In S1.2 nachgemessen, Punkt geschlossen:** die IPC-Uebergabe von 64,8 MB dauert
**302 ms** (`test/perf/rendering.perf.spec.ts`). Zusammen mit dem Parsen erscheint die
erste Seite nach **470 ms** — bei einem Budget von 2000 ms. Eine Groessenschwelle,
oberhalb derer stueckweise uebertragen wird, ist damit nicht noetig und wird nicht
eingezogen. Sollte spaeter ein deutlich groesseres Dokument auftauchen, ist die
Messung reproduzierbar und die Entscheidung neu zu treffen.

---

## 2. Zustandsverwaltung (D5): Zustand

**Entscheidung:** `zustand`, nicht Redux Toolkit.

**Begruendung.** Den Ausschlag gibt das gemeinsame Undo/Redo aus S2.2 und S4.1.
Redux Toolkits Zeitreise klingt danach, als loeste sie das Problem, tut es aber
nicht: Seitenoperationen erfordern laut S4.0 ein vollstaendiges Neuserialisieren
des Dokuments mit anschliessendem Neuladen. Ein generischer Zustands-Schnappschuss
kann das nicht rueckgaengig machen — es braucht ohnehin eine explizite
Kommandohistorie mit Vorwaerts- und Rueckwaertsoperation je Kommando. Diese
Historie ist in Zustand genauso zu schreiben wie in Redux, nur ohne dessen
Beiwerk. Eine Zeitreise, die fuer Annotationen scheinbar funktioniert und fuer
Seitenoperationen still danebenliegt, waere schlechter als gar keine.

**Preis.** Keine Redux-Devtools. Akzeptiert.

---

## 3. Ort des Schreibpfads: Main-Prozess

**Entscheidung.** `pdf-lib` laeuft im Main-Prozess. Der Renderer schickt das
Annotations- und Formularmodell als einfache Daten ueber IPC; die Bytes der
Datei liest der Main-Prozess zum Speicherzeitpunkt **erneut von der Platte**.

**Begruendung.**

- Der Renderer ist die Sandbox fuer fremde Dokumente. Schreibzugriffe gehoeren
  hinter die Pfad-Allowlist aus Invariante 11, und die liegt im Main-Prozess.
- Wuerde der Main-Prozess die Bytes ueber die ganze Sitzung halten, laege das
  Dokument dauerhaft zweimal im Speicher — einmal im Renderer zur Anzeige,
  einmal im Main zum Schreiben. Erneutes Lesen kostet bei 64,8 MB rund 40 ms
  und faellt nur beim Speichern an, also selten.
- Das Annotationsmodell ist bewusst unabhaengig von pdf.js (S2.1) und damit aus
  einfachen Objekten aufgebaut. Es ueber IPC zu schicken ist billig.

---

## 4. Lebensdauer der Datei-Handles: kein Dauer-Handle

**Entscheidung.** Dateien werden geoeffnet, vollstaendig gelesen und sofort
geschlossen. Ueber die Sitzung bleibt kein Handle offen.

**Begruendung.** Ein gehaltenes Handle blockiert unter Windows das Loeschen und
Umbenennen der Datei durch andere Prozesse. Das haette zwei Folgen: der Fall
"Datei wird waehrend des Betrachtens geloescht" aus S1.5 waere kaum ausloesbar,
und das atomare Speichern aus S2.3a scheiterte mit `EPERM`, weil ein Rename auf
eine noch geoeffnete Zieldatei nicht gelingt. Mit Variante A entfaellt das
Problem von selbst — nach dem Lesen ist nichts mehr offen zu halten.

---

## 5. Oberflaechensprache (D15): nur Deutsch, keine i18n-Schicht

> **Abgeloest durch [ADR 0006](0006-oberflaechensprache.md) (S6.8, 2026-09-30):** Deutsch und Englisch,
> typisierte Kataloge in `src/shared/i18n`. Der Text unten ist die urspruengliche Entscheidung.

**Entscheidung.** Eine Sprache, Zeichenketten direkt im Code.

**Begruendung.** Eine i18n-Schicht kostet in jeder Komponente Aufwand und zahlt
sich erst bei der zweiten Sprache aus. Sie spaeter einzuziehen bedeutet, die
Zeichenketten herauszuziehen — unangenehm, aber mechanisch. Sie jetzt
vorzuhalten bedeutet, sie in jedem Schritt mitzuschleppen, ohne Nutzen.

---

## Auswirkungen auf den Plan

- S1.1 setzt Variante A um; der Range-Transport entfaellt ersatzlos.
- S1.2 misst die IPC-Uebergabedauer nach (siehe Grenze unter 1).
- S2.3a schreibt im Main-Prozess und liest die Datei dort erneut.
- S1.5 Fall 4 ist ausloesbar, weil kein Handle gehalten wird.
