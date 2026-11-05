// Minimaler Assembler fuer handgeschriebene PDFs.
//
// Gebraucht fuer die zwei Fixtures, die pdf-lib nicht erzeugen kann:
// die verschluesselte Datei und das Shading mit PostScript-Funktion.
// Beide sind winzig und brauchen exakte Kontrolle ueber die Objektstruktur.

/**
 * @typedef {{ dict: string, stream?: Buffer }} PdfObject
 * Objektnummern ergeben sich aus der Reihenfolge, beginnend bei 1.
 */

/**
 * @param {PdfObject[]} objects
 * @param {string} trailerExtra zusaetzliche Trailer-Eintraege, z. B. /Encrypt
 * @returns {Buffer}
 */
export function assemblePdf(objects, trailerExtra = '') {
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')]
  const offsets = []
  let position = parts[0].length

  objects.forEach((object, index) => {
    const number = index + 1
    offsets.push(position)
    const head = Buffer.from(`${String(number)} 0 obj\n${object.dict}\n`, 'latin1')
    const body =
      object.stream === undefined
        ? Buffer.concat([head, Buffer.from('endobj\n', 'latin1')])
        : Buffer.concat([
            head,
            Buffer.from('stream\n', 'latin1'),
            object.stream,
            Buffer.from('\nendstream\nendobj\n', 'latin1')
          ])
    parts.push(body)
    position += body.length
  })

  const size = objects.length + 1
  let xref = `xref\n0 ${String(size)}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  xref +=
    `trailer\n<< /Size ${String(size)} /Root 1 0 R${trailerExtra} >>\n` +
    `startxref\n${String(position)}\n%%EOF\n`
  parts.push(Buffer.from(xref, 'latin1'))

  return Buffer.concat(parts)
}

/** Hilfsfunktion: Stream-Dictionary mit korrekter /Length. */
export function streamObject(extraEntries, data) {
  return {
    dict: `<< ${extraEntries}${extraEntries.length > 0 ? ' ' : ''}/Length ${String(data.length)} >>`,
    stream: data
  }
}
