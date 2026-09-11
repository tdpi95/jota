import assert from 'node:assert/strict';
import { test } from 'node:test';

import { didYouMean } from './didYouMean.js';

test('finds a close match within a small edit distance', () => {
  assert.deepEqual(didYouMean('wbsite-redesign', ['website-redesign', 'ops']), ['website-redesign']);
});

test('returns nothing when no candidate is actually close', () => {
  assert.deepEqual(didYouMean('website-redesign', ['ops', 'marketing-plan']), []);
});

test('sorts closest first and caps at max', () => {
  const result = didYouMean('ops', ['op', 'opts', 'ops2', 'unrelated'], 2);
  assert.equal(result.length, 2);
  assert.equal(result[0], 'op'); // distance 1, closest
});
