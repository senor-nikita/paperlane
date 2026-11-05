import { describe, expect, it } from 'vitest'
import { APP_NAME, windowTitle } from '../../src/shared/app-info'

describe('app-info', () => {
  it('traegt keinen Fremdmarkenbezug (Invariante 8)', () => {
    expect(APP_NAME.toLowerCase()).not.toMatch(/adobe|acrobat/)
  })

  it('zeigt ohne Dokument nur den Anwendungsnamen', () => {
    expect(windowTitle()).toBe(APP_NAME)
  })

  it('stellt den Dokumentnamen voran', () => {
    expect(windowTitle('bericht.pdf')).toBe(`bericht.pdf — ${APP_NAME}`)
  })
})
