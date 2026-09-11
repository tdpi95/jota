import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getHistory } from '../lib/vaultGit.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { linkTask } from './journal.js';
import { createProject } from './projects.js';
import { createTask, deleteTask, getJournalLinksForTask, listOpenTasks, searchTasks, updateTask } from './tasks.js';

// Mirrors PLAN.md milestone 7's verify step (the tasks half): create
// project, add task, PATCH todo->doing->(wait)->todo, confirm @spent in the
// file, the index row, and a new git commit all agree.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivot-tasks-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

function projectFile(ws: string, slug: string): string {
  return path.join(ws, 'projects', `${slug}.md`);
}

/** Rewrites the one task's @doingSince(...) token in place to simulate time
 * having passed, without going through the service (so `now` at the next
 * transition is realistically far enough from `doingSince` to assert on). */
function backdateDoingSince(ws: string, slug: string, minutesAgo: number): void {
  const filePath = projectFile(ws, slug);
  const backdated = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const content = fs.readFileSync(filePath, 'utf8').replace(/@doingSince\([^)]*\)/, `@doingSince(${backdated})`);
  fs.writeFileSync(filePath, content, 'utf8');
}

test('createTask appends a task with required tokens, indexes, and commits', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });

  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy', tags: ['content'] });

  assert.equal(task.status, 'todo');
  assert.equal(task.text, 'Draft homepage copy');
  assert.deepEqual(task.tags, ['content']);
  assert.equal(task.spentMinutes, 0);
  assert.match(task.id, /^t_[0-9a-f]{6}$/);

  const onDisk = fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8');
  assert.match(onDisk, new RegExp(`<!-- id:${task.id} -->`));

  assert.equal(getHistory(ws)[0].message, `[api] create_task ${task.id} (website-redesign)`);
});

test('createTask requires non-empty text', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  assert.throws(() => createTask(ws, 'website-redesign', { text: '  ' }), /text is required/);
});

test('doing-timer transition: todo -> doing starts doingSince, doing -> todo folds elapsed time into spentMinutes', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy' });

  const doing = updateTask(ws, 'website-redesign', task.id, { status: 'doing' });
  assert.equal(doing.status, 'doing');
  assert.ok(doing.doingSince);
  assert.match(fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8'), /@doingSince\(/);

  backdateDoingSince(ws, 'website-redesign', 30);

  const backToTodo = updateTask(ws, 'website-redesign', task.id, { status: 'todo' });
  assert.equal(backToTodo.status, 'todo');
  assert.equal(backToTodo.doingSince, null);
  assert.ok(backToTodo.spentMinutes >= 29 && backToTodo.spentMinutes <= 31, `expected ~30 spent minutes, got ${backToTodo.spentMinutes}`);

  const onDisk = fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8');
  assert.match(onDisk, /@spent\(/);
  assert.doesNotMatch(onDisk, /@doingSince\(/);

  const history = getHistory(ws);
  assert.equal(history[0].message, `[api] update_task ${task.id} status doing→todo (website-redesign)`);
});

test('doing-timer transition: doing -> done sets doneAt and folds spent time; done -> doing clears doneAt again', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy' });
  updateTask(ws, 'website-redesign', task.id, { status: 'doing' });
  backdateDoingSince(ws, 'website-redesign', 15);

  const done = updateTask(ws, 'website-redesign', task.id, { status: 'done' });
  assert.equal(done.status, 'done');
  assert.ok(done.doneAt);
  assert.equal(done.doingSince, null);
  assert.ok(done.spentMinutes >= 14);

  const reopened = updateTask(ws, 'website-redesign', task.id, { status: 'doing' });
  assert.equal(reopened.doneAt, null);
  assert.ok(reopened.doingSince);
});

test('a same-status update is a no-op guard against double-counting', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy' });
  const doing = updateTask(ws, 'website-redesign', task.id, { status: 'doing' });

  const again = updateTask(ws, 'website-redesign', task.id, { status: 'doing' });
  assert.equal(again.doingSince, doing.doingSince); // untouched, not reset to a new "now"
});

test('updateTask can edit text/description/due/tags without a status change', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy' });

  const updated = updateTask(ws, 'website-redesign', task.id, {
    text: 'Draft new homepage copy',
    description: 'Warmer tone this time.',
    due: '2026-09-20',
    tags: ['content', 'high'],
  });

  assert.equal(updated.text, 'Draft new homepage copy');
  assert.equal(updated.description, 'Warmer tone this time.');
  assert.equal(updated.due, '2026-09-20');
  assert.deepEqual(updated.tags, ['content', 'high']);
  assert.equal(updated.status, 'todo');
  assert.equal(getHistory(ws)[0].message, `[api] update_task ${task.id} (website-redesign)`);
});

test('updateTask on an unknown task id throws a structured 404', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  assert.throws(() => updateTask(ws, 'website-redesign', 't_ffffff', { status: 'doing' }), /no task with id/);
});

test('updateTask reorders the task to the front of the file when afterTaskId is null', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const a = createTask(ws, 'website-redesign', { text: 'A' });
  createTask(ws, 'website-redesign', { text: 'B' });
  const c = createTask(ws, 'website-redesign', { text: 'C' });

  updateTask(ws, 'website-redesign', c.id, { afterTaskId: null });

  const onDisk = fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8');
  const ids = [...onDisk.matchAll(/id:(t_[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.deepEqual(ids, [c.id, a.id, ids[2]]);
  assert.equal(getHistory(ws)[0].message, `[api] update_task ${c.id} reordered (website-redesign)`);
});

test('updateTask reorders the task to immediately after a given task id', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const a = createTask(ws, 'website-redesign', { text: 'A' });
  const b = createTask(ws, 'website-redesign', { text: 'B' });
  const c = createTask(ws, 'website-redesign', { text: 'C' });

  updateTask(ws, 'website-redesign', a.id, { afterTaskId: c.id });

  const onDisk = fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8');
  const ids = [...onDisk.matchAll(/id:(t_[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.deepEqual(ids, [b.id, c.id, a.id]);
});

test('updateTask reorder combined with a status change reports both in the commit message', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const a = createTask(ws, 'website-redesign', { text: 'A' });
  createTask(ws, 'website-redesign', { text: 'B' });

  updateTask(ws, 'website-redesign', a.id, { status: 'doing', afterTaskId: null });

  assert.equal(getHistory(ws)[0].message, `[api] update_task ${a.id} status todo→doing, reordered (website-redesign)`);
});

test('updateTask reorder+status supports moving backward (done -> todo), same as any other direction', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const a = createTask(ws, 'website-redesign', { text: 'A' });
  const b = createTask(ws, 'website-redesign', { text: 'B' });
  updateTask(ws, 'website-redesign', a.id, { status: 'doing' });
  updateTask(ws, 'website-redesign', a.id, { status: 'done' });

  // Drag "A" (done) back into the Todo column, dropped after "B".
  const backward = updateTask(ws, 'website-redesign', a.id, { status: 'todo', afterTaskId: b.id });

  assert.equal(backward.status, 'todo');
  assert.equal(backward.doneAt, null);
  const onDisk = fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8');
  const ids = [...onDisk.matchAll(/id:(t_[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.deepEqual(ids, [b.id, a.id]);
  assert.equal(getHistory(ws)[0].message, `[api] update_task ${a.id} status done→todo, reordered (website-redesign)`);
});

test('updateTask reorder to an unknown afterTaskId throws a structured 404', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const a = createTask(ws, 'website-redesign', { text: 'A' });
  assert.throws(() => updateTask(ws, 'website-redesign', a.id, { afterTaskId: 't_ffffff' }), /no task with id/);
});

test('deleteTask removes the task line and commits', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy' });

  deleteTask(ws, 'website-redesign', task.id);

  const onDisk = fs.readFileSync(projectFile(ws, 'website-redesign'), 'utf8');
  assert.doesNotMatch(onDisk, new RegExp(`id:${task.id}`));
  assert.equal(getHistory(ws)[0].message, `[api] delete_task ${task.id} (website-redesign)`);
});

// --- Aggregate/query reads (milestone 9) ---

test('listOpenTasks returns not-done tasks across projects, due-soonest first, with project info attached', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  createProject(ws, { name: 'Ops' });
  const undated = createTask(ws, 'website-redesign', { text: 'No due date' });
  const soon = createTask(ws, 'website-redesign', { text: 'Due soon', due: '2026-09-12' });
  const later = createTask(ws, 'ops', { text: 'Due later', due: '2026-10-01' });
  const done = createTask(ws, 'ops', { text: 'Already done' });
  updateTask(ws, 'ops', done.id, { status: 'done' });

  const open = listOpenTasks(ws);
  assert.deepEqual(
    open.map((t) => t.id),
    [soon.id, later.id, undated.id],
  );
  assert.equal(open[0].projectSlug, 'website-redesign');
  assert.equal(open[1].projectName, 'Ops');
});

test('searchTasks matches text/description case-insensitively and ignores a blank query', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const match = createTask(ws, 'website-redesign', { text: 'Draft HOMEPAGE copy' });
  createTask(ws, 'website-redesign', { text: 'Unrelated task' });

  assert.deepEqual(
    searchTasks(ws, 'homepage').map((t) => t.id),
    [match.id],
  );
  assert.deepEqual(searchTasks(ws, '   '), []);
});

test('searchTasks also matches by tag, not just text/description', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const match = createTask(ws, 'website-redesign', { text: 'Ship the release', tags: ['polish'] });
  createTask(ws, 'website-redesign', { text: 'Something else', tags: ['backend'] });

  assert.deepEqual(
    searchTasks(ws, 'polish').map((t) => t.id),
    [match.id],
  );
});

test('getJournalLinksForTask returns linked dates and 404s for an unknown task', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'Draft homepage copy' });

  assert.deepEqual(getJournalLinksForTask(ws, task.id), []);

  linkTask(ws, '2026', '2026-09-10', task.id);
  linkTask(ws, '2026', '2026-09-11', task.id);
  assert.deepEqual(getJournalLinksForTask(ws, task.id), ['2026-09-10', '2026-09-11']);

  assert.throws(() => getJournalLinksForTask(ws, 't_ffffff'), /no task with id/);
});
