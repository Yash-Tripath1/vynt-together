// Room bookkeeping for the relay. Pure logic -- no I/O, no storage -- so the interesting
// rules (capacity, eviction, routing) are unit-testable.
//
// The whole privacy story of VYNT Together lives in this file: a room exists only while
// someone is in it. When the last person leaves, the room is gone. Nothing is written
// anywhere.

export function createRooms({ maxPerRoom = 2 } = {}) {
  const rooms = new Map() // roomId -> Set<peer>
  const roomOf = new Map() // peer -> roomId

  function join(roomId, peer) {
    if (typeof roomId !== 'string' || !roomId) return { ok: false, reason: 'bad-room' }
    if (roomOf.has(peer)) leave(peer)

    const set = rooms.get(roomId) || new Set()
    if (set.size >= maxPerRoom) return { ok: false, reason: 'full' }

    set.add(peer)
    rooms.set(roomId, set)
    roomOf.set(peer, roomId)
    return {
      ok: true,
      roomId,
      peers: set.size,
      others: [...set].filter((p) => p !== peer),
    }
  }

  function leave(peer) {
    const roomId = roomOf.get(peer)
    if (!roomId) return null
    roomOf.delete(peer)

    const set = rooms.get(roomId)
    const others = set ? [...set].filter((p) => p !== peer) : []
    if (set) {
      set.delete(peer)
      // The room evaporates with its last occupant; there is nothing to persist.
      if (set.size === 0) rooms.delete(roomId)
    }
    return { roomId, others }
  }

  function roommates(peer) {
    const roomId = roomOf.get(peer)
    if (!roomId) return []
    return [...rooms.get(roomId)].filter((p) => p !== peer)
  }

  function roomOfPeer(peer) {
    return roomOf.get(peer) || null
  }

  function stats() {
    return { rooms: rooms.size, peers: roomOf.size }
  }

  return { join, leave, roommates, roomOfPeer, stats }
}
