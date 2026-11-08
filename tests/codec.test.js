import test from 'node:test'
import assert from 'node:assert/strict'

import { KIND, makeRoomCode, encodeFrame, decodeFrame } from '../web/js/codec.js'

test('frame round-trips: kind, meta, payload', () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5])
  const frame = encodeFrame(KIND.SHUTTER, { id: 'p7', ts: 123 }, payload)
  const decoded = decodeFrame(frame)
  assert.equal(decoded.kind, KIND.SHUTTER)
  assert.deepEqual(decoded.meta, { id: 'p7', ts: 123 })
  assert.deepEqual([...decoded.payload], [...payload])
})

test('preview frames round-trip too', () => {
  const payload = new Uint8Array([1, 2, 3])
  const decoded = decodeFrame(encodeFrame(KIND.PREVIEW, { id: 'p1' }, payload))
  assert.equal(decoded.kind, KIND.PREVIEW)
  assert.equal(decoded.meta.id, 'p1')
  assert.equal(decoded.payload.length, 3)
})

test('empty payload is legal (shutter of nothing still decodes)', () => {
  const decoded = decodeFrame(encodeFrame(KIND.PREVIEW, {}, new Uint8Array(0)))
  assert.equal(decoded.payload.length, 0)
})

test('garbage never throws', () => {
  assert.equal(decodeFrame(new Uint8Array(0)), null)
  assert.equal(decodeFrame(new Uint8Array([1, 255, 255])), null) // metaLen beyond end
  assert.equal(decodeFrame(new Uint8Array([2, 5, 0, 1, 2])), null) // truncated meta
})

test('room codes: 6 chars, unguessable alphabet, no confusables', () => {
  const code = makeRoomCode()
  assert.equal(code.length, 6)
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
  assert.ok(!/[OIL01]/.test(code), 'no lookalike characters')

  const codes = new Set(Array.from({ length: 200 }, () => makeRoomCode()))
  assert.ok(codes.size > 195, 'codes should essentially never collide')
})
