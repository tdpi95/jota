// SQLite index schema + connection (PLAN.md "SQLite index layer"). One index
// per workspace at `<workspace>/.pivot/cache/index.sqlite3`, WAL mode so the
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
  return path.join(workspacePath, '.pivot', 'cache', 'index.sqlite3');
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
  tags TEXT NOT NULL,
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
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_slug ON tasks(project_slug);

CREATE TABLE IF NOT EXISTS journal_entries (
  date TEXT PRIMARY KEY,
  year TEXT NOT NULL,
  has_body INTEGER NOT NULL,
  tags TEXT NOT NULL,
  source_mtime REAL NOT NULL,
  source_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_year ON journal_entries(year);

CREATE TABLE IF NOT EXISTS journal_task_links (
  date TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (date, task_id)
);

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Opens (creating if needed) the workspace's index DB with the schema
 * applied. Callers are responsible for `.close()`-ing what they open. */
export function openIndexDb(workspacePath: string): DatabaseSync {
  const dbPath = getIndexDbPath(workspacePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
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
