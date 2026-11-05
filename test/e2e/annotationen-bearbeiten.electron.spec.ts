import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'
import { oeffneWerkzeuge, waehleWerkzeug } from './werkzeug'

/**
 * S2.2 — Annotationen erstellen, aendern und loeschen.
 *
 * Hier laeuft, was jsdom nicht kann: echtes Layout, echte Textauswahl, echtes
 * Ziehen. Die Unit-Tests pruefen die Rechenwege, dieser Lauf prueft, dass sie
 * in der gebauten Anwendung zusammenfinden.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffne(): Promise<Page> {
  gestartet = await startApp([resolve('test/fixtures/annotated.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="bearbeiten-schalter"]', { timeout: 20000 })
  await gestartet.fenster.waitForSelector(
    '[data-testid="annotationsebene-1"] [data-annotation-typ]'
  )
  return gestartet.fenster
}

/** Waehlt eine Textzeile der ersten Seite aus und laesst die Maustaste los. */
async function waehleText(fenster: Page, teil: string): Promise<void> {
  await fenster.evaluate((suchtext) => {
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const treffer = spans.find((span) => span.textContent?.includes(suchtext))
    if (treffer === undefined) throw new Error('Text nicht gefunden: ' + suchtext)
    const bereich = document.createRange()
    bereich.selectNodeContents(treffer)
    const auswahl = window.getSelection()
    auswahl?.removeAllRanges()
    auswahl?.addRange(bereich)
    // Die Ebene liest die Auswahl beim Loslassen der Maustaste.
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, teil)
}

/** Wieviele Annotationen eines Typs die erste Seite zeigt. */
function zaehle(fenster: Page, typ: string): Promise<number> {
  return fenster
    .locator('[data-testid="annotationsebene-1"] [data-annotation-typ="' + typ + '"]')
    .count()
}

test('legt aus einer Textauswahl eine Markierung an', async () => {
  const fenster = await oeffne()
  const vorher = await zaehle(fenster, 'Highlight')

  await waehleWerkzeug(fenster, 'markieren')
  await waehleText(fenster, 'Markierter Text')

  await expect.poll(async () => zaehle(fenster, 'Highlight'), { timeout: 10000 }).toBe(vorher + 1)
})

for (const [werkzeug, typ] of [
  ['unterstreichen', 'Underline'],
  ['durchstreichen', 'StrikeOut']
] as const) {
  test('legt mit ' + werkzeug + ' eine Annotation vom Typ ' + typ + ' an', async () => {
    const fenster = await oeffne()
    await waehleWerkzeug(fenster, werkzeug)
    await waehleText(fenster, 'Markierter Text')
    await expect.poll(async () => zaehle(fenster, typ), { timeout: 10000 }).toBe(1)
  })
}

/**
 * Exit-Kriterium: eine mehrzeilige Markierung liegt **je Zeile** richtig. Die
 * Fixture hat auf Seite eins drei Textzeilen; die Auswahl ueber alle drei muss
 * drei Streifen ergeben, nicht einen Kasten darueber.
 */
test('gibt einer mehrzeiligen Auswahl einen Streifen je Zeile', async () => {
  const fenster = await oeffne()
  await waehleWerkzeug(fenster, 'markieren')

  await fenster.evaluate(() => {
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const erste = spans.find((span) => span.textContent?.includes('Markierter Text'))
    const letzte = spans.find((span) => span.textContent?.includes('Externer Verweis'))
    if (erste === undefined || letzte === undefined) throw new Error('Textzeilen fehlen')
    const bereich = document.createRange()
    bereich.setStartBefore(erste)
    bereich.setEndAfter(letzte)
    const auswahl = window.getSelection()
    auswahl?.removeAllRanges()
    auswahl?.addRange(bereich)
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

  // Die neue Markierung ist die zuletzt gezeichnete.
  await expect
    .poll(
      async () =>
        fenster.locator('[data-annotation-typ="Highlight"]').last().locator('div').count(),
      { timeout: 10000 }
    )
    .toBeGreaterThanOrEqual(3)
})

test('setzt eine Notiz und einen Stempel per Klick', async () => {
  const fenster = await oeffne()

  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  await expect.poll(async () => zaehle(fenster, 'Text')).toBe(2)

  await waehleWerkzeug(fenster, 'stempel')
  await fenster.getByTestId('werkzeug-stempeltext').selectOption('Entwurf')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 200, y: 400 } })
  await expect.poll(async () => zaehle(fenster, 'Stamp')).toBe(1)
  await expect(fenster.locator('[data-annotation-typ="Stamp"]')).toContainText('Entwurf')
})

/** Klickt auf eine leere Stelle der ersten Seite (Bildschirmkoordinaten). */
async function klickeDaneben(fenster: Page, x = 700, y = 120): Promise<void> {
  const seite = await fenster.locator('[data-testid="annotationsebene-1"]').boundingBox()
  if (seite === null) throw new Error('keine Seite')
  await fenster.mouse.click(seite.x + x, seite.y + y)
}

test('schliesst den Notizzettel mit Escape und mit Klick daneben, der Text bleibt (S6.12)', async () => {
  const fenster = await oeffne()
  const zettel = fenster.locator('[data-testid^="annotation-notizzettel-"]')
  const eingabe = fenster.locator('[data-testid^="annotation-notiz-eingabe-"]')

  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 200 } })
  await eingabe.fill('Per Escape')
  await eingabe.press('Escape')
  await expect(zettel).toHaveCount(0)

  await waehleWerkzeug(fenster, 'notiz')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 300, y: 200 } })
  await eingabe.fill('Per Klick daneben')
  await klickeDaneben(fenster)
  await expect(zettel).toHaveCount(0)

  // Beide Texte sind angekommen: wieder geoeffnet steht jeweils der Text darin.
  const notizen = fenster.locator('[data-annotation-typ="Text"]')
  for (const [nummer, text] of [
    [-2, 'Per Escape'],
    [-1, 'Per Klick daneben']
  ] as const) {
    const kennung = (
      await notizen.nth((await notizen.count()) + nummer).getAttribute('data-testid')
    )?.replace('annotation-', '')
    if (kennung === undefined) throw new Error('keine Notiz')
    await fenster.getByTestId('greifflaeche-' + kennung).click()
    await expect(fenster.getByTestId('annotation-notiz-eingabe-' + kennung)).toHaveValue(text)
    await klickeDaneben(fenster)
    await expect(zettel).toHaveCount(0)
  }
})

test('zeigt unter einem ausgewaehlten Freitext keinen Notizzettel (S6.12)', async () => {
  const fenster = await oeffne()
  await waehleWerkzeug(fenster, 'text')
  await fenster.locator('[data-testid="zeichenflaeche-1"]').click({ position: { x: 120, y: 300 } })
  const kasten = fenster.locator('[data-testid^="freitextfeld-"]')
  await kasten.fill('Kein Zettel')
  await expect(fenster.locator('[data-testid^="annotation-notizzettel-"]')).toHaveCount(0)

  // Escape schliesst Kasten und Auswahl.
  await kasten.press('Escape')
  await expect(kasten).toHaveCount(0)
  await expect(fenster.locator('[data-testid^="auswahlrahmen-"]')).toHaveCount(0)
  await expect(fenster.locator('[data-testid^="freitext-anzeige-"]')).toHaveText('Kein Zettel')

  // Klick hinein, dann daneben: wieder zu, Text bleibt.
  const anzeige = await fenster.locator('[data-testid^="freitext-anzeige-"]').boundingBox()
  if (anzeige === null) throw new Error('keine Geometrie')
  await fenster.mouse.click(anzeige.x + anzeige.width / 2, anzeige.y + anzeige.height / 2)
  await expect(kasten).toBeFocused()
  await kasten.press('End')
  await kasten.pressSequentially(' mehr')
  await klickeDaneben(fenster)
  await expect(kasten).toHaveCount(0)
  await expect(fenster.locator('[data-testid^="auswahlrahmen-"]')).toHaveCount(0)
  await expect(fenster.locator('[data-testid^="freitext-anzeige-"]')).toHaveText('Kein Zettel mehr')
})

test('zeichnet einen Freihandzug', async () => {
  const fenster = await oeffne()
  await waehleWerkzeug(fenster, 'freihand')

  const rahmen = await fenster.locator('[data-testid="zeichenflaeche-1"]').boundingBox()
  expect(rahmen).not.toBeNull()
  if (rahmen === null) return

  await fenster.mouse.move(rahmen.x + 60, rahmen.y + 300)
  await fenster.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await fenster.mouse.move(rahmen.x + 60 + i * 12, rahmen.y + 300 + (i % 2) * 18)
  }
  await fenster.mouse.up()

  await expect.poll(async () => zaehle(fenster, 'Ink'), { timeout: 10000 }).toBe(1)
})

/**
 * Exit-Kriterium: die geloeschte Annotation **verschwindet tatsaechlich**.
 *
 * Das belegt zugleich `annotationMode: DISABLE` aus S2.1 — waere die
 * Markierung von pdf.js in die Canvas gemalt, bliebe an ihrer Stelle Gelb
 * stehen, obwohl das Element verschwunden ist.
 */
test('loescht eine Anmerkung restlos', async () => {
  const fenster = await oeffne()

  // Markierungen werden ueber die Liste ausgewaehlt: auf der Seite haben sie
  // bewusst keine Klickflaeche, damit der Text darunter waehlbar bleibt.
  await fenster.getByTestId('reiter-anmerkungen').click()
  await fenster.getByTitle('Vorhandene Markierung').click()
  await expect(fenster.getByTestId('werkzeug-loeschen')).toBeVisible()

  await fenster.getByTestId('werkzeug-loeschen').click()
  await expect.poll(async () => zaehle(fenster, 'Highlight')).toBe(0)

  const gelb = await fenster.evaluate(() => {
    const canvas = document.querySelector('[data-testid="seiten-canvas-1"]')
    if (!(canvas instanceof HTMLCanvasElement)) return null
    const kontext = canvas.getContext('2d')
    if (kontext === null) return null
    const bild = kontext.getImageData(0, 0, canvas.width, Math.round(canvas.height / 4))
    let treffer = 0
    for (let i = 0; i < bild.data.length; i += 4) {
      const rot = bild.data[i] ?? 0
      const gruen = bild.data[i + 1] ?? 0
      const blau = bild.data[i + 2] ?? 0
      if (rot > 200 && gruen > 200 && blau < 100) treffer++
    }
    return treffer
  })
  expect(gelb).toBe(0)
})

test('faerbt eine ausgewaehlte Anmerkung um', async () => {
  const fenster = await oeffne()
  await fenster.getByTestId('reiter-anmerkungen').click()
  await fenster.getByTitle('Vorhandene Notiz').click()

  await oeffneWerkzeuge(fenster)
  await fenster.getByTestId('werkzeug-farbe').fill('#ff0000')
  await expect
    .poll(async () =>
      fenster.evaluate(() => {
        const marke = document.querySelector('[data-annotation-typ="Text"] button')
        return marke instanceof HTMLElement ? marke.style.background : ''
      })
    )
    .toContain('255, 0, 0')
})

/**
 * Exit-Kriterium: Undo und Redo bleiben ueber mindestens zwanzig Operationen
 * korrekt — hier ueber die Oberflaeche, nicht ueber den Speicher.
 */
test('nimmt zwanzig Notizen zurueck und wieder vor', async () => {
  const fenster = await oeffne()
  const flaeche = fenster.locator('[data-testid="zeichenflaeche-1"]')

  // Seit S6.9 oeffnet jede neue Notiz ihren Zettel und kehrt zur Auswahl
  // zurueck - fuer die naechste also das Werkzeug neu waehlen.
  for (let i = 0; i < 20; i++) {
    await waehleWerkzeug(fenster, 'notiz')
    await flaeche.click({ position: { x: 40 + (i % 10) * 40, y: 120 + Math.floor(i / 10) * 60 } })
  }
  // Eine Notiz war schon im Dokument.
  await expect.poll(async () => zaehle(fenster, 'Text'), { timeout: 15000 }).toBe(21)

  for (let i = 0; i < 20; i++) await fenster.getByTestId('rueckgaengig').click()
  await expect.poll(async () => zaehle(fenster, 'Text')).toBe(1)
  await expect(fenster.getByTestId('rueckgaengig')).toBeDisabled()

  for (let i = 0; i < 20; i++) await fenster.getByTestId('wiederholen').click()
  await expect.poll(async () => zaehle(fenster, 'Text')).toBe(21)
  await expect(fenster.getByTestId('wiederholen')).toBeDisabled()
})

test('kehrt mit Escape zum Auswahlwerkzeug zurueck', async () => {
  const fenster = await oeffne()
  await waehleWerkzeug(fenster, 'freihand')
  await expect(fenster.getByTestId('werkzeug-freihand')).toHaveAttribute('aria-pressed', 'true')

  await fenster.keyboard.press('Escape')
  await expect(fenster.getByTestId('werkzeug-auswahl')).toHaveAttribute('aria-pressed', 'true')
})

/**
 * Exit-Kriterium: nichts verrutscht beim Zoomwechsel. Geprueft wird eine
 * **selbst angelegte** Markierung — die aus dem Dokument sagt darueber nichts,
 * weil ihre Koordinaten nicht aus einer Auswahl stammen.
 */
test('haelt eine neu angelegte Markierung ueber ihrem Text, auch nach Zoomwechsel', async () => {
  const fenster = await oeffne()
  await waehleWerkzeug(fenster, 'markieren')
  await waehleText(fenster, 'Sprung zu Seite zwei')

  const deckt = async (): Promise<boolean> =>
    fenster.evaluate(() => {
      const marken = [...document.querySelectorAll('[data-annotation-typ="Highlight"]')]
      const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
      const text = spans.find((span) => span.textContent?.includes('Sprung zu Seite zwei'))
      if (!(text instanceof HTMLElement)) return false
      const zeile = text.getBoundingClientRect()
      return marken.some((marke) => {
        const rahmen = marke.getBoundingClientRect()
        return (
          rahmen.left <= zeile.left + 1 &&
          rahmen.right >= zeile.right - 1 &&
          rahmen.top <= zeile.top + 1 &&
          rahmen.bottom >= zeile.bottom - 1
        )
      })
    })

  await expect.poll(deckt, { timeout: 10000 }).toBe(true)

  await fenster.getByRole('button', { name: 'größer', exact: true }).click()
  await fenster.getByRole('button', { name: 'größer', exact: true }).click()
  await expect.poll(deckt, { timeout: 15000 }).toBe(true)
})
