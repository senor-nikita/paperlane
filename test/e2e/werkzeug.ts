import type { Page } from '@playwright/test'

/**
 * Waehlt ein Bearbeitungswerkzeug (S6.9). Die Werkzeugleiste ist zu, bis
 * jemand "Bearbeiten" drueckt; wie ein Nutzer oeffnet der Helfer sie zuerst,
 * wenn das Werkzeug nicht zu sehen ist.
 */
export async function waehleWerkzeug(fenster: Page, werkzeug: string): Promise<void> {
  const knopf = fenster.getByTestId('werkzeug-' + werkzeug)
  if (!(await knopf.isVisible())) await fenster.getByTestId('bearbeiten-schalter').click()
  await knopf.click()
}

/** Oeffnet die Werkzeugleiste, falls sie zu ist; die Auswahl bleibt. */
export async function oeffneWerkzeuge(fenster: Page): Promise<void> {
  const schalter = fenster.getByTestId('bearbeiten-schalter')
  if ((await schalter.getAttribute('aria-pressed')) !== 'true') await schalter.click()
}
