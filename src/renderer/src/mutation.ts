import { sammleAenderungen, type Aenderungen } from '../../shared/aenderungen'
import type { Feldwert } from '../../shared/formulare'
import type { GeoeffnetesDokument } from '../../shared/ipc'
import type { TextZeile } from '../../shared/textzeilen'
import {
  beschreibeBericht,
  beschreibeMutation,
  seiteNachMutation,
  seitenzahlNach,
  type Drehung,
  type Mutation
} from '../../shared/mutation'
import { useAnnotationen } from './annotations-store'
import { bruecke } from './bruecke'
import { useDokument, type Ansicht } from './dokument-store'
import { geaenderteFelder, useFormular } from './formular-store'
import { useHistorie } from './historie'
import { useMutation } from './mutation-store'
import { useSeitenauswahl } from './seitenauswahl-store'
import { laufenderVorgang } from './vorgaenge'
import { t } from '../../shared/i18n'

/**
 * Die Mutationspipeline auf der Renderer-Seite (S4.0, Aufgabe 1; S4.1 fuegt
 * Rueckgaengig/Wiederholen hinzu): **eine** gekapselte Einheit von "Seite
 * loeschen" bis "Ansicht steht wieder".
 *
 * Reihenfolge, und warum sie so ist:
 *
 * 1. Den Aenderungssatz und die Formularwerte einsammeln - das, was der
 *    Renderer weiss und die Datei noch nicht. Es reist mit zum Main und wird
 *    **vor** der Reserialisierung eingespielt (Aufgabe 3). Danach ist es
 *    Bestand des Dokuments; der Renderer liest es beim Neuladen zurueck.
 * 2. Die Ansicht merken: Seite, Zoom, Drehung, Passung. Das Neuladen setzt
 *    sonst alles auf den Anfang, als waere eine andere Datei geoeffnet worden.
 * 3. Der Main mutiert und liefert neue Bytes unter demselben Pfad - und die
 *    Nummern des Stands vorher und nachher.
 * 4. `uebernimm` laedt sie. Das erhoeht `ladeNummer`, und daran haengt das
 *    **Cache-Invalidierungsprotokoll** (Aufgabe 2): Textcache und Suchindex,
 *    Anmerkungen, Formular, Auswahl (`useAufraeumenBeiWechsel`), dazu
 *    Seiten-Canvases und Miniaturen, die am Proxy haengen, und das alte
 *    Proxy selbst (`destroy`). Die Historie bleibt seit S4.1 stehen.
 * 5. Die gemerkte Ansicht wiederherstellen, mit der Seite, die nach der
 *    Mutation an die Stelle der alten rueckt (`seiteNachMutation`).
 * 6. Einen Schritt in die **gemeinsame** Historie eintragen (S4.1, Aufgabe 2).
 *
 * **Rueckgaengig** heisst: der Main stellt den Stand *vorher* her (die Bytes
 * vor dem Einspielen), der Renderer laedt neu und spielt die damals offenen
 * Anmerkungen und Formularwerte wieder in seine Stores - genau so, wie sie
 * vor der Mutation dort lagen, mit denselben Kennungen. Deshalb bleiben die
 * Anmerkungsschritte **vor** der Mutation in der Historie gueltig: wer sie
 * zuruecknehmen will, muss vorher die Mutation zuruecknehmen, und danach
 * sieht der Store aus wie damals. **Wiederholen** stellt den Stand *nachher*
 * her; die Anmerkungen sind dann wieder Bestand des Dokuments.
 */

/** Laeuft eine Mutation, wartet die naechste - zwei zugleich gaebe zwei Wahrheiten. */
let laeuft = false

/** Nur fuer Tests. */
export function setzeMutationssperreZurueck(): void {
  laeuft = false
}

interface OffeneAenderungen {
  aenderungen: Aenderungen
  formularwerte: Record<string, Feldwert>
  /** Die Seiten, deren Anmerkungen der Store kannte - sie werden vor dem Einspielen geladen. */
  geladeneSeiten: number[]
}

function sammleOffene(): OffeneAenderungen {
  const { proSeite, urspruenglich } = useAnnotationen.getState()
  const formular = useFormular.getState()
  const formularwerte: Record<string, Feldwert> = {}
  for (const name of geaenderteFelder(formular.werte, formular.ursprung)) {
    const wert = formular.werte[name]
    if (wert !== undefined) formularwerte[name] = wert
  }
  return {
    aenderungen: sammleAenderungen(proSeite, urspruenglich),
    formularwerte,
    geladeneSeiten: Object.keys(urspruenglich).map(Number)
  }
}

function aktuelleAnsicht(): Ansicht {
  const z = useDokument.getState()
  return { seite: z.aktuelleSeite, zoom: z.zoom, rotation: z.rotation, passung: z.passung }
}

/**
 * Spielt nach einem Neuladen die damals offenen Aenderungen wieder in die
 * Stores - ohne Historie, denn die Schritte dazu stehen dort schon.
 */
async function spieleOffeneEin(offen: OffeneAenderungen): Promise<void> {
  const { dokument } = useDokument.getState()
  if (dokument === null) return
  const anmerkungen = useAnnotationen.getState()
  const seiten = new Set(offen.geladeneSeiten)
  for (const a of [...offen.aenderungen.neue, ...offen.aenderungen.geaendert]) seiten.add(a.seite)
  // Erst lesen, dann aendern: `fuegeEin` auf einer ungelesenen Seite machte
  // sonst die leere Liste zu ihrem Ursprung (Gate Phase 2, M2).
  await Promise.all([...seiten].map((seite) => anmerkungen.ladeSeite(dokument, seite)))
  for (const a of offen.aenderungen.neue) anmerkungen.fuegeEin(a)
  for (const a of offen.aenderungen.geaendert) anmerkungen.ersetze(a)
  for (const id of offen.aenderungen.geloescht) anmerkungen.entferne(id)

  const namen = Object.keys(offen.formularwerte)
  if (namen.length > 0) {
    const formular = useFormular.getState()
    for (const seite of Object.keys(formular.proSeite).map(Number)) {
      await formular.ladeSeite(dokument, seite)
    }
    for (const name of namen) {
      const wert = offen.formularwerte[name]
      if (wert !== undefined) useFormular.getState().setzeWert(name, wert)
    }
  }
}

/** Neu laden mit Ansicht; die Auswahl in der Miniaturenleiste gilt danach nicht mehr. */
async function ladeNeu(dokument: GeoeffnetesDokument, ansicht: Ansicht): Promise<void> {
  useSeitenauswahl.getState().leere()
  await useDokument.getState().uebernimm(dokument, ansicht)
}

/**
 * Stellt einen Stand her und laedt ihn. Liefert `null`, wenn das nicht ging,
 * sonst ob der Stand genau die Datei auf der Platte ist (`sauber`): nach einem
 * Speichern ist auch ein Stand mit Nummer ungleich 0 sauber, und ein
 * Rueckgaengig bis vor das Speichern macht das Dokument wieder ungespeichert.
 */
async function stelleStandHer(
  stand: number,
  ansicht: Ansicht
): Promise<{ sauber: boolean } | null> {
  const { pfad, setzeHinweis } = useDokument.getState()
  const api = bruecke()
  if (api === undefined || pfad === null) return null
  const ergebnis = await api.dokumentStandHerstellen({ quelle: pfad, stand })
  if (ergebnis.art === 'abgelehnt') {
    setzeHinweis(ergebnis.grund)
    return null
  }
  await ladeNeu(ergebnis.dokument, ansicht)
  return { sauber: ergebnis.sauber }
}

export async function fuehreMutationAus(mutation: Mutation): Promise<boolean> {
  const dokumentStore = useDokument.getState()
  const { pfad, verschluesselt, setzeHinweis } = dokumentStore
  const api = bruecke()
  if (api === undefined || pfad === null || dokumentStore.ladeZustand !== 'bereit') return false
  if (verschluesselt) {
    setzeHinweis(t('mutation.verschluesselt'))
    return false
  }
  if (laeuft || useHistorie.getState().beschaeftigt) return false
  // Review M1: ein laufender Vorgang (z. B. Extrahieren, das erst noch aus
  // dem Main-Ergebnis liest) haelt Seitenzahlen des Renderers fest, die eine
  // Mutation dazwischen ungueltig machen wuerde - "danach entfernen" darf
  // sonst falsche Seiten treffen.
  if (laufenderVorgang() !== null) return false
  laeuft = true
  const mutationen = useMutation.getState()
  mutationen.beginne(mutation)

  try {
    // 1. Was der Renderer weiss und die Datei noch nicht.
    const offen = sammleOffene()
    // 2. Die Ansicht.
    const vorher = aktuelleAnsicht()

    // 3. Der Main mutiert.
    const ergebnis = await api.dokumentMutieren({
      quelle: pfad,
      mutation,
      aenderungen: offen.aenderungen,
      formularwerte: offen.formularwerte
    })
    if (ergebnis.art === 'abgelehnt') {
      setzeHinweis(ergebnis.grund)
      mutationen.beende(false)
      return false
    }

    // 4. und 5. Neu laden, Ansicht wiederherstellen.
    const nachher: Ansicht = {
      ...vorher,
      seite: seiteNachMutation(
        vorher.seite,
        mutation,
        seitenzahlNach(dokumentStore.seitenzahl, mutation)
      )
    }
    await ladeNeu(ergebnis.dokument, nachher)
    mutationen.beende(true, ergebnis.dauerMs)
    // S6.6b: welche Schrift eine Textaenderung benutzt hat. Die Ersatzschrift
    // ist sichtbar zu melden (ADR 0005, Punkt 4) - im Hinweis und im
    // Historieneintrag, den Rueckgaengig im Tooltip nennt.
    const bericht = ergebnis.bericht
    const was = beschreibeMutation(mutation)
    setzeHinweis(
      bericht === undefined
        ? t('mutation.angewendet', { was })
        : t('mutation.angewendetMit', { was, bericht: beschreibeBericht(bericht) })
    )
    const beschreibung = bericht?.schrift === 'ersatz' ? t('mutation.ersatzschrift', { was }) : was

    // 6. Der Schritt in der gemeinsamen Historie.
    const stand = ergebnis.stand
    useHistorie.getState().merke({
      beschreibung,
      ruecknehmen: async () => {
        const hergestellt = await stelleStandHer(stand.vorher, vorher)
        if (hergestellt === null) {
          // KEIN-UI-TEXT: geht ins Protokoll, die Historie meldet selbst
          throw new Error('Stand ' + String(stand.vorher) + ' nicht wiederherstellbar')
        }
        await spieleOffeneEin(offen)
        useMutation.getState().nachStand(hergestellt.sauber, -1)
      },
      wiederholen: async () => {
        const hergestellt = await stelleStandHer(stand.nachher, nachher)
        if (hergestellt === null) {
          // KEIN-UI-TEXT: geht ins Protokoll, die Historie meldet selbst
          throw new Error('Stand ' + String(stand.nachher) + ' nicht wiederherstellbar')
        }
        useMutation.getState().nachStand(hergestellt.sauber, 1)
      }
    })
    return true
  } catch (fehler) {
    console.error('Mutation fehlgeschlagen:', fehler)
    setzeHinweis(t('mutation.fehler'))
    mutationen.beende(false)
    return false
  } finally {
    laeuft = false
  }
}

/**
 * Die Seiten, auf die ein Seitenwerkzeug wirkt: die Auswahl in der
 * Miniaturenleiste, sonst die aktuelle Seite.
 */
export function zielseiten(): number[] {
  const auswahl = useSeitenauswahl.getState().ausgewaehlt
  if (auswahl.size > 0) return [...auswahl].sort((a, b) => a - b)
  return [useDokument.getState().aktuelleSeite]
}

export function loescheSeiten(seiten: readonly number[]): Promise<boolean> {
  const { seitenzahl, setzeHinweis } = useDokument.getState()
  if (seiten.length >= seitenzahl) {
    setzeHinweis(t('mutation.letzteSeite'))
    return Promise.resolve(false)
  }
  return fuehreMutationAus({ art: 'seitenLoeschen', seiten })
}

export function dreheSeiten(seiten: readonly number[], grad: Drehung): Promise<boolean> {
  return fuehreMutationAus({ art: 'seitenDrehen', seiten, grad })
}

export function ordneSeitenAn(reihenfolge: readonly number[]): Promise<boolean> {
  return fuehreMutationAus({ art: 'seitenAnordnen', reihenfolge })
}

/**
 * Eine Textzeile ersetzen oder - mit leerem Text - loeschen (S6.6b). Der
 * Main findet die Zeile im Content-Stream und lehnt mit Grund ab, wenn sie
 * nicht sicher bearbeitbar ist; der Grund steht dann im Hinweis.
 */
export function ersetzeTextzeile(seite: number, zeile: TextZeile, text: string): Promise<boolean> {
  return fuehreMutationAus({ art: 'textErsetzen', seite, zeile, text })
}

/** Die ausgewaehlten oder die aktuelle Seite loeschen - Knopf, Menue, Kuerzel. */
export function loescheAktuelleSeite(): Promise<boolean> {
  return loescheSeiten(zielseiten())
}
