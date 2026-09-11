// Read-only aggregate queries against the workspace's SQLite index (PLAN.md
// "Which reads go where" — aggregate/cross-file views are the only reads
// that go through the index rather than the source files directly, and can
// show stale data until the next reconciliation). All direct `node:sqlite`
// access for these queries lives here, alongside lib/index/db.ts's schema
// and lib/index/reindex.ts's writes — isolating the still-experimental API
// to lib/index/*.ts (PLAN.md).

import { openIndexDb } from './db.js';
import type { TaskStatus } from '../../types.js';

export interface IndexedTask {
  id: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
  text: string;
  status: TaskStatus;
  due: string | null;
  createdAt: string;
  doingSince: string | null;
  spentMinutes: number;
  doneAt: string | null;
  tags: string[];
  description: string | null;
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
  project_name: string;
  project_color: string;
}

function mapTaskRow(row: TaskJoinRow): IndexedTask {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    projectColor: row.project_color,
    text: row.text,
    status: row.status,
    due: row.due,
    createdAt: row.created_at,
    doingSince: row.doing_since,
    spentMinutes: row.spent_minutes,
    doneAt: row.done_at,
    tags: JSON.parse(row.tags) as string[],
    description: row.description,
  };
}

const TASK_JOIN_SELECT = `
  SELECT t.id, t.project_slug, t.text, t.status, t.due, t.created_at, t.doing_since,
         t.spent_minutes, t.done_at, t.tags, t.description,
         p.name AS project_name, p.color AS project_color
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

/** Case-insensitive substring match over task text/description, newest
 * first, capped at 50 — backs `GET /api/tasks/search?q=`. */
export function querySearchTasks(workspacePath: string, q: string): IndexedTask[] {
  const db = openIndexDb(workspacePath);
  try {
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `${TASK_JOIN_SELECT} WHERE t.text LIKE ? COLLATE NOCASE OR t.description LIKE ? COLLATE NOCASE
         ORDER BY t.created_at DESC LIMIT 50`,
      )
      .all(like, like) as unknown as TaskJoinRow[];
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
        `SELECT t.due AS date, t.id, t.project_slug, p.color AS project_color
         FROM tasks t JOIN projects p ON p.slug = t.project_slug
         WHERE t.due BETWEEN ? AND ?`,
      )
      .all(from, to) as { date: string; id: string; project_slug: string; project_color: string }[];

    const linkedRows = db
      .prepare(
        `SELECT l.date, l.task_id AS id, t.project_slug, p.color AS project_color
         FROM journal_task_links l
         JOIN tasks t ON t.id = l.task_id
         JOIN projects p ON p.slug = t.project_slug
         WHERE l.date BETWEEN ? AND ?`,
      )
      .all(from, to) as { date: string; id: string; project_slug: string; project_color: string }[];

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
      dayOf(row.date).tasks.push({ taskId: row.id, projectSlug: row.project_slug, projectColor: row.project_color, reason: 'due' });
    }
    for (const row of linkedRows) {
      const day = dayOf(row.date);
      if (!day.tasks.some((m) => m.taskId === row.id)) {
        day.tasks.push({ taskId: row.id, projectSlug: row.project_slug, projectColor: row.project_color, reason: 'linked' });
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
