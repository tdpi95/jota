// Task CRUD service (PLAN.md "Backend" + milestone 7) — a task always lives
// inside its project's file, so create/update/delete load+save through
// services/projects.ts's exported file helpers rather than touching the
// filesystem directly (one implementation of "read/write a project file").

import { differenceInMinutes } from 'date-fns';

import { HttpError } from '../lib/httpError.js';
import { generateTaskId } from '../lib/ids.js';
import {
  queryAllTasksForReport,
  queryJournalLinksForTask,
  queryOpenTasks,
  querySearchTasks,
  queryTaskById,
  relevantDateOf,
  type IndexedTask,
} from '../lib/index/queries.js';
import type { ProjectBodyBlock } from '../lib/markdown/taskLine.js';
import type { ChecklistItem, Task, TaskStatus } from '../types.js';
import { getProject, loadProjectFile, saveProjectFile } from './projects.js';

export class TaskServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'TaskServiceError';
  }
}

export interface CreateTaskInput {
  text: string;
  due?: string | null;
  tags?: string[];
  description?: string | null;
  checklist?: ChecklistItem[];
}

export interface UpdateTaskInput {
  text?: string;
  description?: string | null;
  due?: string | null;
  tags?: string[];
  /**
   * Full replacement of the task's checklist (sub-tasks), same
   * full-replace-on-provide convention as `tags` — the caller (UI or agent)
   * already has the current array and sends back the whole thing with one
   * item toggled/added/removed/edited, rather than an index-addressed
   * add/toggle/remove tool per operation.
   */
  checklist?: ChecklistItem[];
  status?: TaskStatus;
  /**
   * Reorders the task within the project file (drag-and-drop on the Kanban
   * columns, PLAN.md's "task order" note under milestone 18) — `undefined`
   * (the default for every other caller) leaves position untouched; `null`
   * moves the task's block to the very front of the file; a task id moves it
   * to immediately after that task's block. Order has no dedicated field —
   * it's purely the position of the task's block in `ParsedProjectFile.blocks`
   * (see lib/markdown/project.ts), so this is a real (small) file edit like
   * any other update, not a separate concept the index needs to track.
   */
  afterTaskId?: string | null;
}

type TaskBlock = { type: 'task'; task: Task };

function findTaskBlock(blocks: ProjectBodyBlock[], taskId: string): TaskBlock {
  const block = blocks.find((b): b is TaskBlock => b.type === 'task' && b.task.id === taskId);
  if (!block) throw new TaskServiceError(`no task with id "${taskId}"`, 404);
  return block;
}

/**
 * Applies the doing-timer transition in-place (PLAN.md "Doing-timer
 * transition" pseudocode, verbatim): folds elapsed `doing` time into
 * `spentMinutes` when leaving 'doing', starts `doingSince` when entering it,
 * and tracks `doneAt`. A same-status "change" is a no-op guard against
 * double-counting.
 */
function applyStatusTransition(task: Task, newStatus: TaskStatus, now: Date): void {
  if (newStatus === task.status) return;

  if (task.status === 'doing' && task.doingSince) {
    task.spentMinutes += Math.max(0, differenceInMinutes(now, new Date(task.doingSince)));
    task.doingSince = null;
  }
  if (newStatus === 'doing') task.doingSince = now.toISOString();
  if (newStatus === 'done') task.doneAt = now.toISOString().slice(0, 10);
  else if (task.status === 'done') task.doneAt = null;
  task.status = newStatus;
}

export function createTask(workspacePath: string, slug: string, input: CreateTaskInput, origin = 'api'): Task {
  const text = input.text?.trim();
  if (!text) throw new TaskServiceError('text is required', 400);

  const parsed = loadProjectFile(workspacePath, slug);
  const task: Task = {
    id: generateTaskId(),
    status: 'todo',
    text,
    due: input.due ?? null,
    created: new Date().toISOString(),
    doingSince: null,
    spentMinutes: 0,
    doneAt: null,
    tags: input.tags ?? [],
    description: input.description ?? null,
    checklist: input.checklist ?? [],
  };
  parsed.blocks.push({ type: 'task', task });

  saveProjectFile(workspacePath, slug, parsed, origin, `create_task ${task.id} (${slug})`);
  return task;
}

export function updateTask(
  workspacePath: string,
  slug: string,
  taskId: string,
  input: UpdateTaskInput,
  origin = 'api',
): Task {
  const parsed = loadProjectFile(workspacePath, slug);
  const block = findTaskBlock(parsed.blocks, taskId);
  const task = block.task;
  const fromStatus = task.status;

  if (input.status !== undefined) applyStatusTransition(task, input.status, new Date());
  if (input.text !== undefined) task.text = input.text;
  if (input.description !== undefined) task.description = input.description;
  if (input.due !== undefined) task.due = input.due;
  if (input.tags !== undefined) task.tags = input.tags;
  if (input.checklist !== undefined) task.checklist = input.checklist;

  let reordered = false;
  if (input.afterTaskId !== undefined) {
    reordered = true;
    const fromIndex = parsed.blocks.indexOf(block);
    parsed.blocks.splice(fromIndex, 1);
    if (input.afterTaskId === null) {
      parsed.blocks.unshift(block);
    } else {
      const afterIndex = parsed.blocks.findIndex((b) => b.type === 'task' && b.task.id === input.afterTaskId);
      if (afterIndex === -1) throw new TaskServiceError(`no task with id "${input.afterTaskId}"`, 404);
      parsed.blocks.splice(afterIndex + 1, 0, block);
    }
  }

  const notes: string[] = [];
  if (input.status !== undefined && input.status !== fromStatus) notes.push(`status ${fromStatus}→${task.status}`);
  if (reordered) notes.push('reordered');
  const message = notes.length > 0 ? `update_task ${taskId} ${notes.join(', ')} (${slug})` : `update_task ${taskId} (${slug})`;
  saveProjectFile(workspacePath, slug, parsed, origin, message);
  return task;
}

export function deleteTask(workspacePath: string, slug: string, taskId: string, origin = 'api'): void {
  const parsed = loadProjectFile(workspacePath, slug);
  const index = parsed.blocks.findIndex((b) => b.type === 'task' && b.task.id === taskId);
  if (index === -1) throw new TaskServiceError(`no task with id "${taskId}"`, 404);
  parsed.blocks.splice(index, 1);

  saveProjectFile(workspacePath, slug, parsed, origin, `delete_task ${taskId} (${slug})`);
}

// --- Aggregate/query reads (PLAN.md "Which reads go where" — these go
// through the index, not the source files, and can show stale data until
// the next reconciliation). ---

/** `GET /api/tasks/open` — every not-done task across all projects. */
export function listOpenTasks(workspacePath: string): IndexedTask[] {
  return queryOpenTasks(workspacePath);
}

/** `GET /api/tasks/search?q=` — empty/whitespace-only query returns no
 * results rather than the whole vault. */
export function searchTasks(workspacePath: string, q: string): IndexedTask[] {
  const query = q?.trim();
  if (!query) return [];
  return querySearchTasks(workspacePath, query);
}

/** `GET /api/tasks/:taskId/journal-links` — dates of every journal entry
 * linking to this task; 404s if the task id doesn't exist at all (not just
 * an empty link list) so the caller can tell "no links" from "no such task". */
export function getJournalLinksForTask(workspacePath: string, taskId: string): string[] {
  if (!queryTaskById(workspacePath, taskId)) throw new TaskServiceError(`no task with id "${taskId}"`, 404);
  return queryJournalLinksForTask(workspacePath, taskId);
}

export interface TaskSummaryInput {
  projectSlug?: string;
  status?: TaskStatus;
  /** YYYY-MM-DD, inclusive; filters on each task's `relevantDateOf` (see
   * lib/index/queries.ts) the same way services/reports.ts does. */
  from?: string;
  to?: string;
}

export interface TaskSummary {
  totalCount: number;
  byStatus: Record<TaskStatus, number>;
  byProject: { projectSlug: string; projectName: string; count: number }[];
  /** Not-done tasks whose due date is in the past, within the filtered set. */
  overdueCount: number;
  tasks: IndexedTask[];
}

/**
 * `get_task_summary` MCP tool (PLAN.md: "returning structured aggregates —
 * the calling agent narrates the summary itself, no summarization logic
 * needed server-side"). `projectSlug`, if given, is validated the same way
 * `get_project` is (404 with a "did you mean" hint via services/projects.ts)
 * rather than silently returning an empty summary for a typo'd slug.
 */
export function getTaskSummary(workspacePath: string, input: TaskSummaryInput = {}): TaskSummary {
  if (input.projectSlug) getProject(workspacePath, input.projectSlug); // throws 404 if unknown

  const today = new Date().toISOString().slice(0, 10);
  const tasks = queryAllTasksForReport(workspacePath).filter((t) => {
    if (input.projectSlug && t.projectSlug !== input.projectSlug) return false;
    if (input.status && t.status !== input.status) return false;
    const date = relevantDateOf(t);
    if (input.from && date < input.from) return false;
    if (input.to && date > input.to) return false;
    return true;
  });

  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  const byProjectMap = new Map<string, { projectSlug: string; projectName: string; count: number }>();
  let overdueCount = 0;
  for (const t of tasks) {
    byStatus[t.status]++;
    const entry = byProjectMap.get(t.projectSlug) ?? { projectSlug: t.projectSlug, projectName: t.projectName, count: 0 };
    entry.count++;
    byProjectMap.set(t.projectSlug, entry);
    if (t.status !== 'done' && t.due && t.due < today) overdueCount++;
  }

  return {
    totalCount: tasks.length,
    byStatus,
    byProject: [...byProjectMap.values()].sort((a, b) => b.count - a.count),
    overdueCount,
    tasks,
  };
}
