// Reconciliation-based (re)indexing (PLAN.md "Sync strategy — reconciliation,
// not blind reparsing" + milestone 4). Walks the workspace directory doing
// only `readdir`/`stat` and reparses just the files that are new or whose
// `mtime` changed since last time — a no-op reopen with nothing changed is
// just stat calls, no parsing.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { parseJournalFile } from '../markdown/journal.js';
import { parseProjectFile, tasksOfProject } from '../markdown/project.js';
import { deleteIndexDb, openIndexDb } from './db.js';

export interface ReconcileStats {
  projectsScanned: number;
  projectsReparsed: number;
  projectsRemoved: number;
  journalEntriesScanned: number;
  journalEntriesReparsed: number;
  journalEntriesRemoved: number;
}

export interface IndexStatus {
  lastReconciledAt: string | null;
  projectCount: number;
  taskCount: number;
  journalEntryCount: number;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Lists `.md` files directly under `dir`, skipping anything that isn't a
 * plain `.md` file (e.g. sync-conflict artifacts like
 * `task-list (conflicted copy 2026-09-10).md` won't match callers' further
 * naming checks and are simply left alone rather than erroring — PLAN.md
 * "Remote & cloud sync"). Returns `[]` for a missing directory rather than
 * throwing, since a brand-new workspace may not have `projects/`/`journal/`
 * populated yet. */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile());
}

function reconcileProjects(workspacePath: string, db: DatabaseSync): { scanned: number; reparsed: number; removed: number } {
  const projectsDir = path.join(workspacePath, 'projects');
  const files = listFiles(projectsDir);
  const seenSlugs = new Set<string>();
  let reparsed = 0;

  const getMtime = db.prepare('SELECT source_mtime FROM projects WHERE slug = ?');
  const upsertProject = db.prepare(`
    INSERT INTO projects (slug, name, created, archived, description, tags, color, source_mtime, source_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, created = excluded.created, archived = excluded.archived,
      description = excluded.description, tags = excluded.tags, color = excluded.color,
      source_mtime = excluded.source_mtime, source_hash = excluded.source_hash
  `);
  const deleteTasksForSlug = db.prepare('DELETE FROM tasks WHERE project_slug = ?');
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, project_slug, text, status, due, created_at, doing_since, spent_minutes, done_at, tags, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const file of files) {
    const slug = file.slice(0, -'.md'.length);
    seenSlugs.add(slug);
    const fullPath = path.join(projectsDir, file);
    const stat = fs.statSync(fullPath);

    const existing = getMtime.get(slug) as { source_mtime: number } | undefined;
    if (existing && existing.source_mtime === stat.mtimeMs) continue; // unchanged: stat only, no parse

    const content = fs.readFileSync(fullPath, 'utf8');
    const parsed = parseProjectFile(content);
    const tasks = tasksOfProject(parsed);

    upsertProject.run(
      slug,
      parsed.frontmatter.name,
      parsed.frontmatter.created,
      parsed.frontmatter.archived ? 1 : 0,
      parsed.frontmatter.description,
      JSON.stringify(parsed.frontmatter.tags),
      parsed.frontmatter.color,
      stat.mtimeMs,
      hashContent(content),
    );
    deleteTasksForSlug.run(slug);
    for (const task of tasks) {
      insertTask.run(
        task.id,
        slug,
        task.text,
        task.status,
        task.due,
        task.created,
        task.doingSince,
        task.spentMinutes,
        task.doneAt,
        JSON.stringify(task.tags),
        task.description,
      );
    }
    reparsed++;
  }

  const indexedSlugs = (db.prepare('SELECT slug FROM projects').all() as { slug: string }[]).map((r) => r.slug);
  const deleteProject = db.prepare('DELETE FROM projects WHERE slug = ?');
  let removed = 0;
  for (const slug of indexedSlugs) {
    if (seenSlugs.has(slug)) continue;
    deleteTasksForSlug.run(slug);
    deleteProject.run(slug);
    removed++;
  }

  return { scanned: files.length, reparsed, removed };
}

function reconcileJournal(workspacePath: string, db: DatabaseSync): { scanned: number; reparsed: number; removed: number } {
  const journalDir = path.join(workspacePath, 'journal');
  const years = fs.existsSync(journalDir)
    ? fs.readdirSync(journalDir).filter((y) => /^\d{4}$/.test(y) && fs.statSync(path.join(journalDir, y)).isDirectory())
    : [];

  const seenDates = new Set<string>();
  let scanned = 0;
  let reparsed = 0;

  const getMtime = db.prepare('SELECT source_mtime FROM journal_entries WHERE date = ?');
  const upsertEntry = db.prepare(`
    INSERT INTO journal_entries (date, year, has_body, tags, source_mtime, source_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      year = excluded.year, has_body = excluded.has_body, tags = excluded.tags,
      source_mtime = excluded.source_mtime, source_hash = excluded.source_hash
  `);
  const deleteLinksForDate = db.prepare('DELETE FROM journal_task_links WHERE date = ?');
  const insertLink = db.prepare('INSERT INTO journal_task_links (date, task_id) VALUES (?, ?)');

  for (const year of years) {
    const yearDir = path.join(journalDir, year);
    // Journal filenames are YYYY-MM-DD.md exactly; anything else (including
    // sync-conflict copies) is left alone rather than erroring.
    const files = fs.readdirSync(yearDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    for (const file of files) {
      const date = file.slice(0, -'.md'.length);
      seenDates.add(date);
      scanned++;
      const fullPath = path.join(yearDir, file);
      const stat = fs.statSync(fullPath);

      const existing = getMtime.get(date) as { source_mtime: number } | undefined;
      if (existing && existing.source_mtime === stat.mtimeMs) continue;

      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = parseJournalFile(content);
      const hasBody = parsed.body.trim().length > 0;

      upsertEntry.run(date, year, hasBody ? 1 : 0, JSON.stringify(parsed.frontmatter.tags), stat.mtimeMs, hashContent(content));
      deleteLinksForDate.run(date);
      for (const taskId of parsed.frontmatter.linkedTasks) {
        insertLink.run(date, taskId);
      }
      reparsed++;
    }
  }

  const indexedDates = (db.prepare('SELECT date FROM journal_entries').all() as { date: string }[]).map((r) => r.date);
  const deleteEntry = db.prepare('DELETE FROM journal_entries WHERE date = ?');
  let removed = 0;
  for (const date of indexedDates) {
    if (seenDates.has(date)) continue;
    deleteLinksForDate.run(date);
    deleteEntry.run(date);
    removed++;
  }

  return { scanned, reparsed, removed };
}

/** Runs one reconciliation pass over the workspace: reparses only new/changed
 * project and journal files, and drops index rows for files that no longer
 * exist. Safe to call repeatedly — a no-op reopen with nothing changed costs
 * only `readdir`/`stat` calls. */
export function reconcileWorkspace(workspacePath: string): ReconcileStats {
  const db = openIndexDb(workspacePath);
  try {
    const projects = reconcileProjects(workspacePath, db);
    const journal = reconcileJournal(workspacePath, db);
    db.prepare(
      `INSERT INTO index_meta (key, value) VALUES ('lastReconciledAt', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(new Date().toISOString());
    return {
      projectsScanned: projects.scanned,
      projectsReparsed: projects.reparsed,
      projectsRemoved: projects.removed,
      journalEntriesScanned: journal.scanned,
      journalEntriesReparsed: journal.reparsed,
      journalEntriesRemoved: journal.removed,
    };
  } finally {
    db.close();
  }
}

/** Explicit forced full reparse (`POST /api/index/rebuild`): drops the index
 * file entirely and reconciles from scratch. Deleting it and reindexing must
 * always reproduce identical query results from a clean scan (PLAN.md's
 * "hard portability constraint"). */
export function rebuildIndex(workspacePath: string): ReconcileStats {
  deleteIndexDb(workspacePath);
  return reconcileWorkspace(workspacePath);
}

export function getIndexStatus(workspacePath: string): IndexStatus {
  const db = openIndexDb(workspacePath);
  try {
    const meta = db.prepare('SELECT value FROM index_meta WHERE key = ?').get('lastReconciledAt') as
      | { value: string }
      | undefined;
    const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c;
    const taskCount = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }).c;
    const journalEntryCount = (db.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as { c: number }).c;
    return {
      lastReconciledAt: meta?.value ?? null,
      projectCount,
      taskCount,
      journalEntryCount,
    };
  } finally {
    db.close();
  }
}
