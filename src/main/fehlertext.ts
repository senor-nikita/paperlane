import { EncryptedPDFError } from 'pdf-lib'
import { verschluesseltText } from '../shared/errors'

/**
 * Der Text einer Ausnahme fuer eine Ablehnung an den Renderer.
 *
 * Ein verschluesseltes Dokument bekommt die Erklaerung statt der englischen
 * pdf-lib-Meldung, die zu `ignoreEncryption` raet - genau das waere falsch
 * (siehe `verschluesseltText`). Das greift auch dort, wo der Renderer nichts
 * von der Verschluesselung weiss: ein Dokument mit leerem Benutzerpasswort
 * oeffnet pdf.js ohne Nachfrage, pdf-lib lehnt es trotzdem ab.
 */
export function fehlertext(fehler: unknown): string {
  if (istVerschluesselt(fehler)) return verschluesseltText()
  return fehler instanceof Error ? fehler.message : String(fehler)
}

/**
 * `instanceof` allein reicht nicht: pdf-lib liegt als CommonJS- und als
 * ES-Modul bei, und je nach Aufloesung wirft eine andere Klasse als die hier
 * importierte. Die Meldung ist bei beiden dieselbe.
 */
function istVerschluesselt(fehler: unknown): boolean {
  if (fehler instanceof EncryptedPDFError) return true
  return fehler instanceof Error && fehler.message.startsWith(new EncryptedPDFError().message)
}
