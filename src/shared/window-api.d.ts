import type { PreloadApi } from './ipc'

declare global {
  interface Window {
    /** Vom Preload freigegebene Bruecke. Der Renderer hat keinen anderen Weg nach aussen. */
    readonly api: PreloadApi
  }
}
