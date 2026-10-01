// Reconciliation-based (re)indexing (PLAN.md "Sync strategy — reconciliation,
// not blind reparsing" + milestone 4). Walks the workspace directory doing
// only `readdir`/`stat` and reparses just the files that are new or whose
// `mtime` changed since last time — a no-op reopen with nothing changed is
// just stat calls, no parsing.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { extractWikilinks } from '../markdown/wikilinks.js';
import { stripEncryptedTokens } from '../markdown/encrypted.js';
import { parseJournalFile } from '../markdown/journal.js';
import { parseNoteFile } from '../markdown/note.js';
import { parseProjectFile, tasksOfProject } from '../markdown/project.js';
import { deleteIndexDb, openIndexDb } from './db.js';

export interface ReconcileStats {
  projectsScanned: number;
  projectsReparsed: number;
  projectsRemoved: number;
  journalEntriesScanned: number;
  journalEntriesReparsed: number;
  journalEntriesRemoved: number;
  notesScanned: number;
  notesReparsed: number;
  notesRemoved: number;
}

export interface IndexStatus {
  lastReconciledAt: string | null;
  projectCount: number;
  taskCount: number;
  journalEntryCount: number;
  noteCount: number;
}

/** Parses one file, or returns null (with a warning) when it can't be
 * parsed — a single hand-broken or conflict-marked file must not stop the
 * rest of the workspace from indexing. The skipped file keeps whatever row
 * it already had (its stored mtime is left alone, so it's retried on the
 * next reconcile), and reading it directly still reports the real error. */
function tryParse<T>(fullPath: string, content: string, parse: (content: string) => T): T | null {
  try {
    return parse(content);
  } catch (err) {
    console.warn(`[index] skipping unparsable file ${fullPath}: ${firstLine(err)}`);
    return null;
  }
}

function firstLine(err: unknown): string {
  return (err as Error).message.split('\n')[0];
}

/** `fs.statSync`, or null (with a warning) for something that can't be
 * stat'ed — a broken symlink, or a file a sync tool removed between the
 * `readdir` and now. The caller treats it as not there at all, so any row
 * it had is dropped like a deleted file's. */
function tryStat(fullPath: string): fs.Stats | null {
  try {
    return fs.statSync(fullPath);
  } catch (err) {
    console.warn(`[index] skipping unreadable file ${fullPath}: ${firstLine(err)}`);
    return null;
  }
}

/** Runs one file's index writes inside a savepoint: if anything throws —
 * a constraint nobody anticipated, a read failing mid-way — that file's
 * partial writes are rolled back and it's skipped with a warning, instead
 * of aborting reconciliation for every file after it (which, during a
 * rebuild, left the freshly-deleted index half-empty). Same "keeps its old
 * row, retried next time" outcome as `tryParse`. Returns whether it
 * committed. */
function inFileSavepoint(db: DatabaseSync, fullPath: string, write: () => boolean): boolean {
  db.exec('SAVEPOINT index_file');
  try {
    const wrote = write();
    db.exec('RELEASE index_file');
    return wrote;
  } catch (err) {
    db.exec('ROLLBACK TO index_file');
    db.exec('RELEASE index_file');
    console.warn(`[index] skipping file that failed to index ${fullPath}: ${firstLine(err)}`);
    return false;
  }
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Lists `.md` files directly under `dir`, sorted (so anything that depends
 * on processing order — see duplicate task ids in `reconcileProjects` — is
 * deterministic), skipping anything that isn't a readable plain file.
 * Sync-conflict copies (`task-list (conflicted copy 2026-09-10).md`) are
 * still listed; journal's own filename check drops them, and a project
 * copy's duplicate task ids are handled in `reconcileProjects`. Returns `[]`
 * for a missing or unreadable directory rather than throwing, since a
 * brand-new workspace may not have `projects/`/`journal/` populated yet. */
function listFiles(dir: string): string[] {
  return readDirNames(dir)
    .filter((f) => f.endsWith('.md') && tryStat(path.join(dir, f))?.isFile())
    .sort();
}

function readDirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    console.warn(`[index] skipping unreadable directory ${dir}: ${firstLine(err)}`);
    return [];
  }
}

/**
 * Duplicate task ids — the same `<!-- id:... -->` in two project files (a
 * sync tool's "conflicted copy" of a project, a copied file) or twice in one
 * file (a copy-pasted task line) — can't all be indexed, since `tasks.id` is
 * the primary key. The first copy wins: the alphabetically first project
 * slug, and within one file the first line. That's decided by slug, not by
 * which file happened to be reparsed first, so an incremental reconcile
 * always lands where a full rebuild would — a file that sorts earlier takes
 * the id over from a later one, and each losing cross-file copy is recorded
 * in `task_id_shadows` so it's re-tried (its file reparsed) once the winner
 * no longer holds the id. Reading the project files directly still shows
 * every copy; only the index's aggregate views see one.
 */
/** Replaces everything `sourceId` links to (its wikilinks) in the index. */
function replaceWikilinks(db: DatabaseSync, kind: 'task' | 'journal' | 'note', sourceId: string, text: string | null): void {
  db.prepare('DELETE FROM wikilinks WHERE source_kind = ? AND source_id = ?').run(kind, sourceId);
  const insert = db.prepare('INSERT OR IGNORE INTO wikilinks (source_kind, source_id, target) VALUES (?, ?, ?)');
  for (const target of extractWikilinks(text)) insert.run(kind, sourceId, target);
}

function reconcileProjects(workspacePath: string, db: DatabaseSync): { scanned: number; reparsed: number; removed: number } {
  const projectsDir = path.join(workspacePath, 'projects');
  const files = listFiles(projectsDir);
  const seenSlugs = new Set<string>();
  let reparsed = 0;

  const getMtime = db.prepare('SELECT source_mtime FROM projects WHERE slug = ?');
  // `tags` is vestigial (see lib/index/db.ts) — always written as '[]'.
  const upsertProject = db.prepare(`
    INSERT INTO projects (slug, name, created, archived, description, tags, group_name, color, source_mtime, source_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, created = excluded.created, archived = excluded.archived,
      description = excluded.description, tags = excluded.tags, group_name = excluded.group_name, color = excluded.color,
      source_mtime = excluded.source_mtime, source_hash = excluded.source_hash
  `);
  const deleteTasksForSlug = db.prepare('DELETE FROM tasks WHERE project_slug = ?');
  const deleteTaskWikilinksForSlug = db.prepare(
    "DELETE FROM wikilinks WHERE source_kind = 'task' AND source_id IN (SELECT id FROM tasks WHERE project_slug = ?)",
  );
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, project_slug, text, status, due, created_at, doing_since, spent_minutes, done_at, tags, description, checklist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getTaskOwner = db.prepare('SELECT project_slug FROM tasks WHERE id = ?');
  const deleteTaskById = db.prepare('DELETE FROM tasks WHERE id = ?');
  // FTS5 mirror of the same tasks — rebuilt alongside `tasks` on every
  // reparse (milestone 25 "Search improvement"; lib/index/db.ts).
  const deleteTasksFtsForSlug = db.prepare('DELETE FROM tasks_fts WHERE project_slug = ?');
  const deleteTaskFtsById = db.prepare('DELETE FROM tasks_fts WHERE id = ?');
  const insertTaskFts = db.prepare(`
    INSERT INTO tasks_fts (id, project_slug, text, description, tags) VALUES (?, ?, ?, ?, ?)
  `);
  const insertShadow = db.prepare('INSERT OR IGNORE INTO task_id_shadows (id, project_slug) VALUES (?, ?)');
  const deleteShadowsForSlug = db.prepare('DELETE FROM task_id_shadows WHERE project_slug = ?');
  // A losing copy whose id is now free, or now held by a file that sorts
  // after it (the winner dropped it, and a later file picked it up in the
  // same pass) — its file needs reparsing to claim the id.
  const listSlugsToRetry = db.prepare(`
    SELECT DISTINCT s.project_slug AS slug FROM task_id_shadows s LEFT JOIN tasks t ON t.id = s.id
    WHERE t.id IS NULL OR t.project_slug > s.project_slug
    ORDER BY s.project_slug
  `);
  // FTS5 mirror of the project itself (name/description) — added after a
  // follow-up ask to also search project name/description, not just
  // task/note/journal. `tags` (its 4th column) is vestigial, always ''
  // (projects have no tags anymore — group filtering is a plain equality
  // match, not full-text, so it isn't in this mirror).
  const deleteProjectFts = db.prepare('DELETE FROM projects_fts WHERE slug = ?');
  const insertProjectFts = db.prepare('INSERT INTO projects_fts (slug, name, description, tags) VALUES (?, ?, ?, ?)');

  function reparse(slug: string, fullPath: string, stat: fs.Stats): boolean {
    return inFileSavepoint(db, fullPath, () => {
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = tryParse(fullPath, content, (c) => parseProjectFile(c, slug));
      if (!parsed) return false;
      const tasks = tasksOfProject(parsed);

      upsertProject.run(
        slug,
        parsed.frontmatter.name,
        parsed.frontmatter.created,
        parsed.frontmatter.archived ? 1 : 0,
        parsed.frontmatter.description,
        '[]',
        parsed.frontmatter.group,
        parsed.frontmatter.color,
        stat.mtimeMs,
        hashContent(content),
      );
      deleteProjectFts.run(slug);
      insertProjectFts.run(slug, parsed.frontmatter.name, parsed.frontmatter.description, '');
      deleteTaskWikilinksForSlug.run(slug);
      deleteTasksForSlug.run(slug);
      deleteTasksFtsForSlug.run(slug);
      deleteShadowsForSlug.run(slug);
      const idsInFile = new Set<string>();
      for (const task of tasks) {
        if (idsInFile.has(task.id)) {
          console.warn(`[index] task id ${task.id} appears more than once in ${fullPath} — indexing only the first`);
          continue;
        }
        idsInFile.add(task.id);
        const owner = (getTaskOwner.get(task.id) as { project_slug: string } | undefined)?.project_slug;
        if (owner !== undefined) {
          const [winner, loser] = owner < slug ? [owner, slug] : [slug, owner];
          console.warn(`[index] task id ${task.id} is in both projects/${winner}.md and projects/${loser}.md — indexing only the first`);
          insertShadow.run(task.id, loser);
          if (winner === owner) continue;
          deleteTaskById.run(task.id);
          deleteTaskFtsById.run(task.id);
        }
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
          JSON.stringify(task.checklist),
        );
        insertTaskFts.run(task.id, slug, task.text, task.description ?? '', JSON.stringify(task.tags));
        replaceWikilinks(db, 'task', task.id, task.description);
      }
      return true;
    });
  }

  for (const file of files) {
    const slug = file.slice(0, -'.md'.length);
    const fullPath = path.join(projectsDir, file);
    const stat = tryStat(fullPath);
    if (!stat) continue;
    seenSlugs.add(slug);

    const existing = getMtime.get(slug) as { source_mtime: number } | undefined;
    if (existing && existing.source_mtime === stat.mtimeMs) continue; // unchanged: stat only, no parse

    if (reparse(slug, fullPath, stat)) reparsed++;
  }

  const indexedSlugs = (db.prepare('SELECT slug FROM projects').all() as { slug: string }[]).map((r) => r.slug);
  const deleteProject = db.prepare('DELETE FROM projects WHERE slug = ?');
  let removed = 0;
  for (const slug of indexedSlugs) {
    if (seenSlugs.has(slug)) continue;
    deleteTaskWikilinksForSlug.run(slug);
    deleteTasksForSlug.run(slug);
    deleteTasksFtsForSlug.run(slug);
    deleteProjectFts.run(slug);
    deleteShadowsForSlug.run(slug);
    deleteProject.run(slug);
    removed++;
  }

  // Re-try losing duplicate-id copies whose winner let go (see above). One
  // pass normally settles it; the cap only guards against looping forever
  // on a file that keeps failing to reparse.
  for (let pass = 0; pass < 5; pass++) {
    const retry = (listSlugsToRetry.all() as { slug: string }[]).map((r) => r.slug);
    if (retry.length === 0) break;
    for (const slug of retry) {
      const fullPath = path.join(projectsDir, `${slug}.md`);
      const stat = seenSlugs.has(slug) ? tryStat(fullPath) : null;
      if (!stat) {
        deleteShadowsForSlug.run(slug);
        continue;
      }
      if (reparse(slug, fullPath, stat)) reparsed++;
      else deleteShadowsForSlug.run(slug);
    }
  }

  return { scanned: files.length, reparsed, removed };
}

function reconcileJournal(workspacePath: string, db: DatabaseSync): { scanned: number; reparsed: number; removed: number } {
  const journalDir = path.join(workspacePath, 'journal');
  const years = readDirNames(journalDir).filter((y) => /^\d{4}$/.test(y) && tryStat(path.join(journalDir, y))?.isDirectory());

  const seenDates = new Set<string>();
  let scanned = 0;
  let reparsed = 0;

  const getMtime = db.prepare('SELECT source_mtime FROM journal_entries WHERE date = ?');
  const upsertEntry = db.prepare(`
    INSERT INTO journal_entries (date, year, has_body, tags, body, source_mtime, source_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      year = excluded.year, has_body = excluded.has_body, tags = excluded.tags, body = excluded.body,
      source_mtime = excluded.source_mtime, source_hash = excluded.source_hash
  `);
  const deleteLinksForDate = db.prepare('DELETE FROM journal_task_links WHERE date = ?');
  // OR IGNORE: a hand edit or merge can list the same task id twice in
  // `linkedTasks`; one link row is the same meaning.
  const insertLink = db.prepare('INSERT OR IGNORE INTO journal_task_links (date, task_id) VALUES (?, ?)');
  // FTS5 mirror (milestone 25 "Search improvement") — delete-then-insert per
  // date, same as the plain `journal_entries` upsert above (FTS5 has no
  // ON CONFLICT upsert against a non-rowid key).
  const deleteJournalFtsForDate = db.prepare('DELETE FROM journal_fts WHERE date = ?');
  const insertJournalFts = db.prepare('INSERT INTO journal_fts (date, tags, body) VALUES (?, ?, ?)');

  for (const year of years) {
    const yearDir = path.join(journalDir, year);
    // Journal filenames are YYYY-MM-DD.md exactly; anything else (including
    // sync-conflict copies) is left alone rather than erroring. So is a file
    // in the wrong year folder (`journal/2025/2026-09-01.md`): the journal
    // service only ever reads `journal/<year of date>/`, so indexing it
    // would show content the app can't open — or, next to the real file,
    // let whichever one was scanned last overwrite the other's row.
    const files = readDirNames(yearDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
    for (const file of files) {
      const date = file.slice(0, -'.md'.length);
      const fullPath = path.join(yearDir, file);
      if (!date.startsWith(`${year}-`)) {
        console.warn(`[index] skipping journal file in the wrong year folder ${fullPath} (expected journal/${date.slice(0, 4)}/)`);
        continue;
      }
      const stat = tryStat(fullPath);
      if (!stat?.isFile()) continue;
      seenDates.add(date);
      scanned++;

      const existing = getMtime.get(date) as { source_mtime: number } | undefined;
      if (existing && existing.source_mtime === stat.mtimeMs) continue;

      const wrote = inFileSavepoint(db, fullPath, () => {
        const content = fs.readFileSync(fullPath, 'utf8');
        const parsed = tryParse(fullPath, content, parseJournalFile);
        if (!parsed) return false;
        const hasBody = parsed.body.trim().length > 0;
        // Ciphertext never reaches the index (milestone 31, "Encryption") —
        // encrypted content is deliberately unsearchable. `hasBody` still
        // looks at the raw body: an all-encrypted entry isn't empty.
        const indexedBody = stripEncryptedTokens(parsed.body);

        upsertEntry.run(
          date,
          year,
          hasBody ? 1 : 0,
          JSON.stringify(parsed.frontmatter.tags),
          indexedBody,
          stat.mtimeMs,
          hashContent(content),
        );
        deleteLinksForDate.run(date);
        for (const taskId of parsed.frontmatter.linkedTasks) {
          insertLink.run(date, taskId);
        }
        deleteJournalFtsForDate.run(date);
        insertJournalFts.run(date, JSON.stringify(parsed.frontmatter.tags), indexedBody);
        replaceWikilinks(db, 'journal', date, parsed.body);
        return true;
      });
      if (wrote) reparsed++;
    }
  }

  const indexedDates = (db.prepare('SELECT date FROM journal_entries').all() as { date: string }[]).map((r) => r.date);
  const deleteEntry = db.prepare('DELETE FROM journal_entries WHERE date = ?');
  let removed = 0;
  for (const date of indexedDates) {
    if (seenDates.has(date)) continue;
    deleteLinksForDate.run(date);
    deleteJournalFtsForDate.run(date);
    replaceWikilinks(db, 'journal', date, null);
    deleteEntry.run(date);
    removed++;
  }

  return { scanned, reparsed, removed };
}

function reconcileNotes(workspacePath: string, db: DatabaseSync): { scanned: number; reparsed: number; removed: number } {
  const notesDir = path.join(workspacePath, 'notes');
  const files = listFiles(notesDir);
  const seenSlugs = new Set<string>();
  let reparsed = 0;

  const getMtime = db.prepare('SELECT source_mtime FROM notes WHERE slug = ?');
  const upsertNote = db.prepare(`
    INSERT INTO notes (slug, title, created, updated, tags, body, source_mtime, source_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title, created = excluded.created, updated = excluded.updated,
      tags = excluded.tags, body = excluded.body, source_mtime = excluded.source_mtime, source_hash = excluded.source_hash
  `);
  // FTS5 mirror (milestone 25 "Search improvement") — delete-then-insert per
  // slug, same reasoning as journal_fts above.
  const deleteNotesFtsForSlug = db.prepare('DELETE FROM notes_fts WHERE slug = ?');
  const insertNoteFts = db.prepare('INSERT INTO notes_fts (slug, title, tags, body) VALUES (?, ?, ?, ?)');

  for (const file of files) {
    const slug = file.slice(0, -'.md'.length);
    const fullPath = path.join(notesDir, file);
    const stat = tryStat(fullPath);
    if (!stat) continue;
    seenSlugs.add(slug);

    const existing = getMtime.get(slug) as { source_mtime: number } | undefined;
    if (existing && existing.source_mtime === stat.mtimeMs) continue; // unchanged: stat only, no parse

    const wrote = inFileSavepoint(db, fullPath, () => {
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = tryParse(fullPath, content, parseNoteFile);
      if (!parsed) return false;
      const indexedBody = stripEncryptedTokens(parsed.body); // same as journal above

      upsertNote.run(
        slug,
        parsed.frontmatter.title,
        parsed.frontmatter.created,
        parsed.frontmatter.updated,
        JSON.stringify(parsed.frontmatter.tags),
        indexedBody,
        stat.mtimeMs,
        hashContent(content),
      );
      deleteNotesFtsForSlug.run(slug);
      insertNoteFts.run(slug, parsed.frontmatter.title, JSON.stringify(parsed.frontmatter.tags), indexedBody);
      replaceWikilinks(db, 'note', slug, parsed.body);
      return true;
    });
    if (wrote) reparsed++;
  }

  const indexedSlugs = (db.prepare('SELECT slug FROM notes').all() as { slug: string }[]).map((r) => r.slug);
  const deleteNote = db.prepare('DELETE FROM notes WHERE slug = ?');
  let removed = 0;
  for (const slug of indexedSlugs) {
    if (seenSlugs.has(slug)) continue;
    deleteNotesFtsForSlug.run(slug);
    replaceWikilinks(db, 'note', slug, null);
    deleteNote.run(slug);
    removed++;
  }

  return { scanned: files.length, reparsed, removed };
}

/** Runs one reconciliation pass over the workspace: reparses only new/changed
 * project, journal, and note files, and drops index rows for files that no
 * longer exist. Safe to call repeatedly — a no-op reopen with nothing
 * changed costs only `readdir`/`stat` calls. */
export function reconcileWorkspace(workspacePath: string): ReconcileStats {
  const db = openIndexDb(workspacePath);
  try {
    const projects = reconcileProjects(workspacePath, db);
    const journal = reconcileJournal(workspacePath, db);
    const notes = reconcileNotes(workspacePath, db);
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
      notesScanned: notes.scanned,
      notesReparsed: notes.reparsed,
      notesRemoved: notes.removed,
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
    const noteCount = (db.prepare('SELECT COUNT(*) as c FROM notes').get() as { c: number }).c;
    return {
      lastReconciledAt: meta?.value ?? null,
      projectCount,
      taskCount,
      journalEntryCount,
      noteCount,
    };
  } finally {
    db.close();
  }
}
