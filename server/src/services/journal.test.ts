import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getHistory } from '../lib/vaultGit.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { getJournalEntry, linkTask, listJournalYear, listJournalYearFull, putJournalEntry, unlinkTask } from './journal.js';

// Mirrors PLAN.md milestone 8's verify step: file, index, and git history
// agree after add/remove.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poco-journal-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'journal'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('getJournalEntry returns a default unpersisted entry when the file does not exist', () => {
  const ws = scratchWorkspace();
  const entry = getJournalEntry(ws, '2026', '2026-09-10');

  assert.deepEqual(entry, { date: '2026-09-10', frontmatter: { date: '2026-09-10', tags: [], linkedTasks: [] }, body: '' });
  assert.ok(!fs.existsSync(path.join(ws, 'journal', '2026', '2026-09-10.md')));
  assert.deepEqual(getHistory(ws), []);
});

test('getJournalEntry rejects a year that does not match the date', () => {
  const ws = scratchWorkspace();
  assert.throws(() => getJournalEntry(ws, '2025', '2026-09-10'), /does not match/);
});

test('putJournalEntry creates the file, indexes it, and commits', () => {
  const ws = scratchWorkspace();
  const entry = putJournalEntry(ws, '2026', '2026-09-10', { body: 'Shipped the redesign draft.', tags: ['work'] });

  assert.equal(entry.body, 'Shipped the redesign draft.');
  assert.deepEqual(entry.frontmatter.tags, ['work']);

  const onDisk = fs.readFileSync(path.join(ws, 'journal', '2026', '2026-09-10.md'), 'utf8');
  assert.match(onDisk, /Shipped the redesign draft\./);
  assert.equal(getHistory(ws)[0].message, '[api] upsert_journal_entry 2026-09-10');
});

test('putJournalEntry only replaces the fields given, keeping the rest', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-09-10', { body: 'first', tags: ['work'], linkedTasks: ['t_aaaaaa'] });

  const updated = putJournalEntry(ws, '2026', '2026-09-10', { body: 'second' });
  assert.equal(updated.body, 'second');
  assert.deepEqual(updated.frontmatter.tags, ['work']);
  assert.deepEqual(updated.frontmatter.linkedTasks, ['t_aaaaaa']);
});

test('putJournalEntry dedupes linkedTasks', () => {
  const ws = scratchWorkspace();
  const entry = putJournalEntry(ws, '2026', '2026-09-10', { linkedTasks: ['t_aaaaaa', 't_bbbbbb', 't_aaaaaa'] });
  assert.deepEqual(entry.frontmatter.linkedTasks, ['t_aaaaaa', 't_bbbbbb']);
});

test('linkTask auto-creates the day file, is idempotent, and unlinkTask removes it', () => {
  const ws = scratchWorkspace();
  assert.ok(!fs.existsSync(path.join(ws, 'journal', '2026', '2026-09-10.md')));

  const linked = linkTask(ws, '2026', '2026-09-10', 't_aaaaaa');
  assert.deepEqual(linked.frontmatter.linkedTasks, ['t_aaaaaa']);
  assert.ok(fs.existsSync(path.join(ws, 'journal', '2026', '2026-09-10.md')));
  assert.equal(getHistory(ws)[0].message, '[api] link_task t_aaaaaa to 2026-09-10');

  // Idempotent: linking again does not duplicate or add a new commit.
  const linkedAgain = linkTask(ws, '2026', '2026-09-10', 't_aaaaaa');
  assert.deepEqual(linkedAgain.frontmatter.linkedTasks, ['t_aaaaaa']);
  assert.equal(getHistory(ws).length, 1);

  const unlinked = unlinkTask(ws, '2026', '2026-09-10', 't_aaaaaa');
  assert.deepEqual(unlinked.frontmatter.linkedTasks, []);
  assert.equal(getHistory(ws)[0].message, '[api] unlink_task t_aaaaaa from 2026-09-10');
});

test('unlinkTask on a nonexistent entry is a no-op, not an error', () => {
  const ws = scratchWorkspace();
  const result = unlinkTask(ws, '2026', '2026-09-10', 't_aaaaaa');
  assert.deepEqual(result.frontmatter.linkedTasks, []);
  assert.ok(!fs.existsSync(path.join(ws, 'journal', '2026', '2026-09-10.md')));
});

test('listJournalYear reads summaries from the index, scoped to the given year', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-09-10', { body: 'entry one', tags: ['a'] });
  putJournalEntry(ws, '2026', '2026-01-01', { body: '' }); // empty body -> hasBody: false
  putJournalEntry(ws, '2025', '2025-12-31', { body: 'last year' });

  const entries = listJournalYear(ws, '2026');
  assert.deepEqual(
    entries.map((e) => e.date),
    ['2026-01-01', '2026-09-10'],
  );
  assert.equal(entries.find((e) => e.date === '2026-01-01')?.hasBody, false);
  assert.equal(entries.find((e) => e.date === '2026-09-10')?.hasBody, true);
});

test('listJournalYearFull reads bodies straight off disk, scoped to the given year', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-09-10', { body: 'entry one', tags: ['a'] });
  putJournalEntry(ws, '2026', '2026-01-01', { body: '' }); // empty body -> hasBody: false
  putJournalEntry(ws, '2025', '2025-12-31', { body: 'last year' });

  const entries = listJournalYearFull(ws, '2026');
  assert.deepEqual(
    entries.map((e) => e.date),
    ['2026-01-01', '2026-09-10'],
  );
  const jan1 = entries.find((e) => e.date === '2026-01-01')!;
  assert.equal(jan1.hasBody, false);
  // Round-tripped through the serializer, an empty body reads back as a
  // lone trailing newline rather than '' — the same reason hasBody itself
  // is computed off `.trim().length > 0`, not a plain emptiness check.
  assert.equal(jan1.body.trim(), '');
  const sep10 = entries.find((e) => e.date === '2026-09-10')!;
  assert.equal(sep10.hasBody, true);
  assert.equal(sep10.body.trim(), 'entry one');
  assert.deepEqual(sep10.tags, ['a']);
});

test('listJournalYearFull returns an empty array for a year with no journal folder yet', () => {
  const ws = scratchWorkspace();
  assert.deepEqual(listJournalYearFull(ws, '2030'), []);
});
