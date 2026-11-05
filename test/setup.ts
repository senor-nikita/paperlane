import { vi } from 'vitest'

/**
 * jsdom kennt keinen ResizeObserver. Die Dokumentansicht braucht ihn, um auf
 * Groessenaenderungen des Sichtfensters zu reagieren; fuer Tests reicht eine
 * Attrappe, die nichts meldet.
 */
class ResizeObserverAttrappe {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverAttrappe)
