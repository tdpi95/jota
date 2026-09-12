// MCP tool schemas + dispatch (PLAN.md "Agent access via MCP", milestone
// 10) — every tool is a thin wrapper over the exact same services/*.ts
// functions the REST routes call (CLAUDE.md: "both the REST API and the MCP
// tools must call these same functions"). Writes are tagged
// `mcp:<tool_name>` as the git commit origin (PLAN.md: "history always
// shows whether a human ... or an agent (and which tool) made a change").

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HttpError } from '../lib/httpError.js';
import * as journalService from '../services/journal.js';
import * as projectService from '../services/projects.js';
import * as taskService from '../services/tasks.js';

const TASK_STATUS = z.enum(['todo', 'doing', 'done']);
const DATE = z.string().describe('YYYY-MM-DD');
const CHECKLIST_ITEM = z.object({ text: z.string(), done: z.boolean() });

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Structured errors are returned to the model as tool results (`isError:
 * true`), not thrown — a thrown error would surface as a raw protocol
 * failure instead of something the agent can read and self-correct from
 * (PLAN.md: "errors are structured and returned to the model"). An
 * `HttpError`'s message already carries the useful detail (e.g. a project
 * "did you mean" hint); anything else is a genuine bug, so it's logged to
 * stderr (never stdout — that's the JSON-RPC channel) as well. */
function wrap<T>(fn: () => T): CallToolResult {
  try {
    return ok(fn());
  } catch (err) {
    if (err instanceof HttpError) return { content: [{ type: 'text', text: err.message }], isError: true };
    console.error('[mcp] tool call failed:', err);
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** Registers every tool against one fixed `workspacePath`, resolved once by
 * mcp/index.ts at process startup — never re-resolved per call, so the
 * target vault can't change mid-conversation (PLAN.md). */
export function registerTools(server: McpServer, workspacePath: string): void {
  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: 'Creates a new task on an existing project.',
      inputSchema: {
        projectSlug: z.string().describe('The project the task belongs to — see list_projects.'),
        text: z.string().describe('The task title.'),
        due: z.string().optional().describe('YYYY-MM-DD due date.'),
        tags: z.array(z.string()).optional(),
        description: z.string().optional().describe('Free-text description.'),
        checklist: z.array(CHECKLIST_ITEM).optional().describe('Sub-task checklist items, in order.'),
      },
    },
    ({ projectSlug, text, due, tags, description, checklist }) =>
      wrap(() =>
        taskService.createTask(workspacePath, projectSlug, { text, due, tags, description, checklist }, 'mcp:create_task'),
      ),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description:
        "Updates a task's text/description/due/tags/checklist, or transitions its status. Moving to 'doing' starts the time " +
        "tracker; moving away from 'doing' automatically folds elapsed time into spentMinutes — there is no separate " +
        'start/stop tool. `checklist`, if given, replaces the whole sub-task list — read the task first (get_project/' +
        'search_tasks) to toggle/add/remove one item without losing the others.',
      inputSchema: {
        projectSlug: z.string(),
        taskId: z.string(),
        text: z.string().optional(),
        description: z.string().nullable().optional(),
        due: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        checklist: z.array(CHECKLIST_ITEM).optional().describe('Full replacement of the sub-task checklist.'),
        status: TASK_STATUS.optional(),
      },
    },
    ({ projectSlug, taskId, text, description, due, tags, checklist, status }) =>
      wrap(() =>
        taskService.updateTask(
          workspacePath,
          projectSlug,
          taskId,
          { text, description, due, tags, checklist, status },
          'mcp:update_task',
        ),
      ),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Permanently removes a task from its project.',
      inputSchema: { projectSlug: z.string(), taskId: z.string() },
    },
    ({ projectSlug, taskId }) =>
      wrap(() => {
        taskService.deleteTask(workspacePath, projectSlug, taskId, 'mcp:delete_task');
        return { deleted: taskId };
      }),
  );

  server.registerTool(
    'search_tasks',
    {
      title: 'Search tasks',
      description: 'Case-insensitive substring search over task text/description, across all projects.',
      inputSchema: { query: z.string() },
    },
    ({ query }) => wrap(() => taskService.searchTasks(workspacePath, query)),
  );

  server.registerTool(
    'list_open_tasks',
    {
      title: 'List open tasks',
      description: 'Every not-done (todo or doing) task across all projects, due-soonest first.',
      inputSchema: {},
    },
    () => wrap(() => taskService.listOpenTasks(workspacePath)),
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Creates a new project. Color is auto-assigned from the palette if omitted.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        color: z.string().optional().describe('Hex color, e.g. "#4f86f7". Auto-assigned if omitted.'),
      },
    },
    ({ name, description, tags, color }) =>
      wrap(() => projectService.createProject(workspacePath, { name, description, tags, color }, 'mcp:create_project')),
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description: "Updates a project's name/description/tags/color/archived state.",
      inputSchema: {
        slug: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        color: z.string().optional(),
        archived: z.boolean().optional(),
      },
    },
    ({ slug, name, description, tags, color, archived }) =>
      wrap(() => projectService.updateProject(workspacePath, slug, { name, description, tags, color, archived }, 'mcp:update_project')),
  );

  server.registerTool(
    'list_projects',
    { title: 'List projects', description: 'Every project in the workspace, each with its tasks.', inputSchema: {} },
    () => wrap(() => projectService.listProjects(workspacePath)),
  );

  server.registerTool(
    'get_project',
    { title: 'Get project', description: 'One project by slug, with its tasks.', inputSchema: { slug: z.string() } },
    ({ slug }) => wrap(() => projectService.getProject(workspacePath, slug)),
  );

  server.registerTool(
    'upsert_journal_entry',
    {
      title: 'Upsert journal entry',
      description: "Creates or updates a day's journal entry. Fields left out keep their existing value.",
      inputSchema: {
        date: DATE,
        tags: z.array(z.string()).optional(),
        linkedTasks: z.array(z.string()).optional().describe('Full-replace list of linked task ids.'),
        body: z.string().optional(),
      },
    },
    ({ date, tags, linkedTasks, body }) =>
      wrap(() => journalService.putJournalEntry(workspacePath, yearOf(date), date, { tags, linkedTasks, body }, 'mcp:upsert_journal_entry')),
  );

  server.registerTool(
    'get_journal_entry',
    {
      title: 'Get journal entry',
      description: "One day's journal entry — returns empty defaults if that day has never been written.",
      inputSchema: { date: DATE },
    },
    ({ date }) => wrap(() => journalService.getJournalEntry(workspacePath, yearOf(date), date)),
  );

  server.registerTool(
    'link_task_to_journal',
    {
      title: 'Link task to journal',
      description: "Links a task to a day's journal entry. Idempotent; auto-creates the entry if it doesn't exist yet.",
      inputSchema: { date: DATE, taskId: z.string() },
    },
    ({ date, taskId }) => wrap(() => journalService.linkTask(workspacePath, yearOf(date), date, taskId, 'mcp:link_task_to_journal')),
  );

  server.registerTool(
    'unlink_task_from_journal',
    {
      title: 'Unlink task from journal',
      description: "Removes a task link from a day's journal entry. Idempotent.",
      inputSchema: { date: DATE, taskId: z.string() },
    },
    ({ date, taskId }) =>
      wrap(() => journalService.unlinkTask(workspacePath, yearOf(date), date, taskId, 'mcp:unlink_task_from_journal')),
  );

  server.registerTool(
    'get_task_summary',
    {
      title: 'Get task summary',
      description:
        'Structured counts/groupings of tasks (by status, by project, overdue count), optionally filtered by project, ' +
        'status, or date range. Returns data for you to narrate, not prose.',
      inputSchema: {
        projectSlug: z.string().optional(),
        status: TASK_STATUS.optional(),
        dateRange: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
      },
    },
    ({ projectSlug, status, dateRange }) =>
      wrap(() => taskService.getTaskSummary(workspacePath, { projectSlug, status, from: dateRange?.from, to: dateRange?.to })),
  );
}
