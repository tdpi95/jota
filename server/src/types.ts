// Shared domain types for the markdown core (Milestone 1).
// These describe the *parsed* shape of vault content — pure data, no filesystem
// or workspace concept lives here (see PLAN.md "Storage format").

export type TaskStatus = 'todo' | 'doing' | 'done';

/** One sub-task checklist entry beneath a task — plain text + done state,
 * deliberately lightweight (no due/tags/time-tracking of its own, unlike a
 * top-level task) so it stays a quick, hand-editable GFM checkbox rather
 * than a second copy of the full task-line grammar. */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  status: TaskStatus;
  /** Task title text, tokens stripped. */
  text: string;
  /** YYYY-MM-DD, or null if no due date. */
  due: string | null;
  /** ISO8601 UTC, set once at creation and never rewritten. */
  created: string;
  /** ISO8601 UTC, present only while status === 'doing'. */
  doingSince: string | null;
  /** Cumulative minutes spent in 'doing', across all past doing-periods. */
  spentMinutes: number;
  /** YYYY-MM-DD, present only while status === 'done'. */
  doneAt: string | null;
  tags: string[];
  /**
   * Free-text description from the indented continuation lines beneath the
   * checkbox, dedented by the 2-space indent. Blank lines inside it are kept
   * as empty strings (paragraph breaks). Null if the task has no description.
   */
  description: string | null;
  /** Sub-task checklist, in file order. Empty array if the task has none. */
  checklist: ChecklistItem[];
}

export interface ProjectFrontmatter {
  name: string;
  /** YYYY-MM-DD */
  created: string;
  archived: boolean;
  description: string;
  /** The project's group, for organizing/filtering the project list and
   * Dashboard. Every project belongs to exactly one group; a project
   * created (or hand-edited) without one falls back to `DEFAULT_GROUP`
   * ("Default") — see services/projects.ts. Tasks have no group field of
   * their own; they inherit this at read time via their project. */
  group: string;
  /** Hex color, e.g. "#4f86f7" — server-assigned, always present. */
  color: string;
}

export interface JournalFrontmatter {
  /** YYYY-MM-DD */
  date: string;
  tags: string[];
  /** Task ids, insertion-ordered, deduped. */
  linkedTasks: string[];
}

export interface NoteFrontmatter {
  title: string;
  /** ISO8601 UTC, set once at creation and never rewritten. */
  created: string;
  /** ISO8601 UTC, rewritten on every write. */
  updated: string;
  tags: string[];
}
