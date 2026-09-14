import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFrontmatter } from './frontmatter.js';

// Regression test: an unquoted YYYY-MM-DD frontmatter value (exactly how a
// human hand-editing the file would naturally type it — see CLAUDE.md
// "Markdown files must stay hand-editable") is auto-converted by js-yaml
// into a native Date per the YAML 1.1 spec. Every date field in our
// frontmatter schemas is declared as a plain string, and a stray Date object
// can't be bound as a SQLite parameter downstream (lib/index/reindex.ts) —
// so parseFrontmatter must always normalize these back to strings.

test('unquoted YYYY-MM-DD frontmatter values parse as strings, not Date objects', () => {
  const content = ['---', 'name: Website Redesign', 'created: 2026-09-10', 'archived: false', '---', 'body'].join(
    '\n',
  );
  const { data } = parseFrontmatter<{ name: string; created: string; archived: boolean }>(content);
  assert.equal(typeof data.created, 'string');
  assert.equal(data.created, '2026-09-10');
});

test('quoted date-shaped frontmatter values are unaffected', () => {
  const content = ['---', "created: '2026-09-10'", '---', 'body'].join('\n');
  const { data } = parseFrontmatter<{ created: string }>(content);
  assert.equal(data.created, '2026-09-10');
});

test('normalizes Date values nested in arrays', () => {
  const content = ['---', 'dates:', '  - 2026-09-10', '  - 2026-09-11', '---', 'body'].join('\n');
  const { data } = parseFrontmatter<{ dates: string[] }>(content);
  assert.deepEqual(data.dates, ['2026-09-10', '2026-09-11']);
});

// Regression test for NoteFrontmatter's created/updated: these are full
// ISO8601 timestamps, not bare dates, and the same unquoted-scalar
// auto-Date-coercion applies to them too. Slicing unconditionally to
// YYYY-MM-DD (the original fix, written before any frontmatter field needed
// a time-of-day) would silently drop it.
test('an unquoted full ISO8601 timestamp keeps its time-of-day, not just the date', () => {
  const content = ['---', 'created: 2026-09-10T09:15:00.000Z', '---', 'body'].join('\n');
  const { data } = parseFrontmatter<{ created: string }>(content);
  assert.equal(data.created, '2026-09-10T09:15:00.000Z');
});

test('an unquoted timestamp that lands exactly on UTC midnight still normalizes to a bare date', () => {
  const content = ['---', 'created: 2026-09-10T00:00:00.000Z', '---', 'body'].join('\n');
  const { data } = parseFrontmatter<{ created: string }>(content);
  assert.equal(data.created, '2026-09-10');
});
