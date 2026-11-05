/**
 * Entscheidet, ob und wie eine Protokolldatei rotiert wird.
 *
 * Als reine Funktion ausgelegt: die Entscheidung ist die fehleranfaellige
 * Stelle, das Verschieben selbst ist trivial. So laesst sie sich an den
 * Grenzwerten pruefen, ohne Dateien anzulegen.
 */
export interface Verschiebung {
  von: string
  nach: string
}

export interface RotationsPlan {
  rotieren: boolean
  /** In dieser Reihenfolge auszufuehren. */
  verschieben: Verschiebung[]
  loeschen: string[]
}

export function planeRotation(
  basis: string,
  groesse: number,
  maxBytes: number,
  archive: number
): RotationsPlan {
  if (groesse < maxBytes) return { rotieren: false, verschieben: [], loeschen: [] }

  const loeschen = archive > 0 ? [basis + '.' + String(archive)] : [basis]
  const verschieben: Verschiebung[] = []
  // Von hinten nach vorne, sonst ueberschreibt jede Verschiebung die naechste.
  for (let nummer = archive - 1; nummer >= 1; nummer--) {
    verschieben.push({ von: basis + '.' + String(nummer), nach: basis + '.' + String(nummer + 1) })
  }
  if (archive > 0) verschieben.push({ von: basis, nach: basis + '.1' })

  return { rotieren: true, verschieben, loeschen }
}
