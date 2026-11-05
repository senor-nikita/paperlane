import type { WebPreferences } from 'electron'

/**
 * Die Haertungseinstellungen des Renderers an genau einer Stelle.
 *
 * Als reine Funktion ausgelegt, damit Invariante 5 ohne laufende Anwendung
 * pruefbar ist (Muster: renderer-path.ts). `src/main/index.ts` erzeugt seine
 * `webPreferences` ausschliesslich hierueber — eine Aufweichung im Fenster-Code
 * ist damit nicht moeglich, ohne dass der Guard-Test rot wird.
 */
/**
 * Die Vorgaben des Druckfensters (S4.3, ADR 0003): dieselbe Haertung, **ohne**
 * Preload - das Fenster hat keine Bruecke und braucht keine - und mit
 * `plugins: true`, damit der Chromium-eigene PDF-Betrachter die Druckvorlage
 * laden darf. Das ist die einzige Stelle der Anwendung, die ein Plugin
 * zulaesst; der Guard-Test haelt beides fest.
 */
export function createDruckWebPreferences(): WebPreferences {
  return {
    plugins: true,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false
  }
}

export function createWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false
  }
}
