import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { ProjectFrontmatter, Task } from '../../types.js';
import { serializeJournalFile } from '../markdown/journal.js';
import { serializeProjectFile } from '../markdown/project.js';
import { DatabaseSync } from 'node:sqlite';

import { getIndexDbPath, openIndexDb } from './db.js';
import { getIndexStatus, rebuildIndex, reconcileWorkspace } from './reindex.js';

// Mirrors PLAN.md milestone 4's verify step: seed a scratch workspace, index,
// inspect rows match files; delete the sqlite file and re-run, confirm
// identical reproduction; touch one file's mtime without changing content
// and confirm it's the only one reparsed.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivot-index-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'journal', '2026'), { recursive: true });
  return dir;
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    status: 'todo',
    text: `Task ${id}`,
    due: null,
    created: '2026-01-01T00:00:00.000Z',
    doingSince: null,
    spentMinutes: 0,
    doneAt: null,
    tags: [],
    description: null,
    checklist: [],
    ...overrides,
  };
}

function writeProject(dir: string, slug: string, tasks: Task[], frontmatterOverrides: Partial<ProjectFrontmatter> = {}) {
  const content = serializeProjectFile({
    frontmatter: {
      name: slug,
      created: '2026-01-01',
      archived: false,
      description: '',
      tags: [],
      color: '#4f86f7',
      ...frontmatterOverrides,
    },
    blocks: tasks.map((task) => ({ type: 'task' as const, task })),
  });
  fs.writeFileSync(path.join(dir, 'projects', `${slug}.md`), content, 'utf8');
}

function writeJournal(dir: string, date: string, body = 'Notes for the day.') {
  const content = serializeJournalFile({
    frontmatter: { date, tags: [], linkedTasks: [] },
    body,
  });
  fs.writeFileSync(path.join(dir, 'journal', date.slice(0, 4), `${date}.md`), content, 'utf8');
}

function countRows(dir: string, table: string): number {
  const db = openIndexDb(dir);
  try {
    return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
  } finally {
    db.close();
  }
}

test('reconcileWorkspace indexes projects, tasks, and journal entries matching the files', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001'), makeTask('t_aaa002')]);
  writeProject(dir, 'personal', [makeTask('t_bbb001')]);
  writeJournal(dir, '2026-09-10');

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsScanned, 2);
  assert.equal(stats.projectsReparsed, 2);
  assert.equal(stats.journalEntriesScanned, 1);
  assert.equal(stats.journalEntriesReparsed, 1);

  assert.equal(countRows(dir, 'projects'), 2);
  assert.equal(countRows(dir, 'tasks'), 3);
  assert.equal(countRows(dir, 'journal_entries'), 1);

  const status = getIndexStatus(dir);
  assert.equal(status.projectCount, 2);
  assert.equal(status.taskCount, 3);
  assert.equal(status.journalEntryCount, 1);
  assert.ok(status.lastReconciledAt);
});

test('a no-op reconcile reparses nothing', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  writeJournal(dir, '2026-09-10');
  reconcileWorkspace(dir);

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsReparsed, 0);
  assert.equal(stats.journalEntriesReparsed, 0);
});

test('touching one file\'s mtime without changing content reparses only that file', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  writeProject(dir, 'personal', [makeTask('t_bbb001')]);
  writeJournal(dir, '2026-09-10');
  reconcileWorkspace(dir);

  const touched = path.join(dir, 'projects', 'website-redesign.md');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(touched, future, future);

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsReparsed, 1);
  assert.equal(stats.journalEntriesReparsed, 0);
});

test('removing a project file removes its index rows on the next reconcile', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  writeProject(dir, 'personal', [makeTask('t_bbb001')]);
  reconcileWorkspace(dir);
  assert.equal(countRows(dir, 'projects'), 2);

  fs.rmSync(path.join(dir, 'projects', 'personal.md'));
  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsRemoved, 1);
  assert.equal(countRows(dir, 'projects'), 1);
  assert.equal(countRows(dir, 'tasks'), 1);
});

test('openIndexDb migrates an index created before the checklist column existed', () => {
  const dir = scratchWorkspace();
  const dbPath = getIndexDbPath(dir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Simulate a pre-checklist index: the `tasks` table without that column,
  // one row already in it.
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
      due TEXT, created_at TEXT NOT NULL, doing_since TEXT, spent_minutes INTEGER NOT NULL,
      done_at TEXT, tags TEXT NOT NULL, description TEXT
    );
  `);
  legacy.prepare(
    `INSERT INTO tasks (id, project_slug, text, status, due, created_at, doing_since, spent_minutes, done_at, tags, description)
     VALUES ('t_legacy1', 'x', 'Legacy task', 'todo', NULL, '2026-01-01T00:00:00Z', NULL, 0, NULL, '[]', NULL)`,
  ).run();
  legacy.close();

  // openIndexDb must add the missing column (defaulting existing rows to
  // '[]') rather than throwing on the next write, and be a no-op on a
  // second open once it's there.
  const db = openIndexDb(dir);
  const row = db.prepare('SELECT checklist FROM tasks WHERE id = ?').get('t_legacy1') as { checklist: string };
  assert.equal(row.checklist, '[]');
  db.close();
  assert.doesNotThrow(() => openIndexDb(dir).close());
});

test('rebuildIndex after deleting the sqlite file reproduces identical state', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001'), makeTask('t_aaa002')]);
  writeJournal(dir, '2026-09-10');
  reconcileWorkspace(dir);

  const before = getIndexStatus(dir);

  fs.rmSync(getIndexDbPath(dir));
  const stats = rebuildIndex(dir);
  assert.equal(stats.projectsReparsed, 1);
  assert.equal(stats.journalEntriesReparsed, 1);

  const after = getIndexStatus(dir);
  assert.equal(after.projectCount, before.projectCount);
  assert.equal(after.taskCount, before.taskCount);
  assert.equal(after.journalEntryCount, before.journalEntryCount);
});
