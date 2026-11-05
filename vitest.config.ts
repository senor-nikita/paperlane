import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Ohne das React-Plugin laeuft JSX in Tests mit der klassischen Runtime und
  // scheitert mit "React is not defined".
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      reportsDirectory: './coverage',
      // Geltungsbereich laut Plan Rev 2, Abschnitt 2.3:
      // Main-Prozess, Konfigurationen und Skripte werden ueber E2E abgedeckt.
      include: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
      exclude: ['src/main/**', '**/*.config.*', 'scripts/**']
    }
  }
})
