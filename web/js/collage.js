// Collage assembly: a pure layout function (unit-tested) plus the canvas render that
// fills it. Both partners end up with every photo, so either side can make the collage.

import { computeCoverCrop } from './layout.js'

const TILE_W = 400
const TILE_H = 300
const GUTTER = 12
const FOOTER_H = 64

/** Pure geometry: where does photo i of n sit on the canvas?
 *  2 photos: a portrait pair side by side.
 *  3 photos: one tall hero beside two stacked cards.
 *  4 photos: a clean 2x2 quad.
 *  1 or 5+: an even grid. */
export function layoutCollage(count, { tileW = TILE_W, tileH = TILE_H, gutter = GUTTER, footer = FOOTER_H } = {}) {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return { width: 0, height: 0, tiles: [], footer, cols: 0, rows: 0 }

  if (n === 2) {
    const w = Math.round(tileW * 0.95)
    const h = Math.round((w * 4) / 3)
    return {
      width: 2 * w + 3 * gutter,
      height: h + 2 * gutter + footer,
      tiles: [
        { x: gutter, y: gutter, w, h },
        { x: 2 * gutter + w, y: gutter, w, h },
      ],
      footer,
      cols: 2,
      rows: 1,
    }
  }

  if (n === 3) {
    const smallW = Math.round(tileW * 0.85)
    const smallH = Math.round(tileH * 0.91)
    const bigW = Math.round(tileW * 1.1)
    const bigH = 2 * smallH + gutter
    return {
      width: bigW + smallW + 3 * gutter,
      height: bigH + 2 * gutter + footer,
      tiles: [
        { x: gutter, y: gutter, w: bigW, h: bigH },
        { x: 2 * gutter + bigW, y: gutter, w: smallW, h: smallH },
        { x: 2 * gutter + bigW, y: 2 * gutter + smallH, w: smallW, h: smallH },
      ],
      footer,
      cols: 2,
      rows: 2,
    }
  }

  if (n === 4) {
    const w = Math.round(tileW * 0.95)
    const h = Math.round((w * 3) / 4)
    return {
      width: 2 * w + 3 * gutter,
      height: 2 * h + 3 * gutter + footer,
      tiles: [
        { x: gutter, y: gutter, w, h },
        { x: 2 * gutter + w, y: gutter, w, h },
        { x: gutter, y: 2 * gutter + h, w, h },
        { x: 2 * gutter + w, y: 2 * gutter + h, w, h },
      ],
      footer,
      cols: 2,
      rows: 2,
    }
  }

  const cols = n <= 1 ? 1 : n <= 6 ? 2 : n <= 12 ? 3 : 4
  const rows = Math.ceil(n / cols)

  const width = cols * tileW + (cols + 1) * gutter
  const height = rows * tileH + (rows + 1) * gutter + footer

  const tiles = []
  for (let i = 0; i < n; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    tiles.push({
      x: gutter + col * (tileW + gutter),
      y: gutter + row * (tileH + gutter),
      w: tileW,
      h: tileH,
    })
  }
  return { width, height, tiles, footer, cols, rows }
}

export async function renderCollage(canvas, photos, { date = new Date() } = {}) {
  const layout = layoutCollage(photos.length)
  canvas.width = Math.max(1, layout.width)
  canvas.height = Math.max(1, layout.height)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#12100c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let i = 0; i < photos.length; i += 1) {
    const tile = layout.tiles[i]
    const photo = photos[i]
    let bitmap
    try {
      bitmap = await createImageBitmap(photo.blob)
    } catch {
      continue
    }
    const rect = computeCoverCrop(bitmap.width, bitmap.height, tile.w, tile.h, 1)
    ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, tile.x, tile.y, tile.w, tile.h)
    bitmap.close()

    ctx.strokeStyle = photo.who === 'me' ? '#ffb454' : '#7fd7ff'
    ctx.lineWidth = 3
    ctx.strokeRect(tile.x + 1.5, tile.y + 1.5, tile.w - 3, tile.h - 3)
  }

  const footY = canvas.height - layout.footer
  ctx.fillStyle = '#ffb454'
  ctx.font = 'bold 22px ui-monospace, "Courier New", monospace'
  ctx.textBaseline = 'middle'
  ctx.fillText('VYNT TOGETHER', GUTTER, footY + layout.footer / 2 - 12)
  ctx.fillStyle = '#a08e72'
  ctx.font = '16px ui-monospace, "Courier New", monospace'
  ctx.fillText(
    `${photos.length} PHOTOS · ${date.toISOString().slice(0, 10)} · amber = me · blue = them`,
    GUTTER,
    footY + layout.footer / 2 + 14
  )
  return canvas
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }, 'image/png')
}
