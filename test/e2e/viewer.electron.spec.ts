import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

let gestartet: GestarteteApp

test.beforeEach(async () => {
  gestartet = await startApp([resolve('test/fixtures/large-500.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="seiten-canvas-1"]', { timeout: 20000 })
})

test.afterEach(async () => {
  await gestartet.schliessen()
})

test('virtualisiert: nur wenige Seiten liegen im DOM', async () => {
  // Nur die Hauptansicht zaehlen. Seit S1.3c haengen auch Miniaturen im DOM;
  // die virtualisieren sich selbst und werden in miniaturen.electron.spec.ts
  // geprueft. Ohne die Eingrenzung waere unklar, welche der beiden Pipelines
  // die Grenze reisst.
  const anzahl = await gestartet.fenster.evaluate(
    () => document.querySelectorAll('[data-testid="ansicht"] canvas').length
  )
  expect(anzahl).toBeGreaterThan(0)
  expect(anzahl).toBeLessThanOrEqual(8)
  await expect(gestartet.fenster.getByTestId('seiten-anzeige')).toHaveText('von 500')
})

test('Scrollen fuehrt die Seitenanzeige mit', async () => {
  await gestartet.fenster.evaluate(() => {
    const behaelter = document.querySelector('[data-testid="ansicht"]')
    if (behaelter instanceof HTMLElement) behaelter.scrollTop = behaelter.scrollHeight * 0.5
  })
  // Die Seitenzahl steht jetzt im Eingabefeld, die Anzeige daneben nennt nur
  // noch die Gesamtzahl.
  await expect(gestartet.fenster.getByTestId('seiten-eingabe')).not.toHaveValue('1')
})

test('Zoomstufen wirken auf die Anzeige', async () => {
  const vorher = await gestartet.fenster.getByTestId('zoom-anzeige').inputValue()
  await gestartet.fenster.getByRole('button', { name: 'größer' }).click()
  await expect(gestartet.fenster.getByTestId('zoom-anzeige')).not.toHaveValue(vorher ?? '')
})

test('Drehen aendert die Seitenmasse, nicht per CSS', async () => {
  const vorher = await gestartet.fenster.evaluate(() => {
    const c = document.querySelector('[data-testid="seiten-canvas-1"]')
    return c instanceof HTMLCanvasElement ? { b: c.width, h: c.height } : null
  })
  await gestartet.fenster.getByRole('button', { name: 'rechts drehen', exact: true }).click()
  await gestartet.fenster.waitForTimeout(1200)

  const nachher = await gestartet.fenster.evaluate(() => {
    const c = document.querySelector('[data-testid="seiten-canvas-1"]')
    const seite = document.querySelector('[data-testid="seite-1"]')
    return {
      masse: c instanceof HTMLCanvasElement ? { b: c.width, h: c.height } : null,
      transform: seite instanceof HTMLElement ? getComputedStyle(seite).transform : ''
    }
  })

  // Nach 90 Grad ist die Seite breiter als hoch.
  expect(nachher.masse).not.toBeNull()
  expect(nachher.masse!.b).toBeGreaterThan(nachher.masse!.h)
  expect(vorher!.b).toBeLessThan(vorher!.h)
  // Und die Drehung steckt nicht in einer CSS-Matrix (Risiko R6).
  expect(nachher.transform).not.toMatch(/matrix\(0/)
})

test('Der Zoom laesst sich eintippen und wird begrenzt', async () => {
  const feld = gestartet.fenster.getByTestId('zoom-anzeige')
  await feld.fill('150')
  await feld.press('Enter')
  await expect(feld).toHaveValue('150 %')

  // Keine Zahl: die Anzeige springt auf den gueltigen Wert zurueck.
  await feld.fill('abc')
  await feld.press('Enter')
  await expect(feld).toHaveValue('150 %')

  // Zu klein: auf die Untergrenze (10 %) begrenzt.
  await feld.fill('1')
  await feld.press('Enter')
  await expect(feld).toHaveValue('10 %')
})

test('Zwei-Seiten-Ansicht stellt Seite 1 und 2 nebeneinander', async () => {
  const kasten = async (nummer: number): Promise<{ oben: number; links: number; rechts: number }> =>
    gestartet.fenster.evaluate((n) => {
      const seite = document.querySelector('[data-testid="seite-' + String(n) + '"]')
      if (!(seite instanceof HTMLElement)) throw new Error('Seite fehlt: ' + String(n))
      const r = seite.getBoundingClientRect()
      return { oben: r.top, links: r.left, rechts: r.right }
    }, nummer)

  // Einzeln: Seite 2 liegt unter Seite 1.
  const einzeln1 = await kasten(1)
  const einzeln2 = await kasten(2)
  expect(einzeln2.oben).toBeGreaterThan(einzeln1.oben + 50)

  await gestartet.fenster.getByTestId('zwei-seiten-schalter').click()
  await expect(gestartet.fenster.getByTestId('zwei-seiten-schalter')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await gestartet.fenster.waitForTimeout(600)

  const links = await kasten(1)
  const rechts = await kasten(2)
  expect(Math.abs(rechts.oben - links.oben)).toBeLessThan(2)
  expect(rechts.links).toBeGreaterThan(links.rechts - 1)
})

test('Strg + Mausrad zoomt stufenlos und haelt die Stelle unter dem Zeiger', async () => {
  const fenster = gestartet.fenster
  const feld = fenster.getByTestId('zoom-anzeige')
  await fenster.keyboard.press('Control+0')
  await expect(feld).toHaveValue('100 %')

  // Auf eine Seitenstelle zeigen und merken, wo sie liegt.
  const ansicht = await fenster.getByTestId('ansicht').boundingBox()
  if (ansicht === null) throw new Error('Ansicht fehlt')
  const zeigerX = ansicht.x + ansicht.width / 2
  const zeigerY = ansicht.y + 200
  await fenster.mouse.move(zeigerX, zeigerY)
  const vorher = await fenster.evaluate(
    ([x, y]) => {
      const seite = document.querySelector('[data-testid="seite-1"]')
      if (!(seite instanceof HTMLElement)) return null
      const r = seite.getBoundingClientRect()
      return { anteilX: ((x ?? 0) - r.left) / r.width, anteilY: ((y ?? 0) - r.top) / r.height }
    },
    [zeigerX, zeigerY]
  )
  expect(vorher).not.toBeNull()

  await fenster.keyboard.down('Control')
  await fenster.mouse.wheel(0, -300)
  await fenster.keyboard.up('Control')
  await fenster.waitForTimeout(600)

  // Stufenlos: ein Wert, der auf keiner festen Stufe liegt.
  const prozent = Number.parseInt(await feld.inputValue(), 10)
  expect(prozent).toBeGreaterThan(100)
  expect([25, 50, 75, 100, 125, 150, 200, 300, 400]).not.toContain(prozent)

  // Dieselbe Stelle der Seite liegt noch unter dem Zeiger (Toleranz: wenige Pixel).
  const nachher = await fenster.evaluate(
    ([x, y]) => {
      const seite = document.querySelector('[data-testid="seite-1"]')
      if (!(seite instanceof HTMLElement)) return null
      const r = seite.getBoundingClientRect()
      return { anteilX: ((x ?? 0) - r.left) / r.width, anteilY: ((y ?? 0) - r.top) / r.height }
    },
    [zeigerX, zeigerY]
  )
  expect(nachher).not.toBeNull()
  expect(Math.abs((nachher?.anteilX ?? 0) - (vorher?.anteilX ?? 0))).toBeLessThan(0.02)
  expect(Math.abs((nachher?.anteilY ?? 0) - (vorher?.anteilY ?? 0))).toBeLessThan(0.02)
})

test('Mausrad ohne Strg scrollt weiter und zoomt nicht', async () => {
  const fenster = gestartet.fenster
  await fenster.keyboard.press('Control+0')
  const feld = fenster.getByTestId('zoom-anzeige')
  await expect(feld).toHaveValue('100 %')
  const ansicht = await fenster.getByTestId('ansicht').boundingBox()
  if (ansicht === null) throw new Error('Ansicht fehlt')
  await fenster.mouse.move(ansicht.x + ansicht.width / 2, ansicht.y + 200)

  await fenster.mouse.wheel(0, 600)
  await fenster.waitForTimeout(400)

  await expect(feld).toHaveValue('100 %')
  const scrollOben = await fenster.getByTestId('ansicht').evaluate((el) => el.scrollTop)
  expect(scrollOben).toBeGreaterThan(0)
})

test('Passung Seite verkleinert gegenueber Passung Breite', async () => {
  await gestartet.fenster.getByRole('button', { name: 'Breite' }).click()
  await gestartet.fenster.waitForTimeout(600)
  const breite = await gestartet.fenster.getByTestId('zoom-anzeige').inputValue()
  await gestartet.fenster.getByRole('button', { name: 'Seite', exact: true }).click()
  await gestartet.fenster.waitForTimeout(600)
  const seite = await gestartet.fenster.getByTestId('zoom-anzeige').inputValue()
  expect(parseInt(seite ?? '0', 10)).toBeLessThanOrEqual(parseInt(breite ?? '0', 10))
})

/**
 * Rueckmeldung aus dem manuellen Durchlauf (2026-09-23): das Fenster hatte
 * eine zweite Scrollbar neben der der Ansicht. `body` behielt seinen
 * Standardrand, die Schale darin ist `100vh` hoch.
 */
test('das Fenster selbst scrollt nicht, nur die Ansicht', async () => {
  const masse = await gestartet.fenster.evaluate(() => {
    const seite = document.scrollingElement ?? document.documentElement
    return {
      hoehe: seite.scrollHeight - seite.clientHeight,
      breite: seite.scrollWidth - seite.clientWidth
    }
  })
  expect(masse).toEqual({ hoehe: 0, breite: 0 })
})

/**
 * Rueckmeldung aus dem manuellen Durchlauf (2026-09-23): seitliches Scrollen
 * mit dem Mausrad ging nicht. Eine Seite, breiter als die Ansicht, ragte links
 * ins Negative - dort scrollt kein Browser hin.
 */
test('eine breite Seite laesst sich seitlich scrollen, auch zum linken Rand', async () => {
  const fenster = gestartet.fenster
  for (let i = 0; i < 4; i++) {
    await fenster.getByRole('button', { name: 'größer' }).click()
  }
  const ansicht = fenster.getByTestId('ansicht')
  await expect
    .poll(() => ansicht.evaluate((el) => el.scrollWidth - el.clientWidth), { timeout: 15000 })
    .toBeGreaterThan(0)

  // Ganz links: der linke Rand der Seite liegt im sichtbaren Bereich.
  const linkerRand = await fenster.evaluate(() => {
    const behaelter = document.querySelector('[data-testid="ansicht"]')
    const canvas = document.querySelector('[data-testid="seiten-canvas-1"]')
    if (!(behaelter instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return null
    behaelter.scrollLeft = 0
    return canvas.getBoundingClientRect().left - behaelter.getBoundingClientRect().left
  })
  expect(linkerRand).not.toBeNull()
  expect(linkerRand ?? -1).toBeGreaterThanOrEqual(0)

  // Das seitliche Mausrad bewegt die Ansicht.
  const kasten = await ansicht.boundingBox()
  if (kasten === null) throw new Error('Ansicht ohne Masse')
  await fenster.mouse.move(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2)
  await fenster.mouse.wheel(200, 0)
  await expect
    .poll(() => ansicht.evaluate((el) => el.scrollLeft), { timeout: 10000 })
    .toBeGreaterThan(0)
})
