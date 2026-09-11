// Client-side mirrors of server/src/types.ts + the service-layer response
// shapes the REST API actually returns. Duplicated rather than imported
// (client/server are separate npm workspaces/tsconfigs, per the project
// scaffold) — keep these in sync with server/src/types.ts and
// server/src/lib/index/queries.ts's `IndexedTask` by hand if either changes.

export type TaskStatus = 'todo' | 'doing' | 'done';

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
}

export interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}
