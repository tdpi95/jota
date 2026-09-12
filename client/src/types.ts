// Client-side mirrors of server/src/types.ts + the service-layer response
// shapes the REST API actually returns. Duplicated rather than imported
// (client/server are separate npm workspaces/tsconfigs, per the project
// scaffold) — keep these in sync with server/src/types.ts and
// server/src/lib/index/queries.ts's `IndexedTask` by hand if either changes.

export type TaskStatus = 'todo' | 'doing' | 'done';

/** Sub-task checklist entry — plain text + done state, no due/tags/time
 * tracking of its own (server/src/types.ts's `ChecklistItem`). */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  status: TaskStatus;
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
  description: string | null;
  checklist: ChecklistItem[];
}

export interface ProjectFrontmatter {
  name: string;
  /** YYYY-MM-DD */
  created: string;
  archived: boolean;
  description: string;
  tags: string[];
  /** Hex color, e.g. "#4f86f7" — server-assigned, always present. */
  color: string;
}

export interface ProjectSummary {
  slug: string;
  frontmatter: ProjectFrontmatter;
  tasks: Task[];
}

export interface JournalFrontmatter {
  /** YYYY-MM-DD */
  date: string;
  tags: string[];
  /** Task ids, insertion-ordered, deduped. */
  linkedTasks: string[];
}

export interface JournalEntry {
  date: string;
  frontmatter: JournalFrontmatter;
  body: string;
}

export interface JournalEntrySummary {
  date: string;
  hasBody: boolean;
  tags: string[];
}

/** `lib/index/queries.ts`'s `IndexedTask` — the shape aggregate endpoints
 * (`/api/tasks/open`, `/api/tasks/search`) return: a `Task` with the owning
 * project's slug/name/color joined in, so list views don't need a second
 * request per task for badges. */
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
  checklist: ChecklistItem[];
}

/** `lib/workspaces.ts`'s `WorkspaceSyncConfig` — absent/undefined on a
 * `Workspace` means the same thing as `{provider: 'none'}` (an entry written
 * before remote sync existed never gains the field until a remote is set). */
export type WorkspaceSyncConfig = { provider: 'none' } | { provider: 'git-remote'; remoteUrl: string; lastSyncedAt: string | null };

export interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
  sync?: WorkspaceSyncConfig;
}

/** `lib/sync/types.ts`'s `SyncStatus`/`PullResult` — back the Settings page's
 * Sync panel (milestone 16). */
export interface SyncStatus {
  remoteUrl: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  lastSyncedAt: string | null;
}

export type PullResult = { conflict: false } | { conflict: true; files: string[] };

/** `lib/vaultGit.ts`'s `CommitInfo` — backs `HistoryPanel` (milestone 15). */
export interface HistoryCommit {
  hash: string;
  /** ISO8601, commit date. */
  date: string;
  message: string;
}

/** `lib/index/queries.ts`'s `CalendarTaskMark`/`CalendarDay` — the sparse
 * per-day marks `GET /api/calendar/:year/:month` returns, backing
 * `CalendarSidebar`'s dots. */
export interface CalendarTaskMark {
  taskId: string;
  projectSlug: string;
  projectColor: string;
  text: string;
  status: TaskStatus;
  reason: 'due' | 'linked';
}

export interface CalendarDay {
  date: string;
  hasJournalEntry: boolean;
  tasks: CalendarTaskMark[];
}
