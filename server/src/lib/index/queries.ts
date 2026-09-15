// Read-only aggregate queries against the workspace's SQLite index (PLAN.md
// "Which reads go where" — aggregate/cross-file views are the only reads
// that go through the index rather than the source files directly, and can
// show stale data until the next reconciliation). All direct `node:sqlite`
// access for these queries lives here, alongside lib/index/db.ts's schema
// and lib/index/reindex.ts's writes — isolating the still-experimental API
// to lib/index/*.ts (PLAN.md).

import { openIndexDb } from './db.js';
import type { ChecklistItem, TaskStatus } from '../../types.js';

export interface IndexedTask {
  id: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
  /** The owning project's group — a task has no group field of its own, it
   * inherits this at query time (PLAN.md "Task line grammar"). */
  projectGroup: string;
  text: string;
  status: TaskStatus;
  due: string | null;
  createdAt: string;
  doingSince: string | null;
  spentMinutes: number;
  doneAt: string | null;
  tags: string[];
  description: string | null;
  checklist: ChecklistItem[];
}

interface TaskJoinRow {
  id: string;
  project_slug: string;
  text: string;
  status: TaskStatus;
  due: string | null;
  created_at: string;
  doing_since: string | null;
  spent_minutes: number;
  done_at: string | null;
  tags: string;
  description: string | null;
  checklist: string;
  project_name: string;
  project_color: string;
  project_group: string;
}

function mapTaskRow(row: TaskJoinRow): IndexedTask {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    projectColor: row.project_color,
    projectGroup: row.project_group,
    text: row.text,
    status: row.status,
    due: row.due,
    createdAt: row.created_at,
    doingSince: row.doing_since,
    spentMinutes: row.spent_minutes,
    doneAt: row.done_at,
    tags: JSON.parse(row.tags) as string[],
    description: row.description,
    checklist: JSON.parse(row.checklist) as ChecklistItem[],
  };
}

const TASK_JOIN_SELECT = `
  SELECT t.id, t.project_slug, t.text, t.status, t.due, t.created_at, t.doing_since,
         t.spent_minutes, t.done_at, t.tags, t.description, t.checklist,
         p.name AS project_name, p.color AS project_color, p.group_name AS project_group
  FROM tasks t
  JOIN projects p ON p.slug = t.project_slug
`;

/** All not-done tasks across every project, due-date-first (undated last),
 * then oldest-created first — backs `GET /api/tasks/open`. */
export function queryOpenTasks(workspacePath: string): IndexedTask[] {
  const db = openIndexDb(workspacePath);
  try {
    const rows = db
      .prepare(`${TASK_JOIN_SELECT} WHERE t.status != 'done' ORDER BY (t.due IS NULL), t.due ASC, t.created_at ASC`)
      .all() as unknown as TaskJoinRow[];
    return rows.map(mapTaskRow);
  } finally {
    db.close();
  }
}

/** Case-insensitive substring match over task text/description/tags, newest
 * first, capped at 50 — backs `GET /api/tasks/search?q=` and the Dashboard's
 * task-search popup (milestone 18: "search by text or tags" as one input).
 * `tags` is stored as a JSON-array string (e.g. `["polish","backend"]`), so
 * matching it with the same LIKE is a plain substring match against that
 * serialized form — same fuzzy-match trade-off text/description already
 * have (a query could straddle two tag names at the `","` boundary), judged
 * acceptable for a quick-find search rather than worth a separate exact-tag
 * query path. */
export function querySearchTasks(workspacePath: string, q: string): IndexedTask[] {
  const db = openIndexDb(workspacePath);
  try {
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `${TASK_JOIN_SELECT} WHERE t.text LIKE ? COLLATE NOCASE OR t.description LIKE ? COLLATE NOCASE OR t.tags LIKE ? COLLATE NOCASE
         ORDER BY t.created_at DESC LIMIT 50`,
      )
      .all(like, like, like) as unknown as TaskJoinRow[];
    return rows.map(mapTaskRow);
  } finally {
    db.close();
  }
}

export function queryTaskById(workspacePath: string, taskId: string): IndexedTask | null {
  const db = openIndexDb(workspacePath);
  try {
    const row = db.prepare(`${TASK_JOIN_SELECT} WHERE t.id = ?`).get(taskId) as TaskJoinRow | undefined;
    return row ? mapTaskRow(row) : null;
  } finally {
    db.close();
  }
}

/** Dates of every journal entry linking to a task, ascending — backs
 * `GET /api/tasks/:taskId/journal-links`. */
export function queryJournalLinksForTask(workspacePath: string, taskId: string): string[] {
  const db = openIndexDb(workspacePath);
  try {
    const rows = db.prepare('SELECT date FROM journal_task_links WHERE task_id = ? ORDER BY date').all(taskId) as {
      date: string;
    }[];
    return rows.map((r) => r.date);
  } finally {
    db.close();
  }
}

export interface CalendarTaskMark {
  taskId: string;
  projectSlug: string;
  projectColor: string;
  /** Task title — lets a full calendar view (CalendarPage) print the task
   * itself, not just a dot; CalendarSidebar ignores this field. */
  text: string;
  status: TaskStatus;
  /** 'due' = the task is due that day; 'linked' = that day's journal entry
   * links to the task. A task can appear for both reasons on different days,
   * or dedup to a single 'due' mark if both are true the same day. */
  reason: 'due' | 'linked';
}

export interface CalendarDay {
  date: string;
  hasJournalEntry: boolean;
  tasks: CalendarTaskMark[];
}

/**
 * Sparse per-day marks for one month — only dates with a non-empty journal
 * entry, a task due, or a task linked via that day's journal entry — backs
 * `GET /api/calendar/:year/:month` (PLAN.md's CalendarSidebar: "marks days
 * with a journal entry, and colored dots ... for linked/due tasks"). The
 * frontend already knows which dates exist in a month; this doesn't return
 * empty entries for every blank day.
 */
export function queryCalendarMonth(workspacePath: string, year: string, month: string): CalendarDay[] {
  const prefix = `${year}-${month}`;
  const from = `${prefix}-01`;
  const to = `${prefix}-31`; // string comparison — safe even for short months, see below

  const db = openIndexDb(workspacePath);
  try {
    const journalRows = db
      .prepare('SELECT date FROM journal_entries WHERE date BETWEEN ? AND ? AND has_body = 1')
      .all(from, to) as { date: string }[];

    const dueRows = db
      .prepare(
        `SELECT t.due AS date, t.id, t.project_slug, p.color AS project_color, t.text, t.status
         FROM tasks t JOIN projects p ON p.slug = t.project_slug
         WHERE t.due BETWEEN ? AND ?`,
      )
      .all(from, to) as { date: string; id: string; project_slug: string; project_color: string; text: string; status: TaskStatus }[];

    const linkedRows = db
      .prepare(
        `SELECT l.date, l.task_id AS id, t.project_slug, p.color AS project_color, t.text, t.status
         FROM journal_task_links l
         JOIN tasks t ON t.id = l.task_id
         JOIN projects p ON p.slug = t.project_slug
         WHERE l.date BETWEEN ? AND ?`,
      )
      .all(from, to) as { date: string; id: string; project_slug: string; project_color: string; text: string; status: TaskStatus }[];

    const days = new Map<string, CalendarDay>();
    const dayOf = (date: string): CalendarDay => {
      let day = days.get(date);
      if (!day) {
        day = { date, hasJournalEntry: false, tasks: [] };
        days.set(date, day);
      }
      return day;
    };

    for (const row of journalRows) dayOf(row.date).hasJournalEntry = true;
    for (const row of dueRows) {
      dayOf(row.date).tasks.push({
        taskId: row.id,
        projectSlug: row.project_slug,
        projectColor: row.project_color,
        text: row.text,
        status: row.status,
        reason: 'due',
      });
    }
    for (const row of linkedRows) {
      const day = dayOf(row.date);
      if (!day.tasks.some((m) => m.taskId === row.id)) {
        day.tasks.push({
          taskId: row.id,
          projectSlug: row.project_slug,
          projectColor: row.project_color,
          text: row.text,
          status: row.status,
          reason: 'linked',
        });
      }
    }

    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  } finally {
    db.close();
  }
}

/**
 * A single representative date for a task, used by anything that needs to
 * bucket/filter tasks by "when" despite the file format only storing
 * point-in-time fields and no per-session log (PLAN.md "Time tracking ...
 * no separate start/stop control"): `doneAt` if finished, else `due` if
 * set, else the day it was created. Shared by services/reports.ts's
 * time-spent grouping and services/tasks.ts's `getTaskSummary`.
 */
export function relevantDateOf(task: IndexedTask): string {
  return task.doneAt ?? task.due ?? task.createdAt.slice(0, 10);
}

/** Every task with its project, unfiltered — callers (services/reports.ts,
 * services/tasks.ts's getTaskSummary) do their own filtering/grouping in JS
 * (a personal vault's task count is small; a SQL rewrite isn't worth the
 * complexity). */
export function queryAllTasksForReport(workspacePath: string): IndexedTask[] {
  const db = openIndexDb(workspacePath);
  try {
    const rows = db.prepare(TASK_JOIN_SELECT).all() as unknown as TaskJoinRow[];
    return rows.map(mapTaskRow);
  } finally {
    db.close();
  }
}

export interface IndexedNote {
  slug: string;
  title: string;
  /** ISO8601 UTC */
  created: string;
  /** ISO8601 UTC */
  updated: string;
  tags: string[];
}

interface NoteRow {
  slug: string;
  title: string;
  created: string;
  updated: string;
  tags: string;
}

function mapNoteRow(row: NoteRow): IndexedNote {
  return { slug: row.slug, title: row.title, created: row.created, updated: row.updated, tags: JSON.parse(row.tags) as string[] };
}

const NOTE_SELECT = 'SELECT slug, title, created, updated, tags FROM notes';

/** Every note's metadata (no body — see below), most-recently-updated
 * first — backs `GET /api/notes`. */
export function queryAllNotes(workspacePath: string): IndexedNote[] {
  const db = openIndexDb(workspacePath);
  try {
    const rows = db.prepare(`${NOTE_SELECT} ORDER BY updated DESC`).all() as unknown as NoteRow[];
    return rows.map(mapNoteRow);
  } finally {
    db.close();
  }
}

/** Case-insensitive substring match over title/tags, most-recently-updated
 * first, capped at 50 — backs `GET /api/notes?q=` and the `list_notes` MCP
 * tool. Never matches body text: like journal entries (PLAN.md "Frontend
 * Calendar page" / `listJournalYearFull`'s reasoning), the index never
 * caches note body — only file-direct reads (`getNote`) ever see it. */
export function querySearchNotes(workspacePath: string, q: string): IndexedNote[] {
  const db = openIndexDb(workspacePath);
  try {
    const like = `%${q}%`;
    const rows = db
      .prepare(`${NOTE_SELECT} WHERE title LIKE ? COLLATE NOCASE OR tags LIKE ? COLLATE NOCASE ORDER BY updated DESC LIMIT 50`)
      .all(like, like) as unknown as NoteRow[];
    return rows.map(mapNoteRow);
  } finally {
    db.close();
  }
}

// --- Cross-type full-text search (PLAN.md "Search (cross-type full-text)",
// milestone 25) — searches the FTS5 mirrors lib/index/db.ts/reindex.ts
// maintain (tasks_fts/notes_fts/journal_fts/projects_fts), which unlike the
// LIKE-based queries above also match task description, note body, journal
// body, and project description. ---

export type SearchContentType = 'task' | 'note' | 'journal' | 'project';

export interface SearchInput {
  query: string;
  /** YYYY-MM-DD, inclusive; filters each result on its own type's natural
   * date (task: `relevantDateOf`; note: `updated`; journal: the entry's own
   * date; project: `created`, the only date a project has) — same field
   * each type's other date-filtered view already uses. */
  from?: string;
  to?: string;
  /** Restricts which content types are searched; all four if omitted. */
  types?: SearchContentType[];
}

interface TaskSearchResult {
  type: 'task';
  /** The date this result was matched/sorted on (`relevantDateOf`). */
  date: string;
  snippet: string;
  task: IndexedTask;
}

interface NoteSearchResult {
  type: 'note';
  date: string;
  snippet: string;
  note: IndexedNote;
}

interface JournalSearchResult {
  type: 'journal';
  date: string;
  snippet: string;
  tags: string[];
}

export interface IndexedProject {
  slug: string;
  name: string;
  description: string;
  group: string;
  color: string;
  archived: boolean;
  created: string;
}

interface ProjectSearchResult {
  type: 'project';
  date: string;
  snippet: string;
  project: IndexedProject;
}

export type SearchResult = TaskSearchResult | NoteSearchResult | JournalSearchResult | ProjectSearchResult;

/**
 * Turns free text into an FTS5 MATCH expression: each whitespace-separated
 * token is quoted as a literal phrase (doubling any embedded `"`, FTS5's own
 * escape) with a trailing `*` *outside* the closing quote — `"zago"*`, not
 * `"zago*"` (the latter is a literal, non-matching character inside the
 * phrase; confirmed empirically against this project's `node:sqlite`
 * build) — which FTS5 treats as a prefix query on that phrase's last token,
 * so a partial word like "zago" matches a stored "zagoo" the same way a
 * quick-find search box is expected to, not just a whole-word match. Tokens
 * are joined with FTS5's default implicit AND between them. Deliberately
 * not "pass the query straight through" — FTS5's own query syntax (bare
 * `AND`/`OR`/`NOT`, `column:` filters, unbalanced quotes) would otherwise
 * throw a syntax error on perfectly ordinary text a user might search for
 * (a version string, a path, "C++"), rather than just matching it
 * literally. Returns `''` for an empty/whitespace-only query — callers
 * treat that as "no results", same as `searchTasks`/`searchNotes`'s
 * existing empty-query convention.
 */
function toFtsMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' ');
}

const SNIPPET_EXPR = (ftsTable: string) => `snippet(${ftsTable}, -1, '**', '**', '…', 12)`;

function inRange(date: string, from: string | undefined, to: string | undefined): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/**
 * Unions matches from `tasks_fts`/`notes_fts`/`journal_fts`/`projects_fts`
 * into one list, each independently date-filtered, then merges and sorts by
 * date (most recent first) and caps at 50 — the same cap `querySearchTasks`/
 * `querySearchNotes` already use. Sorting on date rather than relevance is
 * deliberate: FTS5's `bm25()` score is only comparable *within* one virtual
 * table's own corpus, so "relevance" isn't a single meaningful ranking once
 * results come from four separate FTS tables — recency is the same
 * tie-break every other aggregate view here already uses (notes by
 * `updated`, tasks by `created_at`, journal by date, project by `created`).
 */
export function queryFullTextSearch(workspacePath: string, input: SearchInput): SearchResult[] {
  const matchQuery = toFtsMatchQuery(input.query);
  if (!matchQuery) return [];
  const types =
    input.types && input.types.length > 0
      ? new Set(input.types)
      : new Set<SearchContentType>(['task', 'note', 'journal', 'project']);

  const db = openIndexDb(workspacePath);
  try {
    const results: SearchResult[] = [];

    if (types.has('task')) {
      const rows = db
        .prepare(
          `SELECT t.id, t.project_slug, t.text, t.status, t.due, t.created_at, t.doing_since,
                  t.spent_minutes, t.done_at, t.tags, t.description, t.checklist,
                  p.name AS project_name, p.color AS project_color, p.group_name AS project_group, ${SNIPPET_EXPR('tasks_fts')} AS snippet
           FROM tasks_fts
           JOIN tasks t ON t.id = tasks_fts.id
           JOIN projects p ON p.slug = t.project_slug
           WHERE tasks_fts MATCH ?
           ORDER BY bm25(tasks_fts)
           LIMIT 100`,
        )
        .all(matchQuery) as unknown as (TaskJoinRow & { snippet: string })[];
      for (const row of rows) {
        const task = mapTaskRow(row);
        const date = relevantDateOf(task);
        if (inRange(date, input.from, input.to)) results.push({ type: 'task', date, snippet: row.snippet, task });
      }
    }

    if (types.has('note')) {
      const rows = db
        .prepare(
          `SELECT n.slug, n.title, n.created, n.updated, n.tags, ${SNIPPET_EXPR('notes_fts')} AS snippet
           FROM notes_fts
           JOIN notes n ON n.slug = notes_fts.slug
           WHERE notes_fts MATCH ?
           ORDER BY bm25(notes_fts)
           LIMIT 100`,
        )
        .all(matchQuery) as unknown as (NoteRow & { snippet: string })[];
      for (const row of rows) {
        const date = row.updated.slice(0, 10);
        if (inRange(date, input.from, input.to)) results.push({ type: 'note', date, snippet: row.snippet, note: mapNoteRow(row) });
      }
    }

    if (types.has('journal')) {
      const rows = db
        .prepare(
          `SELECT j.date, j.tags, ${SNIPPET_EXPR('journal_fts')} AS snippet
           FROM journal_fts
           JOIN journal_entries j ON j.date = journal_fts.date
           WHERE journal_fts MATCH ?
           ORDER BY bm25(journal_fts)
           LIMIT 100`,
        )
        .all(matchQuery) as { date: string; tags: string; snippet: string }[];
      for (const row of rows) {
        if (inRange(row.date, input.from, input.to)) {
          results.push({ type: 'journal', date: row.date, snippet: row.snippet, tags: JSON.parse(row.tags) as string[] });
        }
      }
    }

    if (types.has('project')) {
      const rows = db
        .prepare(
          `SELECT p.slug, p.name, p.description, p.group_name, p.color, p.archived, p.created, ${SNIPPET_EXPR('projects_fts')} AS snippet
           FROM projects_fts
           JOIN projects p ON p.slug = projects_fts.slug
           WHERE projects_fts MATCH ?
           ORDER BY bm25(projects_fts)
           LIMIT 100`,
        )
        .all(matchQuery) as {
        slug: string;
        name: string;
        description: string;
        group_name: string;
        color: string;
        archived: number;
        created: string;
        snippet: string;
      }[];
      for (const row of rows) {
        if (inRange(row.created, input.from, input.to)) {
          results.push({
            type: 'project',
            date: row.created,
            snippet: row.snippet,
            project: {
              slug: row.slug,
              name: row.name,
              description: row.description,
              group: row.group_name,
              color: row.color,
              archived: row.archived === 1,
              created: row.created,
            },
          });
        }
      }
    }

    results.sort((a, b) => b.date.localeCompare(a.date));
    return results.slice(0, 50);
  } finally {
    db.close();
  }
}
