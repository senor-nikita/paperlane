# ADR 0002 — Menuebefehle: ein einseitiger Kanal vom Main zum Renderer

**Status:** entschieden · **Datum:** 2026-09-07 · **Schritt:** S1.3b

## Kontext

Der IPC-Contract (`src/shared/ipc.ts`) legte seit S0.2 fest: ausschliesslich
Anfrage/Antwort ueber `handle`/`invoke`, kein `send`/`on`. Die Begruendung
traegt weiterhin — jeder Kanal hat eine definierte Antwort, und es gibt keinen
Ereignisstrom, dessen Nutzlast niemand typisiert.

S1.3b bricht sich daran: ein Menueklick entsteht im Main-Prozess. Das
Anwendungsmenue ist Teil der nativen Fensterrahmung, `Menu.setApplicationMenu`
existiert nur dort. Der auszufuehrende Befehl gehoert aber in den Renderer, wo
der Dokumentzustand liegt.

## Verworfene Alternativen

**Ein Menue in HTML im Renderer.** Damit gaebe es keinen Push-Kanal. Es
scheitert an der eigentlichen Aufgabe des Schritts: `role: 'copy'` und
`role: 'selectAll'` sind Electron-Rollen des nativen Menues. Ohne sie ist
Strg+C auf der Textauswahl tot, sobald ein eigenes Menue gesetzt wird — genau
der Fehler, den S1.3b behebt. Ein HTML-Menue kann sie nicht ersetzen.

**Der Renderer fragt den Main periodisch nach anstehenden Befehlen.** Bliebe
formal bei `invoke`, waere aber ein Polling-Kanal mit Latenz und Leerlauf, um
eine Regel zu wahren, deren Zweck er verfehlt.

## Entscheidung

Genau **ein** einseitiger Kanal, `MENUE_KANAL` (`app:menue:befehl`), vom Main
zum Renderer. Er traegt genau einen Nutzlasttyp:

```ts
export type MenueBefehl =
  { art: 'befehl'; befehl: Befehl } | { art: 'sucheNachAuswahl'; text: string }
```

Drei Bedingungen halten die Ausnahme klein:

1. **Keine generische Bruecke.** Das Preload gibt `beiMenueBefehl(rueckruf)`
   frei, nicht `on(kanal, rueckruf)`. Es hoert genau diesen einen Kanal ab.
2. **Geprueft, nicht geglaubt.** `pruefeMenueBefehl` validiert jede eingehende
   Nutzlast gegen die Kuerzel-Map und verwirft Unbekanntes mit Protokolleintrag
   — Muster von `pruefePatch` in `settings.ts`.
3. **Ein Ausfuehrungspfad.** Der Renderer fuehrt Menuebefehle ueber dasselbe
   `fuehreAus` aus wie Tastenkuerzel. Das Menue oeffnet keinen zweiten Weg in
   den Zustand.

Ein zweiter einseitiger Kanal wird nicht hinzugefuegt, ohne dieses ADR
fortzuschreiben.

## Fortschreibung in S1.3e — Dokumente aus dem Betriebssystem

"Oeffnen mit" und der Start einer zweiten Instanz entstehen ebenfalls im
Main-Prozess und muessen den Renderer erreichen. Statt eines zweiten Kanals
traegt derselbe Kanal eine dritte Variante:

```ts
| { art: 'dokumentAusSystem'; pfad: string }
```

Der Kanal heisst seither `app:ereignis` und der Typ `AnwendungsEreignis` —
`MenueBefehl` waere eine Luege gewesen, sobald er auch Dateien meldet.

Bewusst nur der Pfad und nicht die Bytes: das Dokument holt der Renderer ueber
`dokumentOeffnePfad`, wo es ohnehin geprueft wird. Die Bytes ueber den
Ereigniskanal zu schicken waere ein zweiter Weg an derselben Pruefung vorbei.

Damit bleibt es bei **einem** einseitigen Kanal. Die drei Bedingungen oben
gelten unveraendert: keine generische Bruecke, jede Nutzlast durch
`pruefeEreignis`, und ein Ausfuehrungspfad im Renderer.

## Folge: Accelerators werden angezeigt, nicht registriert

Wuerde das Menue seine Accelerators beim System registrieren, wirkte ein
Tastendruck zweimal: einmal ueber den Menueeintrag, einmal ueber die Behandlung
im Fenster (`App.tsx`). Strg+Plus zoomte zwei Stufen statt einer.

Deshalb tragen alle Eintraege, die einen Befehl aus der Kuerzel-Map ausloesen,
`registerAccelerator: false` — das Kuerzel steht sichtbar im Menue, ausgefuehrt
wird es im Renderer. Die Rollen-Eintraege (`copy`, `selectAll`, `close`,
`quit`) behalten ihre echten Accelerators, denn die behandelt der Renderer
nicht.

Aus demselben Grund gehoeren Rollenbefehle **nicht** in die Kuerzel-Map: stuende
dort ein Eintrag fuer Strg+C, faenge `findeBefehl` den Tastendruck ab und
`preventDefault` machte das native Kopieren wirkungslos.

Ein E2E-Test friert das ein: einmal Strg+Plus ergibt genau eine Zoomstufe.
