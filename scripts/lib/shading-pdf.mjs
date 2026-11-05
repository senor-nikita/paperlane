// PDF mit einem Shading, dessen Farbverlauf ueber eine PostScript-Funktion
// (FunctionType 4) berechnet wird.
//
// Zweck: R3 messbar machen. Die Anwendung laeuft mit `isEvalSupported: false`,
// pdf.js kann den PostScript-Rechner dann nicht zu JavaScript kompilieren und
// interpretiert ihn stattdessen — das ist messbar langsamer. Ohne ein solches
// Dokument bliebe die Aussage eine Vermutung.
import { assemblePdf, streamObject } from './raw-pdf.mjs'

const CONTENT = Buffer.from('q 0 0 400 400 re W n /Sh0 sh Q\n', 'latin1')

// Nimmt einen Eingabewert und erzeugt daraus drei Farbkanaele. Bewusst mit
// etwas Rechenarbeit statt eines trivialen `dup dup`.
const POSTSCRIPT = Buffer.from(
  '{ dup 0.5 mul exch dup 1 exch sub exch 2 mul dup 1 gt { pop 1 } if }\n',
  'latin1'
)

export function createShadingPdf() {
  return assemblePdf([
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      dict:
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] ' +
        '/Resources << /Shading << /Sh0 5 0 R >> >> /Contents 4 0 R >>'
    },
    streamObject('', CONTENT),
    {
      dict:
        '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 400 400] ' +
        '/Function 6 0 R /Extend [true true] >>'
    },
    streamObject('/FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1]', POSTSCRIPT)
  ])
}
