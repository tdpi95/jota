import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FrontmatterParseError, parseFrontmatter } from './frontmatter.js';
import { parseJournalFile } from './journal.js';
import { parseNoteFile } from './note.js';

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

// Frontmatter that isn't valid YAML (a leftover git conflict, a hand-edit
// typo) must fail the same way on every read. gray-matter's own cache used
// to make only the *first* parse throw and every later one silently return
// `data: {}` with the whole file as the body — which the app then rendered
// as a blank note and could have saved back over the real frontmatter.
const CONFLICTED = "---\ntitle: 'Broken'\n<<<<<<< HEAD\nupdated: '2026-09-26T16:50:24.653Z'\n=======\nupdated: '2026-09-26T11:26:02.123Z'\n>>>>>>> parent of f3c6a7b\n---\nbody\n";

test('parseFrontmatter throws a 422 FrontmatterParseError on invalid YAML, every time', () => {
  for (let i = 0; i < 3; i++) {
    assert.throws(
      () => parseFrontmatter(CONFLICTED),
      (err: Error & { statusCode?: number }) => err instanceof FrontmatterParseError && err.statusCode === 422 && /conflict markers/.test(err.message),
    );
  }
});

test('parseNoteFile / parseJournalFile coerce wrong-shaped fields instead of passing them through', () => {
  const note = parseNoteFile('---\ntitle: 2026\ntags: solo\n---\nbody\n');
  assert.equal(note.frontmatter.title, '2026');
  assert.deepEqual(note.frontmatter.tags, []);
  assert.equal(note.frontmatter.created, '');
  const entry = parseJournalFile("---\ndate: '2026-09-25'\ntags: [a, 1]\n---\nhi\n");
  assert.deepEqual(entry.frontmatter.tags, ['a', '1']);
  assert.deepEqual(entry.frontmatter.linkedTasks, []);
});
