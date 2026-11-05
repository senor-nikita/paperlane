import { dialog, type BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/app-info'
import { t } from '../shared/i18n'
import { MAX_TABNAME } from './schliessen'

/**
 * Die Rueckfrage, bevor der Main-Prozess eine Datei liest, die er nicht selbst
 * herausgegeben hat (Drag & Drop).
 *
 * Der Renderer ist eine Sandbox fuer fremde Dokumente; was von dort kommt, ist
 * Eingabe, nicht Wahrheit. Der Main kann einem Pfad aus dem Renderer nicht
 * ansehen, ob ein Mensch die Datei meinte - ein uebernommener Renderer
 * koennte jede PDF- oder Bilddatei der Platte anfordern. Einen Dialog des
 * Betriebssystems kann er nicht anklicken.
 *
 * Gefragt wird **nur** nach Pfaden, die der Main nicht kennt: Dateidialog,
 * Befehlszeile, Systemereignis, die Zuletzt-Liste und die Sitzung laufen ohne
 * Rueckfrage. Wer eine Datei auf das Fenster zieht, bestaetigt sie einmal.
 */
export interface LeseFrage {
  type: 'question' | 'warning'
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

/** So viele Pfade nennt die Frage; der Rest wird gezaehlt, damit der Dialog nicht ueberlaeuft. */
export const MAX_GEZEIGTE_PFADE = 10

/**
 * Der Text der Frage. `netz` heisst: mindestens ein Pfad liegt auf einem
 * anderen Rechner - das Oeffnen verbindet sich dann mit ihm, und die Frage
 * sagt es und ist mit "Abbrechen" vorbelegt.
 */
export function leseFrage(pfade: readonly string[], netz: boolean): LeseFrage {
  const gezeigt = pfade
    .slice(0, MAX_GEZEIGTE_PFADE)
    .map((pfad) => '• ' + (pfad.length > MAX_TABNAME ? pfad.slice(0, MAX_TABNAME) + '...' : pfad))
  const weitere = pfade.length - gezeigt.length
  if (weitere > 0) gezeigt.push(t('schliessen.weitere', { anzahl: weitere }))
  return {
    type: netz ? 'warning' : 'question',
    title: APP_NAME,
    message: t('lesen.frage', { anzahl: pfade.length }),
    detail: gezeigt.join('\n') + (netz ? '\n\n' + t('lesen.netzwerk') : ''),
    buttons: [t('lesen.oeffnen'), t('knopf.abbrechen')],
    defaultId: netz ? 1 : 0,
    cancelId: 1
  }
}

/** Fragt nach; `true` heisst "oeffnen". Schliessen des Dialogs gilt als Abbrechen. */
export async function bestaetigeLesen(
  fenster: BrowserWindow | null,
  pfade: readonly string[],
  netz: boolean
): Promise<boolean> {
  const frage = leseFrage(pfade, netz)
  const { response } =
    fenster === null
      ? await dialog.showMessageBox(frage)
      : await dialog.showMessageBox(fenster, frage)
  return response === 0
}
