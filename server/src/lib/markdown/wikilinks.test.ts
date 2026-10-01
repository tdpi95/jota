import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyWikilinkTarget, extractWikilinks } from './wikilinks.js';

test('extractWikilinks finds targets, strips labels, trims, and dedupes', () => {
  const text = 'See [[reading-list|Reading list]], [[ t_a1b2c3 ]] and [[2026-09-30]] — again [[reading-list]].';
  assert.deepEqual(extractWikilinks(text), ['reading-list', 't_a1b2c3', '2026-09-30']);
});

test('extractWikilinks ignores code spans, fenced blocks, and malformed links', () => {
  const text = ['`[[inline]]`', '```', '[[fenced]]', '```', '[[ ]] [[a\nb]] [unclosed]] [[real]]'].join('\n');
  assert.deepEqual(extractWikilinks(text), ['real']);
  assert.deepEqual(extractWikilinks(null), []);
});

test('classifyWikilinkTarget tells tasks, dates and notes apart', () => {
  assert.equal(classifyWikilinkTarget('t_a1b2c3d4'), 'task');
  assert.equal(classifyWikilinkTarget('2026-09-30'), 'journal');
  assert.equal(classifyWikilinkTarget('Reading list'), 'note');
});
