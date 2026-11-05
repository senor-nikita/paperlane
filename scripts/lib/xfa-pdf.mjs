// PDF mit XFA-Formular.
//
// Warum roh statt mit pdf-lib: pdf-lib entfernt XFA-Daten beim Speichern und
// meldet das auch ("Removing XFA form data as pdf-lib does not support reading
// or writing XFA"). Ein mit pdf-lib erzeugtes Fixture enthaelt also gerade das
// nicht, worum es geht.
//
// Zweck: S1.5 muss erkennen, dass ein Dokument XFA verwendet, und das erklaeren.
// Mit `enableXfa: false` rendert pdf.js sonst nur die Ersatzseite, und der
// Nutzer sieht eine scheinbar leere, korrekt geladene Seite ohne Hinweis.
import { deflateSync } from 'node:zlib'
import { assemblePdf, streamObject } from './raw-pdf.mjs'

// Der Namensraum stammt aus der XFA-Spezifikation und ist Teil des
// Dateiformats, keine Markennennung.
const XDP =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">' +
  '<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">' +
  '<subform name="formular"><field name="platzhalter"/></subform>' +
  '</template></xdp:xdp>'

// Die Ersatzseite, die reale XFA-Dokumente zeigen, wenn der Betrachter XFA
// nicht ausfuehrt.
const CONTENT = Buffer.from(
  'BT /F1 20 Tf 72 760 Td (Please wait...) Tj ET\n' +
    'BT /F1 12 Tf 72 730 Td (If this message is not replaced, your viewer cannot display XFA forms.) Tj ET\n',
  'latin1'
)

export function createXfaPdf() {
  return assemblePdf([
    { dict: '<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      dict:
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
    },
    streamObject('', CONTENT),
    { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { dict: '<< /Fields [] /NeedAppearances true /XFA 7 0 R >>' },
    streamObject('/Filter /FlateDecode', deflateSync(Buffer.from(XDP, 'utf8'), { level: 6 }))
  ])
}
