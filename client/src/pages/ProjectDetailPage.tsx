import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import HistoryPanel from '../components/HistoryPanel';
import Modal from '../components/Modal';
import ProjectForm from '../components/ProjectForm';
import TaskForm from '../components/TaskForm';
import TaskRow from '../components/TaskRow';
import { daysBetween, todayStr, yearOf } from '../lib/date';
import type { Task, TaskStatus } from '../types';

/** A project's Done column can grow without bound over the project's
 * lifetime — tasks finished a year ago have equal footing with yesterday's
 * unless something caps what's shown. Done tasks completed within this many
 * days render by default (newest-done-first); everything older collapses
 * behind a "+N older" toggle instead of always rendering. */
const RECENT_DONE_DAYS = 7;

export default function ProjectDetailPage() {
  const { t } = useTranslation();
  const COLUMNS: { status: TaskStatus; title: string }[] = [
    { status: 'todo', title: t('projectDetail.columns.todo') },
    { status: 'doing', title: t('projectDetail.columns.doing') },
    { status: 'done', title: t('projectDetail.columns.done') },
  ];
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [creatingTask, setCreatingTask] = useState<{ text: string } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverInfo, setDragOverInfo] = useState<{ status: TaskStatus; afterId: string | null } | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => api.getProject(slug),
  });

  // Arriving from a journal entry's linked-task chip (JournalDayPage) passes
  // the task id via navigation state rather than a query param, so a raw
  // page refresh doesn't re-trigger the scroll/highlight. Expand the Done
  // column's "older" collapse first if that's where the task lives, since
  // its row has no ref (isn't rendered) until then.
  useEffect(() => {
    const navState = location.state as { highlightTaskId?: string } | null;
    const taskId = navState?.highlightTaskId;
    if (!taskId || !data) return;
    const task = data.project.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.status === 'done' && task.doneAt !== null && daysBetween(task.doneAt, todayStr()) > RECENT_DONE_DAYS) {
      setShowAllDone(true);
    }
    setHighlightedTaskId(taskId);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, location.state]);

  useEffect(() => {
    if (!highlightedTaskId) return;
    rowRefs.current[highlightedTaskId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setHighlightedTaskId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedTaskId, showAllDone]);
  // Just for the edit form's group combobox suggestions (existing group
  // names across every project) — same query key ProjectsListPage/Dashboard
  // already use, so this is cache-warm rather than a fresh fetch whenever
  // one of those was visited first.
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const existingGroups = [...new Set((projectsQuery.data?.projects ?? []).map((p) => p.frontmatter.group))].sort();

  function invalidateProject() {
    queryClient.invalidateQueries({ queryKey: ['project', slug] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['tasks', 'open'] });
    // Task due dates feed the calendar sidebar's dots — keep it in sync
    // with create/edit/delete here too, not just Dashboard's own mutations.
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  const updateProjectMutation = useMutation({
    mutationFn: (values: api.UpdateProjectInput) => api.updateProject(slug, values),
    onSuccess: () => {
      invalidateProject();
      setEditing(false);
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: (values: api.CreateTaskInput) => api.createTask(slug, values),
    onSuccess: () => {
      invalidateProject();
      setCreatingTask(null);
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, values }: { taskId: string; values: api.UpdateTaskInput }) => api.updateTask(slug, taskId, values),
    onSuccess: invalidateProject,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => api.deleteTask(slug, taskId),
    onSuccess: invalidateProject,
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

  if (isLoading) return <p className="page-sub">{t('projectDetail.loading')}</p>;
  if (isError) {
    const message = error instanceof api.ApiError ? error.message : t('projectDetail.failedToLoad');
    return (
      <div>
        <p className="field-error">{message}</p>
        <button className="btn-secondary" onClick={() => navigate('/projects')}>
          {t('projectDetail.backToProjects')}
        </button>
      </div>
    );
  }

  // Belt-and-suspenders: isLoading/isError above cover every query state
  // that matters, but don't let a gap in that reasoning (or a future change
  // to the query's options) crash the page — fall back to the same "not
  // found" affordance rather than reading `.project` off `undefined`.
  if (!data) return <p className="page-sub">{t('projectDetail.loading')}</p>;

  const project = data.project;
  const { frontmatter, tasks } = project;
  const byStatus = (status: TaskStatus): Task[] => tasks.filter((t) => t.status === status);
  const taskTitles = new Map(tasks.map((t) => [t.id, t.text]));

  // Done column: newest-done-first (file order has no meaning for finished
  // tasks the way it does for todo/doing's drag-reorderable position), with
  // anything older than RECENT_DONE_DAYS collapsed behind "+N older" by
  // default. `allDoneTasks`/`visibleDoneTasks` back both the column's render
  // and its drag-and-drop math below, so the two stay in visual agreement.
  const allDoneTasks = byStatus('done')
    .slice()
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const today = todayStr();
  const olderDoneTasks = allDoneTasks.filter((t) => t.doneAt !== null && daysBetween(t.doneAt, today) > RECENT_DONE_DAYS);
  const visibleDoneTasks = showAllDone ? allDoneTasks : allDoneTasks.filter((t) => !olderDoneTasks.includes(t));

  function columnTasks(status: TaskStatus): Task[] {
    return status === 'done' ? visibleDoneTasks : byStatus(status);
  }

  /** Drag-and-drop within/between the Kanban columns (PLAN.md milestone 18).
   * `afterId: null` means "drop at the top of this column". No optimistic
   * local reordering — same invalidate-and-refetch pattern as every other
   * mutation on this page. */
  function computeAfterId(e: React.DragEvent, others: Task[]): string | null {
    for (const t of others) {
      const rect = rowRefs.current[t.id]?.getBoundingClientRect();
      if (rect && e.clientY < rect.top + rect.height / 2) {
        const idx = others.indexOf(t);
        return idx === 0 ? null : others[idx - 1].id;
      }
    }
    return others.length > 0 ? others[others.length - 1].id : null;
  }

  function handleColumnDragOver(e: React.DragEvent, status: TaskStatus) {
    if (!draggingTaskId) return;
    e.preventDefault();
    const others = columnTasks(status).filter((t) => t.id !== draggingTaskId);
    setDragOverInfo({ status, afterId: computeAfterId(e, others) });
  }

  function handleColumnDrop(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    const taskId = draggingTaskId;
    const info = dragOverInfo;
    setDraggingTaskId(null);
    setDragOverInfo(null);
    if (!taskId || !info || info.status !== status) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    updateTaskMutation.mutate({
      taskId,
      values: { afterTaskId: info.afterId, ...(task.status !== status ? { status } : {}) },
    });
  }

  return (
    <div>
      <Link to="/projects" className="back-link">
        {t('projectDetail.allProjects')}
      </Link>

      <div className="page-header">
        <div>
          <div className="pd-head">
            {frontmatter.profileImage ? (
              <span className="pd-avatar-wrap">
                <img className="pd-avatar" src={`/api/${frontmatter.profileImage}`} alt="" />
                <span className="pd-color-badge" style={{ background: frontmatter.color }} />
              </span>
            ) : (
              <span className="pd-color" style={{ background: frontmatter.color }} />
            )}
            <div>
              <h1 className="page-title">
                {frontmatter.name}
                {frontmatter.archived ? t('projectDetail.archivedSuffix') : ''}
              </h1>
              <div className="pd-group">
                <span className="tag-pill">{frontmatter.group}</span>
              </div>
            </div>
          </div>
        </div>
        <button className="btn-secondary" onClick={() => setEditing(true)}>
          {t('projectDetail.editProject')}
        </button>
      </div>

      {frontmatter.description && <div className="pd-desc">{frontmatter.description}</div>}

      {editing && (
        <Modal title={t('projectDetail.editProjectModalTitle')} onClose={() => setEditing(false)}>
          <ProjectForm
            bare
            initial={{
              name: frontmatter.name,
              description: frontmatter.description,
              group: frontmatter.group,
              color: frontmatter.color,
              archived: frontmatter.archived,
              profileImage: frontmatter.profileImage,
            }}
            existingGroups={existingGroups}
            showArchived
            submitLabel={t('projectDetail.saveChanges')}
            pending={updateProjectMutation.isPending}
            onSubmit={(values) => updateProjectMutation.mutate(values)}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}

      <TaskForm
        compact
        submitLabel={t('projectDetail.addTask')}
        pending={createTaskMutation.isPending}
        onSubmit={(values) => createTaskMutation.mutate(values)}
        onMoreFields={(text) => setCreatingTask({ text })}
      />

      {creatingTask && (
        <Modal title={t('projectDetail.addTaskModalTitle')} onClose={() => setCreatingTask(null)}>
          <TaskForm
            initialText={creatingTask.text}
            submitLabel={t('projectDetail.addTask')}
            pending={createTaskMutation.isPending}
            onSubmit={(values) => createTaskMutation.mutate(values)}
            onCancel={() => setCreatingTask(null)}
          />
        </Modal>
      )}

      <div className="pd-columns">
        {COLUMNS.map((col) => {
          const colTasks = columnTasks(col.status);
          // The Done column's header always counts every finished task, even
          // while older ones are collapsed below — otherwise the count would
          // misleadingly drop the moment the page hides them.
          const totalCount = col.status === 'done' ? allDoneTasks.length : colTasks.length;
          const isDragOverColumn = dragOverInfo?.status === col.status;
          return (
            <div className={`pd-column ${isDragOverColumn ? 'drag-over' : ''}`} key={col.status}>
              <div className="pd-column-header">
                {col.title} <span className="count">{totalCount}</span>
              </div>
              <div className="task-list" onDragOver={(e) => handleColumnDragOver(e, col.status)} onDrop={(e) => handleColumnDrop(e, col.status)}>
                {isDragOverColumn && dragOverInfo?.afterId === null && <div className="drop-indicator" />}
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    ref={(el) => {
                      rowRefs.current[task.id] = el;
                    }}
                    className={`task-drag-wrap ${draggingTaskId === task.id ? 'dragging' : ''} ${highlightedTaskId === task.id ? 'task-highlight' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggingTaskId(task.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', task.id);
                    }}
                    onDragEnd={() => {
                      setDraggingTaskId(null);
                      setDragOverInfo(null);
                    }}
                  >
                    <TaskRow
                      task={task}
                      onStatusChange={(status) => updateTaskMutation.mutate({ taskId: task.id, values: { status } })}
                      onSave={(values) => updateTaskMutation.mutate({ taskId: task.id, values })}
                      onDelete={() => deleteTaskMutation.mutate(task.id)}
                      onLogToday={() => logTodayMutation.mutate(task.id)}
                    />
                    {isDragOverColumn && dragOverInfo?.afterId === task.id && <div className="drop-indicator" />}
                  </div>
                ))}
                {col.status === 'done' && !showAllDone && olderDoneTasks.length > 0 && (
                  <button type="button" className="list-toggle-btn" onClick={() => setShowAllDone(true)}>
                    {t('projectDetail.showOlderDone', { count: olderDoneTasks.length })}
                  </button>
                )}
                {col.status === 'done' && showAllDone && olderDoneTasks.length > 0 && (
                  <button type="button" className="list-toggle-btn" onClick={() => setShowAllDone(false)}>
                    {t('projectDetail.hideOlderDone')}
                  </button>
                )}
                {totalCount === 0 && <div className="empty-note">{t('projectDetail.nothingHere')}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <HistoryPanel path={`projects/${slug}.md`} onReverted={invalidateProject} taskTitles={taskTitles} />
    </div>
  );
}
