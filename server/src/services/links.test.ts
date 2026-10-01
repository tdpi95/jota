import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ensureGitRepo } from '../lib/workspaces.js';
import { putJournalEntry } from './journal.js';
import { getBacklinks, resolveLinks } from './links.js';
import { createNote, updateNote } from './notes.js';
import { createProject } from './projects.js';
import { createTask, deleteTask, updateTask } from './tasks.js';

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-links-'));
  for (const sub of ['projects', 'journal', 'notes']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('backlinks connect journals, notes and tasks in every direction', () => {
  const ws = scratchWorkspace();
  const project = createProject(ws, { name: 'Work' });
  const task = createTask(ws, project.slug, { text: 'Fix login bug' });
  const note = createNote(ws, { title: 'Reading list', body: `Related: [[${task.id}|Fix login bug]]` });
  putJournalEntry(ws, '2026', '2026-09-30', { body: `Read [[${note.slug}|Reading list]] and did [[${task.id}]].` });
  updateTask(ws, project.slug, task.id, { description: 'Context in [[Reading list]] from [[2026-09-30]].' });

  // Task is linked from the note and the journal day.
  assert.deepEqual(
    getBacklinks(ws, 'task', task.id).map((r) => `${r.kind}:${r.id}`),
    ['journal:2026-09-30', `note:${note.slug}`],
  );
  // Note is linked by slug from the journal and by title from the task.
  assert.deepEqual(
    getBacklinks(ws, 'note', note.slug).map((r) => `${r.kind}:${r.id}`),
    ['journal:2026-09-30', `task:${task.id}`].sort(),
  );
  const fromTask = getBacklinks(ws, 'journal', '2026-09-30').find((r) => r.kind === 'task');
  assert.equal(fromTask?.title, 'Fix login bug');
  assert.equal(fromTask?.status, 'todo');
});

test('after a note rename, slug links and the new title resolve; the old title no longer does', () => {
  const ws = scratchWorkspace();
  const note = createNote(ws, { title: 'My ideas' });
  putJournalEntry(ws, '2026', '2026-09-30', { body: `[[${note.slug}]] and [[My ideas]]` });
  updateNote(ws, note.slug, { title: 'Big ideas' });
  assert.deepEqual(resolveLinks(ws, [note.slug, 'big IDEAS', 'My ideas']).map((l) => l.ref?.id ?? null), [note.slug, note.slug, null]);
  assert.equal(getBacklinks(ws, 'note', note.slug).length, 1);
});

test('resolveLinks reports dangling links and always resolves dates; deleting the source drops the backlink', () => {
  const ws = scratchWorkspace();
  const project = createProject(ws, { name: 'Work' });
  const task = createTask(ws, project.slug, { text: 'Task' });
  updateTask(ws, project.slug, task.id, { description: 'see [[2026-01-02]]' });
  const [missingNote, missingTask, date] = resolveLinks(ws, ['nope', 't_deadbeef', '2026-01-02']);
  assert.equal(missingNote.ref, null);
  assert.equal(missingTask.ref, null);
  assert.equal(date.ref?.kind, 'journal');
  assert.equal(getBacklinks(ws, 'journal', '2026-01-02').length, 1);
  deleteTask(ws, project.slug, task.id);
  assert.equal(getBacklinks(ws, 'journal', '2026-01-02').length, 0);
});

test('links inside code are not links, and bad input is rejected', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-09-30', { body: 'literal `[[Ideas]]`' });
  assert.equal(getBacklinks(ws, 'note', 'ideas').length, 0);
  assert.throws(() => getBacklinks(ws, 'bogus', 'x'), /invalid kind/);
  assert.throws(() => getBacklinks(ws, 'journal', 'nope'), /invalid date/);
});
