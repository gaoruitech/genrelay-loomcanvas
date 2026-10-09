'use strict'

/**
 * Detect a file's real type from its leading bytes. Uploads and downloaded
 * results are classified by content, never by the name or the Content-Type
 * the sender claimed. Returns a MIME string or null when unrecognised.
 */

const ascii = (buf, start, end) => buf.toString('latin1', start, end)

function sniffIsoBmff(buf) {
  // ISO base media: [size:4]["ftyp":4][major brand:4]
  if (buf.length < 12 || ascii(buf, 4, 8) !== 'ftyp') return null
  const brand = ascii(buf, 8, 12).toLowerCase()
  if (brand === 'avif' || brand === 'avis') return 'image/avif'
  if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  if (brand.startsWith('qt')) return 'video/quicktime'
  if (brand.startsWith('m4a') || brand.startsWith('m4b')) return 'audio/mp4'
  return 'video/mp4'
}

function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null
  if (buf[0] === 0x89 && ascii(buf, 1, 4) === 'PNG') return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (ascii(buf, 0, 4) === 'GIF8') return 'image/gif'
  if (ascii(buf, 0, 2) === 'BM' && buf.length > 26) return 'image/bmp'
  if (ascii(buf, 0, 4) === 'RIFF' && buf.length >= 12) {
    const form = ascii(buf, 8, 12)
    if (form === 'WEBP') return 'image/webp'
    if (form === 'WAVE') return 'audio/wav'
    return null
  }
  const iso = sniffIsoBmff(buf)
  if (iso) return iso
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    // EBML: WebM and Matroska share the header; the DocType string tells them apart.
    return ascii(buf, 0, Math.min(buf.length, 64)).includes('webm') ? 'video/webm' : 'video/x-matroska'
  }
  if (ascii(buf, 0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(buf, 0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(buf, 0, 3) === 'ID3') return 'audio/mpeg'
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'audio/aac' // ADTS
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg' // MPEG audio frame sync
  return null
}

function kindOfMime(mime) {
  const m = String(mime || '')
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return null
}

module.exports = { sniffMime, kindOfMime }
