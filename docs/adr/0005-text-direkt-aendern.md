# ADR 0005 — Vorhandenen Text direkt aendern: Go mit festem Umfang (D20, R15)

**Status:** angenommen am 2026-09-25 (Nutzer: Go mit festem Umfang) · **Datum:** 2026-09-25 · **Schritt:** S6.6a

## Kontext

D20 verlangt, vorhandenen Text im PDF direkt zu aendern, trotz R15 (Schrift
oder Layout gehen kaputt). S6.6a ist die Erkundung davor: ein Prototyp misst,
fuer welchen Anteil der Zeilen sich eine Zeile **wirklich** aus dem
Content-Stream entfernen und durch neuen Text an derselben Grundlinie ersetzen
laesst — (a) mit der Originalschrift, (b) sonst mit einer Ersatzschrift.

Der Prototyp liegt nur auf dem Branch `spike/6-6a-textbearbeitung` unter
`scripts/spike-textbearbeitung/` (JavaScript, ca. 2 200 Zeilen ohne
Korpus-Erzeuger). Nichts davon ist in `src/` eingehaengt.

### Was der Prototyp tut

1. **Lexer** mit Byte-Offsets je Operator (Strings, Hex, Arrays, Dicts,
   Inline-Bilder werden uebersprungen).
2. **Interpreter** fuer `BT/ET Tf Tm Td TD T* TJ Tj ' " Tc Tw Tz TL Ts Tr cm q/Q`
   und Farben, rekursiv in **Form-XObjects** (mit `/Matrix`, eigenen
   Ressourcen, Rekursionsschutz). Je Glyph: Position im Seitenraum, Advance,
   Herkunft (Strom, Operator, Array-Element, Byte-Offset) und der komplette
   Textzustand zum Neusetzen.
3. **Schriftmodell:** einfache Schriften (Encoding, `/Differences`, Widths,
   AFM-Breiten der Standard-14), Type0 mit `Identity-H/V`, `/W`, `CIDToGIDMap`;
   ToUnicode-Parser (bfchar/bfrange); eingebettete Programme: TrueType/OpenType
   ueber fontkit (cmap 3,0 / 3,1 / 1,0, Umriss vorhanden?), Type1 ueber
   eexec-Entschluesselung und `/CharStrings`.
4. **Zuordnung** pdf.js-`getTextContent` ↔ Glyphen: Zeilen aus den
   pdf.js-Elementen (Richtung, Grundlinie, Luecke < 1 em), dann Glyphen, deren
   Mitte in der Zeile liegt. Abbruch, wenn der Operatortext (ueber ToUnicode)
   nicht exakt dem pdf.js-Text entspricht.
5. **Loeschen:** betroffene Show-Operatoren werden neu geschrieben; entfernte
   Glyphen werden zu gleich grossen `TJ`-Verschiebungen, damit alles Folgende
   im selben Operator und in derselben Textzeile exakt stehen bleibt. Die Bytes
   sind danach **nicht mehr im Stream**. Form-XObjects, die nur einmal benutzt
   werden, werden in place geaendert; geteilte (Kopfzeile auf jeder Seite)
   werden fuer diese Seite kopiert und der `Do` umgehaengt.
6. **Ersetzen:** nach dem Loeschen neuer Text am Seitenende (Original in
   `q … Q` gekapselt) mit der Text-Rendering-Matrix und Farbe des ersten
   Glyphs. (a) Originalschrift: Codes aus ToUnicode/Encoding; neue Zeichen nur,
   wenn der Glyph im eingebetteten Programm tatsaechlich einen Umriss hat;
   fehlende Breiten, ToUnicode-Eintraege und `/Differences` werden ergaenzt.
   (b) Ersatzschrift: Standard-14 (WinAnsi) **oder** LiberationSans (OFL,
   fontkit-Teilmenge), Stil aus dem Schriftnamen geraten.
7. **Pruefung unabhaengig vom Editor** mit pdf.js: Ergebnis oeffnet; jede
   andere Textzeile der Seite ist unveraendert; die bearbeitete Zeile enthaelt
   genau den neuen Text an derselben Grundlinie und Startposition; im
   Rasterbild (2x) aendert sich ausserhalb der alten/neuen Zeilenflaeche kein
   Pixel (> 30 Pixel = Fehler); nach dem Loeschen bleibt < 15 % der Tinte im
   Glyphenband; nach dem Ersetzen ist genug Tinte je Zeichen da (sonst:
   unsichtbare Glyphen, also Kaestchen/Luecken).

### Korpus

- **Fixtures** (`test/fixtures/*.pdf`, inkl. `word.pdf`): alle pdf-lib-erzeugt,
  Standard-14, nicht eingebettet. `corrupt.pdf` und `encrypted.pdf` sind
  uebersprungen, `scanned.pdf`/`shading.pdf` haben keinen Text.
- **Sieben synthetische Dokumente** (`korpus.mjs`, deterministisch, Schrift
  LiberationSans aus `pdfjs-dist/standard_fonts`):
  K1 TrueType-Teilmenge mit WinAnsi, gid-erhaltend (Office-Muster, ohne
  ToUnicode) · K2 Standard-14 mit `' " T* TL TD`, Tabellenzellen je `Td` ·
  K3 Type0/CIDFontType2 Identity-H (pdf-lib-Teilmenge) · K4 Text in
  Form-XObjects, geteilte Kopfzeile auf zwei Seiten, verschachtelte Form ·
  K5 TJ-Kerning, Blocksatz ueber `Tw`, Wortabstand nur als TJ-Zahl, `Tc`,
  `Tz`, `Ts`, `cm`-Skalierung, 90°-Drehung, Farbe · K6 LaTeX-artig: Type1-
  Teilmenge (echtes eexec-Programm), `/Differences`, fi-Ligatur, kein
  ToUnicode, pdfTeX-Operatorstil · K7 Scan mit unsichtbarem OCR-Layer (`3 Tr`,
  `Tz` je Wort).
- **Drei echte Erzeuger-PDFs:** R1 **Microsoft Word** (Export ueber COM,
  `word-export.ps1`: Calibri/Cambria/Arial/Times, Blocksatz, Tabelle,
  Aufzaehlung, Fusszeile), R2/R3 **Chromium/Skia** (Electron `printToPDF`,
  `chromium-export.cjs`: Rechnung mit Tabelle, Protokoll in Segoe UI/Georgia).
- **Kein LaTeX- und kein LibreOffice-PDF:** weder TeX noch LibreOffice sind
  lokal installiert, und Netzwerk/Downloads sind ausgeschlossen. K6 bildet
  das pdfTeX-Muster nach (Type1-Teilmenge, Differences, TJ-Wortabstand), ist
  aber vom selben Autor wie der Parser — das ist die groesste Schwaeche der
  Messung (siehe Grenzen).

Die Plan-Liste „Scan mit OCR-Layer, Formular, Rechnung" ist durch K7,
`acroform.pdf`/`xfa.pdf` und R2 abgedeckt.

### Messung

Stichprobe bis 25 Zeilen je Dokument, gleichmaessig ueber alle Seiten, 226
Zeilen gesamt. Je Zeile vier Operationen:
**L** Zeile loeschen · **E2** Ersetzen durch dieselben Zeichen in anderer
Reihenfolge (Tippfehler korrigieren, Zahl aendern) · **E3** Ersetzen durch
Freitext gleicher Laenge mit Umlauten, `€`, `&`, Ziffern ·
jeweils zuerst (a), bei Fehlschlag (b).

Klassen: **a** = Originalschrift, eingebettet · **a0** = Originalschrift,
aber Standard-14 **nicht eingebettet** (sieht aus wie vorher, weil der
Betrachter ohnehin ersetzt) · **b** = Ersatzschrift · **x** = scheitert.

| Dokument                    | Zeilen | L ok  | E2 a / a0 / b / x    | E3 a / a0 / b / x     |
| --------------------------- | ------ | ----- | -------------------- | --------------------- |
| R1 Word (CID + TrueType)    | 25/31  | 100 % | 96 / 0 / 4 / 0 %     | 56 / 0 / 44 / 0 %     |
| R2 Chromium Rechnung (CID)  | 25/33  | 100 % | 100 / 0 / 0 / 0 %    | 56 / 0 / 44 / 0 %     |
| R3 Chromium Brief (CID)     | 10/10  | 100 % | 100 / 0 / 0 / 0 %    | 10 / 0 / 90 / 0 %     |
| K1 TrueType-Teilmenge       | 9/9    | 100 % | 100 / 0 / 0 / 0 %    | 0 / 0 / 100 / 0 %     |
| K2 Standard-14, `' " T*`    | 25/26  | 100 % | 0 / 100 / 0 / 0 %    | 0 / 100 / 0 / 0 %     |
| K3 CID Identity-H (pdf-lib) | 25/26  | 100 % | 100 / 0 / 0 / 0 %    | 40 / 0 / 60 / 0 %     |
| K4 Form-XObjects            | 11/11  | 100 % | 0 / 100 / 0 / 0 %    | 0 / 100 / 0 / 0 %     |
| K5 Kerning/TJ/Textzustand   | 25/50  | 100 % | 0 / 100 / 0 / 0 %    | 0 / 100 / 0 / 0 %     |
| K6 LaTeX-artig (Type1)      | 6/6    | 100 % | 100 / 0 / 0 / 0 %    | 0 / 0 / 100 / 0 %     |
| K7 Scan + OCR (unsichtbar)  | 9/9    | 100 % | 100 / 0 / 0 / 0 %    | 0 / 0 / 100 / 0 %     |
| Fixtures (9 mit Text)       | 56     | 100 % | 0 / 100 / 0 / 0 %    | 0 / 96 / 4 / 0 %      |
| **Echte Erzeuger (R1–R3)**  | 60     | 100 % | **98 / 0 / 2 / 0 %** | **48 / 0 / 52 / 0 %** |
| **Gesamt**                  | 226    | 100 % | 48 / 52 / 0 / 0 %    | 17 / 51 / 32 / 0 %    |

Ersatzschrift bei E3: LiberationSans (OFL, eingebettet) und Standard-14
bestehen beide in 100 % der Faelle. Laufzeit je Operation (Laden, Analysieren,
Aendern, Speichern; ohne Pruefung): Median 34–85 ms, p95 bis 0,8 s bei
`large-500.pdf` (500 Seiten, Speichern dominiert).

Rohdaten: `scripts/spike-textbearbeitung/ergebnis/messung-25.txt` auf dem
Spike-Branch. Nachlauf: `node scripts/spike-textbearbeitung/korpus.mjs <dir>`,
dann `ZEILEN=25 node scripts/spike-textbearbeitung/messen.mjs out.json <dir> test/fixtures`.

### Fehlerbilder

- **Glyph fehlt in der Teilmenge (46×, nur E3-a):** der haeufigste und
  erwartete Fall. Word bettet zwar alle 3 500–7 000 Glyph-Slots ein, laesst
  unbenutzte aber **leer** — ein naiver Test „gid existiert" haelt sie fuer
  vorhanden und erzeugt unsichtbare Zeichen. Der Prototyp prueft deshalb den
  Umriss; so wird es (b), nicht Kaputt.
- **Teilmenge ohne cmap-Tabelle (24×, E3-a):** pdf-lib- und Chromium-CID-
  Teilmengen enthalten nur die benutzten Glyphen und keine cmap; ein neues
  Zeichen laesst sich nicht auf einen Glyph abbilden → (b).
- **Nicht in der Kodierung (2×):** WinAnsi-Schrift ohne `€`/Sonderzeichen
  bzw. Standard-14 ohne passenden Code → (b).
- **Nur waehrend der Entwicklung gesehen, im Prototyp behoben:** Raster-
  Fehlalarm durch Tabellenlinien in der Zeilenflaeche; Zuordnung schlug fehl,
  wenn pdf-lib zufaellige Ressourcennamen vergab. Kein Fall, in dem der
  Stream beschaedigt oder eine **andere** Zeile veraendert wurde.
- **Qualitaetsmaengel, die die Metrik nicht als Fehler zaehlt**, aber S6.6b
  loesen muss:
  - (b) nimmt den **Stil des ersten Glyphs** — eine Zeile mit fettem Teilstueck
    („Wichtig: **Lieferung frei Haus**") wird einheitlich normal.
  - (b) LiberationSans statt Calibri: gleiche Punktgroesse, aber groessere
    x-Hoehe; die Zeile wirkt sichtbar anders. Deshalb muss (b) markiert sein.
  - Kein Umbruch: laengerer Text laeuft ueber die Spalte/Zelle hinaus,
    kuerzerer hinterlaesst eine Luecke. Blocksatz (`Tw`) wird nicht neu
    verteilt.
  - Ligaturen im Original (`ti` bei Calibri, `fi` bei LaTeX) bleiben beim
    Entfernen korrekt; beim Neusetzen mit (a) werden sie nicht gebildet.

### Grenzen der Messung

- Der Korpus ist klein, und sieben der zehn Nicht-Fixture-Dokumente sind
  **vom Parser-Autor gebaut**. Die 100 % beim Loeschen sind deshalb eine
  Obergrenze, keine Erwartung fuer beliebige PDFs.
- **Nicht abgedeckt:** Type3-Schriften, CMaps ausser Identity-H/V (CJK mit
  Standard-CMaps), CFF-Programme (`FontFile3`) fuer (a), Text in Mustern
  oder Annotations-Appearance-Streams, `ActualText`/Tagged PDF (Strukturbaum
  verweist nach dem Loeschen auf leere `MCID`s), Zeichen-fuer-Zeichen-Satz mit
  eigenem `Tm` je Glyph aus InDesign/Ghostscript, echte LaTeX- und
  LibreOffice-Ausgaben, verschluesselte PDFs.
- **Fremdviewer:** geprueft nur mit pdf.js (Text + Raster). Die visuelle
  Gegenprobe in Acrobat/Edge-PDFium steht aus und gehoert in S6.6b.

## Entscheidung (Empfehlung)

**Go — mit festem, engem Umfang.** Der Kern ist tragfaehig: Operatoren einer
Zeile lassen sich zuverlaessig lokalisieren und wirklich entfernen, ohne
Nachbarzeilen oder den Rest der Seite zu verschieben — in allen 226 Zeilen,
auch in geteilten Form-XObjects und auf unsichtbaren OCR-Layern. Mit der
Originalschrift geht Korrigieren mit den vorhandenen Zeichen fast immer (98 %
bei Word/Chromium); Freitext geht mit der Originalschrift nur in rund der
Haelfte der Zeilen, der Rest braucht die Ersatzschrift — die aber immer
funktioniert. Ein „No-Go" waere durch die Zahlen nicht gedeckt, ein
unbeschraenktes „Go" wegen der Korpusgrenzen nicht verantwortbar.

### Umfang fuer S6.6b

1. **Einheit ist genau eine Zeile** im Sinne dieses Prototyps (Elemente
   gleicher Grundlinie, Luecke < 1 em). Kein Absatz, kein Umbruch, kein
   Reflow, kein Neuverteilen von Blocksatz.
2. **Loeschen** und **Ersetzen**; beides entfernt die Bytes wirklich aus dem
   Stream (auch in Form-XObjects, geteilte werden je Seite kopiert).
3. **(a) Originalschrift**, wenn **jedes** neue Zeichen einen Glyph mit Umriss
   im eingebetteten Programm hat (TrueType/OpenType ueber fontkit, Type1 ueber
   CharStrings) oder die Schrift Standard-14 ist. Sonst die ganze Zeile in
   **(b) Ersatzschrift** — kein Mischen innerhalb einer Zeile.
4. **(b)** ist **sichtbar markiert** (Hinweis im Bearbeitungsfeld vor dem
   Uebernehmen, Kennzeichnung im Undo-Eintrag). Welche Ersatzschrift, legt
   D22 aus S6.5 fest; aus S6.6a spricht alles fuer **eine eingebettete OFL-
   Schrift ueber fontkit** statt Standard-14: gleiches Bild in jedem Viewer,
   volle Unicode-Abdeckung statt WinAnsi, beide Varianten bestanden die
   Messung gleich gut. Mindestens eine Serifen- und eine serifenlose Familie,
   Wahl ueber den Originalnamen.
5. **Klare Ablehnung statt Risiko** (Meldung, nichts geaendert) bei: Type3,
   CMap ausser Identity-H/V, Text in Mustern/Annotationen, Abweichung zwischen
   Operator- und pdf.js-Text, geteilter Form in verschachtelter Form, Tagged
   PDF mit `ActualText` auf der Zeile, verschluesselten Dokumenten.
6. **Pruefung wie im Prototyp** als Test-Orakel (andere Zeilen unveraendert,
   Rasterdifferenz nur in der Zeile, keine unsichtbaren Glyphen) plus
   Fremdviewer-Gegenprobe in Edge/PDFium.
7. Der **Korpus** fuer S6.6b wird um echte LaTeX-, LibreOffice- und
   InDesign-/Ghostscript-Dateien erweitert, sobald der Nutzer sie lokal
   bereitstellt; vorher gilt der Umfang oben.

**Aufwand S6.6b (geschaetzt):** gross. Parser/Interpreter/Schriftmodell als
TypeScript-Kern in `shared/` mit Tests ca. 3–4 Tage; Mutation `textErsetzen`,
Undo, Cache-Invalidierung, UI (Zeile waehlen, Eingabefeld, Hinweis b) ca.
2–3 Tage; Korpus, Fremdviewer-Gegenprobe, Security-Review des Parsers
(fremde Eingabe, Gate Phase 6) ca. 1–2 Tage. Zusammen **6–9 Arbeitstage**.

## Verworfene Alternativen

**No-Go.** Die befuerchteten Fehlerbilder aus R15 — Kaestchen durch fehlende
Glyphen, verrutschte Folgezeilen — traten nicht auf, weil beide Ursachen
vorher erkennbar sind (Umrisspruefung, TJ-Verschiebung statt Loeschen des
Advance). Den gewuenschten Nutzen komplett zu streichen, ist nicht noetig.

**Eingeschraenkt auf „nur Loeschen" oder „nur Standard-14".** Loeschen allein
deckt den Hauptwunsch (Korrigieren) nicht ab, und Standard-14-Dokumente sind
fast nur Generator-PDFs; echte Office-/Browser-PDFs verwenden eingebettete
CID-Teilmengen, genau dort funktionierte (a) fuer E2 in 98 %.

**Abdecken/Ueberschreiben** (weisses Rechteck + neuer Text) — laut D20 nicht
beauftragt, und der alte Text bliebe im Stream (Suche, Kopieren, Datenschutz).

**Glyphen in die Teilmenge nachtragen** (Umriss aus einer Systemschrift in
die eingebettete Teilmenge kopieren) — rechtlich (Schriftlizenz) und technisch
(CFF, Hinting, Metrik-Abweichung) deutlich riskanter als eine markierte
Ersatzschrift. Nicht in S6.6b.

## Folgen

- Der Spike-Branch wird **nicht** gemergt. Auf `main` kommen nur diese ADR
  und die Plan-Aenderungen (D20-Verweis, Aenderungshistorie).
- S6.6b haengt zusaetzlich an D22 (Ersatzschrift aus S6.5).
- Neuer Parser fuer fremde Eingabe → S6.6b faellt unter den Security-Scan im
  Gate Phase 6 (Tiefenbegrenzung, Stream-Groesse, Endlosschleifen im Lexer).
- Wenn S6.6b mit realen Nutzerdokumenten andere Fehlerquoten zeigt, wird der
  Umfang hier nachgetragen, nicht stillschweigend erweitert.

## Anmerkung zur Nummer

0005 ist die naechste freie Nummer auf `a2e147e`. S6.3 und S6.5 laufen
parallel; legt einer davon ebenfalls eine ADR 0005 an, wird diese beim Merge
umnummeriert und der Verweis in D20 angepasst.
