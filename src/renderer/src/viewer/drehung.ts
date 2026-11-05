/**
 * Die wirksame Drehung einer Seite (Befund aus S4.1, behoben vor S4.2b).
 *
 * pdf.js kennt zwei Drehungen: die der Seite selbst (`/Rotate`, als
 * `PDFPageProxy.rotate`) und die, die `getViewport({ rotation })` verlangt.
 * Wer `rotation` angibt, **ersetzt** damit die Seitendrehung — er addiert sie
 * nicht. Seit S1.2 gab diese Anwendung die Ansichtsdrehung aus dem Store an
 * und verlor damit das `/Rotate` jedes Dokuments: eine im Querformat
 * gespeicherte Seite erschien hochkant, mit falsch gesetzten Anmerkungen.
 * Sichtbar wurde das erst mit S4.1, als "dauerhaft drehen" im eigenen Viewer
 * nichts zu tun schien.
 *
 * Deshalb eine Funktion fuer alle Stellen, die eine Seite zeichnen oder ihre
 * Koordinaten abbilden: Seitendrehung plus Ansichtsdrehung, auf 0..270
 * normiert. Das Layout braucht sie nicht - `getViewport({ scale: 1 })` liefert
 * die Seitenmasse bereits gedreht.
 */
export function effektiveDrehung(seitenDrehung: number, ansichtsDrehung: number): number {
  // Eine Seite ohne brauchbare Drehung (pdf.js liefert dann 0, eine Attrappe
  // gar nichts) zaehlt als ungedreht - NaN als Drehung waere ein leerer Canvas.
  const seite = Number.isFinite(seitenDrehung) ? seitenDrehung : 0
  const summe = Math.round((seite + ansichtsDrehung) / 90) * 90
  return ((summe % 360) + 360) % 360
}
