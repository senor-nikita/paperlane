import { create } from 'zustand'
import type { BildFormat, BildPdfAuftrag, BildSeite, Bildquelle } from '../../../shared/ipc'
import { bruecke } from '../bruecke'
import { useDokument } from '../dokument-store'
import { useTabs } from '../tabs-store'
import { t } from '../../../shared/i18n'

/**
 * "Aus Bildern erstellen…" auf der Renderer-Seite (S6.4, D18).
 *
 * Eigener Store statt eines Eintrags in `dokumentwerkzeuge-logik.ts` (Zusammen-
 * fuehren/Teilen/PNG-Export/Drucken): dieser Schritt laeuft parallel zu S6.2 und
 * S6.7 an demselben Projekt, und beide koennten den gemeinsamen `Werkzeug`-
 * Aufzaehlungstyp dort ebenfalls erweitern wollen. Ein eigenes Feld hier haelt
 * den Merge klein.
 *
 * Der Ablauf: der Main liest die gewaehlten oder fallengelassenen Dateien roh
 * (`bilderWaehlen`); der Renderer wertet EXIF-Ausrichtung aus und normalisiert
 * jedes Bild ueber `createImageBitmap`/Canvas auf PNG oder JPEG (Aufgabe 2+4,
 * R17) und schickt die Seiten in der gewaehlten Reihenfolge (`bilderZuPdf`).
 * Der Main baut das PDF, fragt nach dem Ziel und schreibt atomar; das Ergebnis
 * kommt danach ueber `dokumentOeffnePfad` in einen neuen Tab.
 */

export type Seitengroesse = BildPdfAuftrag['seitengroesse']
export type BildAusrichtung = BildPdfAuftrag['ausrichtung']

export interface BilderZuPdfEintrag {
  /** Eindeutig innerhalb einer Sitzung des Felds - fuer React-Keys und Entfernen. */
  id: number
  name: string
  /** `null`, solange die Normalisierung (EXIF, Formatumwandlung) noch laeuft. */
  seite: BildSeite | null
  /** Ein Bild, das sich nicht normalisieren liess (z. B. beschaedigte Datei). */
  fehler: string | null
}

export interface BilderZuPdfZustand {
  offen: boolean
  eintraege: BilderZuPdfEintrag[]
  seitengroesse: Seitengroesse
  ausrichtung: BildAusrichtung
  randMm: number
  laeuft: boolean

  oeffne: () => void
  schliesse: () => void
  fuegeHinzu: (quellen: Bildquelle[]) => (number | null)[]
  setzeSeite: (id: number, seite: BildSeite | null, fehler: string | null) => void
  entferne: (index: number) => void
  verschiebe: (index: number, richtung: -1 | 1) => void
  setzeSeitengroesse: (wert: Seitengroesse) => void
  setzeAusrichtung: (wert: BildAusrichtung) => void
  setzeRandMm: (wert: number) => void
  setzeLaeuft: (laeuft: boolean) => void
  setzeAlles: (patch: Partial<Pick<BilderZuPdfZustand, 'eintraege'>>) => void
}

let naechsteId = 1

export const useBilderZuPdf = create<BilderZuPdfZustand>((set, get) => ({
  offen: false,
  eintraege: [],
  seitengroesse: 'bild',
  ausrichtung: 'auto',
  randMm: 10,
  laeuft: false,

  oeffne: () => {
    set({ offen: true })
  },
  schliesse: () => {
    set({ offen: false, eintraege: [] })
  },
  fuegeHinzu: (quellen) => {
    // Liefert je Eingabe-Quelle ihre neue ID (oder `null`, wenn der Name schon
    // in der Liste steht) - **in derselben Reihenfolge wie `quellen`**. Der
    // Aufrufer (`bilderHinzufuegen`) ordnet Normalisierungsergebnisse ueber
    // genau diesen Index zu; eine gefilterte Rueckgabe wuerde bei ueberlappenden
    // Listen falsche Bilder falschen Eintraegen zuordnen (Review H1).
    const vorhanden = new Set(get().eintraege.map((e) => e.name))
    const neueEintraege: BilderZuPdfEintrag[] = []
    const ids = quellen.map((q) => {
      if (vorhanden.has(q.name)) return null
      vorhanden.add(q.name)
      const id = naechsteId++
      neueEintraege.push({ id, name: q.name, seite: null, fehler: null })
      return id
    })
    set({ eintraege: [...get().eintraege, ...neueEintraege] })
    return ids
  },
  setzeSeite: (id, seite, fehler) => {
    set({
      eintraege: get().eintraege.map((e) => (e.id === id ? { ...e, seite, fehler } : e))
    })
  },
  entferne: (index) => {
    set({ eintraege: get().eintraege.filter((_, i) => i !== index) })
  },
  verschiebe: (index, richtung) => {
    const eintraege = [...get().eintraege]
    const ziel = index + richtung
    const a = eintraege[index]
    const b = eintraege[ziel]
    if (a === undefined || b === undefined) return
    eintraege[index] = b
    eintraege[ziel] = a
    set({ eintraege })
  },
  setzeSeitengroesse: (seitengroesse) => {
    set({ seitengroesse })
  },
  setzeAusrichtung: (ausrichtung) => {
    set({ ausrichtung })
  },
  setzeRandMm: (randMm) => {
    set({ randMm })
  },
  setzeLaeuft: (laeuft) => {
    set({ laeuft })
  },
  setzeAlles: (patch) => {
    set(patch)
  }
}))

/** MIME-Typ je erkanntem Format - fuer den Blob, den `createImageBitmap` braucht. */
function mimeVon(format: BildFormat): string {
  switch (format) {
    case 'png':
      return 'image/png'
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
  }
}

/** Zerlegt eine `data:`-URL (aus `canvas.toDataURL`) in Bytes. */
export function bytesVonDataUrl(url: string): Uint8Array {
  const treffer = /^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (treffer === null) throw new Error('Unerwartetes Bildformat nach der Normalisierung.') // KEIN-UI-TEXT: Protokoll, der Eintrag zeigt einen eigenen Text
  const binaer = atob(treffer[1] ?? '')
  const bytes = new Uint8Array(binaer.length)
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i)
  return bytes
}

/**
 * Normalisiert eine Bildquelle: EXIF-Ausrichtung anwenden (Aufgabe 4, R17) und
 * auf PNG oder JPEG bringen (Aufgabe 2). `imageOrientation: 'from-image'` laesst
 * den Browser die EXIF-Drehung/-Spiegelung schon im Bitmap vorwegnehmen - genau
 * das, was pdf-lib beim Einbetten **nicht** von selbst tut.
 *
 * JPEG bleibt JPEG (verlustarm neu kodiert, falls eine Drehung noetig war),
 * alles andere wird PNG - WebP/GIF/BMP kennt pdf-lib nicht (Aufgabe 2).
 */
export async function normalisiereBild(quelle: Bildquelle): Promise<BildSeite> {
  // `Uint8Array.buffer` traegt laut Lib-Typen ein `ArrayBufferLike`
  // (theoretisch auch `SharedArrayBuffer`); `Blob` will ein echtes
  // `ArrayBuffer`. Die IPC-Bytes sind immer eines - `slice` kopiert es als
  // solches und loest den Typkonflikt ohne `any`.
  const puffer = quelle.bytes.buffer.slice(
    quelle.bytes.byteOffset,
    quelle.bytes.byteOffset + quelle.bytes.byteLength
  ) as ArrayBuffer
  const blob = new Blob([puffer], { type: mimeVon(quelle.format) })
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const kontext = canvas.getContext('2d')
    if (kontext === null) throw new Error('Kein Zeichenkontext verfuegbar.')
    kontext.drawImage(bitmap, 0, 0)
    const zielFormat: 'png' | 'jpeg' = quelle.format === 'jpeg' ? 'jpeg' : 'png'
    const datenUrl = canvas.toDataURL(zielFormat === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92)
    return {
      format: zielFormat,
      bytes: bytesVonDataUrl(datenUrl),
      breitePx: bitmap.width,
      hoehePx: bitmap.height
    }
  } finally {
    bitmap.close()
  }
}

/** Oeffnet das Feld und startet gleich die Bildauswahl ueber den Dialog. */
export async function beginneBilderZuPdf(): Promise<void> {
  useBilderZuPdf.getState().oeffne()
  await bilderHinzufuegen(null)
}

/**
 * Waehlt Bilder (Dialog bei `null`, sonst Pfade aus Drag & Drop) und
 * normalisiert sie im Hintergrund. Jedes Bild erscheint sofort in der Liste
 * und traegt nach seiner Normalisierung die Seitenmasse - so bleibt die
 * Oberflaeche waehrend vieler oder grosser Bilder bedienbar.
 */
export async function bilderHinzufuegen(pfade: string[] | null): Promise<void> {
  const api = bruecke()
  if (api === undefined) return
  const { setzeHinweis } = useDokument.getState()
  try {
    const ergebnis = await api.bilderWaehlen(pfade)
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    const store = useBilderZuPdf.getState()
    const ids = store.fuegeHinzu(ergebnis.bilder)
    const meldungen = ergebnis.abgelehnt.map((a) =>
      t('abgelehnt.eintrag', { name: a.name, grund: a.grund })
    )
    if (meldungen.length > 0) setzeHinweis(meldungen.join(' '))

    await Promise.all(
      ergebnis.bilder.map(async (quelle, index) => {
        const id = ids[index]
        if (id === undefined || id === null) return
        try {
          const seite = await normalisiereBild(quelle)
          useBilderZuPdf.getState().setzeSeite(id, seite, null)
        } catch (fehler) {
          console.error('Bild liess sich nicht normalisieren:', fehler)
          useBilderZuPdf
            .getState()
            .setzeSeite(id, null, t('bilder.nichtLesbar', { name: quelle.name }))
        }
      })
    )
  } catch (fehler) {
    console.error('Bilder liessen sich nicht waehlen:', fehler)
    setzeHinweis(t('bilder.waehlenFehler'))
  }
}

/** Der Dateiname ohne Endung, fuer den Vorschlag im Speichern-Dialog. */
export function vorschlagsname(eintraege: readonly BilderZuPdfEintrag[]): string {
  const erster = eintraege[0]?.name.replace(/\.[^.]+$/, '')
  if (erster === undefined || erster.length === 0) return t('bilder.dateiname')
  return eintraege.length === 1 ? erster : t('bilder.undWeitere', { name: erster })
}

/** Baut das PDF aus den fertig normalisierten Eintraegen und oeffnet es. */
export async function erzeugeBilderPdf(): Promise<void> {
  const api = bruecke()
  const store = useBilderZuPdf.getState()
  const { setzeHinweis } = useDokument.getState()
  if (api === undefined || store.laeuft) return
  const seiten = store.eintraege.map((e) => e.seite).filter((s): s is BildSeite => s !== null)
  if (seiten.length === 0) {
    setzeHinweis(t('bilder.nichtsNormalisiert'))
    return
  }
  const auftrag: BildPdfAuftrag = {
    seiten,
    seitengroesse: store.seitengroesse,
    ausrichtung: store.ausrichtung,
    randMm: store.randMm,
    vorschlag: vorschlagsname(store.eintraege)
  }
  store.setzeLaeuft(true)
  try {
    const ergebnis = await api.bilderZuPdf(auftrag)
    if (ergebnis.art === 'abgebrochen') return
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      return
    }
    useBilderZuPdf.getState().schliesse()
    await useTabs.getState().oeffneUeberPfad(ergebnis.pfad)
    setzeHinweis(t('bilder.erstellt', { name: ergebnis.name, anzahl: ergebnis.seiten }))
  } catch (fehler) {
    console.error('Bilder zu PDF fehlgeschlagen:', fehler)
    setzeHinweis(t('bilder.fehler'))
  } finally {
    useBilderZuPdf.getState().setzeLaeuft(false)
  }
}

/** Bilddatei-Endungen, an denen ein Drop als "Aus Bildern erstellen" erkannt wird. */
const BILD_ENDUNGEN = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

function endung(pfad: string): string {
  const punkt = pfad.lastIndexOf('.')
  return punkt === -1 ? '' : pfad.slice(punkt).toLowerCase()
}

/**
 * Ob eine Drop-Liste ausschliesslich Bilder enthaelt (Aufgabe 1, dritter
 * Einstieg). Eine gemischte Ablage - ein PDF neben einem Bild - bleibt beim
 * bestehenden PDF-Einstieg; das Bild darin scheitert dort sichtbar, statt
 * still in der falschen Ansicht zu landen.
 */
export function sindNurBilder(pfade: readonly string[]): boolean {
  return pfade.length > 0 && pfade.every((pfad) => BILD_ENDUNGEN.has(endung(pfad)))
}
