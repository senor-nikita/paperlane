import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ladeSprache } from './sprache'

const container = document.getElementById('root')
if (container === null) throw new Error('Wurzelelement #root nicht gefunden') // KEIN-UI-TEXT: Invariante des Buildes

// Erst die Sprache, dann das erste Zeichnen (S6.8): sonst blitzte die
// Oberflaeche auf einem englischen System kurz deutsch auf. `ladeSprache`
// wirft nicht; ohne Antwort bleibt es beim Deutschen.
void ladeSprache().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
