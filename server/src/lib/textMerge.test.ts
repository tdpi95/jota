import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffHunks, diffLines, joinLines, merge2, merge3, splitLines, type MergeChunk } from './textMerge.js';

function applyOps(a: string[], b: string[]): { old: string[]; new: string[] } {
  const ops = diffLines(a, b);
  return {
    old: ops.filter((o) => o.type !== 'insert').map((o) => o.text),
    new: ops.filter((o) => o.type !== 'delete').map((o) => o.text),
  };
}

function render(chunks: MergeChunk[]): string {
  return joinLines(chunks.flatMap((c) => (c.kind === 'ok' ? c.lines : ['<<<', ...c.local, '===', ...c.remote, '>>>'])));
}

test('splitLines/joinLines round-trip, including a trailing newline', () => {
  for (const s of ['', 'a', 'a\n', 'a\nb', 'a\n\nb\n']) assert.equal(joinLines(splitLines(s)), s);
});

test('diffLines reproduces both inputs and finds a minimal script', () => {
  const cases: [string[], string[]][] = [
    [[], []],
    [['a'], []],
    [[], ['a']],
    [['a', 'b', 'c'], ['a', 'x', 'c']],
    [['a', 'b', 'c', 'a', 'b', 'b', 'a'], ['c', 'b', 'a', 'b', 'a', 'c']],
    [['1', '2', '3', '4', '5'], ['0', '1', '3', '5', '6']],
  ];
  for (const [a, b] of cases) {
    assert.deepEqual(applyOps(a, b), { old: a, new: b });
  }
  const edits = diffLines(['a', 'b', 'c', 'a', 'b', 'b', 'a'], ['c', 'b', 'a', 'b', 'a', 'c']).filter((o) => o.type !== 'equal');
  assert.equal(edits.length, 5); // the classic Myers-paper example: D = 5
});

test('diffHunks reports changes with context and 1-based line numbers', () => {
  const oldText = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12'].join('\n');
  const newText = ['l1', 'L2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12', 'l13'].join('\n');
  const hunks = diffHunks(oldText, newText, 2);
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0], {
    oldStart: 1,
    newStart: 1,
    lines: [
      { type: ' ', text: 'l1' },
      { type: '-', text: 'l2' },
      { type: '+', text: 'L2' },
      { type: ' ', text: 'l3' },
      { type: ' ', text: 'l4' },
    ],
  });
  assert.deepEqual(hunks[1], {
    oldStart: 11,
    newStart: 11,
    lines: [
      { type: ' ', text: 'l11' },
      { type: ' ', text: 'l12' },
      { type: '+', text: 'l13' },
    ],
  });
  assert.deepEqual(diffHunks('same\n', 'same\n'), []);
});

test('diffHunks merges nearby changes into one hunk', () => {
  const hunks = diffHunks('a\nb\nc\nd\ne', 'A\nb\nc\nd\nE', 3);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].lines.length, 7);
});

test('merge3 combines non-overlapping edits from both sides with no conflict', () => {
  const base = '- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n';
  const local = '- [x] one\n- [ ] two\n- [ ] three\n- [ ] four\n';
  const remote = '- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n- [ ] five\n';
  const chunks = merge3(base, local, remote);
  assert.ok(chunks.every((c) => c.kind === 'ok'));
  assert.equal(render(chunks), '- [x] one\n- [ ] two\n- [ ] three\n- [ ] four\n- [ ] five\n');
});

test('merge3 takes an identical change on both sides once', () => {
  const chunks = merge3('a\nb\nc', 'a\nB\nc', 'a\nB\nc');
  assert.deepEqual(chunks, [{ kind: 'ok', lines: ['a', 'B', 'c'] }]);
});

test('merge3 surfaces overlapping edits as a conflict carrying all three versions', () => {
  const chunks = merge3('a\nb\nc', 'a\nlocal\nc', 'a\nremote\nc');
  assert.deepEqual(chunks, [
    { kind: 'ok', lines: ['a'] },
    { kind: 'conflict', local: ['local'], remote: ['remote'], base: ['b'] },
    { kind: 'ok', lines: ['c'] },
  ]);
});

test('merge3 treats different insertions at the same spot as a conflict', () => {
  const chunks = merge3('a\nz', 'a\nx\nz', 'a\ny\nz');
  assert.deepEqual(chunks, [
    { kind: 'ok', lines: ['a'] },
    { kind: 'conflict', local: ['x'], remote: ['y'], base: [] },
    { kind: 'ok', lines: ['z'] },
  ]);
});

test('merge3 handles one side deleting a line the other left alone', () => {
  assert.equal(render(merge3('a\nb\nc\nd', 'a\nc\nd', 'a\nb\nc\nD')), 'a\nc\nD');
});

test('merge2 keeps shared lines and marks every difference as a conflict', () => {
  const chunks = merge2('a\nlocal\nc\n', 'a\nremote\nc\n');
  assert.deepEqual(chunks, [
    { kind: 'ok', lines: ['a'] },
    { kind: 'conflict', local: ['local'], remote: ['remote'], base: null },
    { kind: 'ok', lines: ['c', ''] },
  ]);
});
