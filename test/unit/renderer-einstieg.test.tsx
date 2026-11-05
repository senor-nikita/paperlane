import { screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

/**
 * Der Einstieg des Renderers (S6.8): erst die Sprache beim Main erfragen,
 * dann zeichnen. Andersherum blitzte die Oberflaeche auf einem englischen
 * System kurz deutsch auf.
 */
const sprache = vi.hoisted(() => {
  let fertig: () => void = () => undefined
  const geladen = new Promise<void>((erfuellen) => {
    fertig = erfuellen
  })
  return { ladeSprache: vi.fn(() => geladen), fertig: () => fertig() }
})

vi.mock('../../src/renderer/src/sprache', () => ({ ladeSprache: sprache.ladeSprache }))
vi.mock('../../src/renderer/src/App', () => ({ App: () => <p>Anwendung</p> }))

it('zeichnet erst, wenn die Sprache geladen ist', async () => {
  const wurzel = document.createElement('div')
  wurzel.id = 'root'
  document.body.append(wurzel)

  await import('../../src/renderer/src/main')
  expect(sprache.ladeSprache).toHaveBeenCalledTimes(1)
  // Noch nichts gezeichnet, solange die Antwort aussteht.
  await Promise.resolve()
  expect(screen.queryByText('Anwendung')).toBeNull()

  sprache.fertig()
  await waitFor(() => {
    expect(screen.getByText('Anwendung')).not.toBeNull()
  })
})
