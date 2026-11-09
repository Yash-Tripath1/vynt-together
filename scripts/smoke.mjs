// End-to-end smoke test against a running relay: two peers exchange a binary frame and a
// control message, a third is refused, and leaving notifies the room.
//
//   node server/index.js &        (or against a deployed instance)
//   node scripts/smoke.mjs http://localhost:8765

import WebSocket from 'ws'

const BASE = process.argv[2] || 'http://localhost:8765'
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws'

const failures = []
function check(ok, label) {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) failures.push(label)
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    const inbox = []
    ws.on('message', (data, isBinary) => {
      inbox.push(isBinary ? { binary: data } : JSON.parse(data.toString()))
    })
    ws.on('open', () => resolve({ ws, inbox }))
    ws.on('error', reject)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(fn, label, timeout = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const result = fn()
    if (result) return result
    await wait(25)
  }
  failures.push(`timeout: ${label}`)
  return null
}

// healthz
const health = await fetch(`${BASE}/healthz`).then((r) => r.json())
check(health.ok === true, 'healthz ok')

const A = await connect()
const B = await connect()
const [welcomeA, welcomeB] = [
  await until(() => A.inbox.find((m) => m.type === 'welcome'), 'welcome A'),
  await until(() => B.inbox.find((m) => m.type === 'welcome'), 'welcome B'),
]
check(Boolean(welcomeA && welcomeB), 'both welcomed')

A.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE1' }))
await until(() => A.inbox.find((m) => m.type === 'joined'), 'A joined')
B.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE1' }))
const joinedB = await until(() => B.inbox.find((m) => m.type === 'joined'), 'B joined')
check(joinedB && joinedB.peers === 2, 'B sees 2 in room')
check(
  Boolean(await until(() => A.inbox.find((m) => m.type === 'peer-joined'), 'A notified')),
  'A notified of partner'
)

// binary frame passes through untouched
const frame = Uint8Array.from([1, 2, 0, 123, 9, 9, 9])
A.ws.send(frame)
const gotBin = await until(() => B.inbox.find((m) => m.binary), 'B got binary')
check(gotBin && new Uint8Array(gotBin.binary).join(',') === frame.join(','), 'binary forwarded verbatim')

// control messages carry the server-assigned sender id
A.ws.send(JSON.stringify({ type: 'countdown', ms: 3000 }))
const cd = await until(() => B.inbox.find((m) => m.type === 'countdown'), 'B got countdown')
check(cd && cd.from === welcomeA.id, 'control message tagged with sender id')

// rtc signalling rides the same channel and must never be swallowed by the relay
A.ws.send(JSON.stringify({ type: 'rtc-offer', sdp: { type: 'offer', sdp: 'x' } }))
const rtc = await until(() => B.inbox.find((m) => m.type === 'rtc-offer'), 'B got rtc-offer')
check(Boolean(rtc && rtc.sdp), 'rtc signalling forwarded (live video path)')

// third wheel is refused
const C = await connect()
C.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE1' }))
const refused = await until(() => C.inbox.find((m) => m.type === 'join-error'), 'C refused')
check(refused && refused.reason === 'full', 'third peer refused (2-person rooms)')

// leaving notifies the survivor
A.ws.send(JSON.stringify({ type: 'leave' }))
check(
  Boolean(await until(() => B.inbox.find((m) => m.type === 'peer-left'), 'B told partner left')),
  'peer-left delivered'
)

// room evaporates: C can now join
C.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE1' }))
const late = await until(() => C.inbox.find((m) => m.type === 'joined'), 'C joins after empty')
check(Boolean(late), 'room evaporated and is re-usable')

// regression: defecting to another room must notify the room you abandoned
const D = await connect()
const E = await connect()
D.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE2' }))
E.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE2' }))
// E joins second, so E's `joined` is the one that reports the full room.
await until(() => E.inbox.find((m) => m.type === 'joined' && m.peers === 2), 'D+E paired')
D.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE3' })) // D defects
check(
  Boolean(await until(() => E.inbox.find((m) => m.type === 'peer-left'), 'E told D left')),
  'defection notifies the abandoned room'
)

// regression: messages never leak across rooms
const F = await connect()
F.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE3' }))
await until(() => F.inbox.find((m) => m.type === 'joined'), 'F joins D in SMOKE3')
E.ws.send(Uint8Array.from([7, 7, 7])) // E is alone in SMOKE2 now
await wait(300)
check(!F.inbox.some((m) => m.binary), 'binary does not leak into other rooms')

// regression: re-joining your own room is a harmless no-op
D.inbox.length = 0
F.ws.send(JSON.stringify({ type: 'join', room: 'SMOKE3' }))
const rejoin = await until(() => F.inbox.filter((m) => m.type === 'joined').length >= 2, 'F re-joined')
check(Boolean(rejoin), 'same-room rejoin answers joined again')
await wait(150)
check(!D.inbox.some((m) => m.type === 'peer-left'), 'same-room rejoin does not flap the room')

A.ws.close()
B.ws.close()
C.ws.close()
D.ws.close()
E.ws.close()
F.ws.close()
await wait(200)

console.log(failures.length === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
