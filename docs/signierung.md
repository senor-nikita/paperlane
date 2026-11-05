# Code-Signing — Ist-Zustand

Dieses Dokument gehoert zu S5.3, Aufgabe 4. Es beschreibt, was an den gebauten
Windows-Artefakten signiert ist und was nicht, was `electron-builder` dabei
tatsaechlich tut, was das fuer Nutzer und fuer die Performance-Messung aus S5.1
bedeutet, und wie eine Signierung technisch angeschlossen wuerde, sobald die
Entscheidung D9 gefallen ist.

Alle Aussagen im Abschnitt „Ist-Zustand" sind gemessen oder im Quelltext der
installierten Abhaengigkeit nachgeschlagen, nicht aus dem Gedaechtnis
geschrieben.

## 1. Ist-Zustand

### 1.1 Nichts ist signiert

Geprueft am gebauten Stand `0.0.1` mit dem Windows-Bordmittel:

```powershell
Get-AuthenticodeSignature 'release\paperlane Setup 0.0.1.exe' | Format-List Status, StatusMessage, SignerCertificate
Get-AuthenticodeSignature 'release\win-unpacked\paperlane.exe' | Format-List Status, StatusMessage, SignerCertificate
```

Beide Aufrufe liefern dasselbe Ergebnis:

```
Status            : NotSigned
StatusMessage     : Die Datei "...\release\paperlane Setup 0.0.1.exe" ist nicht digital signiert. ...
SignerCertificate :
SignatureType     : None
```

```
Status            : NotSigned
StatusMessage     : Die Datei "...\release\win-unpacked\paperlane.exe" ist nicht digital signiert. ...
SignerCertificate :
SignatureType     : None
```

Weder der NSIS-Installer `paperlane Setup 0.0.1.exe` noch die entpackte
Anwendung `release\win-unpacked\paperlane.exe` traegt eine Authenticode-Signatur.
`SignerCertificate` ist leer, es gibt also auch kein selbstsigniertes Zertifikat
— es gibt gar keines.

### 1.2 Die Konfiguration sieht keine Signierung vor

`electron-builder.yml` enthaelt keinen einzigen Signierungsschluessel. Im
`win`-Block steht nur das Ziel:

```yaml
win:
  target:
    - target: nsis
      arch:
        - x64
```

Es gibt kein `win.signtoolOptions`, kein `win.azureSignOptions`, kein
`certificateFile`, kein `certificateSubjectName`, kein `sign`-Haken und kein
`forceCodeSigning`. Auch die Umgebung liefert nichts nach: `CSC_LINK` und
`WIN_CSC_LINK` sind im Projekt nirgends gesetzt.

### 1.3 Das Bauprotokoll behauptet etwas anderes — und das ist eine Falle

Im Protokoll des Windows-Builds (`npm run dist:win`, `electron-builder` 26.15.3)
stehen vier Zeilen, die nach Signierung aussehen:

```
  • signing with signtool.exe  path=release\win-unpacked\paperlane.exe
  • signing with signtool.exe  path=release\win-unpacked\resources\elevate.exe
  • signing with signtool.exe  path=release\paperlane Setup 0.0.1.__uninstaller.exe
  • signing with signtool.exe  path=release\paperlane Setup 0.0.1.exe
```

Signiert wurde trotzdem nichts, wie Abschnitt 1.1 zeigt. Die Erklaerung steht im
Quelltext der installierten Version:

- `node_modules/app-builder-lib/out/codeSign/windowsCodeSign.js` gibt die Zeile
  `signing with signtool.exe` **bedingungslos** aus, bevor irgendetwas geprueft
  wird — sie ist eine Absichtserklaerung, kein Ergebnis.
- Erst danach laeuft
  `node_modules/app-builder-lib/out/codeSign/windowsSignToolManager.js`,
  `signFile`. Dort wird `cscInfo` aufgeloest. Ist weder ein Zertifikat
  konfiguriert noch `WIN_CSC_LINK`/`CSC_LINK` gesetzt, ist `cscInfo` gleich
  `null`, und die Methode bricht ab mit
  `log.debug({ signHook: !!customSign, cscInfo }, "no signing info identified, signing is skipped")`
  und `return false`. Diese Meldung steht auf **debug**-Ebene und erscheint im
  normalen Protokoll deshalb nicht.
- `node_modules/app-builder-lib/out/winPackager.js`, `_sign` wertet den
  Rueckgabewert aus: `if (!didSignSuccessfully && this.forceCodeSigning) { throw ... }`.
  Weil `forceCodeSigning` nicht gesetzt ist (Vorgabe `false`, siehe
  `node_modules/app-builder-lib/out/options/PlatformSpecificBuildOptions.d.ts`),
  laeuft der Build ohne Fehler und ohne Warnung durch.

**Merksatz fuer spaeter:** `signing with signtool.exe` im Protokoll ist kein
Beleg fuer eine Signatur. Der einzige Beleg ist
`Get-AuthenticodeSignature` am fertigen Artefakt.

### 1.4 Was das fuer den Nutzer heisst

Beim ersten Start des heruntergeladenen Installers greift der Microsoft
Defender SmartScreen. Da die Datei weder eine Signatur noch eine Reputation hat,
zeigt Windows den blauen Vollbild-Hinweis „Der Computer wurde durch Windows
geschuetzt" mit dem Knopf „Nicht ausfuehren". Der Installer laesst sich nur
ueber „Weitere Informationen" → „Trotzdem ausfuehren" starten — also ueber zwei
zusaetzliche Klicks, die bewusst unauffaellig gestaltet sind. Dieselbe Huerde
gilt fuer `paperlane.exe`, wenn sie aus dem entpackten Verzeichnis gestartet
wird.

Zwei Dinge sind dabei auseinanderzuhalten, weil sie sehr unterschiedlich wiegen:

- **Fehlende Signatur** (unser Fall). Windows sagt sinngemaess „Herausgeber:
  Unbekannt" und laesst den Start nach ausdruecklicher Bestaetigung zu. Der Weg
  ist unangenehm, aber offen. SmartScreen stuft die Datei nach Reputation ein,
  nicht nach Identitaet.
- **Ungueltige Signatur** (etwa ein abgelaufenes Zertifikat ohne Zeitstempel,
  eine nach dem Signieren veraenderte Datei, ein zurueckgezogenes Zertifikat).
  Das ist deutlich schlimmer als gar keine Signatur: Windows meldet eine
  beschaedigte oder manipulierte Datei, die Warnung ist schaerfer formuliert,
  und Unternehmensrichtlinien (AppLocker, WDAC, Smart App Control) blockieren
  solche Dateien haeufig hart, ohne Ausweg fuer den Nutzer. Eine Signatur „nur
  zur Optik" ist deshalb keine Verbesserung — entweder richtig oder gar nicht.

**Reputationsaufbau.** SmartScreen fuehrt seine Einstufung nicht pro Datei,
sondern pro Herausgeber, sobald ein Zertifikat im Spiel ist. Ohne Zertifikat
gibt es keinen Herausgeber, an dem Reputation haften koennte: **jede neue
Version faengt bei null an**, weil sich der Datei-Hash aendert. Mit einem
OV-Zertifikat wandert die Reputation dagegen vom Artefakt auf das Zertifikat,
und jede weitere Version erbt sie. Das ist der eigentliche Unterschied — nicht
die erste Warnung, sondern ob sie bei Version 0.0.2, 0.0.3 und 0.1.0 wiederkommt.

Da das Projekt bewusst kein Auto-Update hat (D8, ADR 0004), trifft die Warnung
immerhin nur die Installation, die der Nutzer selbst angestossen hat, und nicht
zusaetzlich jeden stillen Aktualisierungslauf. Das war eines der Argumente in
ADR 0004.

## 2. Folgen fuer die Messung aus S5.1

In S5.1 (Aenderungshistorie, Eintrag vom 2026-09-21) wurde der Kaltstart
separat gemessen:

- Kaltstart gesamt: **1,1 bis 3,4 s**, stark schwankend.
- Profiling (`ecc:performance-optimizer`) verortete die Varianz **vollstaendig
  vor der ersten eigenen Codezeile**: Prozessstart bis zur ersten eigenen
  Codezeile **0,56 bis 2,36 s**.
- Kein Treffer in `settings/service.ts`, `logging/logger.ts` oder `csp.ts`.
- Auffaelliges Muster: **nur der erste Start nach einem frischen Build ist
  langsam.**

Dieses Muster passt zu einem Virenscan der unsignierten `electron.exe` durch
Windows Defender und nicht zu Anwendungscode: Defender scannt eine unbekannte,
unsignierte Binaerdatei beim ersten Ausfuehren vollstaendig und merkt sich das
Ergebnis pro Datei-Hash; ein neuer Build aendert den Hash und erzwingt den Scan
erneut.

**Der Verdacht ist derzeit nicht pruefbar.** Er laesst sich weder bestaetigen
noch widerlegen, solange es kein Zertifikat gibt, denn die entscheidende
Variable — „signiert von einem vertrauenswuerdigen Herausgeber" — laesst sich
nicht setzen. S5.1 hat den Verdacht deshalb ausdruecklich an S5.3 verwiesen, und
S5.3 kann ihn ohne D9 nur weiterreichen.

**So waere er zu pruefen, sobald ein Zertifikat vorliegt.** Die Messung muss den
Vergleich sauber isolieren, also gleiche Maschine, gleicher Build, nur die
Signatur unterschiedlich:

1. Einen Build erzeugen und **zwei Kopien** von `win-unpacked` anlegen. Eine
   bleibt unsigniert, die andere wird signiert (nur das Signieren unterscheidet
   die beiden; der Code ist Byte fuer Byte derselbe).
2. Fuer jede Kopie den Kaltstart nach dem Muster aus `rendering.perf.spec.ts`
   messen, mindestens zehn Durchlaeufe, und dabei jeweils den **ersten** Start
   nach dem Kopieren getrennt von den folgenden auswerten — der Effekt zeigt
   sich laut S5.1 genau dort.
3. Denselben Lauf ein zweites Mal mit einer Defender-Ausnahme fuer das
   Verzeichnis wiederholen (Gegenprobe). Trifft der Verdacht zu, muessen sich
   drei Werte angleichen: signiert, unsigniert-mit-Ausnahme und der zweite Start.
   Bleibt nur „unsigniert ohne Ausnahme" langsam, ist die Ursache belegt.
4. Ergaenzend im Defender-Betriebsprotokoll nachsehen
   (`Microsoft-Windows-Windows Defender/Operational`), ob zum Startzeitpunkt ein
   Scanvorgang fuer die Binaerdatei vermerkt ist.

Wichtig fuer die Ehrlichkeit der Aussage: Sollte die Messung **keinen**
Unterschied zeigen, ist der Verdacht widerlegt und die Ursache der Kaltstart-
Varianz weiterhin unbekannt. Das waere dann in der Aenderungshistorie
festzuhalten, statt die Erklaerung stehenzulassen.

## 3. Was ein Zertifikat aendern wuerde — und was nicht

**Ein OV-Zertifikat (Organization Validation) beseitigt die Warnung nicht
sofort.** Es traegt den Namen des Herausgebers in die Signatur und ersetzt
„Unbekannt" durch diesen Namen, aber SmartScreen zeigt die Warnung fuer einen
frisch ausgestellten, noch reputationslosen Herausgeber weiterhin an. Sie
verschwindet erst, nachdem genuegend Nutzer die Pakete dieses Herausgebers
installiert haben. Wie viele und wie lange das dauert, gibt Microsoft nicht
bekannt; es ist keine Zahl, die man hier belegen koennte. Fuer ein Projekt mit
wenigen Installationen kann das bedeuten, dass die Warnung praktisch bestehen
bleibt — der Gewinn liegt dann allein im sichtbaren Herausgebernamen und darin,
dass Reputation ueberhaupt aufgebaut werden **kann** (Abschnitt 1.4).

**Ein EV-Zertifikat (Extended Validation) beseitigt die Warnung ebenfalls
nicht mehr sofort.** _Richtiggestellt am 2026-09-23 (Abschnitt 6)._ Frueher
brachte SmartScreen EV-signierten Paketen von Beginn an Vertrauen entgegen;
Microsoft hat das 2024 abgeschafft. Die aktuelle Microsoft-Dokumentation sagt
ausdruecklich, EV-Zertifikate umgingen SmartScreen nicht mehr, und ein
Aufpreis fuer EV allein wegen SmartScreen sei nicht mehr gerechtfertigt. EV
und OV bauen Reputation heute auf dieselbe Weise auf. Uebrig bleibt der
organisatorische Preis: EV wird nur an gepruefte Rechtstraeger ausgegeben.

**Hardware gilt fuer beide Arten.** Seit dem 1. Juni 2023 verlangen die
CA/Browser-Forum-Anforderungen auch fuer OV-Zertifikate, dass der private
Schluessel in zertifizierter Hardware entsteht und dort bleibt (Token, HSM oder
Cloud-Signaturdienst). Das schliesst fuer **jedes** neu ausgestellte Zertifikat
das Ablegen einer `.pfx`-Datei in einem CI-Geheimnis aus. Signiert wird
entweder von Hand an einer Maschine mit dem Token oder ueber einen Dienst wie
Azure Artifact Signing (frueher Trusted Signing, von `electron-builder`
unterstuetzt, siehe Abschnitt 4.3).

**Was ein Zertifikat in keinem Fall aendert:**

- Es macht die Anwendung nicht sicherer. Eine Signatur belegt Herkunft und
  Unversehrtheit, nicht Qualitaet oder Harmlosigkeit.
- Es ersetzt keine der Invarianten des Projekts. Die Haertung des Renderers,
  Invariante 7 (keine Netzwerkaufrufe) und die Schreibpfad-Regeln bleiben
  unveraendert noetig.
- Es bringt kein Auto-Update zurueck. D8 ist unabhaengig von D9 entschieden
  (ADR 0004).
- Es hilft nicht bei macOS. Dort gelten Apple-Entwicklerzertifikat,
  Notarisierung und Gatekeeper als eigener, getrennter Vorgang; der
  `mac`-Abschnitt in `electron-builder.yml` ist ohnehin unbelegte Konfiguration
  (siehe Kopfkommentar dort).

**Kosten.** Richtwerte stehen seit 2026-09-23 in Abschnitt 6. Es sind
Listenpreise und Vergleichsseiten, keine Angebote; vor dem Kauf ist das
konkrete Angebot einzuholen. Weil EV keinen SmartScreen-Vorteil mehr bringt,
genuegt der Vergleich der OV-Wege.

## 4. Wie die Signierung technisch angeschlossen wuerde

Grundlage dieses Abschnitts ist die im Projekt installierte Version
`electron-builder` 26.15.3 beziehungsweise `app-builder-lib`, konkret
`node_modules/app-builder-lib/out/options/winOptions.d.ts` und
`node_modules/app-builder-lib/out/codeSign/`. Nichts davon ist heute gesetzt;
der Abschnitt beschreibt nur, was der Anschluss kosten wuerde.

### 4.1 Der Weg ueber signtool (OV, Zertifikatsdatei)

> **Stand 2026-09-23:** Fuer ein neu ausgestelltes, oeffentlich vertrauenswuerdiges
> Zertifikat gibt es keine `.pfx`-Datei mehr (Hardwarepflicht seit Juni 2023,
> Abschnitt 3). Die Umgebungsvariablen `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`
> passen dann nicht; signiert wird ueber den Zertifikatsspeicher mit dem Token
> (`certificateSubjectName`/`certificateSha1`) oder ueber einen Dienst
> (Abschnitt 4.3). Der Abschnitt bleibt als Beschreibung der Optionen stehen.

In `electron-builder.yml` liegt die Konfiguration unter `win.signtoolOptions`
(Typ `WindowsSigntoolConfiguration`). Die dort vorgesehenen Felder sind:

- `sign` — eigene Signierfunktion oder Modulpfad, fuer Sonderfaelle.
- `signingHashAlgorithms` — Vorgabe `['sha1', 'sha256']` (Doppelsignatur).
- `certificateFile` — Pfad zur `*.pfx`-Datei. Die Typdefinition sagt
  ausdruecklich: nur benutzen, wenn die Umgebungsvariable nicht geht.
- `certificatePassword` — Passwort zu `certificateFile`, mit demselben Vorbehalt.
- `certificateSubjectName` — Name des Zertifikatsinhabers im Windows-Zertifikat-
  speicher. Laut Typdefinition „Required only for EV Code Signing" und nur unter
  Windows nutzbar.
- `certificateSha1` — SHA-1-Fingerabdruck des Zertifikats im Speicher, wenn
  mehrere passen; ebenfalls nur unter Windows.
- `additionalCertificateFile` — zusaetzliches Zertifikat fuer den Signaturblock
  (Zwischenzertifikate).
- `rfc3161TimeStampServer` — Vorgabe `http://timestamp.digicert.com`.
- `timeStampServer` — Vorgabe `http://timestamp.digicert.com`.
- `publisherName` — Herausgebername, genau wie im Zertifikat; mehrere moeglich.
  Vorgabe ist der Common Name aus dem Zertifikat.

Ausserhalb von `signtoolOptions`, direkt unter `win` beziehungsweise als
allgemeine Optionen, stehen ergaenzend:

- `signExecutable` — `false` ueberspringt das Signieren, behaelt aber Icon und
  Metadaten.
- `signAndEditExecutable` — `false` ueberspringt beides.
- `signExts` — zusaetzliche Dateiendungen, die mitsigniert werden sollen.
- `verifyUpdateCodeSignature` — nur fuer den Updater relevant und hier ohne
  Bedeutung, weil es kein Auto-Update gibt (ADR 0004).
- `forceCodeSigning` — Vorgabe `false`; auf `true` gesetzt **bricht der Build
  ab**, wenn nicht signiert wurde. Genau das ist der Haken, der die Falle aus
  Abschnitt 1.3 entschaerft: sobald D9 zugunsten eines Zertifikats faellt, sollte
  `forceCodeSigning: true` mitgesetzt werden, damit ein fehlendes oder falsch
  hinterlegtes Zertifikat den Build rot macht, statt still unsignierte Pakete zu
  erzeugen.

**Umgebungsvariablen.** `app-builder-lib` loest das Zertifikat in
`windowsSignToolManager.js` in dieser Reihenfolge auf: erst
`certificateSubjectName`/`certificateSha1` (Zertifikatsspeicher), dann
`certificateFile`, dann die Umgebung. Die Variablen sind:

- `WIN_CSC_LINK`, ersatzweise `CSC_LINK` — Herkunft des Zertifikats.
  `importCertificate` in `codeSign/codesign.js` akzeptiert drei Formen: eine
  `https://`-URL (wird heruntergeladen), einen Base64-Text (wird in eine
  temporaere `.p12` geschrieben) oder einen Dateipfad.
- `WIN_CSC_KEY_PASSWORD`, ersatzweise `CSC_KEY_PASSWORD` — das Passwort. Fehlt
  es, protokolliert `platformPackager.js`
  „empty password will be used for code signing".

Eine minimale Konfiguration saehe demnach so aus — bewusst **ohne** jede
Geheimnisangabe in der Datei:

```yaml
win:
  signtoolOptions:
    publisherName: <Name genau wie im Zertifikat>
    rfc3161TimeStampServer: <Zeitstempeldienst der Zertifizierungsstelle>
  # Ein Build ohne Signatur soll ab hier fehlschlagen statt still durchzulaufen.
  forceCodeSigning: true
```

Zertifikat und Passwort kommen ausschliesslich aus `WIN_CSC_LINK` und
`WIN_CSC_KEY_PASSWORD`.

### 4.2 Der Zeitstempel ist nicht optional

Ohne RFC-3161-Zeitstempel werden alle Signaturen mit dem Ablauf des Zertifikats
ungueltig — auch die von Paketen, die lange vorher ausgeliefert wurden. Das
fuehrt genau in den schlechteren der beiden Faelle aus Abschnitt 1.4: nicht
„unsigniert", sondern „ungueltig signiert". `electron-builder` setzt zwar einen
Vorgabedienst, dieser sollte aber bewusst auf den Dienst der eigenen
Zertifizierungsstelle gesetzt werden.

### 4.3 Der Weg ueber Azure Trusted Signing (EV ohne eigenes Token)

`winOptions.d.ts` kennt daneben `win.azureSignOptions`
(`WindowsAzureSigningConfiguration`) mit den Pflichtfeldern `publisherName`,
`endpoint` und `certificateProfileName`. Die Typdefinition weist ausdruecklich
darauf hin, dass die Anmeldung ueber die Umgebungsvariablen der
`EnvironmentCredential` von Microsoft Entra ID laeuft, also ebenfalls nicht
ueber die Konfigurationsdatei. `windowsCodeSign.js` warnt, wenn `signtoolOptions`
und `azureSignOptions` gleichzeitig gesetzt sind — es ist entweder das eine oder
das andere.

### 4.4 Zertifikat und Passwort gehoeren nie ins Repository

Das ist keine Empfehlung, sondern eine harte Regel:

- **Keine `.pfx`-, `.p12`- oder `.key`-Datei** wird eingecheckt, auch nicht
  „vorlaeufig", auch nicht in einem Testzweig. Ein einmal gepushtes Zertifikat
  gilt als kompromittiert und muss zurueckgezogen werden; die Historie
  nachtraeglich zu saeubern hilft nicht, weil das Objekt bereits verteilt war.
- **Kein Passwort** in `electron-builder.yml`, `package.json`, einem Skript,
  einem Workflow oder einem Kommentar. Deshalb sind `certificateFile` und
  `certificatePassword` in der Konfiguration zu vermeiden: die Typdefinition
  selbst nennt sie nur als Notloesung.
- Der Bezugsweg ist **ausschliesslich** die Umgebung: lokal als
  Sitzungsvariable, in der CI als Geheimnis des Aktionslaufs
  (`WIN_CSC_LINK` als Base64-Text, `WIN_CSC_KEY_PASSWORD` als Passwort).
- Vor dem ersten Versuch ist `.gitignore` um `*.pfx`, `*.p12` und `*.key` zu
  ergaenzen. Heute enthaelt die Datei keinen solchen Eintrag — es gibt zwar auch
  nichts zu schuetzen, aber die Sperre sollte vor dem Zertifikat da sein, nicht
  danach.
- Seit der Hardwarepflicht (Abschnitt 3) gilt fuer jedes neue Zertifikat: der
  Schluessel liegt in Hardware oder im Signaturdienst und verlaesst diesen nie.
  Es gibt dann keine Schluesseldatei, die man versehentlich einchecken koennte.
  Die Regeln oben bleiben trotzdem stehen — fuer Passwoerter, Token-PINs und
  die Zugangsdaten eines Signaturdienstes gelten sie unveraendert.

## 5. Entscheidung D9

**Entschieden am 2026-09-23: vorerst kein Zertifikat.** Version 0.0.1 wird
unsigniert ausgeliefert. Gruende: bei wenigen Installationen bleibt die
SmartScreen-Warnung auch signiert wahrscheinlich bestehen (Abschnitt 6.1), und
die guenstigen Wege setzen ein oeffentliches Repository voraus (Abschnitt 6.2).
D9 wird wieder aufgenommen, sobald feststeht, ob das Repository oeffentlich
wird. Die Teilfragen unten bleiben als Grundlage dafuer stehen.

### Die Teilfragen

**D9 — Code-Signing-Zertifikat beschaffen? Status: offen. Faellig in S5.3. Marktlage recherchiert am 2026-09-23 (Abschnitt 6).**

Zu entscheiden ist, ob das Projekt ein Code-Signing-Zertifikat beschafft, und
wenn ja, welcher Art. Die Entscheidung zerfaellt in vier Teilfragen:

1. **Ueberhaupt?** Ohne Zertifikat bleibt es beim Ist-Zustand aus Abschnitt 1:
   SmartScreen-Warnung bei jeder Version, kein Herausgebername, kein
   Reputationsaufbau. Das ist fuer ein Projekt ohne breite Verteilung eine
   vertretbare Lage — sie muss nur bewusst gewaehlt und im README unter den
   bekannten Grenzen benannt sein, statt stillschweigend zu gelten.
2. **Welcher Weg?** _Seit 2026-09-23 keine Frage OV gegen EV mehr:_ EV bringt
   keinen SmartScreen-Vorteil mehr, und Hardware verlangen beide (Abschnitt 3).
   Zu waehlen ist zwischen den Wegen in Abschnitt 6 — Signaturdienst,
   Open-Source-Programm oder kaufmaennisches OV-Zertifikat mit Token.
3. **Auf wen wird es ausgestellt?** Die Signatur macht einen Herausgeber
   sichtbar. Wer das ist — eine Person, eine Organisation — ist eine Frage, die
   vor der Beschaffung beantwortet sein muss und die sich nachtraeglich nicht
   kostenlos aendern laesst.
4. **Was kostet es?** Richtwerte in Abschnitt 6; vor dem Kauf ein konkretes
   Angebot fuer den gewaehlten Weg.

**Was von D9 abhaengt:**

- Die Erklaerung der Kaltstart-Varianz aus S5.1 (Abschnitt 2) bleibt bis dahin
  ein unbelegter Verdacht.
- `forceCodeSigning: true` kann erst gesetzt werden, wenn ein Zertifikat
  vorliegt; bis dahin bleibt die stille Falle aus Abschnitt 1.3 bestehen und ist
  nur durch dieses Dokument abgesichert.
- Der Hinweis in den bekannten Grenzen des README haengt am Ausgang von D9 und
  muss bei einer Entscheidung mitgezogen werden.

**Was nicht von D9 abhaengt:** D8 ist unabhaengig entschieden. Es gibt kein
Auto-Update, unabhaengig davon, wie D9 ausgeht (ADR 0004).

## 6. Marktlage (recherchiert am 2026-09-23)

Grundlage fuer D9. Preise sind Listenpreise oder Werte von Vergleichsseiten,
**keine Angebote**. Was aus einer Herstellerquelle stammt, ist so markiert.

### 6.1 Was sich seit dem Schreiben dieses Dokuments geaendert hat

- **EV bringt keinen SmartScreen-Vorteil mehr.** Herstellerquelle: Microsoft
  Learn, „SmartScreen reputation for Windows app developers" (Stand 2026-08).
  Signierte Dateien — OV wie EV — gelten beim ersten Herunterladen als
  „unbekannt"; der Unterschied zur unsignierten Datei ist der angezeigte
  Herausgebername und dass sich Reputation am Zertifikat sammeln kann. Laut
  derselben Seite dauert das „mehrere Wochen und Hunderte saubere
  Installationen aus einem breiten Publikum". Fuer ein Projekt mit wenigen
  Nutzern heisst das: auch signiert bleibt die Warnung wahrscheinlich.
- **Hardwarepflicht auch fuer OV** seit 2023-06-01 (CA/Browser Forum, Code
  Signing Baseline Requirements). Keine `.pfx`-Datei mehr.
- **Hoechstlaufzeit 459 Tage** fuer Code-Signing-Zertifikate seit 2026-02-27
  (laut Certum). Mehrjahresprodukte werden dazwischen neu ausgestellt.
- **Smart App Control** (Windows 11) blockiert unsignierte Dateien ohne
  positive Reputation ganz, nicht nur mit Warnung (Microsoft Learn, selbe Seite).
  Das betrifft nur Geraete, auf denen die Funktion aktiv ist.

### 6.2 Die Wege im Vergleich

| Weg                                    | Kosten (Richtwert)                                                                       | Wer darf                                                                                                                                    | Passt heute?                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Nichts tun** (Ist-Zustand)           | 0                                                                                        | —                                                                                                                                           | ja                                                                                   |
| **Azure Artifact Signing** (Microsoft) | 9,99 USD/Monat, bis 5 000 Signaturen (Herstellerangabe)                                  | Einzelpersonen **nur USA und Kanada**; Organisationen u. a. in der EU, mit Rechtstraeger, Website und Domain-E-Mail; Pruefung 1–20 Werktage | nur als Organisation in einem zugelassenen Land; als Einzelperson in Europa **nein** |
| **Certum Open Source Code Signing**    | um 69 EUR im ersten Jahr mit Smartcard und Leser, danach um 29–30 EUR/Jahr               | nur Einzelpersonen, mit Nachweis eines **aktiven, oeffentlichen** Open-Source-Projekts                                                      | **nein**, solange das Repository privat ist                                          |
| **SignPath Foundation**                | kostenlos                                                                                | Open-Source-Projekte mit **oeffentlichem** Quelltext, anerkannter Lizenz, bereits veroeffentlichtem Release, ohne proprietaere Teile        | **nein**, solange das Repository privat ist; Apache-2.0 erfuellt die Lizenzbedingung |
| **Kaufmaennisches OV** (z. B. Sectigo) | um 215–230 USD/Jahr bei Sectigo, um 440 USD/Jahr bei DigiCert, plus Token oder Cloud-HSM | Einzelpersonen und Organisationen                                                                                                           | ja, aber teuerster Weg fuer denselben SmartScreen-Effekt                             |

`electron-builder` 26.15.3 unterstuetzt Artifact Signing ueber
`win.azureSignOptions` (Abschnitt 4.3); Token-Wege laufen ueber
`win.signtoolOptions` mit `certificateSubjectName`; SignPath signiert in seiner
eigenen Pipeline, das Paket wird danach dorthin hochgeladen.

### 6.3 Einordnung fuer D9

Das ist eine Einordnung, keine Entscheidung — D9 bleibt beim Nutzer.

- Der Gewinn einer Signatur ist fuer paperlane derzeit **klein**: die Warnung
  bleibt bei wenigen Installationen wahrscheinlich bestehen, sichtbar wird nur
  ein Herausgebername. Der Kaltstart-Verdacht aus Abschnitt 2 liesse sich
  allerdings erst mit einer Signatur pruefen.
- Die **guenstigen Wege haengen am oeffentlichen Repository.** Wird paperlane
  als Open Source veroeffentlicht (Lizenz ist mit D10 schon Apache-2.0),
  kommen SignPath (kostenlos) und Certum (um 30 EUR/Jahr) in Frage.
- **Artifact Signing** ist der bequemste Weg (kein Token, CI-tauglich), aber
  fuer eine Einzelperson ausserhalb der USA und Kanadas nicht zu haben.
- Ein **kaufmaennisches OV-Zertifikat** geht immer, kostet aber das Mehrfache
  fuer denselben Effekt.

Naheliegend fuer den Release-Kandidaten 0.0.1: unsigniert ausliefern — so steht
es schon in den bekannten Grenzen des README — und D9 wieder aufnehmen, sobald
feststeht, ob das Repository oeffentlich wird.

### 6.4 Quellen

- Microsoft Learn: [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- Microsoft Learn: [Artifact Signing — Quickstart, Voraussetzungen](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) und [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- Microsoft Azure: [Artifact Signing — Preise](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- ToDesktop: [EV certs do not grant immediate reputation anymore](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore)
- GlobalSign: [New Requirements related to Private Key protection for Code Signing Certificates](https://support.globalsign.com/code-signing/advisory/new-requirements-related-private-key-protection-codesigning-certificates)
- Certum: [Code Signing im Shop](https://shop.certum.eu/code-signing.html); Erfahrungsbericht [Certum Open Source Developer Code Signing Certificate](https://piers.rocks/2025/10/30/certum-open-source-code-sign.html)
- SignPath Foundation: [Bedingungen fuer Open-Source-Projekte](https://signpath.org/terms.html)
- Preisvergleich OV: [DigiCert vs Sectigo Code Signing 2026](https://sslinsights.com/digicert-vs-sectigo-code-signing/)
