// Thin typed fetch wrappers over the REST API (PLAN.md "Routes"). One
// function per endpoint the frontend actually calls — no generic
// request-builder abstraction, there just aren't enough endpoints yet to
// earn one. Every mutating call returns the same structured object the
// service layer produced (never re-fetches to "confirm"), matching the
// backend's own write-path contract.

import type {
  CalendarDay,
  IndexedTask,
  JournalEntry,
  JournalEntrySummary,
  ProjectSummary,
  Task,
  TaskStatus,
  Workspace,
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

// --- Workspace (read-only here — management UI is milestone 16) ---

export function getActiveWorkspace(): Promise<{ workspace: Workspace | null }> {
  return request('/workspaces/active');
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

export { ApiError };
