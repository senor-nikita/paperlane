/**
 * Wohin zeigt ein Pfad, den der Renderer nennt?
 *
 * Der Main-Prozess liest Dateien auf Zuruf des Renderers (Drag & Drop, Zuletzt-
 * Liste, Sitzung). Der Renderer ist aber eine Sandbox fuer fremde Dokumente;
 * wer ihn uebernimmt, darf den Main nicht zu einem Netzwerkzugriff bringen -
 * die Content-Security-Policy gilt nur im Renderer. Ein `\\server\freigabe\x.pdf`
 * loest DNS-Aufloesung und SMB/NTLM aus, ohne dass je ein Dialog erschien.
 *
 * **Klassifiziert wird die Zeichenkette**, vor jedem Dateizugriff, und mit der
 * Windows-Lesart: `/` und `\` sind dasselbe Trennzeichen. `/\server\x`,
 * `\/server/x` und `//server/x` sind deshalb genau so Netzwerkpfade wie
 * `\\server\x`; eine Pruefung auf `\\` allein am Rohstring liesse sie durch.
 */
export type Pfadklasse = 'lokal' | 'netz' | 'geraet'

/** Reservierte Namen, die unter Windows ein Geraet meinen - egal welche Endung folgt. */
const RESERVIERTE_NAMEN = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

export function pfadklasse(pfad: string): Pfadklasse {
  const einheitlich = pfad.trim().replace(/\//g, '\\')
  // Namensraeume und Geraetepfade: `\\?\C:\x`, `\\.\pipe\x`, `\??\UNC\s\x`.
  // Auch der lokal klingende `\\?\C:\`-Fall wird abgelehnt: er umgeht die
  // uebliche Pfadnormalisierung und hat keinen Platz bei einem Pfad, den ein
  // Renderer nennt.
  if (/^\\\\[?.]\\/.test(einheitlich) || einheitlich.startsWith('\\??\\')) return 'geraet'
  if (einheitlich.startsWith('\\\\')) return 'netz'
  const dateiname = einheitlich.split('\\').pop() ?? ''
  const ohneEndung = dateiname.replace(/\.[^.]*$/, '').toLowerCase()
  if (RESERVIERTE_NAMEN.has(ohneEndung)) return 'geraet'
  return 'lokal'
}
