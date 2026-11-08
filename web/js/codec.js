// Wire format for the relay: text frames carry JSON control messages; image frames are
// binary -- [kind:u8][metaLen:u16 LE][meta JSON utf8][jpeg bytes]. The server forwards
// binary frames untouched (it never parses them); the tiny header is how the receiving
// side tells previews from shutters and who sent them.

export const KIND = { PREVIEW: 1, SHUTTER: 2 }

// No 0/O/1/I/L: a room code gets read aloud over a call sometimes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function makeRoomCode(len = 6) {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  // 256 % 32 === 0, so modulo bias is exactly zero here.
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function encodeFrame(kind, meta, payload) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta))
  const out = new Uint8Array(1 + 2 + metaBytes.length + payload.length)
  out[0] = kind
  out[1] = metaBytes.length & 0xff
  out[2] = metaBytes.length >> 8
  out.set(metaBytes, 3)
  out.set(payload, 3 + metaBytes.length)
  return out
}

export function decodeFrame(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (buf.length < 3) return null
  const kind = buf[0]
  const metaLen = buf[1] | (buf[2] << 8)
  if (metaLen > buf.length - 3) return null
  let meta = {}
  try {
    meta = JSON.parse(new TextDecoder().decode(buf.subarray(3, 3 + metaLen)))
  } catch {
    return null
  }
  return { kind, meta, payload: buf.subarray(3 + metaLen) }
}
