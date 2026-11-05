import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildCsp } from './src/main/csp'

/**
 * Zweite Verteidigungslinie: dieselbe CSP zusaetzlich als <meta> im Dokument,
 * falls der Header einmal ausbleibt. Wird injiziert statt in die index.html
 * geschrieben, damit es nur eine Quelle gibt und das Profil zum Modus passt —
 * ein statisches <meta> mit `connect-src 'none'` wuerde HMR toeten.
 */
function cspMetaPlugin(): Plugin {
  return {
    name: 'paperlane-csp-meta',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const csp = buildCsp(ctx.server === undefined ? 'production' : 'development', 'meta')
        // Ganz an den Anfang von <head>: ein <meta>-CSP gilt nur fuer Inhalte,
        // die ihm folgen. Hinter dem von Vite injizierten Script-Tag waere es
        // als Rueckfalllinie wirkungslos.
        const meta = `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
        return html.replace('<head>', meta)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // S0.1 / H3: Electron laedt unter `sandbox: true` KEIN ESM-Preload.
      // Ein als ESM gebautes Preload scheitert nicht beim Build, sondern zur
      // Laufzeit mit `window.api === undefined`. Daher CJS erzwingen.
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react(), cspMetaPlugin()]
  }
})
