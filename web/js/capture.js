// The camera: photos and fallback frames.
//
// Live video is shown as the raw decoded stream (see app.js), so nothing here touches
// the display anymore. This module exists for the two moments that still need the exact
// VYNT pixel pipeline: the shutter photo (full size, through the filter worker) and the
// fallback preview frames for when video cannot connect at all.

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

const PREVIEW_W = 384
const PREVIEW_H = 216
const SNAP_W = 1280
const SNAP_H = 720

function jpegBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.video the camera element
 * @param {object} options.settings shared, mutable filter settings
 */
export function createFeed({ video, settings }) {
  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = PREVIEW_W
  previewCanvas.height = PREVIEW_H

  let worker = null
  let workerReady = false
  let workerFailed = false
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

  /** Small JPEG for the fallback frame stream: rendered on demand at preview size. */
  function previewBlob() {
    if (!ready()) return Promise.resolve(null)
    drawScene(previewCanvas.getContext('2d'), video, video.videoWidth, video.videoHeight, PREVIEW_W, PREVIEW_H, settings)
    return jpegBlob(previewCanvas, 0.65)
  }

  /** The photo itself: full-size, exact VYNT pixels, through the worker when possible. */
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
    previewBlob,
    snapshotBlob,
    dispose,
    get usingWorker() {
      return Boolean(worker && workerReady && !workerFailed)
    },
  }
}
