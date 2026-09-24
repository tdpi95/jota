// Thin typed fetch wrappers over the REST API (PLAN.md "Routes"). One
// function per endpoint the frontend actually calls — no generic
// request-builder abstraction, there just aren't enough endpoints yet to
// earn one. Every mutating call returns the same structured object the
// service layer produced (never re-fetches to "confirm"), matching the
// backend's own write-path contract.

import type {
  CalendarDay,
  ChecklistItem,
  HistoryCommit,
  IndexedNote,
  IndexedTask,
  JournalEntry,
  JournalEntryFull,
  JournalEntrySummary,
  Note,
  ProjectSummary,
  PullResult,
  SearchContentType,
  SearchResult,
  SyncStatus,
  Task,
  TaskStatus,
  WebDavConflictDetail,
  WebDavFileVersion,
  WebDavResolution,
  WebDavStatus,
  WebDavSyncResult,
  WebDavTestResult,
  Workspace,
  WorkspaceSyncConfig,
} from '../types';
import type { AccentPalette, ThemeMode } from '../lib/theme';

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
 * workspace — `path` comes from `window.jota.pickFolder()` in the Electron
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
  /** Left out or blank falls back to "Default". */
  group?: string;
  color?: string;
}

export function createProject(input: CreateProjectInput): Promise<{ project: ProjectSummary }> {
  return request('/projects', { method: 'POST', body: JSON.stringify(input) });
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  /** Blank (not just left out) resets to "Default". */
  group?: string;
  color?: string;
  archived?: boolean;
  /** `undefined` leaves it untouched, a path sets/replaces it, `null` clears
   * it back to the plain color swatch (milestone 27). */
  profileImage?: string | null;
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
  checklist?: ChecklistItem[];
}

export function createTask(slug: string, input: CreateTaskInput): Promise<{ task: Task }> {
  return request(`/projects/${encodeURIComponent(slug)}/tasks`, { method: 'POST', body: JSON.stringify(input) });
}

export interface UpdateTaskInput {
  text?: string;
  description?: string | null;
  due?: string | null;
  tags?: string[];
  /** Full replacement of the task's checklist (sub-tasks), same
   * full-replace-on-provide convention as `tags`. */
  checklist?: ChecklistItem[];
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

/** Same year, body text included — backs CalendarPage's "show all journal
 * entries" list. Heavier than `listJournalYear` (reads every file in the
 * year off disk), so only fetch this when that list is actually open. */
export function listJournalYearFull(year: string): Promise<{ entries: JournalEntryFull[] }> {
  return request(`/journal/${encodeURIComponent(year)}/full`);
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

// --- Notes ---

/** Every note's metadata (no body), most-recently-updated first — or, with
 * `q`, a substring search over title/tags only (never body text, which the
 * index never caches). */
export function listNotes(q?: string): Promise<{ notes: IndexedNote[] }> {
  return request(`/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}

export function getNote(slug: string): Promise<{ note: Note }> {
  return request(`/notes/${encodeURIComponent(slug)}`);
}

export interface CreateNoteInput {
  title: string;
  tags?: string[];
  body?: string;
}

export function createNote(input: CreateNoteInput): Promise<{ note: Note }> {
  return request('/notes', { method: 'POST', body: JSON.stringify(input) });
}

export interface UpdateNoteInput {
  title?: string;
  tags?: string[];
  body?: string;
  /** Renames the note's filename/slug — see server/src/services/notes.ts's
   * `UpdateNoteInput.newSlug` doc. Rejects (409) rather than auto-suffixing
   * if a note with that filename already exists. */
  newSlug?: string;
}

export function updateNote(slug: string, input: UpdateNoteInput): Promise<{ note: Note }> {
  return request(`/notes/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteNote(slug: string): Promise<void> {
  return request(`/notes/${encodeURIComponent(slug)}`, { method: 'DELETE' });
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

// --- WebDAV sync (Settings page's Sync panel, milestone 29) — additive
// alongside git-remote above; only one provider is active per workspace at
// a time (PLAN.md), whichever one's `config`/`remote` endpoint was called
// last. ---

export function getWebdavConfig(): Promise<{ sync: WorkspaceSyncConfig }> {
  return request('/vault/webdav/config');
}

export function setWebdavConfig(input: { url: string; username: string; password: string }): Promise<{ sync: WorkspaceSyncConfig }> {
  return request('/vault/webdav/config', { method: 'PUT', body: JSON.stringify(input) });
}

/** Tests the given credentials directly — not necessarily the saved config,
 * and not tied to any workspace — so the "Test connection" button works
 * against whatever's currently typed into the form, before ever saving it. */
export function testWebdavConnection(input: { url: string; username: string; password: string }): Promise<WebDavTestResult> {
  return request('/vault/webdav/test', { method: 'POST', body: JSON.stringify(input) });
}

export function pushWebdav(): Promise<WebDavSyncResult> {
  return request('/vault/webdav/push', { method: 'POST' });
}

export function pullWebdav(): Promise<WebDavSyncResult> {
  return request('/vault/webdav/pull', { method: 'POST' });
}

export function getWebdavStatus(): Promise<WebDavStatus> {
  return request('/vault/webdav/status');
}

export function getWebdavConflict(path: string): Promise<WebDavConflictDetail> {
  return request(`/vault/webdav/conflict?path=${encodeURIComponent(path)}`);
}

/** `expected` is the conflict's `version` as it was read — the server
 * refuses (409) if either side changed since, instead of overwriting it. */
export function resolveWebdavConflict(input: { path: string; resolution: WebDavResolution; expected: WebDavFileVersion }): Promise<{ localChanged: boolean }> {
  return request('/vault/webdav/conflict/resolve', {
    method: 'POST',
    body: JSON.stringify({ path: input.path, ...input.resolution, expected: input.expected }),
  });
}

/** Provider-agnostic "disconnect" — resets the active workspace's sync
 * provider back to `{provider: 'none'}` regardless of which one was active. */
export function clearSyncProvider(): Promise<{ sync: WorkspaceSyncConfig }> {
  return request('/vault/sync', { method: 'DELETE' });
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

// App-wide UI theme + accent palette (PLAN.md "Theming") — same reasoning
// as language above: plain preferences, no Electron bridge needed.
export function getThemePreference(): Promise<{ theme: ThemeMode }> {
  return request('/preferences/theme');
}

export function setThemePreference(theme: ThemeMode): Promise<{ theme: ThemeMode }> {
  return request('/preferences/theme', { method: 'PUT', body: JSON.stringify({ theme }) });
}

export function getAccentPalettePreference(): Promise<{ accentPalette: AccentPalette }> {
  return request('/preferences/accent-palette');
}

export function setAccentPalettePreference(accentPalette: AccentPalette): Promise<{ accentPalette: AccentPalette }> {
  return request('/preferences/accent-palette', { method: 'PUT', body: JSON.stringify({ accentPalette }) });
}

// CalendarPage's due/journal toggle — same reasoning as language/theme
// above: a plain preference, no Electron bridge needed.
export function getCalendarModePreference(): Promise<{ calendarMode: 'due' | 'journal' }> {
  return request('/preferences/calendar-mode');
}

export function setCalendarModePreference(calendarMode: 'due' | 'journal'): Promise<{ calendarMode: 'due' | 'journal' }> {
  return request('/preferences/calendar-mode', { method: 'PUT', body: JSON.stringify({ calendarMode }) });
}

// CalendarPage's month/year granularity — same reasoning as calendar-mode
// above.
export function getCalendarGranularityPreference(): Promise<{ calendarGranularity: 'month' | 'year' }> {
  return request('/preferences/calendar-granularity');
}

export function setCalendarGranularityPreference(calendarGranularity: 'month' | 'year'): Promise<{ calendarGranularity: 'month' | 'year' }> {
  return request('/preferences/calendar-granularity', { method: 'PUT', body: JSON.stringify({ calendarGranularity }) });
}

// Journal editor's autosave debounce, in seconds (PLAN.md "Journal editor")
// — same shape as calendar-granularity above.
export function getAutosaveIntervalPreference(): Promise<{ autosaveIntervalSeconds: number }> {
  return request('/preferences/autosave-interval');
}

// NoteBodyEditor's Edit/Preview toggle — same shape as calendar-mode above.
export function getNoteViewModePreference(): Promise<{ noteViewMode: 'edit' | 'preview' }> {
  return request('/preferences/note-view-mode');
}

export function setNoteViewModePreference(noteViewMode: 'edit' | 'preview'): Promise<{ noteViewMode: 'edit' | 'preview' }> {
  return request('/preferences/note-view-mode', { method: 'PUT', body: JSON.stringify({ noteViewMode }) });
}

// Dashboard's "Pinned" section collapse state — same shape as
// calendar-mode above.
export function getDashboardPinnedOpenPreference(): Promise<{ open: boolean }> {
  return request('/preferences/dashboard-pinned-open');
}

export function setDashboardPinnedOpenPreference(open: boolean): Promise<{ open: boolean }> {
  return request('/preferences/dashboard-pinned-open', { method: 'PUT', body: JSON.stringify({ open }) });
}

// Dashboard's group-filter selection (milestone 26 follow-up) — same shape
// as dashboard-pinned-open above.
export function getDashboardGroupFilterPreference(): Promise<{ groups: string[] }> {
  return request('/preferences/dashboard-group-filter');
}

export function setDashboardGroupFilterPreference(groups: string[]): Promise<{ groups: string[] }> {
  return request('/preferences/dashboard-group-filter', { method: 'PUT', body: JSON.stringify({ groups }) });
}

// Dashboard's pinned-projects/pinned-notes selections (replaces "Recent
// projects") — same shape as dashboard-group-filter above.
export function getPinnedProjectsPreference(): Promise<{ slugs: string[] }> {
  return request('/preferences/pinned-projects');
}

export function setPinnedProjectsPreference(slugs: string[]): Promise<{ slugs: string[] }> {
  return request('/preferences/pinned-projects', { method: 'PUT', body: JSON.stringify({ slugs }) });
}

export function getPinnedNotesPreference(): Promise<{ slugs: string[] }> {
  return request('/preferences/pinned-notes');
}

export function setPinnedNotesPreference(slugs: string[]): Promise<{ slugs: string[] }> {
  return request('/preferences/pinned-notes', { method: 'PUT', body: JSON.stringify({ slugs }) });
}

export function setAutosaveIntervalPreference(autosaveIntervalSeconds: number): Promise<{ autosaveIntervalSeconds: number }> {
  return request('/preferences/autosave-interval', { method: 'PUT', body: JSON.stringify({ autosaveIntervalSeconds }) });
}

// --- System (Settings' git-notice + Agent access section) ---

/** Whether the `git` CLI is available on this machine — undo history and
 * remote sync both depend on it. */
export function checkGitAvailable(): Promise<{ available: boolean }> {
  return request('/system/git-available');
}

/** How to launch this app's own standalone MCP server entrypoint, for
 * building copy-pasteable agent config snippets. `args` is already
 * complete (includes the entrypoint path, or — for a packaged Linux
 * AppImage, where that path isn't stable across restarts — just a
 * relaunch flag) — the full invocation is exactly `command` then `args`,
 * nothing else to append. `env`, when present, holds extra vars (beyond
 * `JOTA_WORKSPACE`, which callers already add themselves) the command
 * actually needs to start reliably — only the AppImage case populates
 * this (`DISPLAY`/`DBUS_SESSION_BUS_ADDRESS`, milestone 18 part 20). See
 * server/src/lib/mcpInfo.ts. */
export function getMcpInfo(): Promise<{ command: string; args: string[]; env?: Record<string, string> }> {
  return request('/system/mcp-info');
}

// --- Search (cross-type full-text, PLAN.md "Search (cross-type full-text)", milestone 25) ---

/** Full-text search across task/note/journal/project body content at once —
 * unlike `searchTasks` (tasks only, title/description/tags, no date
 * filter), matches body/description text and supports a date range. Backs
 * the Dashboard's search popup. */
export function search(params: { q: string; from?: string; to?: string; types?: SearchContentType[] }): Promise<{ results: SearchResult[] }> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.types && params.types.length > 0) qs.set('types', params.types.join(','));
  return request(`/search?${qs.toString()}`);
}

// --- Attachments (milestone 27, PLAN.md "File attachments") ---

export type AttachmentFolder = 'tasks' | 'journal' | 'notes' | 'projects';

export interface AttachmentInfo {
  folder: AttachmentFolder;
  filename: string;
  /** Workspace-relative path, e.g. "attachments/notes/foo.png" — what a
   * project's `profileImage` field stores directly. */
  path: string;
  /** API URL to fetch/display the file. */
  url: string;
}

/** Uploads a file into the workspace's attachments folder. Doesn't go
 * through `request()` — a multipart body must NOT carry the JSON
 * `Content-Type` header `request()` always sets; the browser needs to set
 * its own `multipart/form-data; boundary=...` instead. */
export async function uploadAttachment(folder: AttachmentFolder, file: File): Promise<{ attachment: AttachmentInfo }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/attachments/${encodeURIComponent(folder)}`, { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(typeof body.error === 'string' ? body.error : `request failed (${res.status})`, res.status);
  }
  return res.json();
}

export { ApiError };
