import type { PreloadApi } from '../../shared/ipc'

/**
 * Der Zugang zum Preload.
 *
 * `window.api` ist typisiert, als waere es immer da — zur Laufzeit fehlt es
 * jedoch, wenn das Preload nicht geladen wurde. Genau dieser Fall tritt ein,
 * wenn es versehentlich als ESM gebaut wird (guard-build:preload-cjs). Ohne
 * diese Pruefung wuerde der Zugriff synchron werfen und die Oberflaeche
 * zerstoeren, statt den Zustand zu melden.
 *
 * Seit S2.1 in einem eigenen Modul: die Annotationsebene braucht denselben
 * Zugang wie die App-Schale, und zwei Fassungen derselben Vorsichtsmassnahme
 * waeren eine zu viel.
 */
export function bruecke(): PreloadApi | undefined {
  return (window as Window & { api?: PreloadApi }).api
}
