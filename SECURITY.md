# Sicherheit

paperlane öffnet Dokumente aus unbekannter Herkunft und schreibt Dateien. Sicherheitslücken
nehmen wir deshalb ernst, und wir bitten darum, sie **nicht öffentlich** zu melden, bevor es
einen Fix gibt.

## Unterstützte Versionen

Gepflegt wird nur die **neueste veröffentlichte Version** (siehe
[Releases](https://github.com/senor-nikita/paperlane/releases/latest)). Für ältere
Versionen gibt es keine Korrekturen; bitte vorher auf die neueste aktualisieren und prüfen, ob
das Problem dort noch besteht.

## Eine Lücke melden

Über GitHubs **privates Melden von Sicherheitslücken**: im Repository auf den Reiter
**Security** gehen und **„Report a vulnerability“** wählen. Die Meldung ist nur für die
Betreuer sichtbar.

Bitte kein öffentliches Issue und keinen Pull Request für eine ungepatchte Lücke.

Hilfreich in einer Meldung:

- die Version von paperlane und das Betriebssystem,
- was passiert und was stattdessen passieren sollte,
- eine Schritt-für-Schritt-Beschreibung, bei Dokumentfehlern möglichst mit einer kleinen
  Beispieldatei (bitte ohne vertrauliche Inhalte),
- wie schwer die Folge aus Ihrer Sicht ist (Absturz, Hänger, Schreiben an eine falsche Stelle,
  Ausführen von Code).

## Was zu erwarten ist

paperlane ist ein Einzelprojekt, eine feste Antwortfrist können wir nicht zusagen. Wir bestätigen
den Eingang, prüfen die Meldung und melden uns mit einer Einschätzung. Eine behobene Lücke wird
in den Hinweisen zum Release genannt; wer sie gemeldet hat, wird auf Wunsch dort erwähnt.

## Was als Sicherheitsproblem zählt

Die Anwendung behandelt jedes Dokument und jede Zeichenkette aus dem Oberflächenprozess als
nicht vertrauenswürdig. Von Interesse sind zum Beispiel:

- ein präpariertes PDF, das die Anwendung abstürzen lässt, hängen lässt oder zu viel Speicher
  frisst,
- Schreiben oder Lesen außerhalb der Dateien, die die Nutzerin oder der Nutzer ausgewählt hat
  (die Prüfung der Pfade liegt im Hauptprozess),
- Ausführen von Skripten aus einem Dokument (PDF-JavaScript wird bewusst nicht ausgeführt),
- Netzwerkzugriffe: paperlane macht keine, ein Guard (`npm run guard:netzwerk`) und die
  Content-Security-Policy halten das fest,
- Ausbruch aus der Oberflächen-Sandbox.

## Was bewusst kein Sicherheitsproblem ist

Diese Punkte sind dokumentiert und gewollt; sie stehen unter _Bekannte Grenzen_ in der
[README](README.md):

- Beim Speichern werden vorhandene digitale Signaturen ungültig (paperlane schreibt die Datei
  neu und warnt davor).
- Verschlüsselte PDFs lassen sich nur lesen, nicht speichern.
- Der Installer ist nicht signiert, Windows SmartScreen warnt deshalb beim ersten Start.
- Es gibt keine automatischen Updates.
- Windows-Einstellungen wie der „Überwachte Ordnerzugriff“ können das Speichern in
  bestimmten Ordnern verhindern; das ist kein Fehler der Anwendung.
