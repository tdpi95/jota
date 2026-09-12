import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ensureGitRepo } from '../lib/workspaces.js';
import { getCalendarMonth } from './calendar.js';
import { linkTask, putJournalEntry } from './journal.js';
import { createProject } from './projects.js';
import { createTask } from './tasks.js';

// Mirrors PLAN.md milestone 9's verify step: curl (here, direct service
// calls), cross-checked by hand against the .md files.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poco-calendar-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('getCalendarMonth marks days with a non-empty journal entry, a due task, or a linked task', () => {
  const ws = scratchWorkspace();
  const project = createProject(ws, { name: 'Website Redesign' });
  const dueTask = createTask(ws, project.slug, { text: 'Ship it', due: '2026-09-15' });
  const linkedTask = createTask(ws, project.slug, { text: 'Write notes' });

  putJournalEntry(ws, '2026', '2026-09-10', { body: 'Wrote something today.' });
  putJournalEntry(ws, '2026', '2026-09-11', { body: '' }); // empty body: should NOT count as a journal mark
  linkTask(ws, '2026', '2026-09-12', linkedTask.id);

  const days = getCalendarMonth(ws, '2026', '09');
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));

  assert.equal(byDate['2026-09-10'].hasJournalEntry, true);
  assert.equal(byDate['2026-09-11'], undefined); // empty-body entry produces no mark at all

  assert.equal(byDate['2026-09-15'].tasks.length, 1);
  assert.equal(byDate['2026-09-15'].tasks[0].taskId, dueTask.id);
  assert.equal(byDate['2026-09-15'].tasks[0].reason, 'due');
  assert.equal(byDate['2026-09-15'].tasks[0].projectColor, project.frontmatter.color);
  assert.equal(byDate['2026-09-15'].tasks[0].text, 'Ship it');
  assert.equal(byDate['2026-09-15'].tasks[0].status, 'todo');

  assert.equal(byDate['2026-09-12'].tasks[0].taskId, linkedTask.id);
  assert.equal(byDate['2026-09-12'].tasks[0].reason, 'linked');
  assert.equal(byDate['2026-09-12'].tasks[0].text, 'Write notes');

  // Days outside the queried month are never returned.
  assert.ok(!('2026-10-01' in byDate));
});

test('a task both due and linked the same day is not double-counted', () => {
  const ws = scratchWorkspace();
  const project = createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, project.slug, { text: 'Ship it', due: '2026-09-15' });
  linkTask(ws, '2026', '2026-09-15', task.id);

  const days = getCalendarMonth(ws, '2026', '09');
  const day = days.find((d) => d.date === '2026-09-15')!;
  assert.equal(day.tasks.length, 1);
  assert.equal(day.tasks[0].reason, 'due'); // due is recorded first, linked is deduped against it
});

test('getCalendarMonth rejects malformed year/month', () => {
  const ws = scratchWorkspace();
  assert.throws(() => getCalendarMonth(ws, '26', '09'), /invalid year/);
  assert.throws(() => getCalendarMonth(ws, '2026', '13'), /invalid month/);
});
