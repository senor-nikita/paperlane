# ADR 0003 — Drucken: Druckvorlage und Chromium-PDF-Betrachter im versteckten Fenster (D12)

**Status:** entschieden · **Datum:** 2026-09-17 · **Schritt:** S4.3

## Kontext

`webContents.print()` und `printToPDF()` drucken das DOM. Seit S1.2 liegen im
DOM nur die sichtbaren Seiten; ein Druck des Hauptfensters ergaebe fuenf
gedruckte und 495 leere Blaetter. Alle Seiten zu materialisieren spraengte das
Speicherbudget, das S1.2 als Exit-Kriterium hat. Der Plan stellt drei Varianten
zur Wahl (D12):

- **(a)** ein verstecktes Fenster, das das Dokument seitenweise mit pdf.js in
  Druckaufloesung rastert und `print()` ruft — Speicherprofil zu messen;
- **(b)** ein verstecktes Fenster mit `plugins: true`, das die PDF-Bytes im
  Chromium-eigenen PDF-Betrachter laedt und dort druckt — aktiviert ein Plugin,
  Spannung zur Haertung, braucht diese ADR;
- **(c)** Drucken auf die aktuelle Seite oder einen Bereich ≤ N beschraenken —
  eine ehrliche, dokumentierte Produktgrenze.

## Erkundung (2026-09-17, Electron 44.1.1)

Zwei Spikes vor der Entscheidung:

1. Ein verstecktes Fenster mit `plugins: true` laedt `large-500.pdf` ueber
   `file:` und liefert mit `printToPDF` alle **500 Seiten mit Text** in rund
   100 ms; der Fensterprozess braucht ~125 MB, unabhaengig von der Seitenzahl.
   `print()` aus demselben Fenster oeffnet den Druckdialog des Systems.
2. Ein eigenes Schema (`app://druck/…`) nimmt der Betrachter **nicht** an
   (leeres Blatt); `data:` funktioniert, ist aber durch die URL-Laenge auf
   kleine Dokumente beschraenkt. Es bleibt `file:`.

## Verworfene Alternativen

**(a) Raster aus pdf.js.** Invariante 6 (`annotationMode: DISABLE`) gilt fuer
jede Zeichenstelle, also blieben Anmerkungen und Formularfelder weg — und die
Aufgabe verlangt „Kommentare mitdrucken". Ausserdem: 500 Seiten in
Druckaufloesung sind als Bilder im DOM ein Speicherrisiko, das erst zu messen
waere, und der Ausdruck waere ein Raster ohne Text.

**(c) Produktgrenze.** Nicht noetig: der gewaehlte Pfad kostet je Seite keinen
Speicher, und das Exit-Kriterium (500 Seiten) ist damit erreichbar. Eine Grenze
waere ein Verzicht ohne Grund.

## Entscheidung

Variante **(b)**, in zwei Teilen:

1. **Die Druckvorlage** (`src/main/druck.ts`, electron-frei) entsteht im Main
   mit pdf-lib aus der Arbeitskopie plus den ungespeicherten Anmerkungen und
   Formularwerten — dieselbe Sammlung wie beim Speichern. Alles, was der Nutzer
   waehlt, wird ins PDF eingebaut: Seitenbereich (nicht gewaehlte Seiten fallen
   wie bei der Mutation aus S4.1, samt verwaister Felder), Ausrichtung ueber
   `/Rotate`, „An Seite anpassen" ueber `page.scale` und eine verschobene
   MediaBox (die Anmerkungen bleiben ohne eigene Verschiebung an ihrer Stelle),
   „Kommentare mitdrucken" ueber das Behalten oder Entfernen der `/Annots`
   ausser Widgets. Und alles, was der Betrachter nicht sehen soll, wird
   entfernt: `entferneSkripte` nimmt `/OpenAction`, `/AA` (Katalog, Seiten,
   Anmerkungen, Felder), den `/JavaScript`-Namensbaum und `/A`-Aktionen vom Typ
   JavaScript.
2. **Das Druckfenster** (`src/main/druckfenster.ts`) ist ein verstecktes
   `BrowserWindow` mit `createDruckWebPreferences()`: `plugins: true`, sonst
   dieselbe Haertung wie das Hauptfenster, **kein** Preload, Fensteroeffnung
   und Navigation gesperrt. Es laedt die Vorlage ueber `file:` aus dem
   temporaeren Verzeichnis des Nutzers (zufaelliger Name, Modus 0600, nach dem
   Auftrag geloescht — auch bei Abbruch und Fehler), wartet, bis `printToPDF`
   so viele Seiten liefert wie die Vorlage hat, und druckt dann: **Datei** =
   genau diese Bytes, atomar geschrieben; **Drucker** = `print()` mit dem
   Systemdialog. Danach wird das Fenster zerstoert.

Beide Ziele laufen durch dieselbe Pipeline: was in der Datei steht, ist das,
was auf dem Papier landet — und das Exit-Kriterium prueft die Datei
(`test/e2e/drucken.electron.spec.ts`: 500 Seiten, Text auf 1, 250, 500 per
pdf.js).

## Warum die Spannung zur Haertung tragbar ist

- Der Betrachter (PDFium) fuehrt Dokument-Skripte aus, pdf.js im Hauptfenster
  nicht (Invariante 6). Deshalb sieht der Betrachter **nie das Original**,
  sondern nur die Vorlage — ohne Skripte, nur mit den gewaehlten Seiten. Der
  Unit-Test belegt es an `js-embedded.pdf`.
- Das Fenster hat keine Bruecke (kein Preload), keinen Node-Zugang, keine
  Navigation, keinen Weg nach draussen; es lebt nur fuer den Auftrag.
- `plugins: true` bleibt auf dieses Fenster beschraenkt; der Guard-Test
  (`electron-hardening.test.ts`) haelt fest, dass das Hauptfenster keines hat
  und das Druckfenster sonst nichts lockert.
- Die Vorlage liegt kurz als Datei im Temp-Verzeichnis. Das ist der Preis
  dafuer, dass der Betrachter kein eigenes Schema nimmt; die Datei traegt nur,
  was der Nutzer ohnehin drucken will, ist nur fuer ihn lesbar und wird
  geloescht.

## Folgen

- Fortschritt (Aufgabe 3) ist phasenweise: Vorlage, Laden, Drucken — der
  Betrachter meldet keinen Seitenfortschritt. Abbrechen zerstoert das Fenster
  und raeumt die Datei weg.
- Der Ereigniskanal aus ADR 0002 traegt dafuer eine weitere Variante
  (`druckFortschritt`); es bleibt bei einem Kanal, geprueft durch
  `pruefeEreignis`.
- Es laeuft hoechstens ein Druck zugleich.
