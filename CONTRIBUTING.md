# Mithelfen

Danke für das Interesse an paperlane. Fehlermeldungen, Verbesserungsvorschläge und Pull Requests
sind willkommen. paperlane ist ein Einzelprojekt: Antworten und Reviews können dauern, und nicht
jeder Vorschlag passt zum Umfang. Fragen Sie bei größeren Änderungen deshalb **vorher in einem
Issue**, bevor Sie viel Arbeit investieren.

**Sicherheitslücken** bitte nicht hier melden, sondern nach [`SECURITY.md`](SECURITY.md).

## Fehler melden

Ein Issue hilft am meisten mit:

- Version von paperlane und Windows-Version,
- den Schritten, die zum Fehler führen,
- was passiert ist und was Sie erwartet haben,
- wenn möglich einer kleinen Beispieldatei. Bitte **keine vertraulichen Dokumente** hochladen;
  ein Fehler lässt sich oft mit einem selbst erzeugten PDF nachstellen.

## Entwicklung

Voraussetzung ist Node.js 24 (die Version, gegen die die CI baut) und npm. Entwickelt und getestet
wird unter Windows; macOS und Linux sind konfiguriert, aber nicht nachgewiesen.

```bash
npm ci            # Abhängigkeiten installieren
npm run dev       # Anwendung mit Neuladen starten
npm run verify    # Typprüfung, Stil, Unit-Tests mit Abdeckung, Guards
```

`npm run verify` muss grün sein, bevor ein Pull Request Sinn ergibt; die CI führt dieselben
Prüfungen aus. `npm run verify:full` baut zusätzlich das Paket und lässt die E2E- und
Performance-Tests laufen (sie starten die echte Anwendung und brauchen entsprechend länger).

## Regeln, die der Build prüft

Mehrere Regeln sind als Guards umgesetzt, damit sie nicht von Aufmerksamkeit abhängen:

- **Keine Netzwerkaufrufe** und kein Auto-Update (`guard:netzwerk`, `guard:kein-updater`,
  [ADR 0004](docs/adr/0004-kein-auto-update.md)). Das ist eine Zusage an die Nutzer.
- **Kein Oberflächentext im Quelltext.** Texte stehen in den Katalogen unter `src/shared/i18n`
  (Deutsch und Englisch, beide Sprachen vollständig; `guard:sprache`).
- **Keine fremden Marken** im Produkt (`guard:brand`).
- **Neue Abhängigkeiten** brauchen eine Begründung und müssen in `THIRD_PARTY.md` stehen
  (`npm run third-party`, `guard:third-party`). Die Lizenz muss zu Apache-2.0 passen.
- **Tests** für jede Änderung am Verhalten. Geänderte Dateien sollen zu mindestens 80 %
  abgedeckt sein (`npm run test:cov`).

## Stil

- Der Quelltext benennt Dinge deutsch (Bezeichner und Kommentare in ASCII, also `ae`, `oe`,
  `ue`); Texte für Nutzer dürfen und sollen echte Umlaute haben. Bleiben Sie beim Stil der
  Umgebung, in der Sie ändern.
- Kommentare sagen, **warum** etwas so ist, nicht was die Zeile tut.
- Formatiert wird mit Prettier (`npm run format`), geprüft mit ESLint (`npm run lint`).
- Commit-Nachrichten: kurze Überschrift im Imperativ oder als Ergebnis („Entf löscht Textfelder
  und Notizen“), darunter bei Bedarf das Warum.

## Pull Requests

1. Ein Issue anlegen oder kommentieren, bei größeren Änderungen vorab.
2. Einen Branch von `main` abzweigen und die Änderung klein und zusammenhängend halten.
3. Tests ergänzen, `npm run verify` lokal grün bekommen.
4. Im Pull Request beschreiben, was sich ändert und warum, und wie Sie es geprüft haben.

## Lizenz

Mit einem Beitrag stimmen Sie zu, dass er unter der [Apache-2.0-Lizenz](LICENSE) des Projekts
veröffentlicht wird (Abschnitt 5 der Lizenz). Eine gesonderte Beitragsvereinbarung gibt es nicht.
