import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type GestarteteApp } from './launchApp'

/**
 * Nacharbeit zu S1.4 — die Textebene unter Drehung.
 *
 * Der Befund aus S2.1: nach einer Seitendrehung blieb die Textebene waagerecht,
 * waehrend Canvas und Annotationsebene sich mitdrehten. Bei 90 Grad mass die
 * Markierung 36x321 px (senkrecht, richtig), der Textspan 207x16 px
 * (waagerecht, falsch). Textauswahl und Trefferrechtecke sassen damit auf
 * gedrehten Seiten an der falschen Stelle.
 *
 * Gemessen wird gegen die Annotationsebene, nicht gegen eine im Test
 * nachgebaute Rechnung. Deren Lage ist unabhaengig belegt: `annotationen.
 * electron.spec.ts` zeigt per Pixelmessung im Canvas, dass die Markierung in
 * jeder Drehung auf ihrer Schrift liegt. Deckt sich der Textspan mit der
 * Markierung, deckt er sich also mit der gezeichneten Schrift.
 *
 * Die Fixture `annotated.pdf` traegt auf Seite eins die gelbe Markierung
 * `Rect [70, 752, 340, 782]` ueber "Markierter Text auf Seite eins" (18 pt,
 * ab x = 72, Grundlinie y = 760). Der Text liegt darin mit Rand — in jeder
 * Drehung.
 */

let gestartet: GestarteteApp

test.afterEach(async () => {
  await gestartet.schliessen()
})

async function oeffneAnnotiert(): Promise<Page> {
  gestartet = await startApp([resolve('test/fixtures/annotated.pdf')])
  await gestartet.fenster.waitForSelector('[data-testid="textebene-1"] span', { timeout: 20000 })
  await gestartet.fenster.waitForSelector('[data-annotation-typ="Highlight"]', { timeout: 20000 })
  return gestartet.fenster
}

async function drehe(fenster: Page, grad: number): Promise<void> {
  for (let i = 0; i < grad / 90; i++) {
    await fenster.getByRole('button', { name: 'rechts drehen', exact: true }).click()
  }
}

interface Kasten {
  links: number
  oben: number
  rechts: number
  unten: number
  breite: number
  hoehe: number
}

/** Liegt `innen` in `aussen`? Ein Pixel Spiel fuer Rundungen. */
function liegtIn(innen: Kasten, aussen: Kasten): boolean {
  return (
    innen.links >= aussen.links - 1 &&
    innen.rechts <= aussen.rechts + 1 &&
    innen.oben >= aussen.oben - 1 &&
    innen.unten <= aussen.unten + 1
  )
}

/**
 * Der Kasten des Textspans und der der Markierung, beide in Fensterkoordinaten.
 *
 * `null`, solange die Ebene noch nicht steht — der Aufrufer pollt darauf.
 */
async function kaesten(fenster: Page): Promise<{ text: Kasten; marke: Kasten } | null> {
  return fenster.evaluate(() => {
    const kasten = (element: HTMLElement): Kasten => {
      const rechteck = element.getBoundingClientRect()
      return {
        links: rechteck.left,
        oben: rechteck.top,
        rechts: rechteck.right,
        unten: rechteck.bottom,
        breite: rechteck.width,
        hoehe: rechteck.height
      }
    }
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const span = spans.find((eintrag) => eintrag.textContent?.includes('Markierter Text'))
    const flaeche = document.querySelector('[data-annotation-typ="Highlight"]')
    if (!(span instanceof HTMLElement) || !(flaeche instanceof HTMLElement)) return null
    return { text: kasten(span), marke: kasten(flaeche) }
  })
}

/** Der Kasten des ersten Trefferrechtecks, in Fensterkoordinaten. */
async function trefferkasten(fenster: Page): Promise<Kasten | null> {
  return fenster.evaluate(() => {
    const treffer = document.querySelector('.treffer')
    if (!(treffer instanceof HTMLElement)) return null
    const rechteck = treffer.getBoundingClientRect()
    return {
      links: rechteck.left,
      oben: rechteck.top,
      rechts: rechteck.right,
      unten: rechteck.bottom,
      breite: rechteck.width,
      hoehe: rechteck.height
    }
  })
}

/** Waehlt den Span ueber die Auswahl-API aus und gibt zurueck, was darin steht. */
async function waehleAus(fenster: Page): Promise<string> {
  return fenster.evaluate(() => {
    const spans = [...document.querySelectorAll('[data-testid="textebene-1"] span')]
    const span = spans.find((eintrag) => eintrag.textContent?.includes('Markierter Text'))
    if (span?.firstChild == null) return ''
    const bereich = document.createRange()
    bereich.selectNodeContents(span)
    const gewaehlt = window.getSelection()
    gewaehlt?.removeAllRanges()
    gewaehlt?.addRange(bereich)
    return gewaehlt?.toString() ?? ''
  })
}

/** Der Kasten der aktuellen Auswahl, in Fensterkoordinaten. */
async function auswahlkasten(fenster: Page): Promise<Kasten | null> {
  return fenster.evaluate(() => {
    const auswahl = window.getSelection()
    if (auswahl === null || auswahl.rangeCount === 0) return null
    const rechteck = auswahl.getRangeAt(0).getBoundingClientRect()
    return {
      links: rechteck.left,
      oben: rechteck.top,
      rechts: rechteck.right,
      unten: rechteck.bottom,
      breite: rechteck.width,
      hoehe: rechteck.height
    }
  })
}

/**
 * Das Kernkriterium, fuer jede Drehung gleich formuliert: der Textspan liegt in
 * der Markierung, und bei 90 und 270 Grad steht er hochkant.
 *
 * Die Hochkant-Probe ist noetig, weil "liegt darin" allein zu schwach waere:
 * ein waagerechter Span koennte in eine breite Markierung zufaellig
 * hineinpassen. Die Zeile ist mit rund 250 pt deutlich laenger als hoch, ihr
 * Kasten also eindeutig orientiert.
 */
for (const grad of [0, 90, 180, 270]) {
  test('haelt Textebene und Markierung bei ' + String(grad) + ' Grad deckungsgleich', async () => {
    const fenster = await oeffneAnnotiert()
    await drehe(fenster, grad)

    await expect
      .poll(
        async () => {
          const gemessen = await kaesten(fenster)
          return gemessen === null ? false : liegtIn(gemessen.text, gemessen.marke)
        },
        { timeout: 20000 }
      )
      .toBe(true)

    const gemessen = await kaesten(fenster)
    expect(gemessen).not.toBeNull()
    const hochkant = grad === 90 || grad === 270
    expect((gemessen?.text.hoehe ?? 0) > (gemessen?.text.breite ?? 0)).toBe(hochkant)
    expect((gemessen?.marke.hoehe ?? 0) > (gemessen?.marke.breite ?? 0)).toBe(hochkant)
  })
}

/**
 * Der zweite Teil des Befunds: die Textauswahl selbst.
 *
 * Genau sie war der Einwand gegen den CSS-Weg (Risiko R6): Chromium verhalte
 * sich bei der Auswahl ueber gedrehten Containern erratisch. Hier steht der
 * Gegenbeleg — ueber der gedrehten Ebene liefert die Auswahl denselben Text wie
 * ungedreht, und der ausgewaehlte Bereich liegt weiter in der Markierung.
 */
for (const grad of [90, 180]) {
  test('erlaubt die Textauswahl nach ' + String(grad) + ' Grad Drehung', async () => {
    const fenster = await oeffneAnnotiert()
    await drehe(fenster, grad)

    // Erst warten, bis die Ebene steht. Canvas, Textebene und Annotationen
    // bauen sich nach einem Klick auf "rechts drehen" unabhaengig voneinander
    // neu auf; dazwischen liegt ein Fenster, in dem die alte Textebene noch
    // steht und die Annotationen schon gedreht sind. Nur auf das Vorhandensein
    // der Elemente zu warten genuegt deshalb nicht — der Test maesse dann
    // diesen Zwischenstand und waere flaky.
    await expect
      .poll(
        async () => {
          const stand = await kaesten(fenster)
          return stand === null ? false : liegtIn(stand.text, stand.marke)
        },
        { timeout: 20000 }
      )
      .toBe(true)

    expect(await waehleAus(fenster)).toContain('Markierter Text auf Seite eins')

    const auswahl = await auswahlkasten(fenster)
    const gemessen = await kaesten(fenster)
    expect(auswahl).not.toBeNull()
    expect(gemessen).not.toBeNull()
    if (auswahl !== null && gemessen !== null) expect(liegtIn(auswahl, gemessen.marke)).toBe(true)
  })
}

/**
 * Der dritte Teil: die Trefferrechtecke aus S1.4.
 *
 * Sie entstehen aus `Range.getClientRects()` innerhalb der Spans und werden
 * gegen den Kasten der Ebene versetzt. Beides bleibt unter Drehung richtig —
 * aber nur, solange der gedrehte Container deckungsgleich auf dem Seitenkasten
 * liegt. Diese Probe haelt genau das fest.
 */
for (const grad of [0, 90, 180]) {
  test('setzt das Trefferrechteck bei ' + String(grad) + ' Grad auf den Text', async () => {
    const fenster = await oeffneAnnotiert()
    await drehe(fenster, grad)

    await fenster.getByTestId('such-eingabe').fill('Markierter')
    await fenster.getByTestId('such-eingabe').press('Enter')
    await expect(fenster.getByTestId('treffer-anzeige')).toHaveText('1 von 1', { timeout: 20000 })

    await expect
      .poll(
        async () => {
          const treffer = await trefferkasten(fenster)
          const gemessen = await kaesten(fenster)
          return treffer === null || gemessen === null ? false : liegtIn(treffer, gemessen.marke)
        },
        { timeout: 20000 }
      )
      .toBe(true)

    // Ein leeres Rechteck laege trivial in jeder Flaeche.
    const treffer = await trefferkasten(fenster)
    expect((treffer?.breite ?? 0) * (treffer?.hoehe ?? 0)).toBeGreaterThan(100)
  })
}
