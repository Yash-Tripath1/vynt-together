// Filter worker: owns an OffscreenCanvas and does all per-pixel work off the main
// thread. The main thread hands over one raw camera frame at a time and gets back a
// filtered ImageBitmap to blit (and to feed the WebRTC track).
//
// Loaded as a module worker: new Worker(url, { type: 'module' }).

import { drawScene } from './render.js'

let frameCanvas = null
let frameCtx = null
let snapCanvas = null
let snapCtx = null

function ensureFrameCanvas(width, height) {
  if (!frameCanvas) {
    frameCanvas = new OffscreenCanvas(width, height)
    frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true })
  }
  return Boolean(frameCtx)
}

function ensureSnapCanvas(width, height) {
  if (!snapCanvas || snapCanvas.width !== width || snapCanvas.height !== height) {
    snapCanvas = new OffscreenCanvas(width, height)
    snapCtx = snapCanvas.getContext('2d', { willReadFrequently: true })
  }
  return Boolean(snapCtx)
}

self.onmessage = (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return

  try {
    if (message.type === 'init') {
      self.postMessage({ type: 'ready' })
      return
    }

    if (message.type === 'frame') {
      const bitmap = message.bitmap
      if (!bitmap) return
      const outW = 480
      const outH = 270
      if (!ensureFrameCanvas(outW, outH)) {
        bitmap.close()
        self.postMessage({ type: 'error', error: 'no 2d context' })
        return
      }
      drawScene(frameCtx, bitmap, bitmap.width, bitmap.height, outW, outH, message.settings)
      bitmap.close()
      const out = frameCanvas.transferToImageBitmap()
      self.postMessage({ type: 'rendered', bitmap: out }, [out])
      return
    }

    if (message.type === 'snapshot') {
      const bitmap = message.bitmap
      if (!bitmap) return
      const outW = message.outW || 1280
      const outH = message.outH || 720
      if (!ensureSnapCanvas(outW, outH)) {
        bitmap.close()
        self.postMessage({ type: 'error', error: 'no 2d context' })
        return
      }
      drawScene(snapCtx, bitmap, bitmap.width, bitmap.height, outW, outH, message.settings)
      bitmap.close()
      const out = snapCanvas.transferToImageBitmap()
      self.postMessage({ type: 'snapshot', id: message.id, bitmap: out }, [out])
      return
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: String((error && error.message) || error) })
  }
}
