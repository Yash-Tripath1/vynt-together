// The booth render: source frame -> cover-crop -> pixelation -> VYNT filter -> stamp.
//
// Used by the filter worker (off the main thread, so filtering never blocks the UI or
// the WebRTC encoder) and by the main thread as a fallback. Everything here must work
// with either a document or a bare worker scope, so canvases are OffscreenCanvas when
// available.

import { applyPreset, drawTimestamp, getEffectivePixelSize } from './filters.js'
import { getFisheyeLut } from './fisheyeLut.js'
import { computeCoverCrop } from './layout.js'

function makeCanvas(width, height) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  canvas.width = width
  canvas.height = height
  return canvas
}

// One reduced-size work canvas per module instance (the worker and the main thread each
// get their own instance, so they cannot collide).
let work = null
let workCtx = null

export function drawScene(ctx, source, srcW, srcH, outW, outH, settings) {
  if (!srcW || !srcH) return

  const px = getEffectivePixelSize(Math.max(1, Math.round(settings.pixelSize || 1)))
  const w = Math.max(2, Math.round(outW / px))
  const h = Math.max(2, Math.round(outH / px))
  if (!work || work.width !== w || work.height !== h) {
    work = makeCanvas(w, h)
    workCtx = work.getContext('2d', { willReadFrequently: true })
  }

  const rect = computeCoverCrop(srcW, srcH, w, h, 1)
  workCtx.save()
  if (settings.mirror) {
    workCtx.translate(w, 0)
    workCtx.scale(-1, 1)
  }
  workCtx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h)
  workCtx.restore()

  applyPreset(workCtx, w, h, settings.filterMode, settings.grain, getFisheyeLut(w, h))

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(work, 0, 0, w, h, 0, 0, outW, outH)
  ctx.imageSmoothingEnabled = true

  if (settings.stamp) drawTimestamp(ctx, outW, outH, new Date(), 'bottom-right')
}
