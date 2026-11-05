import { PDFDocument } from 'pdf-lib'
import type { Mutation, TextBericht } from '../../shared/mutation'
import { ersetzeZeile } from './editor'
import { t } from '../../shared/i18n'

export type TextErsetzen = Extract<Mutation, { art: 'textErsetzen' }>

export interface TextErgebnis {
  bytes: Uint8Array
  bericht: TextBericht
}

/**
 * `textErsetzen` auf Dokumentbytes (S6.6b): laden, Zeile ersetzen oder
 * loeschen, speichern. Laeuft in der Anwendung im Text-Worker
 * (`textworker.ts`, Gate Phase 6), in Tests und Werkzeugen ausserhalb von
 * Electron direkt. Wirft `TextAbgelehnt` mit Grund.
 */
export async function ersetzeTextDirekt(
  bytes: Uint8Array,
  mutation: TextErsetzen
): Promise<TextErgebnis> {
  // `updateMetadata: false`: das Aenderungsdatum setzt der Speicherpfad.
  const dokument = await PDFDocument.load(bytes, { updateMetadata: false })
  const seiten = dokument.getPageCount()
  if (mutation.seite > seiten) {
    throw new Error(t('mutation.seiteFehlt', { seite: mutation.seite, seiten }))
  }
  const bericht = await ersetzeZeile(dokument, mutation.seite, mutation.zeile, mutation.text)
  return { bytes: await dokument.save(), bericht }
}
