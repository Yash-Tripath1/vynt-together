import test from 'node:test'
import assert from 'node:assert/strict'

import { layoutCollage } from '../web/js/collage.js'

test('zero photos gives a degenerate but safe layout', () => {
  const l = layoutCollage(0)
  assert.equal(l.tiles.length, 0)
  assert.equal(l.rows, 0)
  assert.equal(l.width, 0)
})

test('every tile is inside the canvas and never overlaps a neighbour', () => {
  for (let n = 1; n <= 14; n += 1) {
    const l = layoutCollage(n)
    assert.equal(l.tiles.length, n, `count ${n}`)
    for (const t of l.tiles) {
      assert.ok(t.x >= 0 && t.y >= 0, `tile starts inside (${n})`)
      assert.ok(t.x + t.w <= l.width, `tile fits horizontally (${n})`)
      assert.ok(t.y + t.h <= l.height - l.footer, `tile fits above footer (${n})`)
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = l.tiles[i]
        const b = l.tiles[j]
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        assert.ok(!overlap, `tiles ${i} and ${j} overlap at count ${n}`)
      }
    }
  }
})

test('grid columns step up sensibly with the photo count', () => {
  assert.equal(layoutCollage(1).cols, 1)
  assert.equal(layoutCollage(2).cols, 2)
  assert.equal(layoutCollage(6).cols, 2)
  assert.equal(layoutCollage(7).cols, 3)
  assert.equal(layoutCollage(13).cols, 4)
})

test('footer always sits below the last row', () => {
  for (const n of [1, 2, 5, 9, 14]) {
    const l = layoutCollage(n)
    const lastRowBottom = Math.max(...l.tiles.map((t) => t.y + t.h))
    assert.ok(l.height - l.footer >= lastRowBottom, `footer clear at count ${n}`)
  }
})
