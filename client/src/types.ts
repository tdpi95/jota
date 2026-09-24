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
  /** Every project belongs to exactly one group; falls back to "Default"
   * when not set. Tasks have no group of their own — they inherit this
   * from their project. */
  group: string;
  /** Hex color, e.g. "#4f86f7" — server-assigned, always present. */
  color: string;
  /** Workspace-relative path to an uploaded profile image (milestone 27,
   * PLAN.md "File attachments"), e.g. "attachments/projects/foo.png".
   * Optional — most projects have none, falling back to the color swatch. */
  profileImage?: string;
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

/** `GET /api/journal/:year/full` — same as `JournalEntrySummary` plus the
 * actual body text, for views (CalendarPage's "show all journal entries"
 * list) that need to preview/expand content rather than just a has-entry
 * dot. */
export interface JournalEntryFull extends JournalEntrySummary {
  body: string;
  linkedTasks: string[];
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
  /** The owning project's group — inherited, not stored on the task. */
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

/** `lib/workspaces.ts`'s `WorkspaceSyncConfig` — absent/undefined on a
 * `Workspace` means the same thing as `{provider: 'none'}` (an entry written
 * before remote sync existed never gains the field until a remote is set).
 * Exactly one provider is active at a time (PLAN.md milestone 29's "one
 * provider active per workspace" model) — the Settings page's provider
 * selector switches which one this is by writing to that provider's own
 * config endpoint, or clears it back to `'none'` via `DELETE /api/vault/sync`. */
export type WorkspaceSyncConfig =
  | { provider: 'none' }
  | { provider: 'git-remote'; remoteUrl: string; lastSyncedAt: string | null }
  | { provider: 'webdav'; url: string; username: string; password: string; lastSyncedAt: string | null };

export interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
  sync?: WorkspaceSyncConfig;
}

/** `lib/sync/types.ts`'s `SyncStatus`/`PullResult` — back the Settings page's
 * Sync panel (milestone 16, git-remote provider only). */
export interface SyncStatus {
  remoteUrl: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  lastSyncedAt: string | null;
}

export type PullResult = { conflict: false } | { conflict: true; files: string[] };

/** `lib/sync/webdav.ts`'s `WebDavStatus`/`WebDavSyncResult` — back the
 * Settings page's Sync panel when the WebDAV provider is active (milestone 29). */
export interface WebDavPendingChange {
  path: string;
  change: 'added' | 'modified' | 'deleted';
}

export interface WebDavStatus {
  toPush: number;
  toPull: number;
  pushFiles: WebDavPendingChange[];
  pullFiles: WebDavPendingChange[];
  conflicts: string[];
  lastSyncedAt: string | null;
}

export interface WebDavSyncResult {
  synced: string[];
  conflicts: string[];
}

/** `lib/sync/webdav.ts`'s conflict-detail shapes — back the WebDAV conflict
 * resolver (`WebdavConflictModal`). */
export type WebDavFileState = 'created' | 'modified' | 'deleted' | 'same';

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: { type: ' ' | '+' | '-'; text: string }[];
}

export type MergeChunk = { kind: 'ok'; lines: string[] } | { kind: 'conflict'; local: string[]; remote: string[]; base: string[] | null };

export interface WebDavFileVersion {
  localMtimeMs: number | null;
  remoteEtag: string | null;
}

export interface WebDavConflictDetail {
  path: string;
  local: WebDavFileState;
  remote: WebDavFileState;
  isText: boolean;
  hasBase: boolean;
  localSize: number | null;
  remoteSize: number | null;
  localChanges: DiffHunk[] | null;
  remoteChanges: DiffHunk[] | null;
  differences: DiffHunk[] | null;
  merge: MergeChunk[] | null;
  version: WebDavFileVersion;
}

export type WebDavResolution = { choice: 'local' } | { choice: 'remote' } | { choice: 'merged'; content: string };

/** `lib/sync/webdav.ts`'s `WebDavTestResult` — backs the Settings page's
 * "Test connection" button. */
export type WebDavTestResult = { ok: true } | { ok: false; reason: 'auth' | 'not-found' | 'other'; message: string };

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

export interface NoteFrontmatter {
  title: string;
  /** ISO8601 UTC, set once at creation and never rewritten. */
  created: string;
  /** ISO8601 UTC, rewritten on every write. */
  updated: string;
  tags: string[];
}

export interface Note {
  slug: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

/** `lib/index/queries.ts`'s `IndexedNote` — metadata only, no body (the
 * index never caches note body text) — backs the notes list page. */
export interface IndexedNote {
  slug: string;
  title: string;
  created: string;
  updated: string;
  tags: string[];
}

/** `lib/index/queries.ts`'s `IndexedProject` — the cross-type search
 * result's project shape (milestone 25 follow-up). */
export interface IndexedProject {
  slug: string;
  name: string;
  description: string;
  group: string;
  color: string;
  archived: boolean;
  created: string;
}

/** `lib/index/queries.ts`'s `SearchContentType`/`SearchResult` — backs
 * `GET /api/search` (milestone 25 "Search (cross-type full-text)"). Each
 * result carries a `date` (the type's own natural date field — see
 * PLAN.md) and a `snippet` excerpt with the match marked in `**bold**`. */
export type SearchContentType = 'task' | 'note' | 'journal' | 'project';

export interface TaskSearchResult {
  type: 'task';
  date: string;
  snippet: string;
  task: IndexedTask;
}

export interface NoteSearchResult {
  type: 'note';
  date: string;
  snippet: string;
  note: IndexedNote;
}

export interface JournalSearchResult {
  type: 'journal';
  date: string;
  snippet: string;
  tags: string[];
}

export interface ProjectSearchResult {
  type: 'project';
  date: string;
  snippet: string;
  project: IndexedProject;
}

export type SearchResult = TaskSearchResult | NoteSearchResult | JournalSearchResult | ProjectSearchResult;
