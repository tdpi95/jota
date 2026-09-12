import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { reconcileWorkspace } from '../lib/index/reindex.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { createProject } from './projects.js';
import { getTimeSpentReport } from './reports.js';
import { createTask, updateTask } from './tasks.js';

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poco-reports-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

/** Backdates the one task's @doingSince in the given project file, mirroring
 * services/tasks.test.ts's helper — lets a subsequent status transition (or
 * includeInProgress read) see a realistic elapsed duration. */
function backdateDoingSince(ws: string, slug: string, minutesAgo: number): void {
  const filePath = path.join(ws, 'projects', `${slug}.md`);
  const backdated = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const content = fs.readFileSync(filePath, 'utf8').replace(/@doingSince\([^)]*\)/, `@doingSince(${backdated})`);
  fs.writeFileSync(filePath, content, 'utf8');
}

/** Creates a task, runs it through a doing session of ~minutes long, and
 * marks it done — so it ends up with a known spentMinutes and a doneAt. */
function taskWithSpentTime(ws: string, slug: string, text: string, minutes: number, due?: string) {
  const task = createTask(ws, slug, { text, due });
  updateTask(ws, slug, task.id, { status: 'doing' });
  backdateDoingSince(ws, slug, minutes);
  return updateTask(ws, slug, task.id, { status: 'done' });
}

test('groups by project by default, summing spentMinutes, largest first', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  createProject(ws, { name: 'Ops' });
  taskWithSpentTime(ws, 'website-redesign', 'A', 10);
  taskWithSpentTime(ws, 'website-redesign', 'B', 20);
  taskWithSpentTime(ws, 'ops', 'C', 5);

  const groups = getTimeSpentReport(ws, {});
  assert.deepEqual(
    groups.map((g) => g.key),
    ['website-redesign', 'ops'],
  );
  assert.ok(groups[0].minutes >= 29 && groups[0].minutes <= 31, `expected ~30, got ${groups[0].minutes}`);
  assert.ok(groups[1].minutes >= 4 && groups[1].minutes <= 6);
  assert.equal(groups[0].label, 'Website Redesign');
});

test('groups by day using doneAt as the relevant date for finished tasks', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const done = taskWithSpentTime(ws, 'website-redesign', 'A', 15);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(done.doneAt, today);

  const groups = getTimeSpentReport(ws, { groupBy: 'day' });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, today);
});

test('from/to filters tasks by their relevant date (due date, for a task that is not done)', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  // Left in 'todo' (not 'done'), so doneAt stays null and `due` is the
  // relevant date; spentMinutes still needs to be >0 to appear at all.
  const task = createTask(ws, 'website-redesign', { text: 'due next week', due: '2099-01-01' });
  updateTask(ws, 'website-redesign', task.id, { status: 'doing' });
  backdateDoingSince(ws, 'website-redesign', 10);
  updateTask(ws, 'website-redesign', task.id, { status: 'todo' });

  const inRange = getTimeSpentReport(ws, { from: '2098-12-01', to: '2099-02-01' });
  assert.equal(inRange.length, 1);

  const outOfRange = getTimeSpentReport(ws, { from: '2000-01-01', to: '2000-01-02' });
  assert.equal(outOfRange.length, 0);
});

test('a task with zero spent time is excluded unless includeInProgress adds live elapsed time', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  const task = createTask(ws, 'website-redesign', { text: 'In progress' });
  updateTask(ws, 'website-redesign', task.id, { status: 'doing' });
  backdateDoingSince(ws, 'website-redesign', 12);
  // Aggregate reads go through the index (PLAN.md "which reads go where"),
  // which is only ever refreshed by a write path or an explicit
  // reconcile — reconcile explicitly here since the backdate above bypassed
  // both.
  reconcileWorkspace(ws);

  const withoutLive = getTimeSpentReport(ws, { includeInProgress: false });
  assert.equal(withoutLive.length, 0); // spentMinutes is still 0 until the task leaves 'doing'

  const withLive = getTimeSpentReport(ws, { includeInProgress: true });
  assert.equal(withLive.length, 1);
  assert.ok(withLive[0].minutes >= 11 && withLive[0].minutes <= 13, `expected ~12, got ${withLive[0].minutes}`);
});

test('rejects an invalid groupBy', () => {
  const ws = scratchWorkspace();
  assert.throws(() => getTimeSpentReport(ws, { groupBy: 'bogus' as never }), /invalid groupBy/);
});
