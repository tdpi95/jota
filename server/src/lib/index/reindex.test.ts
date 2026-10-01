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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-index-'));
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
      group: 'Default',
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

test('one unparsable file is skipped instead of failing the whole reconcile', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  writeJournal(dir, '2026-09-10');
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  // Leftover git conflict markers in frontmatter — invalid YAML.
  fs.writeFileSync(
    path.join(dir, 'notes', 'broken.md'),
    "---\ntitle: 'Broken'\n<<<<<<< HEAD\nupdated: '2026-09-26T16:50:24.653Z'\n=======\nupdated: '2026-09-26T11:26:02.123Z'\n>>>>>>> parent of f3c6a7b\n---\nbody\n",
    'utf8',
  );

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsReparsed, 1);
  assert.equal(stats.journalEntriesReparsed, 1);
  assert.equal(stats.notesReparsed, 0);
  const status = getIndexStatus(dir);
  assert.equal(status.taskCount, 1);
  assert.equal(status.noteCount, 0);
});

test('a hand-written project file with sparse or missing frontmatter is still indexed', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  // Only what a person would bother typing: no created/archived/description/group.
  fs.writeFileSync(
    path.join(dir, 'projects', 'alpha.md'),
    '---\nname: Alpha\ncolor: "#4f7cff"\n---\n\n- [ ] Buy milk @created(2026-09-29T10:00) <!-- id:t_alpha01 -->\n',
    'utf8',
  );
  // No frontmatter at all, and a wrong-shaped value in another.
  fs.writeFileSync(
    path.join(dir, 'projects', 'bare.md'),
    '- [ ] Bare task @created(2026-09-29T10:00) <!-- id:t_bare001 -->\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'projects', 'numbers.md'),
    '---\nname: 2026\ngroup: 7\ndescription: [a, b]\n---\n\n- [ ] Numbered @created(2026-09-29T10:00) <!-- id:t_num0001 -->\n',
    'utf8',
  );

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsReparsed, 4);
  assert.equal(getIndexStatus(dir).taskCount, 4);

  const db = openIndexDb(dir);
  const rows = db.prepare('SELECT slug, name, created, archived, description, group_name, color FROM projects ORDER BY slug').all();
  db.close();
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { slug: 'alpha', name: 'Alpha', created: '', archived: 0, description: '', group_name: 'Default', color: '#4f7cff' },
      { slug: 'bare', name: 'bare', created: '', archived: 0, description: '', group_name: 'Default', color: '' },
      { slug: 'numbers', name: '2026', created: '', archived: 0, description: '', group_name: '7', color: '' },
      { slug: 'website-redesign', name: 'website-redesign', created: '2026-01-01', archived: 0, description: '', group_name: 'Default', color: '#4f86f7' },
    ],
  );
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

test('openIndexDb migrates an index created before journal/note `body` was cached, backfilling unchanged files too (milestone 25)', () => {
  const dir = scratchWorkspace();
  writeJournal(dir, '2026-09-10', 'Some real body text about widgets.');
  const filePath = path.join(dir, 'journal', '2026', '2026-09-10.md');
  const mtime = fs.statSync(filePath).mtimeMs;

  const dbPath = getIndexDbPath(dir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // Simulate a pre-milestone-25 index: `journal_entries` without `body`, its
  // row already at the file's *current* mtime — the exact condition that
  // would make a plain `ALTER ... DEFAULT ''` migration (with no mtime
  // reset) leave this row's body empty forever, since reconciliation would
  // see the mtime as unchanged and skip reparsing it.
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE journal_entries (
      date TEXT PRIMARY KEY, year TEXT NOT NULL, has_body INTEGER NOT NULL, tags TEXT NOT NULL,
      source_mtime REAL NOT NULL, source_hash TEXT NOT NULL
    );
  `);
  legacy
    .prepare('INSERT INTO journal_entries (date, year, has_body, tags, source_mtime, source_hash) VALUES (?, ?, 1, ?, ?, ?)')
    .run('2026-09-10', '2026', '[]', mtime, 'irrelevant');
  legacy.close();

  openIndexDb(dir).close(); // triggers the migration + mtime reset
  reconcileWorkspace(dir); // must now see the row as changed and reparse it

  const db = openIndexDb(dir);
  const row = db.prepare('SELECT body FROM journal_entries WHERE date = ?').get('2026-09-10') as { body: string };
  const ftsRow = db.prepare('SELECT body FROM journal_fts WHERE date = ?').get('2026-09-10') as { body: string } | undefined;
  db.close();

  assert.match(row.body, /Some real body text about widgets\./);
  assert.match(ftsRow?.body ?? '', /Some real body text about widgets\./);
});

test('openIndexDb backfills projects_fts and group_name for an index created before either existed, even for an unchanged project file (follow-up to milestone 25 / project groups)', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'widget-warehouse', [], { name: 'Widget Warehouse', description: 'Tracks widget stock levels.' });
  const filePath = path.join(dir, 'projects', 'widget-warehouse.md');
  const mtime = fs.statSync(filePath).mtimeMs;

  const dbPath = getIndexDbPath(dir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // Simulate a pre-follow-up index: `projects` exists (its columns didn't
  // change — only the new `projects_fts` mirror is missing), its row
  // already at the file's *current* mtime, same "unchanged file still
  // needs a one-time backfill" condition as the journal/note case above.
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE projects (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, archived INTEGER NOT NULL,
      description TEXT NOT NULL, tags TEXT NOT NULL, color TEXT NOT NULL,
      source_mtime REAL NOT NULL, source_hash TEXT NOT NULL
    );
  `);
  legacy
    .prepare(
      `INSERT INTO projects (slug, name, created, archived, description, tags, color, source_mtime, source_hash)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run('widget-warehouse', 'Widget Warehouse', '2026-01-01', 'Tracks widget stock levels.', '[]', '#4f86f7', mtime, 'irrelevant');
  legacy.close();

  openIndexDb(dir).close(); // triggers the sqlite_master check + mtime reset
  reconcileWorkspace(dir); // must now see the row as changed and reparse it

  const db = openIndexDb(dir);
  const ftsRow = db.prepare('SELECT name FROM projects_fts WHERE slug = ?').get('widget-warehouse') as
    | { name: string }
    | undefined;
  const projectRow = db.prepare('SELECT group_name FROM projects WHERE slug = ?').get('widget-warehouse') as
    | { group_name: string }
    | undefined;
  db.close();

  assert.equal(ftsRow?.name, 'Widget Warehouse');
  assert.equal(projectRow?.group_name, 'Default');
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

// --- Files that used to abort reconciliation for the whole workspace ---

const rawTask = (id: string, text: string) => `- [ ] ${text} @created(2026-09-29T10:00) <!-- id:${id} -->\n`;

/** Writes a raw project file and pushes its mtime forward, so an incremental
 * reconcile is guaranteed to see it as changed even within one millisecond. */
function writeRawProject(dir: string, slug: string, lines: string[]) {
  const filePath = path.join(dir, 'projects', `${slug}.md`);
  const previous = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
  fs.writeFileSync(filePath, `---\nname: ${slug}\n---\n\n${lines.join('\n')}`, 'utf8');
  const next = new Date(Math.max(Date.now(), previous + 1000));
  fs.utimesSync(filePath, next, next);
}

function taskSnapshot(dir: string) {
  const db = openIndexDb(dir);
  try {
    return {
      tasks: db.prepare('SELECT id, project_slug, text FROM tasks ORDER BY id').all().map((r) => ({ ...r })),
      fts: db.prepare('SELECT id, project_slug, text FROM tasks_fts ORDER BY id').all().map((r) => ({ ...r })),
    };
  } finally {
    db.close();
  }
}

/** The index an incremental reconcile left behind must equal a from-scratch
 * rebuild's (PLAN.md's portability constraint). Returns the snapshot. */
function assertMatchesRebuild(dir: string) {
  reconcileWorkspace(dir);
  const incremental = taskSnapshot(dir);
  rebuildIndex(dir);
  assert.deepEqual(incremental, taskSnapshot(dir));
  return incremental;
}

test('duplicate linkedTasks in a journal entry index as one link instead of aborting', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  fs.writeFileSync(path.join(dir, 'journal', '2026', '2026-09-10.md'), '---\nlinkedTasks: [t_aaa001, t_aaa001]\n---\nx\n', 'utf8');
  writeJournal(dir, '2026-09-11');

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.journalEntriesReparsed, 2);
  assert.equal(countRows(dir, 'journal_task_links'), 1);
});

test('broken symlinks are skipped, and a file that turns into one is dropped from the index', () => {
  const dir = scratchWorkspace();
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  writeProject(dir, 'website-redesign', [makeTask('t_aaa001')]);
  writeJournal(dir, '2026-09-10');
  fs.writeFileSync(path.join(dir, 'notes', 'kept.md'), '---\ntitle: Kept\n---\nbody\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'notes', 'gone.md'), '---\ntitle: Gone\n---\nbody\n', 'utf8');
  reconcileWorkspace(dir);
  assert.equal(countRows(dir, 'notes'), 2);

  const missing = path.join(dir, 'nowhere.md');
  fs.rmSync(path.join(dir, 'notes', 'gone.md'));
  fs.symlinkSync(missing, path.join(dir, 'notes', 'gone.md'));
  fs.symlinkSync(missing, path.join(dir, 'journal', '2026', '2026-09-11.md'));
  fs.symlinkSync(missing, path.join(dir, 'projects', 'dangling.md'));

  reconcileWorkspace(dir);
  const status = getIndexStatus(dir);
  assert.deepEqual(
    [status.projectCount, status.taskCount, status.journalEntryCount, status.noteCount],
    [1, 1, 1, 1],
  );
});

test('a journal file in the wrong year folder is ignored, not indexed over the real one', () => {
  const dir = scratchWorkspace();
  writeJournal(dir, '2026-09-10', 'the real entry');
  fs.mkdirSync(path.join(dir, 'journal', '2025'), { recursive: true });
  // Sorts (and so used to be scanned) after nothing / before the real one —
  // either way it must not count.
  fs.writeFileSync(path.join(dir, 'journal', '2025', '2026-09-10.md'), '---\n---\nmisfiled copy\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'journal', '2025', '2026-09-11.md'), '---\n---\nmisfiled only\n', 'utf8');

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.journalEntriesScanned, 1);
  const db = openIndexDb(dir);
  const rows = db.prepare('SELECT date, year, body FROM journal_entries').all().map((r) => ({ ...r }));
  db.close();
  assert.deepEqual(rows, [{ date: '2026-09-10', year: '2026', body: 'the real entry\n' }]);
});

test('a task id repeated within one project file indexes only the first line', () => {
  const dir = scratchWorkspace();
  writeRawProject(dir, 'alpha', [rawTask('t_dup0001', 'First'), rawTask('t_other01', 'Other'), rawTask('t_dup0001', 'Second')]);

  const snapshot = assertMatchesRebuild(dir);
  assert.deepEqual(
    snapshot.tasks.map((t) => [t.id, t.text]),
    [
      ['t_dup0001', 'First'],
      ['t_other01', 'Other'],
    ],
  );
});

test('a task id in two project files goes to the alphabetically first one, incrementally the same as a rebuild', () => {
  const dir = scratchWorkspace();
  const owner = () => taskSnapshot(dir).tasks.find((t) => t.id === 't_dup0001')?.project_slug;

  // "bravo" is indexed alone first, then "alpha" appears with the same id
  // (a sync tool's conflicted copy, say): alpha sorts first, so it takes over.
  writeRawProject(dir, 'bravo', [rawTask('t_dup0001', 'Bravo copy'), rawTask('t_bravo01', 'Bravo own')]);
  reconcileWorkspace(dir);
  writeRawProject(dir, 'alpha', [rawTask('t_dup0001', 'Alpha copy')]);
  assertMatchesRebuild(dir);
  assert.equal(owner(), 'alpha');

  // Editing the losing file doesn't steal it back.
  writeRawProject(dir, 'bravo', [rawTask('t_dup0001', 'Bravo copy, edited'), rawTask('t_bravo01', 'Bravo own')]);
  assertMatchesRebuild(dir);
  assert.equal(owner(), 'alpha');

  // The winner drops the id while a third file that sorts after bravo picks
  // it up in the same pass: bravo, untouched, must still end up with it.
  writeRawProject(dir, 'alpha', [rawTask('t_alpha01', 'Alpha own')]);
  writeRawProject(dir, 'charlie', [rawTask('t_dup0001', 'Charlie copy')]);
  assertMatchesRebuild(dir);
  assert.equal(owner(), 'bravo');

  // Deleting the winner hands it to the next copy.
  fs.rmSync(path.join(dir, 'projects', 'bravo.md'));
  assertMatchesRebuild(dir);
  assert.equal(owner(), 'charlie');
  assert.equal(countRows(dir, 'task_id_shadows'), 0);
});

test('a file that fails to index for an unforeseen reason is rolled back and skipped, not fatal', () => {
  const dir = scratchWorkspace();
  writeProject(dir, 'a-project', [makeTask('t_aaa001')]);
  writeProject(dir, 'poison', [makeTask('t_ppp001')]);
  writeProject(dir, 'z-project', [makeTask('t_zzz001')]);
  // Fail a *later* write for one file (its task, after its project row
  // already went in) — simulates any error SQLite might raise mid-file.
  const db = openIndexDb(dir);
  db.exec(`
    CREATE TRIGGER poison_task BEFORE INSERT ON tasks
    WHEN NEW.project_slug = 'poison' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
  `);
  db.close();

  const stats = reconcileWorkspace(dir);
  assert.equal(stats.projectsReparsed, 2);
  const check = openIndexDb(dir);
  const slugs = check.prepare('SELECT slug FROM projects ORDER BY slug').all().map((r) => r.slug);
  const ftsSlugs = check.prepare('SELECT slug FROM projects_fts ORDER BY slug').all().map((r) => r.slug);
  check.close();
  assert.deepEqual(slugs, ['a-project', 'z-project']); // poison's half-written rows rolled back
  assert.deepEqual(ftsSlugs, ['a-project', 'z-project']);
  assert.equal(getIndexStatus(dir).taskCount, 2);
});
