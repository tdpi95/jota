import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import TaskRow from '../components/TaskRow';
import { daysBetween, formatDateLong, todayStr, yearOf } from '../lib/date';
import type { IndexedTask, Task, TaskStatus } from '../types';

/** `GET /api/tasks/open`'s `IndexedTask` (project name/color/slug joined
 * in) -> the `Task` shape `TaskRow`/`TaskForm` actually render. Same fields
 * modulo `created`/`createdAt` naming, which neither component reads off
 * directly — `project` (name/color) is passed to `TaskRow` separately so it
 * can show the badge ProjectDetailPage's own task lists don't need. */
function toTask(t: IndexedTask): Task {
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
  };
}

/**
 * Dashboard v2 (PLAN.md: "open tasks across all projects, bucketed by due
 * date, project color badges, '+ log to today' quick action per row").
 * Buckets mirror design/Main.dc.html's own logic exactly: Today (due today),
 * Overdue (due before today, hidden entirely when empty), This week (due
 * within the next 7 days). Undated tasks and anything due further out stay
 * off the dashboard by design — they're still visible in each project's
 * Todo column.
 */
export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['tasks', 'open'], queryFn: api.getOpenTasks });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tasks', 'open'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  const updateTaskMutation = useMutation({
    mutationFn: ({ slug, taskId, values }: { slug: string; taskId: string; values: api.UpdateTaskInput }) =>
      api.updateTask(slug, taskId, values),
    onSuccess: invalidate,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ slug, taskId }: { slug: string; taskId: string }) => api.deleteTask(slug, taskId),
    onSuccess: invalidate,
  });

  const logTodayMutation = useMutation({
    mutationFn: (taskId: string) => {
      const today = todayStr();
      return api.linkTaskToJournal(yearOf(today), today, taskId);
    },
    onSuccess: () => {
      const today = todayStr();
      queryClient.invalidateQueries({ queryKey: ['journalEntry', today] });
      queryClient.invalidateQueries({ queryKey: ['journalYear', yearOf(today)] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  const today = todayStr();
  const open = data?.tasks ?? [];
  const overdue: IndexedTask[] = [];
  const dueToday: IndexedTask[] = [];
  const week: IndexedTask[] = [];
  for (const t of open) {
    if (!t.due) continue;
    const diff = daysBetween(today, t.due);
    if (diff < 0) overdue.push(t);
    else if (diff === 0) dueToday.push(t);
    else if (diff <= 7) week.push(t);
  }

  function renderBucket(title: string, tasks: IndexedTask[], opts: { hideIfEmpty?: boolean; emptyLabel?: string } = {}) {
    if (tasks.length === 0 && opts.hideIfEmpty) return null;
    return (
      <div className="bucket" key={title}>
        <div className="bucket-title">
          {title} <span className="count">{tasks.length}</span>
        </div>
        <div className="task-list">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={toTask(t)}
              project={{ name: t.projectName, color: t.projectColor }}
              onStatusChange={(status: TaskStatus) => updateTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id, values: { status } })}
              onSave={(values) => updateTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id, values })}
              onDelete={() => deleteTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id })}
              onLogToday={() => logTodayMutation.mutate(t.id)}
            />
          ))}
          {tasks.length === 0 && opts.emptyLabel && <div className="empty-note">{opts.emptyLabel}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-sub">{formatDateLong(today)}</div>
        </div>
        <Link className="journal-cta" to={`/journal/${yearOf(today)}/${today}`}>
          Open today's journal
        </Link>
      </div>

      {isLoading && <p className="page-sub">Loading open tasks…</p>}
      {isError && <p className="field-error">{error instanceof api.ApiError ? error.message : 'Failed to load open tasks.'}</p>}

      {!isLoading && !isError && (
        <>
          {renderBucket('Today', dueToday, { emptyLabel: 'Nothing due today.' })}
          {renderBucket('Overdue', overdue, { hideIfEmpty: true })}
          {renderBucket('This week', week)}
        </>
      )}
    </div>
  );
}
