// Erzeugt ein passwortgeschuetztes PDF (Standard-Sicherheitshandler, R2/V1,
// RC4 mit 40 Bit).
//
// Warum von Hand: pdf-lib kann nicht verschluesseln, `qpdf` ist auf dieser
// Maschine nicht installiert, und `muhammara` waere ein natives Modul mit
// Prebuild-Risiko fuer ein einziges Testdokument. RC4 sind zwanzig Zeilen und
// MD5 liefert node:crypto — das ist die guenstigste tragfaehige Loesung (D6).
//
// R2/V1 ist bewusst die aelteste Variante: sie ist am einfachsten korrekt
// hinzubekommen, und der Zweck des Fixtures ist ausschliesslich, dass ein
// Betrachter nach einem Passwort fragt.
import { createHash } from 'node:crypto'
import { assemblePdf, streamObject } from './raw-pdf.mjs'

/** Standard-Fuellzeichenkette aus der PDF-Spezifikation, Algorithmus 2. */
const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
])

/** Feste Datei-ID, damit zwei Laeufe byte-identisch sind. */
const FILE_ID = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')

const KEY_LENGTH = 5 // 40 Bit
const PERMISSIONS = -1 // alles erlaubt

function md5(...parts) {
  const hash = createHash('md5')
  for (const part of parts) hash.update(part)
  return hash.digest()
}

function rc4(key, data) {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  const out = Buffer.alloc(data.length)
  let i = 0
  j = 0
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff
    j = (j + s[i]) & 0xff
    ;[s[i], s[j]] = [s[j], s[i]]
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff]
  }
  return out
}

function padPassword(password) {
  const bytes = Buffer.from(password, 'latin1')
  return Buffer.concat([bytes, PAD]).subarray(0, 32)
}

function int32le(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32LE(value, 0)
  return buffer
}

/** Algorithmus 3: der /O-Eintrag. */
function computeOwnerEntry(ownerPassword, userPassword) {
  const source = ownerPassword.length > 0 ? ownerPassword : userPassword
  const key = md5(padPassword(source)).subarray(0, KEY_LENGTH)
  return rc4(key, padPassword(userPassword))
}

/** Algorithmus 2: der Verschluesselungsschluessel des Dokuments. */
function computeEncryptionKey(userPassword, ownerEntry) {
  return md5(padPassword(userPassword), ownerEntry, int32le(PERMISSIONS), FILE_ID).subarray(
    0,
    KEY_LENGTH
  )
}

/** Algorithmus 4: der /U-Eintrag fuer R2. */
function computeUserEntry(encryptionKey) {
  return rc4(encryptionKey, PAD)
}

/** Algorithmus 1: der objektspezifische Schluessel. */
function objectKey(encryptionKey, objectNumber, generation) {
  const extra = Buffer.from([
    objectNumber & 0xff,
    (objectNumber >> 8) & 0xff,
    (objectNumber >> 16) & 0xff,
    generation & 0xff,
    (generation >> 8) & 0xff
  ])
  return md5(encryptionKey, extra).subarray(0, Math.min(KEY_LENGTH + 5, 16))
}

/**
 * @param {string} userPassword Passwort, mit dem sich das Dokument oeffnen laesst
 * @returns {Buffer} vollstaendiges, verschluesseltes PDF
 */
export function createEncryptedPdf(userPassword) {
  const ownerEntry = computeOwnerEntry('', userPassword)
  const encryptionKey = computeEncryptionKey(userPassword, ownerEntry)
  const userEntry = computeUserEntry(encryptionKey)

  const content = Buffer.from(
    'BT /F1 24 Tf 72 760 Td (Verschluesseltes Testdokument) Tj ET\n',
    'latin1'
  )
  const encryptedContent = rc4(objectKey(encryptionKey, 4, 0), content)

  const objects = [
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      dict:
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
    },
    streamObject('', encryptedContent),
    { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    {
      dict:
        `<< /Filter /Standard /V 1 /R 2 /O <${ownerEntry.toString('hex')}> ` +
        `/U <${userEntry.toString('hex')}> /P ${String(PERMISSIONS)} >>`
    }
  ]

  const id = FILE_ID.toString('hex')
  return assemblePdf(objects, ` /Encrypt 6 0 R /ID [<${id}> <${id}>]`)
}
