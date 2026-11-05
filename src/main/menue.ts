import type { MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '../shared/app-info'
import { t } from '../shared/i18n'
import { beschreibeBefehl, FENSTER_SCHLIESSEN, findeKuerzel, type Befehl } from '../shared/tastatur'

/**
 * Das Anwendungsmenue als reine Funktion.
 *
 * Muster wie window-options.ts: die Vorlage entsteht ohne laufende Anwendung
 * und ist damit vollstaendig pruefbar — einschliesslich des macOS-Zweigs, der
 * sonst auf einem Windows-Rechner nie getestet wuerde. Deshalb kommt die
 * Plattform als Parameter herein und nicht aus `process.platform`.
 */
export interface MenueUmgebung {
  plattform: NodeJS.Platform
  /** Traegt den Befehl zum Renderer, der ihn wie einen Tastendruck ausfuehrt. */
  sende: (befehl: Befehl) => void
  /** Oeffnet den Ueber-Dialog; injiziert, damit diese Datei rein bleibt. */
  ueberAnwendung: () => void
}

/**
 * Ein Eintrag fuer einen Befehl aus der Kuerzel-Map.
 *
 * `registerAccelerator: false` ist der Kern: das Kuerzel wird **angezeigt**,
 * aber nicht beim System registriert. Registriert wuerde derselbe Tastendruck
 * zweimal wirken — einmal ueber das Menue, einmal ueber die Behandlung im
 * Fenster (App.tsx), und Strg+Plus zoomte zwei Stufen statt einer. Ausgefuehrt
 * wird ausschliesslich im Renderer; das Menue zeigt nur, was moeglich ist.
 */
function befehlsEintrag(
  befehl: Befehl,
  sende: (befehl: Befehl) => void
): MenuItemConstructorOptions {
  const kuerzel = findeKuerzel(befehl)
  return {
    label: beschreibeBefehl(befehl),
    accelerator: kuerzel.accelerator,
    registerAccelerator: false,
    click: () => {
      sende(befehl)
    }
  }
}

/**
 * Baut die Menuevorlage.
 *
 * Die Rollen `copy` und `selectAll` stehen bewusst drin: sobald ein eigenes
 * Menue gesetzt wird, verschwindet Electrons Standardmenue mitsamt diesen
 * Rollen — und Strg+C auf der Textauswahl waere tot. Genau das macht diesen
 * Schritt von S1.4 abhaengig.
 */
export function baueMenueVorlage(umgebung: MenueUmgebung): MenuItemConstructorOptions[] {
  const { plattform, sende, ueberAnwendung } = umgebung
  const istMac = plattform === 'darwin'

  const ueberEintrag: MenuItemConstructorOptions = {
    label: t('menue.ueber', { app: APP_NAME }),
    click: ueberAnwendung
  }

  // Ohne App-Menue sind Cmd+Q und die Dienste auf macOS nicht erreichbar.
  const appMenue: MenuItemConstructorOptions[] = istMac
    ? [
        {
          label: APP_NAME,
          submenu: [
            ueberEintrag,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      ]
    : []

  const datei: MenuItemConstructorOptions = {
    label: t('menue.datei'),
    submenu: [
      befehlsEintrag('oeffnen', sende),
      { type: 'separator' },
      befehlsEintrag('speichern', sende),
      befehlsEintrag('speichernUnter', sende),
      { type: 'separator' },
      befehlsEintrag('formularFlachlegen', sende),
      befehlsEintrag('fdfExportieren', sende),
      { type: 'separator' },
      befehlsEintrag('zusammenfuehren', sende),
      befehlsEintrag('teilen', sende),
      befehlsEintrag('seitenExtrahieren', sende),
      befehlsEintrag('pngExportieren', sende),
      befehlsEintrag('wordExportieren', sende),
      befehlsEintrag('ausBildernErstellen', sende),
      { type: 'separator' },
      befehlsEintrag('drucken', sende),
      { type: 'separator' },
      // Strg+W schliesst seit S6.1b den Tab, nicht mehr das Fenster. Die
      // Rolle `close` bekaeme sonst ihren Standard-Accelerator Strg+W und
      // registrierte ihn nativ - dann schloesse derselbe Tastendruck den Tab
      // und das Fenster. Deshalb der eigene Accelerator aus der Kuerzeldatei.
      befehlsEintrag('tabSchliessen', sende),
      {
        role: 'close',
        label: t('menue.fensterSchliessen'),
        accelerator: FENSTER_SCHLIESSEN.accelerator
      },
      // Auf macOS liegt Beenden im App-Menue; zweimal waere es verwirrend.
      ...(istMac ? [] : [{ role: 'quit' } as MenuItemConstructorOptions])
    ]
  }

  const bearbeiten: MenuItemConstructorOptions = {
    label: t('menue.bearbeiten'),
    submenu: [
      // Rueckgaengig und Wiederholen laufen ueber die eigene Historie und
      // **nicht** ueber Electrons `undo`/`redo`-Rollen: die naehmen nur
      // Texteingaben zurueck und wuessten von einer geloeschten Anmerkung
      // nichts (S2.2, Aufgabe 7).
      befehlsEintrag('rueckgaengig', sende),
      befehlsEintrag('wiederholen', sende),
      { type: 'separator' },
      { role: 'copy', label: t('menue.kopieren') },
      { role: 'selectAll', label: t('menue.allesAuswaehlen') },
      { type: 'separator' },
      befehlsEintrag('annotationLoeschen', sende),
      befehlsEintrag('werkzeugAuswahl', sende),
      { type: 'separator' },
      befehlsEintrag('seiteLoeschen', sende),
      befehlsEintrag('werkzeugZuschneiden', sende),
      befehlsEintrag('werkzeugTextBearbeiten', sende),
      { type: 'separator' },
      befehlsEintrag('suchen', sende),
      { type: 'separator' },
      befehlsEintrag('einstellungen', sende)
    ]
  }

  const ansicht: MenuItemConstructorOptions = {
    label: t('menue.ansicht'),
    submenu: [
      befehlsEintrag('zoomGroesser', sende),
      befehlsEintrag('zoomKleiner', sende),
      befehlsEintrag('zoomZuruecksetzen', sende),
      { type: 'separator' },
      befehlsEintrag('passungBreite', sende),
      befehlsEintrag('passungSeite', sende),
      { type: 'separator' },
      befehlsEintrag('drehenLinks', sende),
      befehlsEintrag('drehenRechts', sende),
      { type: 'separator' },
      befehlsEintrag('sidebarUmschalten', sende),
      befehlsEintrag('seitenuebersicht', sende),
      { type: 'separator' },
      befehlsEintrag('tabVor', sende),
      befehlsEintrag('tabZurueck', sende)
    ]
  }

  const hilfe: MenuItemConstructorOptions = {
    label: t('menue.hilfe'),
    role: 'help',
    // F1 steht auch hier: wer die Kuerzel nicht kennt, kennt F1 oft ebenso
    // wenig und findet die Uebersicht sonst nur per Zufall (S5.2a).
    submenu: [befehlsEintrag('kuerzeluebersicht', sende), { type: 'separator' }, ueberEintrag]
  }

  return [...appMenue, datei, bearbeiten, ansicht, hilfe]
}
