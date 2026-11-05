; Zusaetzliche Installationsseite: die Dateizuordnung ist abwaehlbar
; (S5.3, Aufgabe 2).
;
; electron-builder registriert eine konfigurierte `fileAssociations`-Angabe
; immer — einen Schalter dafuer kennt es nicht. Die Reihenfolge im erzeugten
; Skript macht den Ausweg moeglich: `installSection.nsh` setzt erst
; `registerFileAssociations` ein und unmittelbar danach `customInstall`. Wer
; den Haken wegnimmt, bekommt die Zuordnung also zuerst und dann wieder
; genommen. Der Umweg ist bewusst: die Registrierung bleibt damit Wort fuer
; Wort die von electron-builder erzeugte, und der Deinstallationsweg
; (`unregisterFileAssociations`) passt ohne Zutun dazu.
;
; Stille Installation (`/S`) zeigt keine Seite. Die Variable bleibt dann leer,
; und der Zweig unten greift nicht — die Zuordnung bleibt bestehen. Das ist die
; gewollte Vorgabe.

; makensis laeuft zweimal: einmal fuer den Installer, einmal fuer den
; Deinstaller. Im zweiten Durchlauf blendet `assistedInstaller.nsh` alle Seiten
; aus (`!ifndef BUILD_UNINSTALLER`), die Seitenfunktion waere dort unbenutzt —
; und electron-builder behandelt NSIS-Warnungen als Fehler
; ("warning 6010: install function not referenced"). Deshalb steht die Seite
; samt `customInstall` nur im Installer-Durchlauf; `customUnInstall` davor gilt
; fuer beide.
!include LogicLib.nsh

; Der Deinstaller laesst den Standardwert von `.pdf` sonst auf der geloeschten
; Klasse `paperlane.pdf` stehen - dieselbe Luecke wie beim Abwaehlen, gefunden
; im manuellen Durchlauf am 2026-09-23 (Installation fuer alle Benutzer, HKLM).
; `unregisterFileAssociations` laeuft erst nach diesem Makro und nimmt nur
; OpenWithProgids und den Klassenschluessel. Hier wird zurueckgestellt, was vor
; der Installation galt; gemerkt ist es unter `Software\${APP_GUID}` - das ist
; electron-builders INSTALL_REGISTRY_KEY (multiUser.nsh), den der Deinstaller
; danach ohnehin loescht. Der Name selbst ist hier noch nicht definiert, weil
; electron-builder diese Datei vor multiUser.nsh einbindet.
;
; Nicht bei einem Update (`isUpdated`): dann laeuft der alte Deinstaller mitten
; in der neuen Installation, und die Zuordnung soll bleiben.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $R8 SHELL_CONTEXT "Software\Classes\.pdf" ""
    ${If} $R8 == "paperlane.pdf"
      ReadRegStr $R9 SHELL_CONTEXT "Software\${APP_GUID}" "VorherigePdfKlasse"
      ${If} $R9 == ""
        DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf" ""
      ${Else}
        WriteRegStr SHELL_CONTEXT "Software\Classes\.pdf" "" "$R9"
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend

!ifndef BUILD_UNINSTALLER

!include nsDialogs.nsh

Var DialogZuordnung
Var KastenZuordnung
Var ZuordnungAbgewaehlt
Var VorherigeKlasse

Function zuordnungSeite
  ; Kein `MUI_HEADER_TEXT` hier: electron-builder haengt diese Datei vor
  ; `MUI2.nsh` in das erzeugte Skript, das Makro ist an dieser Stelle also
  ; noch nicht bekannt (makensis bricht sonst mit "macro not found" ab).
  ; Die Ueberschrift steht deshalb im Dialog selbst.
  nsDialogs::Create 1018
  Pop $DialogZuordnung
  ${If} $DialogZuordnung == error
    Abort
  ${EndIf}

  ; Den bisherigen Klassennamen von `.pdf` merken, solange er noch steht.
  ; `APP_ASSOCIATE` ueberschreibt ihn spaeter bedingungslos, und
  ; `APP_UNASSOCIATE` nimmt genau diesen Wert NICHT zurueck: es loescht nur den
  ; Eintrag unter OpenWithProgids und den Klassenschluessel selbst
  ; (FileAssociation.nsh, Makro APP_UNASSOCIATE). Ohne dieses Gedaechtnis bliebe
  ; bei abgewaehlter Zuordnung ein Verweis auf eine geloeschte Klasse stehen.
  ReadRegStr $VorherigeKlasse SHELL_CONTEXT "Software\Classes\.pdf" ""
  ; Neuinstallation ueber eine bestehende: dann steht hier schon die eigene
  ; Klasse. Das Original liegt in diesem Fall im gemerkten Wert der alten
  ; Installation - lesen, solange der alte Deinstaller ihn noch nicht geloescht
  ; hat. Sonst stellte ein spaeteres Deinstallieren einen Verweis auf die
  ; eigene, dann geloeschte Klasse wieder her.
  ${If} $VorherigeKlasse == "paperlane.pdf"
    ReadRegStr $VorherigeKlasse SHELL_CONTEXT "Software\${APP_GUID}" "VorherigePdfKlasse"
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "Dateizuordnung"
  Pop $0

  ${NSD_CreateCheckbox} 0 16u 100% 12u "PDF-Dateien mit paperlane oeffnen"
  Pop $KastenZuordnung
  ; Beim ersten Aufruf ist die Variable leer, der Haken also gesetzt. Wer ihn
  ; wegnimmt und spaeter zurueckblaettert, findet ihn weiterhin weggenommen.
  ${If} $ZuordnungAbgewaehlt != 1
    ${NSD_Check} $KastenZuordnung
  ${EndIf}

  ${NSD_CreateLabel} 0 36u 100% 32u "Die Zuordnung laesst sich jederzeit in den Windows-Einstellungen unter Standard-Apps aendern. Ohne sie bleibt paperlane vollstaendig nutzbar; es traegt sich dann nicht als Programm fuer PDF-Dateien ein."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function zuordnungSeiteVerlassen
  ${NSD_GetState} $KastenZuordnung $0
  ${If} $0 == 0
    StrCpy $ZuordnungAbgewaehlt 1
  ${Else}
    StrCpy $ZuordnungAbgewaehlt 0
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom zuordnungSeite zuordnungSeiteVerlassen
!macroend

!macro customInstall
  ${If} $ZuordnungAbgewaehlt == 1
    !insertmacro APP_UNASSOCIATE "pdf" "paperlane.pdf"
    ; APP_UNASSOCIATE laesst den Standardwert von `.pdf` unberuehrt. Er zeigt an
    ; dieser Stelle auf die gerade geloeschte Klasse `paperlane.pdf` - also auf
    ; nichts. Deshalb den gemerkten Zustand wiederherstellen: entweder den
    ; vorherigen Klassennamen oder, wenn es keinen gab, gar keinen Wert.
    ${If} $VorherigeKlasse == ""
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf" ""
    ${Else}
      WriteRegStr SHELL_CONTEXT "Software\Classes\.pdf" "" "$VorherigeKlasse"
    ${EndIf}
    DetailPrint "Dateizuordnung fuer PDF abgewaehlt."
  ${Else}
    ; Fuer `customUnInstall` merken, was vorher galt (leer: es gab nichts).
    ; Bei stiller Installation (`/S`) laeuft die Seite nicht, der Wert bleibt
    ; leer - der Deinstaller loescht dann den Standardwert, statt einen toten
    ; Verweis stehen zu lassen.
    WriteRegStr SHELL_CONTEXT "Software\${APP_GUID}" "VorherigePdfKlasse" "$VorherigeKlasse"
    DetailPrint "paperlane ist fuer PDF-Dateien registriert."
  ${EndIf}
!macroend

!endif
