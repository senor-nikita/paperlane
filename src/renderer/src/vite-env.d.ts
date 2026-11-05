/// <reference types="vite/client" />

/**
 * Vite buendelt einen Worker, wenn der Import mit `?worker` endet, und liefert
 * einen Konstruktor. Genau so wird der pdf.js-Worker eingebunden — damit laedt
 * er auch im Produktionsbuild aus eigener Herkunft und erfuellt
 * `worker-src 'self'` aus der CSP (Risiko R2).
 */
declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
