import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldOffer } from '../web/js/rtc.js'

test('exactly one side of a pair offers', () => {
  assert.equal(shouldOffer('p1', 'p2'), true)
  assert.equal(shouldOffer('p2', 'p1'), false)
})

test('the election is symmetric for any pair', () => {
  for (const [a, b] of [['p3', 'p7'], ['p10', 'p9'], ['abc', 'abd']]) {
    assert.notEqual(shouldOffer(a, b), shouldOffer(b, a), `${a}/${b}`)
  }
})

test('missing ids never offer (no glare from half-knowledge)', () => {
  assert.equal(shouldOffer('p1', null), false)
  assert.equal(shouldOffer(null, 'p2'), false)
  assert.equal(shouldOffer('', ''), false)
})
