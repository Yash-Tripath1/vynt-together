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

test('two photos form a portrait pair side by side', () => {
  const l = layoutCollage(2)
  assert.equal(l.tiles.length, 2)
  const [a, b] = l.tiles
  assert.equal(a.y, b.y, 'same row')
  assert.ok(a.x + a.w < b.x, 'left then right')
  for (const t of l.tiles) assert.ok(t.h > t.w, 'portrait tiles')
})

test('three photos stack two cards beside a tall hero', () => {
  const l = layoutCollage(3)
  assert.equal(l.tiles.length, 3)
  const [hero, top, bottom] = l.tiles
  assert.ok(hero.h > top.h, 'hero taller than a card')
  assert.ok(hero.h > bottom.h, 'hero taller than a card')
  assert.equal(top.x, bottom.x, 'cards share a column')
  assert.ok(top.y + top.h < bottom.y, 'cards stack')
  assert.ok(hero.x + hero.w < top.x, 'hero left of cards')
})

test('four photos make a 2x2 quad of equal tiles', () => {
  const l = layoutCollage(4)
  assert.equal(l.tiles.length, 4)
  const xs = [...new Set(l.tiles.map((t) => t.x))]
  const ys = [...new Set(l.tiles.map((t) => t.y))]
  assert.equal(xs.length, 2, 'two columns')
  assert.equal(ys.length, 2, 'two rows')
  const sizes = new Set(l.tiles.map((t) => `${t.w}x${t.h}`))
  assert.equal(sizes.size, 1, 'all tiles the same size')
})

test('shape tiles respect the footer margin at 2, 3 and 4 photos', () => {
  for (const n of [2, 3, 4]) {
    const l = layoutCollage(n)
    const lastBottom = Math.max(...l.tiles.map((t) => t.y + t.h))
    assert.ok(l.height - l.footer >= lastBottom, `footer clear at count ${n}`)
  }
})
