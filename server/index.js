#!/usr/bin/env node
// VYNT Together relay + static host.
//
// One process, one port: serves the web app and relays messages between the two people
// in a room. The relay is deliberately dumb:
//
//   * it never stores anything -- frames pass through and are forgotten,
//   * a room evaporates the moment its last occupant leaves (see rooms.js),
//   * binary frames (preview/shutter JPEGs) are forwarded byte-for-byte without being
//     parsed or logged.
//
// That is the entire privacy model: relay-only, no persistence, no accounts.
//
//   npm install && npm start     ->  http://localhost:8765
//
// Env: PORT (default 8765), HOST (default 0.0.0.0 so phones on the LAN can join).

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

import { createRooms } from './rooms.js'

const PORT = Number(process.env.PORT) || 8765
const HOST = process.env.HOST || '0.0.0.0'
const WEB_ROOT = fileURLToPath(new URL('../web', import.meta.url))

const MAX_BINARY = 1_000_000 // 1 MB is far above any frame we send
const MAX_TEXT = 4_096
const MAX_MSG_PER_SEC = 60
const MAX_JOINS_PER_MIN = 20

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

const RESERVED = new Set(['join', 'leave', 'ping'])

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

// ---- static files -----------------------------------------------------------

async function serveStatic(req, res) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }
  if (pathname === '/') pathname = '/index.html'

  const filePath = normalize(join(WEB_ROOT, pathname))
  if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + sep)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const data = await readFile(filePath)
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}

// ---- server + relay ---------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ...rooms.stats() }))
    return
  }
  await serveStatic(req, res)
})

const rooms = createRooms({ maxPerRoom: 2 })
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1_500_000 })

let nextId = 1

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
}

function broadcast(peers, obj) {
  for (const peer of peers) send(peer, obj)
}

wss.on('connection', (ws) => {
  const id = `p${nextId++}`
  ws.vynt = { id, joins: 0, windowStart: Date.now(), msgs: 0 }

  log('+', id)
  send(ws, { type: 'welcome', id })

  ws.on('message', (data, isBinary) => {
    // Light abuse guard: a friend-link relay, not a public pipe.
    const now = Date.now()
    if (now - ws.vynt.windowStart > 60_000) {
      ws.vynt.windowStart = now
      ws.vynt.msgs = 0
    }
    ws.vynt.msgs += 1
    if (ws.vynt.msgs > MAX_MSG_PER_SEC) return

    if (isBinary) {
      if (data.length > MAX_BINARY) return
      for (const peer of rooms.roommates(ws)) {
        if (peer.readyState === peer.OPEN) peer.send(data, { binary: true })
      }
      return
    }

    const text = data.toString()
    if (text.length > MAX_TEXT) return
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' })
      return
    }

    if (msg.type === 'join') {
      if (now - (ws.vynt.joinWindowStart || 0) > 60_000) {
        ws.vynt.joinWindowStart = now
        ws.vynt.joins = 0
      }
      ws.vynt.joins += 1
      if (ws.vynt.joins > MAX_JOINS_PER_MIN) return

      const roomId = String(msg.room || '').toUpperCase()
      if (!/^[A-Z0-9]{4,12}$/.test(roomId)) {
        send(ws, { type: 'join-error', reason: 'bad-room' })
        return
      }

      const result = rooms.join(roomId, ws)
      if (!result.ok) {
        send(ws, { type: 'join-error', reason: result.reason })
        return
      }
      send(ws, { type: 'joined', room: roomId, id, peers: result.peers })
      broadcast(result.others, { type: 'peer-joined' })
      log('+', id, '-> room', roomId, `(${result.peers}/2)`)
      return
    }

    if (msg.type === 'leave') {
      const left = rooms.leave(ws)
      if (left) {
        broadcast(left.others, { type: 'peer-left' })
        log('-', id, '<- room', left.roomId)
      }
      return
    }

    // Everything else (countdown, clear, ...) is forwarded to the room verbatim,
    // tagged with the sender's server-assigned id.
    const peers = rooms.roommates(ws)
    if (peers.length === 0) return
    const out = JSON.stringify({ ...msg, from: id })
    for (const peer of peers) {
      if (peer.readyState === peer.OPEN) peer.send(out)
    }
  })

  ws.on('close', () => {
    const left = rooms.leave(ws)
    log('-', id, left ? `<- room ${left.roomId}` : '')
    if (left) broadcast(left.others, { type: 'peer-left' })
  })

  ws.on('error', () => ws.close())
})

server.listen(PORT, HOST, () => {
  log(`vynt together relay listening on http://${HOST}:${PORT}`)
})
