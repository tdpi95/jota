// SQLite index schema + connection (PLAN.md "SQLite index layer"). One index
// per workspace at `<workspace>/.poco/cache/index.sqlite3`, WAL mode so the
// Express server and a concurrently-running MCP server process can both
// read/write it without lock contention (see milestone 10).
//
// `node:sqlite` is still Node-experimental — all access to it is isolated
// behind this one file so a future API shift (or a swap to a different
// library) is a contained change (PLAN.md).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function getIndexDbPath(workspacePath: string): string {
  return path.join(workspacePath, '.poco', 'cache', 'index.sqlite3');
}

// Each file-backed table carries `source_mtime`/`source_hash` for staleness
// bookkeeping (PLAN.md schema sketch). Reconciliation (lib/index/reindex.ts)
// uses `source_mtime` to decide what needs reparsing; `source_hash` is kept
// alongside for future use (e.g. detecting a touch-without-change explicitly)
// without being load-bearing for that decision today.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created TEXT NOT NULL,
  archived INTEGER NOT NULL,
  description TEXT NOT NULL,
  -- Vestigial: projects no longer have tags (replaced by group_name below),
  -- but the column stays (always written as '[]') rather than attempting a
  -- DROP COLUMN migration on every existing workspace's index for a column
  -- nothing reads anymore — this is a derived, always-rebuildable cache, so
  -- an unused column here is harmless.
  tags TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'Default',
  color TEXT NOT NULL,
  source_mtime REAL NOT NULL,
  source_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  due TEXT,
  created_at TEXT NOT NULL,
  doing_since TEXT,
  spent_minutes INTEGER NOT NULL,
  done_at TEXT,
  tags TEXT NOT NULL,
  description TEXT,
  checklist TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_slug ON tasks(project_slug);

CREATE TABLE IF NOT EXISTS journal_entries (
  date TEXT PRIMARY KEY,
  year TEXT NOT NULL,
  has_body INTEGER NOT NULL,
  tags TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source_mtime REAL NOT NULL,
  source_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_year ON journal_entries(year);

CREATE TABLE IF NOT EXISTS journal_task_links (
  date TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (date, task_id)
);

CREATE TABLE IF NOT EXISTS notes (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  tags TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source_mtime REAL NOT NULL,
  source_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Full-text search (milestone 25 "Search improvement", PLAN.md "Search
-- (cross-type full-text)") — standalone FTS5 tables, one per content type,
-- rather than the plain LIKE-scan pattern the rest of this file's queries
-- use: gives ranked results and snippet() excerpts once a result can be a
-- task, a note, or a journal entry mixed together. Not "external content"
-- FTS5 tables (no content= option) since the natural keys here (task id,
-- note slug, journal date) aren't integer rowids; kept in sync by explicit
-- delete-then-insert during reconciliation (lib/index/reindex.ts), same
-- rebuild-on-reconcile approach as every other index table, rather than
-- triggers — a missing/corrupt FTS table self-heals on the next reindex.
-- id/project_slug/slug/date columns are UNINDEXED (stored for the join back
-- to the real table, never matched against).
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(id UNINDEXED, project_slug UNINDEXED, text, description, tags);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(slug UNINDEXED, title, tags, body);
CREATE VIRTUAL TABLE IF NOT EXISTS journal_fts USING fts5(date UNINDEXED, tags, body);
CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(slug UNINDEXED, name, description, tags);
`;

/** Opens (creating if needed) the workspace's index DB with the schema
 * applied. Callers are responsible for `.close()`-ing what they open. */
export function openIndexDb(workspacePath: string): DatabaseSync {
  const dbPath = getIndexDbPath(workspacePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  // `projects_fts` needs the same one-time backfill reasoning as the `body`
  // migration below, but `name`/`description`/`tags` were never new columns
  // on `projects` (unlike journal/note `body`) — only the FTS mirror of them
  // is new — so there's no `ALTER TABLE` to hang the "did this just get
  // added?" check on. Check `sqlite_master` directly instead, before the
  // `CREATE VIRTUAL TABLE IF NOT EXISTS` below makes that check moot.
  const projectsFtsExisted =
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects_fts'").get() !== undefined;
  db.exec(SCHEMA);
  // Lightweight migration for an index created before `checklist` existed —
  // `CREATE TABLE IF NOT EXISTS` above is a no-op against an already-existing
  // `tasks` table, so an old index needs the column added explicitly rather
  // than forcing every existing workspace through a full `/api/index/rebuild`.
  // SQLite has no `ADD COLUMN IF NOT EXISTS`; swallow the "duplicate column"
  // error on every subsequent open once it's there.
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // already has the column
  }
  // Same lightweight migration for an index created before `body` was cached
  // on journal_entries/notes (milestone 25). Unlike the `checklist` migration
  // above, a bare default here isn't good enough on its own: reconciliation
  // skips reparsing a file whose `source_mtime` hasn't changed (that's the
  // whole point of it), so an existing, untouched note/journal entry would
  // otherwise keep an empty `body` — and be unsearchable — forever after
  // upgrading. So when (and only when) the `ALTER TABLE` actually adds the
  // column (i.e. this workspace's index predates it), also zero out
  // `source_mtime` on every existing row of that table: the next
  // `reconcileWorkspace` call then sees every row as "changed" (no real
  // file mtime is ever `0`) and reparses it for real, backfilling `body`
  // once. A workspace whose index already has the column skips both steps.
  try {
    db.exec("ALTER TABLE journal_entries ADD COLUMN body TEXT NOT NULL DEFAULT ''");
    db.exec('UPDATE journal_entries SET source_mtime = 0');
  } catch {
    // already has the column
  }
  try {
    db.exec("ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT ''");
    db.exec('UPDATE notes SET source_mtime = 0');
  } catch {
    // already has the column
  }
  // Same migration shape again for `group_name` (project groups): an index
  // predating this field has no way to know each project's group without a
  // reparse, so force one via the usual source_mtime reset — reconciliation
  // then reads it straight off each file's frontmatter (defaulting to
  // 'Default' for a file with no `group` field at all, same as a fresh
  // parse — see lib/markdown/project.ts).
  try {
    db.exec("ALTER TABLE projects ADD COLUMN group_name TEXT NOT NULL DEFAULT 'Default'");
    db.exec('UPDATE projects SET source_mtime = 0');
  } catch {
    // already has the column
  }
  // `projects_fts` just got created for the first time on this index (see
  // the `sqlite_master` check above) — force every existing project to be
  // reparsed on the next reconcile so it actually gets a row, same
  // "unchanged file needs backfill too" reasoning as journal/note body.
  if (!projectsFtsExisted) {
    db.exec('UPDATE projects SET source_mtime = 0');
  }
  return db;
}

/** Deletes the index file (and its WAL/SHM sidecars) so the next
 * `openIndexDb` starts completely fresh — used by an explicit rebuild. */
export function deleteIndexDb(workspacePath: string): void {
  const dbPath = getIndexDbPath(workspacePath);
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
