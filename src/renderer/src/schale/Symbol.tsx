/**
 * Die Symbole der Oberflaeche (S6.9) als eingebettetes SVG: Linien, 24er
 * Raster, `currentColor`. Keine Bibliothek und keine Schrift - beides waere
 * Paket oder Netz fuer zwanzig Pfade.
 *
 * Ein Symbol allein ist nie die Beschriftung: der Knopf traegt `aria-label`
 * und `title`, das Symbol ist `aria-hidden`.
 */
const PFADE = {
  anfang: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  zurueck: 'M15 18l-6-6 6-6',
  vor: 'M9 18l6-6-6-6',
  ende: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  kleiner: 'M5 12h14',
  groesser: 'M12 5v14M5 12h14',
  breite: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  seite: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  zweiSeiten: 'M3 5h8v14H3zM13 5h8v14h-8z',
  linksDrehen: 'M3 3v6h6M3.6 14a9 9 0 1 0 2.1-9.3L3 9',
  rechtsDrehen: 'M21 3v6h-6M20.4 14a9 9 0 1 1-2.1-9.3L21 9',
  rueckgaengig: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  wiederholen: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  seitenleiste: 'M4 4h16v16H4zM10 4v16',
  bearbeiten: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  suche: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  hoch: 'M18 15l-6-6-6 6',
  runter: 'M6 9l6 6 6-6',
  loeschen: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  oeffnen: 'M3 7V5h7l2 2h9v12H3zM3 7h18',
  speichern: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  notiz: 'M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2zM8 9h8M8 12h5'
} as const

export type SymbolName = keyof typeof PFADE

export function Sinnbild({
  name,
  groesse = 18
}: {
  name: SymbolName
  groesse?: number | string
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PFADE[name]} />
    </svg>
  )
}
