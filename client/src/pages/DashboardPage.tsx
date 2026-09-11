import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import Modal from '../components/Modal';
import ProjectCard from '../components/ProjectCard';
import TaskRow from '../components/TaskRow';
import { daysBetween, formatDateLong, todayStr, yearOf } from '../lib/date';
import type { IndexedTask, ProjectSummary, Task, TaskStatus } from '../types';

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

/** Most-recent-activity instant for a project — the latest of its own
 * creation date and every task's creation/completion — used to sort the
 * Dashboard's "Recent projects" section. Not a stored field: derived purely
 * from data every consumer already has (PLAN.md doesn't track a
 * last-modified timestamp anywhere, and adding one just for this would mean
 * a write-path change for a read-only convenience). */
function lastActivity(project: ProjectSummary): number {
  let latest = new Date(project.frontmatter.created).getTime();
  for (const task of project.tasks) {
    latest = Math.max(latest, new Date(task.created).getTime());
    if (task.doneAt) latest = Math.max(latest, new Date(task.doneAt).getTime());
  }
  return latest;
}

const RECENT_PROJECTS_LIMIT = 3;

/**
 * Dashboard v2 (PLAN.md: "open tasks across all projects, bucketed by due
 * date, project color badges, '+ log to today' quick action per row").
 * Buckets mirror design/Main.dc.html's own logic exactly: Today (due today),
 * Overdue (due before today, hidden entirely when empty), This week (due
 * within the next 7 days). Undated tasks and anything due further out stay
 * off the dashboard by design — they're still visible in each project's
 * Todo column.
 *
 * Milestone 18 additions: an "+ Add task" button next to "Open today's
 * journal" (that link already covers quick journaling) opening a popup with
 * a project selector; a "Search tasks" button (by the task buckets, not the
 * page header) opening a search popup — one text input plus clickable tag
 * pills, both driving the same underlying text-or-tag query
 * (`querySearchTasks` matches both); a collapsible "Recent projects"
 * section.
 */
const SEARCH_DEBOUNCE_MS = 300;
export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const queryClient = useQueryClient();
  const today = todayStr();
  const year = yearOf(today);

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['tasks', 'open'], queryFn: api.getOpenTasks });
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const [addingTask, setAddingTask] = useState(false);
  const [quickTaskText, setQuickTaskText] = useState('');
  const [quickTaskSlug, setQuickTaskSlug] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [recentProjectsOpen, setRecentProjectsOpen] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchResultsQuery = useQuery({
    queryKey: ['taskSearch', debouncedSearchQuery],
    queryFn: () => api.searchTasks(debouncedSearchQuery),
    enabled: searching && debouncedSearchQuery.trim().length > 0,
  });

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
    mutationFn: (taskId: string) => api.linkTaskToJournal(year, today, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntry', today] });
      queryClient.invalidateQueries({ queryKey: ['journalYear', year] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  const quickAddTaskMutation = useMutation({
    mutationFn: ({ slug, text }: { slug: string; text: string }) => api.createTask(slug, { text }),
    onSuccess: () => {
      invalidate();
      setQuickTaskText('');
      setAddingTask(false);
    },
  });

  const projects = projectsQuery.data?.projects ?? [];
  const selectableProjects = projects.filter((p) => !p.frontmatter.archived);
  const recentProjects = [...selectableProjects].sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, RECENT_PROJECTS_LIMIT);
  const selectedSlug = quickTaskSlug || recentProjects[0]?.slug || selectableProjects[0]?.slug || '';

  function handleQuickAddTask(e: React.FormEvent) {
    e.preventDefault();
    const text = quickTaskText.trim();
    if (!text || !selectedSlug) return;
    quickAddTaskMutation.mutate({ slug: selectedSlug, text });
  }

  const open = data?.tasks ?? [];
  // Clickable tags in the search popup — derived from open tasks (the data
  // already loaded here), not a separate fetch. Clicking one just runs it
  // through the same text search (which also matches tags), rather than a
  // parallel filter path.
  const searchableTags = [...new Set(open.flatMap((t) => t.tags))].sort();

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

  // Shared by the Today/Overdue/This-week buckets and the search popup's
  // results — same task shape (IndexedTask), same mutations either way.
  function renderTaskRow(t: IndexedTask) {
    return (
      <TaskRow
        key={t.id}
        task={toTask(t)}
        project={{ name: t.projectName, color: t.projectColor, slug: t.projectSlug }}
        onStatusChange={(status: TaskStatus) => updateTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id, values: { status } })}
        onSave={(values) => updateTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id, values })}
        onDelete={() => deleteTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id })}
        onLogToday={() => logTodayMutation.mutate(t.id)}
      />
    );
  }

  function renderBucket(title: string, tasks: IndexedTask[], opts: { hideIfEmpty?: boolean; emptyLabel?: string } = {}) {
    if (tasks.length === 0 && opts.hideIfEmpty) return null;
    return (
      <div className="bucket" key={title}>
        <div className="bucket-title">
          {title} <span className="count">{tasks.length}</span>
        </div>
        <div className="task-list">
          {tasks.map(renderTaskRow)}
          {tasks.length === 0 && opts.emptyLabel && <div className="empty-note">{opts.emptyLabel}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <div className="page-sub">{formatDateLong(today, language)}</div>
        </div>
        <div className="dashboard-header-actions">
          <Link className="journal-cta" to={`/journal/${year}/${today}`}>
            {t('dashboard.openTodaysJournal')}
          </Link>
          <button type="button" className="journal-cta" onClick={() => setAddingTask(true)}>
            {t('dashboard.addTask')}
          </button>
        </div>
      </div>

      {searching && (
        <Modal
          title={t('dashboard.searchTasks')}
          onClose={() => {
            setSearching(false);
            setSearchQuery('');
          }}
        >
          <input
            className="picker-input"
            placeholder={t('dashboard.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchableTags.length > 0 && (
            <div className="tag-filter-row search-tag-row">
              {searchableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-pill tag-pill-filter ${searchQuery === tag ? 'active' : ''}`}
                  onClick={() => setSearchQuery(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <div className="task-list search-results">
            {(searchResultsQuery.data?.tasks ?? []).map(renderTaskRow)}
            {debouncedSearchQuery.trim() && !searchResultsQuery.isFetching && searchResultsQuery.data?.tasks.length === 0 && (
              <div className="empty-note">{t('dashboard.noMatchingTasks')}</div>
            )}
            {!debouncedSearchQuery.trim() && <div className="empty-note">{t('dashboard.searchHint')}</div>}
          </div>
        </Modal>
      )}

      {addingTask && (
        <Modal title={t('dashboard.quickAddTaskTitle')} onClose={() => setAddingTask(false)}>
          <form onSubmit={handleQuickAddTask}>
            <div className="quick-add-row">
              <input
                className="add-task-input"
                placeholder={t('dashboard.taskTitlePlaceholder')}
                value={quickTaskText}
                onChange={(e) => setQuickTaskText(e.target.value)}
                autoFocus
              />
              <select className="quick-add-select" value={selectedSlug} onChange={(e) => setQuickTaskSlug(e.target.value)}>
                {selectableProjects.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.frontmatter.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={!quickTaskText.trim() || !selectedSlug || quickAddTaskMutation.isPending}>
                {t('dashboard.addTaskSubmit')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAddingTask(false)}>
                {t('dashboard.cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {recentProjects.length > 0 && (
        <div className="bucket">
          <button type="button" className="bucket-title bucket-title-toggle" onClick={() => setRecentProjectsOpen((v) => !v)}>
            <span className={`disclosure-caret ${recentProjectsOpen ? 'open' : ''}`}>▸</span>
            {t('dashboard.recentProjects')}
          </button>
          {recentProjectsOpen && (
            <>
              <div className="projects-grid">
                {recentProjects.map((p) => (
                  <ProjectCard key={p.slug} project={p} variant="grid" />
                ))}
              </div>
              {selectableProjects.length > recentProjects.length && (
                <Link to="/projects" className="back-link">
                  {t('dashboard.seeAllProjects')}
                </Link>
              )}
            </>
          )}
        </div>
      )}

      <div className="tasks-section-header">
        <button
          type="button"
          className="btn-secondary icon-only-btn"
          title={t('dashboard.searchTasks')}
          aria-label={t('dashboard.searchTasks')}
          onClick={() => setSearching(true)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </div>

      {isLoading && <p className="page-sub">{t('dashboard.loadingOpenTasks')}</p>}
      {isError && <p className="field-error">{error instanceof api.ApiError ? error.message : t('dashboard.failedToLoad')}</p>}

      {!isLoading && !isError && (
        <>
          {renderBucket(t('dashboard.buckets.today'), dueToday, { emptyLabel: t('dashboard.nothingDueToday') })}
          {renderBucket(t('dashboard.buckets.overdue'), overdue, { hideIfEmpty: true })}
          {renderBucket(t('dashboard.buckets.thisWeek'), week)}
        </>
      )}
    </div>
  );
}
