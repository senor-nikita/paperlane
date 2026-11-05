/**
 * Ein kleines, echtes Type1-Programm fuer Tests (S6.6b) - wie eine
 * LaTeX-Teilmenge: nur die genannten Glyphen, eexec-verschluesselt, mit
 * `hsbw`-Breiten und je einem Rechteck als Umriss. Deterministisch: die
 * vier "zufaelligen" Startbytes sind fest.
 */

function verschluessele(klar: Uint8Array, r: number): Uint8Array {
  const out = new Uint8Array(klar.length)
  for (let k = 0; k < klar.length; k++) {
    const c = (klar[k] as number) ^ (r >> 8)
    out[k] = c
    r = ((c + r) * 52845 + 22719) & 0xffff
  }
  return out
}

function zahl(v: number): number[] {
  if (v >= -107 && v <= 107) return [v + 139]
  if (v >= 108 && v <= 1131) return [((v - 108) >> 8) + 247, (v - 108) & 0xff]
  if (v <= -108 && v >= -1131) return [((-v - 108) >> 8) + 251, (-v - 108) & 0xff]
  return [255, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

function charstring(breite: number, leer: boolean): Uint8Array {
  const befehle = [...zahl(0), ...zahl(breite), 13]
  if (!leer) {
    // rmoveto, drei rlineto, closepath: ein Rechteck.
    befehle.push(...zahl(50), ...zahl(0), 21)
    befehle.push(...zahl(breite - 100), ...zahl(0), 5)
    befehle.push(...zahl(0), ...zahl(600), 5)
    befehle.push(...zahl(-(breite - 100)), ...zahl(0), 5, 9)
  }
  befehle.push(14)
  return verschluessele(Uint8Array.from([0, 0, 0, 0, ...befehle]), 4330)
}

export interface Type1Datei {
  bytes: Uint8Array
  laenge1: number
  laenge2: number
  breiten: Map<string, number>
}

export function baueType1(name: string, glyphen: readonly string[]): Type1Datei {
  const enc = new TextEncoder()
  const klartext = enc.encode(
    '%!PS-AdobeFont-1.0: ' +
      name +
      ' 001.000\n12 dict begin\n/FontName /' +
      name +
      ' def\n/PaintType 0 def\n/FontType 1 def\n' +
      '/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n/FontBBox {0 -200 1000 900} readonly def\n' +
      '/Encoding StandardEncoding def\ncurrentfile eexec\n'
  )
  const breiten = new Map<string, number>()
  const teile: Uint8Array[] = [
    enc.encode(
      'dup /Private 8 dict dup begin\n/RD{string currentfile exch readstring pop}executeonly def\n' +
        '/ND{noaccess def}executeonly def\n/NP{noaccess put}executeonly def\n/BlueValues [] def\n' +
        '/MinFeature {16 16} def\n/lenIV 4 def\n/password 5839 def\n/Subrs 0 array\nND\n' +
        '2 index /CharStrings ' +
        String(glyphen.length + 1) +
        ' dict dup begin\n'
    )
  ]
  for (const g of ['.notdef', ...glyphen]) {
    const breite = g === '.notdef' ? 0 : g === 'space' ? 250 : 500 + (g.length % 3) * 50
    if (g !== '.notdef') breiten.set(g, breite)
    const cs = charstring(breite, g === '.notdef' || g === 'space')
    teile.push(enc.encode('/' + g + ' ' + String(cs.length) + ' RD '), cs, enc.encode(' ND\n'))
  }
  teile.push(
    enc.encode(
      'end\nend\nreadonly put\nnoaccess put\ndup /FontName get exch definefont pop\n' +
        'mark currentfile closefile\n'
    )
  )
  const privat = new Uint8Array(teile.reduce((s, t) => s + t.length, 4))
  let o = 4
  for (const t of teile) {
    privat.set(t, o)
    o += t.length
  }
  const binaer = verschluessele(privat, 55665)
  const bytes = new Uint8Array(klartext.length + binaer.length)
  bytes.set(klartext)
  bytes.set(binaer, klartext.length)
  return { bytes, laenge1: klartext.length, laenge2: binaer.length, breiten }
}
