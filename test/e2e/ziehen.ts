import type { Locator, Page } from '@playwright/test'

/**
 * Ziehen und Ablegen zwischen zwei Elementen ueber echte DragEvents an den
 * Elementen selbst (dragstart, dragover, drop, dragend mit einem gemeinsamen
 * DataTransfer).
 *
 * Warum nicht `dragTo`: das fuehrt die Maus. In kleinen Fenstern - der
 * Windows-Runner der CI hat einen kleineren Bildschirm als die
 * Entwicklungsmaschine - ist die Miniaturliste niedriger als eine Miniatur;
 * Playwright scrollt dann waehrend des Ziehens, und der Drop landet auf der
 * Quelle (CI #59-#63). Hier geht es um die Handler, nicht um die Geometrie
 * des Fensters.
 *
 * `anteil` ist die Stelle im Ziel (0..1) entlang der Achse: unter 0,5 heisst
 * "davor", darueber "danach". `waagerecht` fuer das Raster der Uebersicht.
 */
export async function ziehe(
  fenster: Page,
  quelle: Locator,
  ziel: Locator,
  anteil: number,
  waagerecht = false
): Promise<void> {
  const daten = await fenster.evaluateHandle(() => new DataTransfer())
  await quelle.scrollIntoViewIfNeeded()
  await quelle.dispatchEvent('dragstart', { dataTransfer: daten })
  await ziel.scrollIntoViewIfNeeded()
  const rahmen = await ziel.boundingBox()
  if (rahmen === null) throw new Error('Ziel ohne Masse')
  const punkt = waagerecht
    ? { clientX: rahmen.x + rahmen.width * anteil, clientY: rahmen.y + rahmen.height / 2 }
    : { clientX: rahmen.x + rahmen.width / 2, clientY: rahmen.y + rahmen.height * anteil }
  await ziel.dispatchEvent('dragover', { dataTransfer: daten, ...punkt })
  await ziel.dispatchEvent('drop', { dataTransfer: daten, ...punkt })
  await quelle.dispatchEvent('dragend', { dataTransfer: daten })
}
