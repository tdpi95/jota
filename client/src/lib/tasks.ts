import type { IndexedTask, Task } from '../types';

/** `GET /api/tasks/open`'s `IndexedTask` (project name/color/slug joined
 * in) -> the `Task` shape `TaskRow`/`TaskForm` actually render. Same fields
 * modulo `created`/`createdAt` naming, which neither component reads off
 * directly — `project` (name/color) is passed to `TaskRow` separately so it
 * can show the badge ProjectDetailPage's own task lists don't need. Shared
 * by `DashboardPage`'s own buckets and `SearchModal`'s task results — both
 * render `IndexedTask` search/query results through the same `TaskRow`. */
export function toTask(t: IndexedTask): Task {
  return {
    id: t.id,
    status: t.status,
    text: t.text,
    due: t.due,
    created: t.createdAt,
    doingSince: t.doingSince,
    spentMinutes: t.spentMinutes,
    doneAt: t.doneAt,
    tags: t.tags,
    description: t.description,
    checklist: t.checklist,
  };
}
