import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * S2.1 — vorhandene Annotationen anzeigen.
 *
 * Die Fixture `annotated.pdf` traegt auf Seite eins eine gelbe Markierung ueber
 * "Markierter Text auf Seite eins", eine Textnotiz, einen internen Verweis auf
 * Seite zwei und einen externen auf `https://example.org/`.
 *
 * **Der Bestaetigungsdialog wird hier nie ausgeloest.** Er ist modal und wuerde
 * den Playwright-Lauf anhalten — derselbe Grund, aus dem S1.5 den
 * Renderer-Absturz nicht per E2E prueft. Geprueft wird stattdessen der Weg
 * davor: dass ein `file:`-Ziel abgelehnt wird, **bevor** ein Dialog entsteht.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffneAnnotiert(): Promise<Page> {
  gestartet = await startApp([resolve('test/fixtures/annotated.pdf')])
  await gestartet.fenster.waitForSelector(
    '[data-testid="annotationsebene-1"] [data-annotation-typ]',
    { timeout: 20000 }
  )
  return gestartet.fenster
}

/** Wieviele Annotationsflaechen eines Typs die erste Seite traegt. */
async function flaechen(fenster: Page, typ: string): Promise<number> {
  return fenster
    .locator('[data-testid="annotationsebene-1"] [data-annotation-typ="' + typ + '"]')
    .count()
}

test('zeigt die Annotationen der ersten Seite', async () => {
  const fenster = await oeffneAnnotiert()
  expect(await flaechen(fenster, 'Highlight')).toBe(1)
  expect(await flaechen(fenster, 'Text')).toBe(1)
  expect(await flaechen(fenster, 'Link')).toBe(2)
})

/**
 * Exit-Kriterium, erster Teil: **jede Annotation erscheint genau einmal.**
 *
 * Die Zaehlung im DOM allein genuegt dafuer nicht — eine zweite, von pdf.js in
 * die Canvas gemalte Markierung waere dort unsichtbar. Deshalb der zweite
 * Teil: die Canvas selbst darf an der Stelle der Markierung kein Gelb tragen.
 * Ohne `annotationMode: DISABLE` waere es dort eingebrannt, denn pdf.js
 * erzeugt fuer Highlights auch ohne `/AP` eine Darstellung.
 */
test('malt keine Annotation ein zweites Mal in die Seite', async () => {
  const fenster = await oeffneAnnotiert()

  const kennungen = await fenster
    .locator('[data-testid="annotationsebene-1"] [data-annotation-typ]')
    .evaluateAll((elemente) => elemente.map((element) => element.getAttribute('data-testid') ?? ''))
  expect(new Set(kennungen).size).toBe(kennungen.length)

  const gelb = await fenster.evaluate(() => {
    const flaeche = document.querySelector('[data-annotation-typ="Highlight"]')
    const canvas = document.querySelector('[data-testid="seiten-canvas-1"]')
    if (!(flaeche instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return null
    const kontext = canvas.getContext('2d')
    if (kontext === null) return null

    // Von CSS-Pixeln auf Canvas-Pixel: das Canvas ist um den
    // Geraetepixelfaktor groesser als seine dargestellte Flaeche.
    const faktor = canvas.width / canvas.getBoundingClientRect().width
    const bild = kontext.getImageData(
      Math.round(flaeche.offsetLeft * faktor),
      Math.round(flaeche.offsetTop * faktor),
      Math.max(1, Math.round(flaeche.offsetWidth * faktor)),
      Math.max(1, Math.round(flaeche.offsetHeight * faktor))
    )
    let treffer = 0
    for (let i = 0; i < bild.data.length; i += 4) {
      const rot = bild.data[i] ?? 0
      const gruen = bild.data[i + 1] ?? 0
      const blau = bild.data[i + 2] ?? 0
      if (rot > 200 && gruen > 200 && blau < 100) treffer++
    }
    return treffer
  })

  expect(gelb).not.toBeNull()
  expect(gelb).toBe(0)
})

/**
 * Liegt die Markierung ueber ihrem Text?
 *
 * Gemessen wird gegen die Textebene, die pdf.js selbst positioniert — nicht
 * gegen eine im Test nachgebaute Rechnung. Verrutschte die Transformation, so
 * laege der markierte Text nicht mehr unter seiner Markierung. Das ist der
 * unabhaengige Gegencheck zu Risiko R6.
 */
async function markierungLiegtUeberDemText(fenster: Page): Promise<boolean> {
  return fenster.evaluate(() => {
    const flaeche = document.querySelector('[data-annotation-typ="Highlight"]')
    if (!(flaeche instanceof HTMLElement)) return false
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const text = spans.find((span) => span.textContent?.includes('Markierter Text'))
    if (!(text instanceof HTMLElement)) return false

    const marke = flaeche.getBoundingClientRect()
    const zeile = text.getBoundingClientRect()
    // Die Markierung deckt die Zeile ab; ein Pixel Spiel fuer Rundungen.
    return (
      marke.left <= zeile.left + 1 &&
      marke.right >= zeile.right - 1 &&
      marke.top <= zeile.top + 1 &&
      marke.bottom >= zeile.bottom - 1
    )
  })
}

/**
 * Wieviel Schrift liegt unter der Markierung — und wieviel unter einer gleich
 * grossen Flaeche in der Seitenmitte?
 *
 * Der zweite Gegencheck, fuer die gedrehten Faelle. Er kommt ohne die
 * Textebene aus und misst direkt in der Canvas, also in dem, was der Leser
 * sieht. Liegt die Markierung richtig, findet er dort Schrift und in der
 * leeren Seitenmitte keine; verrutschte die Transformation, kippte das
 * Verhaeltnis sofort.
 *
 * Warum nicht auch hier gegen die Textebene: dieses Mass soll ohne sie
 * auskommen. Es war der Befund an S1.4 (Textebene drehte sich nicht mit), der
 * es noetig gemacht hat, und es bleibt danach die unabhaengige Aussage —
 * `textebene-drehung.electron.spec.ts` misst umgekehrt die Textebene gegen
 * diese Markierung und stuetzt sich dabei auf das Pixelmass hier.
 */
async function schriftUnterDerMarkierung(
  fenster: Page
): Promise<{ markierung: number; mitte: number } | null> {
  return fenster.evaluate(() => {
    const flaeche = document.querySelector('[data-annotation-typ="Highlight"]')
    const canvas = document.querySelector('[data-testid="seiten-canvas-1"]')
    if (!(flaeche instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return null
    const kontext = canvas.getContext('2d')
    if (kontext === null) return null

    const faktor = canvas.width / canvas.getBoundingClientRect().width
    const breite = Math.max(1, Math.round(flaeche.offsetWidth * faktor))
    const hoehe = Math.max(1, Math.round(flaeche.offsetHeight * faktor))

    const dunkle = (x: number, y: number): number => {
      const bild = kontext.getImageData(
        Math.max(0, Math.min(canvas.width - breite, Math.round(x))),
        Math.max(0, Math.min(canvas.height - hoehe, Math.round(y))),
        breite,
        hoehe
      )
      let treffer = 0
      for (let i = 0; i < bild.data.length; i += 4) {
        if ((bild.data[i] ?? 255) < 100 && (bild.data[i + 1] ?? 255) < 100) treffer++
      }
      return treffer
    }

    return {
      markierung: dunkle(flaeche.offsetLeft * faktor, flaeche.offsetTop * faktor),
      // Die Fixture beschriftet nur den Kopf der Seite; die Mitte ist in jeder
      // Drehung leer.
      mitte: dunkle((canvas.width - breite) / 2, (canvas.height - hoehe) / 2)
    }
  })
}

/**
 * Stellt eine Zoomstufe ueber die Schaltflaechen ein — denselben Weg, den auch
 * der Nutzer geht, inklusive Neuaufbau von Canvas, Textebene und Annotationen.
 *
 * Die Anwendung startet mit "Breite anpassen", also einem krummen Wert, der
 * vom Fenster abhaengt. Von dort wird in Richtung Ziel geklickt, bis die
 * Anzeige stimmt: jede Zoomstufe der Leiter ist auf diesem Weg erreichbar.
 */
async function stelleZoomEin(fenster: Page, prozent: number): Promise<void> {
  const anzeige = fenster.getByTestId('zoom-anzeige')
  for (let versuch = 0; versuch < 12; versuch++) {
    const gelesen = Number.parseInt((await anzeige.inputValue()) ?? '0', 10)
    if (gelesen === prozent) return
    const richtung = gelesen < prozent ? 'größer' : 'kleiner'
    await fenster.getByRole('button', { name: richtung, exact: true }).click()
  }
  await expect(anzeige).toHaveValue(String(prozent) + ' %')
}

test('haelt die Markierung bei 100 Prozent ueber ihrem Text', async () => {
  const fenster = await oeffneAnnotiert()
  await stelleZoomEin(fenster, 100)
  await expect.poll(async () => markierungLiegtUeberDemText(fenster), { timeout: 15000 }).toBe(true)
})

/**
 * Der Plan nennt 250 %. Die Zoomleiter (`ZOOMSTUFEN`) hat dort keine Sprosse —
 * sie geht von 200 auf 300 —, und die Leiter fuer einen Test umzubauen hiesse,
 * den Test das Produkt bestimmen zu lassen. Geprueft wird deshalb die naechste
 * Sprosse darueber; sie ist die schaerfere Probe.
 */
test('haelt die Markierung bei 300 Prozent ueber ihrem Text', async () => {
  const fenster = await oeffneAnnotiert()
  await stelleZoomEin(fenster, 300)
  await expect.poll(async () => markierungLiegtUeberDemText(fenster), { timeout: 15000 }).toBe(true)
})

// Die ungedrehte Gegenprobe zum Pixelmass: beide Verfahren muessen dasselbe
// sagen, sonst taugt das zweite als Ersatz fuer die gedrehten Faelle nicht.
test('findet die Schrift auch ungedreht unter der Markierung', async () => {
  const fenster = await oeffneAnnotiert()
  const gemessen = await schriftUnterDerMarkierung(fenster)
  expect(gemessen).not.toBeNull()
  expect(gemessen?.markierung ?? 0).toBeGreaterThan(50)
  expect(gemessen?.mitte ?? 1).toBe(0)
})

for (const grad of [90, 180, 270]) {
  test('haelt die Markierung nach ' + String(grad) + ' Grad Drehung auf ihrem Text', async () => {
    const fenster = await oeffneAnnotiert()
    for (let i = 0; i < grad / 90; i++) {
      await fenster.getByRole('button', { name: 'rechts drehen', exact: true }).click()
    }
    await expect
      .poll(async () => (await schriftUnterDerMarkierung(fenster))?.markierung ?? 0, {
        timeout: 15000
      })
      .toBeGreaterThan(50)
    expect((await schriftUnterDerMarkierung(fenster))?.mitte).toBe(0)
  })
}

test('springt ueber einen internen Verweis auf die Zielseite', async () => {
  const fenster = await oeffneAnnotiert()
  // Der erste Verweis der Fixture ist der interne auf Seite zwei.
  await fenster.locator('[data-annotation-typ="Link"] button').first().click()
  await expect(fenster.getByTestId('seiten-eingabe')).toHaveValue('2', { timeout: 15000 })
})

/**
 * Exit-Kriterium: `file:` wird nachweislich abgelehnt.
 *
 * Geprueft ueber den IPC-Kanal, nicht ueber einen Klick: die Ablehnung
 * passiert im Main-Prozess, **bevor** ein Dialog entsteht. Genau das ist die
 * Aussage — ein `file:`-Ziel erreicht `shell.openExternal` nie.
 */
test('lehnt ein file-Ziel ab, ohne einen Dialog zu oeffnen', async () => {
  const fenster = await oeffneAnnotiert()
  const ergebnis = await fenster.evaluate(async () =>
    window.api.externOeffnen('file:///C:/Windows/win.ini')
  )
  expect(ergebnis.art).toBe('abgelehnt')
  if (ergebnis.art === 'abgelehnt') expect(ergebnis.grund).toContain('file')
})

for (const ziel of ['javascript:alert(1)', 'ms-msdt:/id PCWDiagnostic', 'ftp://example.org/x']) {
  test('lehnt ' + ziel + ' ab', async () => {
    const fenster = await oeffneAnnotiert()
    const ergebnis = await fenster.evaluate(
      async (adresse) => window.api.externOeffnen(adresse),
      ziel
    )
    expect(ergebnis.art).toBe('abgelehnt')
  })
}

test('listet die Anmerkungen in der Seitenleiste und springt zu ihnen', async () => {
  const fenster = await oeffneAnnotiert()
  await fenster.getByTestId('reiter-anmerkungen').click()

  // Vier Annotationen in der Fixture, alle auf Seite eins.
  await expect(fenster.locator('[data-testid="annotationsliste"] li')).toHaveCount(4, {
    timeout: 20000
  })
  await expect(fenster.getByTestId('annotationsliste-stand')).toContainText('4 Anmerkungen')

  await fenster.getByTitle('Vorhandene Notiz').click()
  await expect(fenster.getByTestId('seiten-eingabe')).toHaveValue('1')
})

/**
 * Seit S2.2 liegt die Bearbeitungsebene ueber der Anzeige: ein Klick auf eine
 * Notiz trifft ihre Greifflaeche, waehlt sie damit aus — und der Zettel geht
 * auf, weil er an der Auswahl haengt. Der Knopf darunter bleibt fuer die
 * Tastaturbedienung.
 */
test('zeigt den Inhalt einer Notiz beim Klick', async () => {
  const fenster = await oeffneAnnotiert()
  await fenster.locator('[data-testid^="greifflaeche-"]').first().click()
  await expect(fenster.locator('.annotation-notizzettel')).toContainText('Testautor')
  await expect(fenster.locator('[data-testid^="annotation-notiz-eingabe-"]')).toHaveValue(
    'Vorhandene Notiz'
  )
})

// Die Ebene liegt ueber der Textebene. Wuerde sie Zeigereignisse abfangen,
// waere die Textauswahl aus S1.4 unter jeder Markierung tot.
test('laesst Text unter einer Markierung weiter auswaehlbar', async () => {
  const fenster = await oeffneAnnotiert()
  const auswahl = await fenster.evaluate(() => {
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const text = spans.find((span) => span.textContent?.includes('Markierter Text'))
    if (text?.firstChild == null) return ''
    const bereich = document.createRange()
    bereich.selectNodeContents(text)
    const gewaehlt = window.getSelection()
    gewaehlt?.removeAllRanges()
    gewaehlt?.addRange(bereich)
    return gewaehlt?.toString() ?? ''
  })
  expect(auswahl).toContain('Markierter Text')
})
