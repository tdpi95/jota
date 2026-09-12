// Thin typed fetch wrappers over the REST API (PLAN.md "Routes"). One
// function per endpoint the frontend actually calls — no generic
// request-builder abstraction, there just aren't enough endpoints yet to
// earn one. Every mutating call returns the same structured object the
// service layer produced (never re-fetches to "confirm"), matching the
// backend's own write-path contract.

import type {
  CalendarDay,
  HistoryCommit,
  IndexedTask,
  JournalEntry,
  JournalEntrySummary,
  ProjectSummary,
  PullResult,
  SyncStatus,
  Task,
  TaskStatus,
  Workspace,
  WorkspaceSyncConfig,
} from '../types';

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(typeof body.error === 'string' ? body.error : `request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Workspace ---

export function getActiveWorkspace(): Promise<{ workspace: Workspace | null }> {
  return request('/workspaces/active');
}

/** Every registered workspace — backs `WorkspaceSwitcher` and the Settings
 * page's workspace list (milestone 16). */
export function listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  return request('/workspaces');
}

/** Registers (or, if already registered, just re-activates) a folder as a
 * workspace — `path` comes from `window.pivot.pickFolder()` in the Electron
 * shell. */
export function addWorkspace(input: { path: string; name?: string }): Promise<{ workspace: Workspace }> {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(input) });
}

export function openWorkspace(id: string): Promise<{ workspace: Workspace }> {
  return request(`/workspaces/${encodeURIComponent(id)}/open`, { method: 'POST' });
}

/** Un-registers a workspace only — never touches its folder (PLAN.md). */
export function removeWorkspace(id: string): Promise<void> {
  return request(`/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Projects ---

export function listProjects(): Promise<{ projects: ProjectSummary[] }> {
  return request('/projects');
}

export function getProject(slug: string): Promise<{ project: ProjectSummary }> {
  return request(`/projects/${encodeURIComponent(slug)}`);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  tags?: string[];
  color?: string;
}

export function createProject(input: CreateProjectInput): Promise<{ project: ProjectSummary }> {
  return request('/projects', { method: 'POST', body: JSON.stringify(input) });
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  tags?: string[];
  color?: string;
  archived?: boolean;
}

export function updateProject(slug: string, input: UpdateProjectInput): Promise<{ project: ProjectSummary }> {
  return request(`/projects/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteProject(slug: string): Promise<void> {
  return request(`/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

// --- Tasks ---

export interface CreateTaskInput {
  text: string;
  due?: string | null;
  tags?: string[];
  description?: string | null;
}

export function createTask(slug: string, input: CreateTaskInput): Promise<{ task: Task }> {
  return request(`/projects/${encodeURIComponent(slug)}/tasks`, { method: 'POST', body: JSON.stringify(input) });
}

export interface UpdateTaskInput {
  text?: string;
  description?: string | null;
  due?: string | null;
  tags?: string[];
  status?: TaskStatus;
  /** Drag-and-drop reorder within the Kanban columns: `undefined` leaves
   * position untouched, `null` moves to the front of the project file,
   * a task id moves it to immediately after that task. */
  afterTaskId?: string | null;
}

export function updateTask(slug: string, taskId: string, input: UpdateTaskInput): Promise<{ task: Task }> {
  return request(`/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteTask(slug: string, taskId: string): Promise<void> {
  return request(`/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export function searchTasks(q: string): Promise<{ tasks: IndexedTask[] }> {
  return request(`/tasks/search?q=${encodeURIComponent(q)}`);
}

/** Not-done tasks across every project, due-soonest-first — backs the
 * Dashboard's Today/Overdue/This-week buckets. */
export function getOpenTasks(): Promise<{ tasks: IndexedTask[] }> {
  return request('/tasks/open');
}

// --- Calendar ---

/** Sparse per-day marks for one month (`month` zero-padded "01"-"12") —
 * backs `CalendarSidebar`. */
export function getCalendarMonth(year: string, month: string): Promise<{ days: CalendarDay[] }> {
  return request(`/calendar/${encodeURIComponent(year)}/${encodeURIComponent(month)}`);
}

// --- Journal ---

export function listJournalYear(year: string): Promise<{ entries: JournalEntrySummary[] }> {
  return request(`/journal/${encodeURIComponent(year)}`);
}

export function getJournalEntry(year: string, date: string): Promise<{ entry: JournalEntry }> {
  return request(`/journal/${encodeURIComponent(year)}/${encodeURIComponent(date)}`);
}

export interface PutJournalInput {
  tags?: string[];
  linkedTasks?: string[];
  body?: string;
}

export function putJournalEntry(year: string, date: string, input: PutJournalInput): Promise<{ entry: JournalEntry }> {
  return request(`/journal/${encodeURIComponent(year)}/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function linkTaskToJournal(year: string, date: string, taskId: string): Promise<{ entry: JournalEntry }> {
  return request(`/journal/${encodeURIComponent(year)}/${encodeURIComponent(date)}/links/${encodeURIComponent(taskId)}`, {
    method: 'POST',
  });
}

export function unlinkTaskFromJournal(year: string, date: string, taskId: string): Promise<{ entry: JournalEntry }> {
  return request(`/journal/${encodeURIComponent(year)}/${encodeURIComponent(date)}/links/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}

// --- Vault history/backup (`HistoryPanel`, milestone 15) ---

/** Recent commits touching the workspace, or (when `path` is given, relative
 * to the workspace root, e.g. `projects/website-redesign.md`) just that
 * file — most recent first. */
export function getVaultHistory(opts: { path?: string; limit?: number } = {}): Promise<{ history: HistoryCommit[] }> {
  const params = new URLSearchParams();
  if (opts.path) params.set('path', opts.path);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/vault/history${qs ? `?${qs}` : ''}`);
}

export function getVaultDiff(commit: string): Promise<{ diff: string }> {
  return request(`/vault/diff/${encodeURIComponent(commit)}`);
}

/** `git revert --no-edit <commit>` — a new undo commit, not a rewrite of
 * history, so it's safe even with later commits already on top. */
export function revertVaultCommit(commit: string): Promise<{ commit: HistoryCommit }> {
  return request(`/vault/revert/${encodeURIComponent(commit)}`, { method: 'POST' });
}

/** The workspace's current git commit hash — polled by `VaultChangePoller`
 * to auto-refresh the UI after a change made outside the client's own
 * mutations (an MCP agent, most notably, but also a hand-edit + commit or a
 * `git pull`). */
export function getVaultHead(): Promise<{ hash: string | null }> {
  return request('/vault/head');
}

// --- Remote sync (Settings page's Sync panel, milestone 16) ---

export function getSyncRemote(): Promise<{ sync: WorkspaceSyncConfig }> {
  return request('/vault/git/remote');
}

export function setSyncRemote(url: string): Promise<{ sync: WorkspaceSyncConfig }> {
  return request('/vault/git/remote', { method: 'PUT', body: JSON.stringify({ url }) });
}

export function pushVault(): Promise<{ ok: true }> {
  return request('/vault/git/push', { method: 'POST' });
}

export function pullVault(): Promise<PullResult> {
  return request('/vault/git/pull', { method: 'POST' });
}

export function getSyncStatus(): Promise<SyncStatus> {
  return request('/vault/git/status');
}

// --- Preferences ---

// App-wide UI language (PLAN.md "Localization") — a plain preference, not
// an OS-level API, so (unlike launch-at-login/reminder settings) this goes
// straight over HTTP rather than through the Electron preload bridge; it
// works identically in a plain browser tab.
export function getLanguagePreference(): Promise<{ language: 'en' | 'vi' }> {
  return request('/preferences/language');
}

export function setLanguagePreference(language: 'en' | 'vi'): Promise<{ language: 'en' | 'vi' }> {
  return request('/preferences/language', { method: 'PUT', body: JSON.stringify({ language }) });
}

// --- System (Settings' git-notice + Agent access section) ---

/** Whether the `git` CLI is available on this machine — undo history and
 * remote sync both depend on it. */
export function checkGitAvailable(): Promise<{ available: boolean }> {
  return request('/system/git-available');
}

/** Absolute path to this app's own standalone MCP server entrypoint, for
 * building copy-pasteable agent config snippets. */
export function getMcpInfo(): Promise<{ entryPath: string }> {
  return request('/system/mcp-info');
}

export { ApiError };
