// PNG character-card reader.
//
// SillyTavern (and the whole TavernAI-derived ecosystem) stores a card inside
// the PNG's metadata: a `tEXt` chunk whose keyword is `chara`, holding the card
// JSON as base64. The image itself is just the avatar — the card data rides
// along in the file, which is why a 3.5 MB "card" is really a picture plus
// ~1.5 MB of base64 payload.
//
// DSH's own importer never looked at these files: it only ever read its
// `characters.json` store, which keeps just `{name, desc, first, enabled}`. So a
// card dragged in as PNG arrived stripped of its regex scripts, world book and
// helper scripts. This module reads the original file instead.

import fs from 'node:fs'

/**
 * Walk a PNG's chunks.
 *
 * PNG layout: 8-byte signature, then chunks of
 * `length(4) type(4) data(length) crc(4)`, ending at IEND.
 * @param {Buffer} buf
 * @returns {{type:string, len:number, off:number}[]}
 */
export function readPngChunks(buf) {
  const chunks = []
  if (!buf || buf.length < 8) return chunks
  let off = 8
  // Guard against a malformed length field running us off the end.
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) break
    chunks.push({ type, len, off })
    if (type === 'IEND') break
    off += 12 + len
    if (len < 0) break
  }
  return chunks
}

/**
 * Pull the `chara` payload out of a PNG's text chunks.
 *
 * Both `tEXt` and `iTXt` appear in the wild. `tEXt` is `keyword\0text`, while
 * `iTXt` is `keyword\0 compressionFlag(1) compressionMethod(1) langTag\0
 * translatedKeyword\0 text` — the extra header bytes have to be skipped or the
 * base64 decodes to garbage.
 * @param {Buffer} buf
 * @returns {string|null} the raw (still base64) payload
 */
export function extractCharaPayload(buf) {
  for (const c of readPngChunks(buf)) {
    if (c.type !== 'tEXt' && c.type !== 'iTXt') continue
    const body = buf.subarray(c.off + 8, c.off + 8 + c.len)
    const nul = body.indexOf(0)
    if (nul < 0) continue
    const keyword = body.toString('latin1', 0, nul)
    if (keyword !== 'chara' && keyword !== 'ccv3') continue

    let rest = body.subarray(nul + 1)
    if (c.type === 'iTXt') {
      const compressed = rest[0] === 1
      if (compressed) continue // would need zlib; these cards do not use it
      rest = rest.subarray(2)
      const langEnd = rest.indexOf(0)
      if (langEnd < 0) continue
      rest = rest.subarray(langEnd + 1)
      const transEnd = rest.indexOf(0)
      if (transEnd < 0) continue
      rest = rest.subarray(transEnd + 1)
    }
    return rest.toString('latin1')
  }
  return null
}

/**
 * Read a PNG character card into the card-JSON shape the rest of the plugin
 * expects — the same `{name, description, first_mes, data:{extensions}}` object
 * a `.json` card has.
 * @param {string} filePath
 * @returns {object|null}
 */
export function readPngCard(filePath) {
  let buf
  try {
    buf = fs.readFileSync(filePath)
  } catch (_) {
    return null
  }
  const payload = extractCharaPayload(buf)
  if (!payload) return null

  const decoded = [
    () => Buffer.from(payload, 'base64').toString('utf8'),
    () => Buffer.from(payload.replace(/\s+/g, ''), 'base64').toString('utf8'),
  ]
  for (const make of decoded) {
    try {
      const json = JSON.parse(make())
      // Some exports wrap the card as `{spec, data}`, others are flat.
      const data = json.data && json.data.name ? json.data : json
      if (!data || (!data.name && !data.first_mes && !data.description)) continue
      return {
        ...json,
        data: {
          ...(json.data || {}),
          name: data.name || '',
          description: data.description || '',
          personality: data.personality || '',
          scenario: data.scenario || '',
          first_mes: data.first_mes || '',
          mes_example: data.mes_example || '',
          extensions: data.extensions || (json.data && json.data.extensions) || {},
          character_book: data.character_book || (json.data && json.data.character_book) || null,
        },
      }
    } catch (_) {}
  }
  return null
}

/** Does the file look like a PNG card (by extension)? */
export function isPngCard(filePath) {
  return /\.png$/i.test(String(filePath || ''))
}
