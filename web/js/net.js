// Thin WebSocket wrapper with slow auto-reconnect (a demo dies when one laptop lid
// closes and the socket silently drops). The app re-joins its room on every open.

import { decodeFrame } from './codec.js'

export function createNet({ url, handlers }) {
  let ws = null
  let closed = false
  let retry = 0
  let timer = null

  function connect() {
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      retry = 0
      handlers.onStatus('open')
    }

    ws.onclose = () => {
      if (closed) return // deliberate close: nobody needs a "reconnecting" status
      handlers.onStatus('closed')
      if (!closed) {
        const delay = Math.min(10_000, 1_000 * 2 ** retry)
        retry += 1
        timer = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      // onclose follows; reconnect lives there.
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        handlers.onControl(msg)
        return
      }
      const frame = decodeFrame(ev.data)
      if (frame) handlers.onFrame(frame)
    }
  }

  connect()

  return {
    send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
    },
    sendBinary(bytes) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(bytes)
    },
    get connected() {
      return Boolean(ws && ws.readyState === WebSocket.OPEN)
    },
    close() {
      closed = true
      clearTimeout(timer)
      if (ws) ws.close()
    },
  }
}
