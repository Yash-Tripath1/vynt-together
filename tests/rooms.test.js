import test from 'node:test'
import assert from 'node:assert/strict'

import { createRooms } from '../server/rooms.js'

const A = 'alice'
const B = 'bob'
const C = 'carol'

test('a room holds exactly two people', () => {
  const rooms = createRooms({ maxPerRoom: 2 })
  assert.equal(rooms.join('ROOM1', A).ok, true)
  const second = rooms.join('ROOM1', B)
  assert.equal(second.ok, true)
  assert.equal(second.peers, 2)
  assert.deepEqual(second.others, [A])

  const third = rooms.join('ROOM1', C)
  assert.equal(third.ok, false)
  assert.equal(third.reason, 'full')
})

test('rooms evaporate when the last person leaves -- nothing is kept', () => {
  const rooms = createRooms()
  rooms.join('X1', A)
  rooms.join('X1', B)
  assert.equal(rooms.stats().rooms, 1)

  rooms.leave(A)
  assert.equal(rooms.stats().rooms, 1, 'still one occupant')
  assert.deepEqual(rooms.roommates(B), [], 'survivor has no one left to talk to')

  rooms.leave(B)
  assert.deepEqual(rooms.stats(), { rooms: 0, peers: 0 })
})

test('leave reports who must be told', () => {
  const rooms = createRooms()
  rooms.join('Y1', A)
  rooms.join('Y1', B)
  const left = rooms.leave(A)
  assert.equal(left.roomId, 'Y1')
  assert.deepEqual(left.others, [B])
})

test('routing only reaches roommates', () => {
  const rooms = createRooms()
  rooms.join('R1', A)
  rooms.join('R1', B)
  rooms.join('R2', C)
  assert.deepEqual(rooms.roommates(A), [B])
  assert.deepEqual(rooms.roommates(C), [])
})

test('re-joining moves you between rooms', () => {
  const rooms = createRooms()
  rooms.join('R1', A)
  rooms.join('R1', B)
  rooms.join('R2', A) // A defects
  assert.deepEqual(rooms.roommates(A), [])
  assert.deepEqual(rooms.roommates(B), [], 'old room is empty of mates')
  assert.equal(rooms.stats().rooms, 2)
})

test('bad room ids are rejected', () => {
  const rooms = createRooms()
  assert.equal(rooms.join('', A).ok, false)
  assert.equal(rooms.join(null, A).ok, false)
  assert.equal(rooms.join(42, A).ok, false)
})
