// The booth pipeline: camera -> cover-crop -> pixelation -> Vynt filter -> date stamp.
//
// The filter mathematics in filters.js are the verbatim VYNT port (see LICENSE). What
// this file adds is just plumbing: one filtered draw shared by the live preview, the
// low-res preview frames we send to the partner, and the full-res shutter captures.

import { applyPreset, drawTimestamp, getEffectivePixelSize } from './filters.js'
import { getFisheyeLut } from './fisheyeLut.js'
import { computeCoverCrop } from './layout.js'

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

export function createBooth({ video }) {
  const settings = {
    filterMode: 'vyntage',
    grain: 34,
    pixelSize: 3,
    stamp: true,
    mirror: true,
  }

  // The pixel loop runs at reduced size and is scaled back up with smoothing off --
  // that IS the pixelation look, and it is also the cheapest render we can do.
  const work = document.createElement('canvas')
  const workCtx = work.getContext('2d', { willReadFrequently: true })

  function drawFiltered(ctx, width, height) {
    if (!video || !video.videoWidth || !video.videoHeight) return
    const px = Math.max(1, Math.round(settings.pixelSize))
    const w = Math.max(2, Math.round(width / px))
    const h = Math.max(2, Math.round(height / px))
    if (work.width !== w || work.height !== h) {
      work.width = w
      work.height = h
    }

    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720
    const rect = computeCoverCrop(vw, vh, w, h, 1)

    workCtx.save()
    if (settings.mirror) {
      workCtx.translate(w, 0)
      workCtx.scale(-1, 1)
    }
    workCtx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h)
    workCtx.restore()

    applyPreset(workCtx, w, h, settings.filterMode, settings.grain, getFisheyeLut(w, h))

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(work, 0, 0, w, h, 0, 0, width, height)
    ctx.imageSmoothingEnabled = true

    if (settings.stamp) drawTimestamp(ctx, width, height, new Date(), 'bottom-right')
  }

  function renderTo(canvas, width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    drawFiltered(canvas.getContext('2d'), width, height)
  }

  async function toJpegBlob(width, height, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    drawFiltered(canvas.getContext('2d'), width, height)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  }

  return {
    settings,
    renderTo,
    /** Small, slow-cadence frame so each partner sees the other's viewfinder. */
    previewBlob: () => toJpegBlob(288, 162, 0.55),
    /** The photo itself: full resolution, full quality. */
    snapshotBlob: () => toJpegBlob(1280, 720, 0.85),
  }
}
