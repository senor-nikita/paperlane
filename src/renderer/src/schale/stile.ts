/**
 * Die wenigen Stile, die sich mehrere Teile der Schale teilen. Farben kommen
 * aus den Variablen in `schale.css` (S6.9); Knoepfe tragen die Klasse
 * `knopf`, weil Hover, Druck- und Sperrzustand nur in CSS gehen.
 */

/**
 * Der Streifen, in dem die eingeblendeten Felder der Schale sitzen - Drucken,
 * Teilen, Zusammenfuehren, PNG-Export, Kuerzeluebersicht.
 *
 * Liegt hier und nicht mehr in `Dokumentwerkzeuge.tsx`, seit die
 * Kuerzeluebersicht (S5.2a) denselben Rahmen braucht, ohne ein
 * Dokumentwerkzeug zu sein.
 */
export const feldrahmen: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--linie)',
  background: 'var(--flaeche)'
}
