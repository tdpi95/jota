import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { rebuildIndex } from '../lib/index/reindex.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { putJournalEntry } from './journal.js';
import { createNote } from './notes.js';
import { createProject } from './projects.js';
import { searchEverything } from './search.js';
import { createTask } from './tasks.js';

// Mirrors PLAN.md's "Search (cross-type full-text)" design (milestone 25):
// task description, note body, journal body, and project description are
// all matched — not just title/text/tags, which is all the pre-existing
// search_tasks/list_notes tools can see — and a date range narrows each type
// by its own natural date field.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-search-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('searchEverything matches task description, note body, and journal body — not just title/tags', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Infra' });
  const task = createTask(ws, 'infra', {
    text: 'Rotate VPN keys',
    description: "The bank's subnet is 10.20.0.0/16, peered via the office VPN.",
  });
  createNote(ws, { title: 'Vendor contacts', body: 'BankX support line and their subnet notes live here.' });
  putJournalEntry(ws, '2026', '2026-06-05', { body: 'Spent the afternoon debugging the BankX VPN subnet issue.' });

  const results = searchEverything(ws, { query: 'subnet' });
  const types = results.map((r) => r.type).sort();
  assert.deepEqual(types, ['journal', 'note', 'task']);

  const taskResult = results.find((r) => r.type === 'task');
  assert.ok(taskResult && taskResult.type === 'task');
  assert.equal(taskResult.task.id, task.id);
  assert.match(taskResult.snippet, /\*\*[Ss]ubnet\*\*/);
});

test('searchEverything also matches project name/description, not just task/note/journal', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Widget Warehouse', description: 'Tracks widget stock levels across all our sites.' });
  createProject(ws, { name: 'Unrelated' });

  const results = searchEverything(ws, { query: 'widget' });
  const projectResult = results.find((r) => r.type === 'project');
  assert.ok(projectResult && projectResult.type === 'project');
  assert.equal(projectResult.project.slug, 'widget-warehouse');
  assert.match(projectResult.snippet, /\*\*[Ww]idget\*\*/);

  const projectsOnly = searchEverything(ws, { query: 'widget', types: ['project'] });
  assert.equal(projectsOnly.length, 1);
  assert.equal(projectsOnly[0].type, 'project');
});

test('searchEverything matches a partial/prefix word, not just a whole word', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Vendor', body: 'Zagoo is our preferred logistics partner this quarter.' });
  createNote(ws, { title: 'Other', body: 'Completely unrelated content about something else.' });

  const results = searchEverything(ws, { query: 'zago' });
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'note');
  assert.match(results[0].snippet, /\*\*Zagoo\*\*/);
});

test('searchEverything is case-insensitive and matches a multi-word query as an AND of terms', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Ideas', body: 'A great idea about BankX onboarding flow.' });
  createNote(ws, { title: 'Other', body: 'Unrelated note about something else entirely.' });

  const results = searchEverything(ws, { query: 'bankx onboarding' });
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'note');
});

test('searchEverything restricts to the given content types', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Infra' });
  createTask(ws, 'infra', { text: 'Check widget stock levels' });
  createNote(ws, { title: 'Warehouse note', body: 'Widget stock levels look fine this week.' });

  const notesOnly = searchEverything(ws, { query: 'widget', types: ['note'] });
  assert.equal(notesOnly.length, 1);
  assert.equal(notesOnly[0].type, 'note');

  const tasksOnly = searchEverything(ws, { query: 'widget', types: ['task'] });
  assert.equal(tasksOnly.length, 1);
  assert.equal(tasksOnly[0].type, 'task');
});

test('searchEverything filters by date range on each type\'s own relevant date', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-06-05', { body: 'Talked about widget rollout plans.' });
  putJournalEntry(ws, '2026', '2026-07-20', { body: 'More widget rollout notes, later in the summer.' });

  const juneOnly = searchEverything(ws, { query: 'widget', from: '2026-06-01', to: '2026-06-30' });
  assert.equal(juneOnly.length, 1);
  assert.equal(juneOnly[0].date, '2026-06-05');

  const allTime = searchEverything(ws, { query: 'widget' });
  assert.equal(allTime.length, 2);
});

test('searchEverything returns no results for an empty/whitespace-only query', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Something', body: 'anything at all' });
  assert.deepEqual(searchEverything(ws, { query: '' }), []);
  assert.deepEqual(searchEverything(ws, { query: '   ' }), []);
});

test('searchEverything sorts mixed-type results most-recent-first', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-01-10', { body: 'kayak trip planning notes' });
  createNote(ws, { title: 'Kayak gear', body: 'kayak paddle recommendations' });
  putJournalEntry(ws, '2026', '2026-05-01', { body: 'kayak trip follow-up' });

  const results = searchEverything(ws, { query: 'kayak' });
  const dates = results.map((r) => r.date);
  assert.deepEqual([...dates].sort().reverse(), dates);
});

test('deleting the index and reindexing reproduces identical search results (PLAN.md\'s hard portability constraint)', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Infra' });
  createTask(ws, 'infra', { text: 'Rotate VPN keys', description: "The bank's subnet is 10.20.0.0/16." });
  createNote(ws, { title: 'Vendor contacts', body: 'BankX support line and their subnet notes live here.' });
  putJournalEntry(ws, '2026', '2026-06-05', { body: 'Debugging the BankX subnet issue.' });

  const before = searchEverything(ws, { query: 'subnet' });
  rebuildIndex(ws); // deletes index.sqlite3 and reconciles from scratch
  const after = searchEverything(ws, { query: 'subnet' });

  assert.deepEqual(after, before);
});
