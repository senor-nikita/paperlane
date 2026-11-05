# ADR 0006 — Oberflaeche auf Deutsch und Englisch: typisierte Kataloge ohne Bibliothek (D15)

**Status:** angenommen · **Datum:** 2026-09-30 · **Schritt:** S6.8 · **Loest ab:** ADR 0001, Abschnitt 5

## Kontext

ADR 0001 hatte D15 mit "nur Deutsch, keine i18n-Schicht" entschieden und das
Herausziehen der Texte ausdruecklich auf spaeter verschoben. Am 2026-09-28
revidierte der Nutzer D15: die Oberflaeche soll auch englisch sein, beim
ersten Start aus der Systemsprache, umschaltbar in den Einstellungen, ohne
Abfrage im Installer.

Die Texte standen bis dahin direkt im Code: rund 650 Stellen in Renderer,
Main (Menue, Dialoge, Ablehnungsgruende), `shared` (Fehlerdeutung,
Seitenbereiche, Formularpruefung, Mutationsbeschreibungen) und im Worker der
Textbearbeitung. Die deutsche Oberflaeche schrieb Umlaute durchgehend
umschrieben ("oeffnen").

## Entscheidung

1. **Eigene, kleine Schicht in `src/shared/i18n`, keine Abhaengigkeit.** Zwei
   Sprachen, Platzhalter `{name}` und eine Pluralform (`eins`/`mehr`) sind
   rund 130 Zeilen. Eine Bibliothek braechte Laufzeitformate, ICU-Parser und
   Ladelogik, von denen nichts gebraucht wird.
2. **Der deutsche Katalog ist die Quelle der Schluessel.** Er steht `as const`;
   der englische ist gegen ihn typisiert (`Abschnitt<typeof de>`). Ein
   fehlender englischer Text ist ein Typfehler an genau der Stelle. `t()` leitet
   die verlangten Platzhalter aus dem deutschen Text ab: wer einen vergisst,
   bekommt ebenfalls einen Typfehler. Was der Typ nicht sieht (gleiche
   Platzhalter in beiden Sprachen, keine doppelten Schluessel ueber Bereiche,
   kein ungenutzter Schluessel), prueft `test/unit/i18n.test.ts`.
3. **Kataloge nach Bereichen:** `menue`, `main`, `schale`, `viewer` je Sprache.
   Flache Schluessel (`'kopf.speichern'`) statt verschachtelter Objekte: die
   Typen bleiben einfach, und ein Schluessel ist im Code per Textsuche
   auffindbar.
4. **Die Sprache loest der Main auf** (`loeseSpracheAuf(einstellung,
app.getLocale())`): `de*` wird Deutsch, alles andere Englisch. Die
   Einstellung `sprache` (Schema 7) ist `auto`, `de` oder `en`; `auto` folgt
   bei jedem Start der Systemsprache. Der Renderer fragt `spracheGet` vor dem
   ersten Zeichnen, damit nichts deutsch aufblitzt, und nach jeder Aenderung
   der Einstellung. Menue und Oberflaeche koennen so nie verschieden sprechen.
5. **Umschalten ohne Neustart:** der Main baut das Menue neu, der Renderer
   setzt die Sprache in einem kleinen Store; Komponenten mit Text rufen
   `useT()` und zeichnen neu. Bereits angezeigte Hinweise und
   Historieneintraege bleiben in der Sprache, in der sie entstanden - sie
   sind Ereignisse, keine Beschriftungen.
6. **Der Worker der Textbearbeitung** hat eine eigene Modulinstanz. Er bekommt
   die Sprache im Auftrag mit, sonst meldete er immer deutsch.
7. **Echte Umlaute** im deutschen Katalog (Nutzerentscheidung): das
   Herausziehen war ohnehin eine vollstaendige Durchsicht. Dateinamen im
   Vorschlag (`-zusammengefuehrt.pdf`) bleiben ohne Umlaute.
8. **Deutsch bleibt, was keine Oberflaeche erreicht:** Protokoll, Kommentare,
   Invarianten-Ausnahmen und die Pruefgruende von `pruefePatch`. Der Guard
   `guard:sprache` meldet deutschen Text ausserhalb der Kataloge; Ausnahmen
   tragen die Markierung `KEIN-UI-TEXT` mit Grund.

## Verworfen

- **i18next / FormatJS:** neue Laufzeitabhaengigkeit fuer zwei Sprachen, und
  die Schluesselpruefung liefe ueber Zusatzwerkzeuge statt ueber `tsc`.
- **Sprachabfrage im Installer:** vom Nutzer ausgeschlossen; die
  Systemsprache ist der bessere Vorschlag, und die Einstellung korrigiert ihn.
- **Neustart nach dem Umschalten:** einfacher, aber die Exit-Kriterien
  verlangen die Wirkung sofort.

## Folgen

- Neue Texte gehoeren in beide Kataloge; `tsc`, `i18n.test.ts` und
  `guard:sprache` fangen die ueblichen Fehler.
- Die E2E-Suite laeuft auf Deutsch (`--lang=de-DE` im Starter, der CI-Runner
  ist englisch). `sprache.electron.spec.ts` prueft eine Stichprobe auf
  Englisch, `a11y.electron.spec.ts` alle Ansichten in beiden Sprachen.
- Die englischen Texte sieht der Nutzer vor dem Merge durch.
