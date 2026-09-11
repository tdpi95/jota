// Task CRUD service (PLAN.md "Backend" + milestone 7) — a task always lives
// inside its project's file, so create/update/delete load+save through
// services/projects.ts's exported file helpers rather than touching the
// filesystem directly (one implementation of "read/write a project file").

import { differenceInMinutes } from 'date-fns';

import { HttpError } from '../lib/httpError.js';
import { generateTaskId } from '../lib/ids.js';
import type { ProjectBodyBlock } from '../lib/markdown/taskLine.js';
import type { Task, TaskStatus } from '../types.js';
import { loadProjectFile, saveProjectFile } from './projects.js';

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
}

export interface UpdateTaskInput {
  text?: string;
  description?: string | null;
  due?: string | null;
  tags?: string[];
  status?: TaskStatus;
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
  const task = findTaskBlock(parsed.blocks, taskId).task;
  const fromStatus = task.status;

  if (input.status !== undefined) applyStatusTransition(task, input.status, new Date());
  if (input.text !== undefined) task.text = input.text;
  if (input.description !== undefined) task.description = input.description;
  if (input.due !== undefined) task.due = input.due;
  if (input.tags !== undefined) task.tags = input.tags;

  const message =
    input.status !== undefined && input.status !== fromStatus
      ? `update_task ${taskId} status ${fromStatus}→${task.status} (${slug})`
      : `update_task ${taskId} (${slug})`;
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
