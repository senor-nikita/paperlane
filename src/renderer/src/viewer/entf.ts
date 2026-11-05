/**
 * Entf in einem Eingabefeld einer Anmerkung (Textfeld, Notizzettel): loescht
 * Entf die Anmerkung selbst oder ein Zeichen?
 *
 * Die Tasten gehoeren dem Feld, solange es den Fokus hat - und ein Klick auf
 * ein Textfeld oder eine frisch gesetzte Notiz gibt ihm den Fokus sofort.
 * Entf tat dort bisher nichts, wenn rechts von der Einfuegemarke kein Zeichen
 * mehr stand, und die Anmerkung liess sich nur mit der Maus loeschen.
 *
 * Die Anmerkung geht deshalb nur weg, wenn Entf **kein Zeichen loeschen
 * koennte**: nichts markiert, die Einfuegemarke am Ende des Textes (bei einem
 * leeren Feld ist das immer so). Alles andere bleibt Textbearbeitung.
 * Gehaltene Taste zaehlt nicht: wer Zeichen mit Entf wegraeumt, soll nicht mit
 * dem letzten Wiederholungssignal die ganze Anmerkung verlieren. Mit einer
 * Zusatztaste ist es ohnehin ein anderes Kuerzel. Das Loeschen steht in der
 * Historie und laesst sich mit Strg+Z zuruecknehmen.
 */
export interface EntfEreignis {
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  currentTarget: Pick<HTMLTextAreaElement, 'value' | 'selectionStart' | 'selectionEnd'>
}

export function loeschtDieAnnotation(ereignis: EntfEreignis): boolean {
  if (ereignis.key !== 'Delete' || ereignis.repeat) return false
  if (ereignis.ctrlKey || ereignis.metaKey || ereignis.altKey || ereignis.shiftKey) return false
  const { value, selectionStart, selectionEnd } = ereignis.currentTarget
  return selectionStart === selectionEnd && selectionEnd === value.length
}
