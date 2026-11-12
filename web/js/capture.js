// The feed renderer: raw video in, filtered canvas out.
//
// Live video travels as the raw camera track (see app.js), which the media pipeline
// keeps alive even in hidden tabs, exactly like a video call. Filtering happens here,
// at display time, per pane, in a Web Worker so it never blocks the UI. The same
// renderer draws the local viewfinder and the partner's feed. Preview JPEGs and
// shutter captures are derived from the same pipeline.

import { drawScene } from './render.js'

export const FILTERS = [
  { id: 'original', label: 'ORIGINAL' },
  { id: 'vyntage', label: 'VYNTAGE' },
  { id: 'digicam', label: '2007 DIGICAM' },
  { id: 'nightflash', label: 'NIGHT FLASH' },
  { id: 'neoncity', label: 'NEON CITY' },
  { id: 'fisheye', label: 'FISHEYE' },
  { id: 'vhs', label: 'VHS TAPE' },
  { id: 'goldenfilm', label: 'GOLDEN FILM' },
]

const LIVE_W = 480
const LIVE_H = 270
const PREVIEW_W = 384
const PREVIEW_H = 216
const SNAP_W = 1280
const SNAP_H = 720

function jpegBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/** Cover-resize the current source frame to roughly LIVE_W x LIVE_H during the grab,
 * so a 720p feed costs the same as a webcam: no full-size copy, no jank. */
function grabLiveFrame(video) {
  const scale = Math.max(LIVE_W / video.videoWidth, LIVE_H / video.videoHeight)
  return createImageBitmap(video, {
    resizeWidth: Math.max(LIVE_W, Math.round(video.videoWidth * scale)),
    resizeHeight: Math.max(LIVE_H, Math.round(video.videoHeight * scale)),
    resizeQuality: 'low',
  })
}

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.video source (camera element or remote feed)
 * @param {HTMLCanvasElement} options.canvas where the filtered frames land
 * @param {object} options.settings shared, mutable filter settings
 */
export function createFeed({ video, canvas, settings }) {
  canvas.width = LIVE_W
  canvas.height = LIVE_H
  const ctx = canvas.getContext('2d')

  // Derived preview surface: reused, so the fallback frame sends cost one blit and one
  // JPEG encode, never another filter pass.
  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = PREVIEW_W
  previewCanvas.height = PREVIEW_H
  const previewCtx = previewCanvas.getContext('2d')

  let worker = null
  let workerReady = false
  let workerFailed = false
  let pending = false
  let disposed = false
  let nextSnapId = 1
  const snapWaiters = new Map()

  function failWorker() {
    workerFailed = true
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      worker = null
    }
    workerReady = false
    pending = false
    for (const [, waiter] of snapWaiters) waiter(null)
    snapWaiters.clear()
  }

  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker('/js/filter.worker.js', { type: 'module' })
      worker.onmessage = (event) => {
        const message = event.data
        if (!message) return
        if (message.type === 'ready') {
          workerReady = true
        } else if (message.type === 'rendered') {
          pending = false
          if (message.bitmap) {
            ctx.drawImage(message.bitmap, 0, 0)
            message.bitmap.close()
          }
        } else if (message.type === 'snapshot') {
          const waiter = snapWaiters.get(message.id)
          snapWaiters.delete(message.id)
          if (waiter) waiter(message.bitmap)
        } else if (message.type === 'error') {
          failWorker()
        }
      }
      worker.onerror = () => failWorker()
      worker.postMessage({ type: 'init' })
    } catch (error) {
      worker = null
    }
  }

  function ready() {
    return !disposed && video && video.videoWidth > 0 && video.videoHeight > 0
  }

  /** Called from the render loop at ~30 fps. No-ops while the source has no frames. */
  function frame() {
    if (!ready()) return

    if (worker && workerReady && !workerFailed) {
      if (pending) return
      pending = true
      grabLiveFrame(video).then(
        (bitmap) => {
          if (disposed || !worker) {
            bitmap.close()
            pending = false
            return
          }
          try {
            worker.postMessage({ type: 'frame', bitmap, settings: { ...settings } }, [bitmap])
          } catch (error) {
            pending = false
            failWorker()
          }
        },
        () => {
          pending = false
        }
      )
      return
    }

    // Main-thread fallback (worker unavailable or crashed).
    drawScene(ctx, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height, settings)
  }

  /** Small JPEG for the fallback frame stream: downscaled from the rendered frame. */
  function previewBlob() {
    previewCtx.drawImage(canvas, 0, 0, PREVIEW_W, PREVIEW_H)
    return jpegBlob(previewCanvas, 0.65)
  }

  /** The photo itself: full-size filtered capture from the live source. */
  async function snapshotBlob() {
    if (!ready()) throw new Error('camera not ready')

    if (worker && workerReady && !workerFailed) {
      const bitmap = await createImageBitmap(video)
      const id = nextSnapId
      nextSnapId += 1
      const out = await new Promise((resolve) => {
        snapWaiters.set(id, resolve)
        setTimeout(() => {
          if (snapWaiters.has(id)) {
            snapWaiters.delete(id)
            resolve(null)
          }
        }, 4000)
        try {
          worker.postMessage({ type: 'snapshot', id, bitmap, outW: SNAP_W, outH: SNAP_H, settings: { ...settings } }, [bitmap])
        } catch (error) {
          snapWaiters.delete(id)
          failWorker()
          resolve(null)
        }
      })
      if (out) {
        const snap = document.createElement('canvas')
        snap.width = SNAP_W
        snap.height = SNAP_H
        snap.getContext('2d').drawImage(out, 0, 0)
        out.close()
        return jpegBlob(snap, 0.85)
      }
      // fall through to the main-thread path on timeout or worker failure
    }

    const snap = document.createElement('canvas')
    snap.width = SNAP_W
    snap.height = SNAP_H
    drawScene(snap.getContext('2d'), video, video.videoWidth, video.videoHeight, SNAP_W, SNAP_H, settings)
    return jpegBlob(snap, 0.85)
  }

  function dispose() {
    disposed = true
    failWorker()
  }

  return {
    settings,
    frame,
    previewBlob,
    snapshotBlob,
    dispose,
    get usingWorker() {
      return Boolean(worker && workerReady && !workerFailed)
    },
  }
}
