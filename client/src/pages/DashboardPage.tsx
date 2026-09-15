import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import Modal from '../components/Modal';
import ProjectCard from '../components/ProjectCard';
import TaskRow from '../components/TaskRow';
import { daysBetween, formatDateLong, todayStr, yearOf } from '../lib/date';
import type { IndexedTask, ProjectSummary, SearchResult, Task, TaskStatus } from '../types';

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
    checklist: t.checklist,
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
/** Each task bucket (Doing/Today/Overdue/This week) below the fold shows at
 * most this many rows by default — same "+N more"/"Show fewer" collapse
 * pattern used elsewhere (ProjectDetailPage's Done column, HistoryPanel). */
const BUCKET_LIMIT = 10;

/** ⌘ on Mac, Ctrl everywhere else — matches how every app using this same
 * Cmd/Ctrl+K "open search" convention (VS Code, Slack, Notion, Linear,
 * GitHub) displays its own shortcut hint. */
const SEARCH_SHORTCUT_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';

/** Renders a `snippet()` excerpt's `**match**` markers as `<mark>` — the
 * only markup FTS5's snippet ever produces (PLAN.md "Search (cross-type
 * full-text)"), so a plain split-on-`**` is enough; no need for a real
 * markdown renderer for what is otherwise plain, already-escaped text. */
function renderSnippet(snippet: string): React.ReactNode {
  return snippet.split('**').map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

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
 * a project selector; a "Search everything" button opening a search popup —
 * one text input plus clickable tag pills (sourced from open tasks' own
 * tags; note/project-only tags aren't offered as pills, though typing one
 * still matches them); a collapsible "Recent projects" section.
 *
 * Milestone 25 follow-up: the popup was upgraded from the task-only
 * `GET /api/tasks/search` to the cross-type `GET /api/search` (PLAN.md
 * "Search (cross-type full-text)") — results can now be a task, note,
 * journal entry, or project, each rendered by its own row shape (task rows
 * reuse `TaskRow` exactly as the buckets below do; the other three get a
 * compact title/date + snippet row with a "go to" link) rather than
 * assuming every result is a task. A later follow-up moved the search
 * button up into the page header next to the other two quick actions
 * (previously it sat alone by the task buckets, further down the page) and
 * added the Cmd/Ctrl+K shortcut every app using this same "open search"
 * convention supports (VS Code, Slack, Notion, Linear, GitHub) — bound
 * globally on the page (not just while a text field has focus), matching
 * how those apps behave, and a no-op if the popup is already open.
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
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({});
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [groupFilters, setGroupFilters] = useState<string[]>([]);

  // Persists across restarts (`~/.poco/config.json` via
  // `GET/PUT /api/preferences/dashboard-recent-projects-open`) — same
  // fetch-once-and-apply-on-top-of-the-default shape as CalendarPage's
  // `calendarMode`/`granularity` toggles.
  const { data: recentProjectsOpenData } = useQuery({
    queryKey: ['dashboardRecentProjectsOpenPreference'],
    queryFn: () => api.getDashboardRecentProjectsOpenPreference(),
  });
  useEffect(() => {
    if (recentProjectsOpenData) setRecentProjectsOpen(recentProjectsOpenData.open);
  }, [recentProjectsOpenData]);
  const setRecentProjectsOpenMutation = useMutation({ mutationFn: (next: boolean) => api.setDashboardRecentProjectsOpenPreference(next) });
  function toggleRecentProjectsOpen() {
    const next = !recentProjectsOpen;
    setRecentProjectsOpen(next);
    setRecentProjectsOpenMutation.mutate(next);
  }

  function toggleTagFilter(tag: string) {
    setTagFilters((current) => (current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]));
  }

  // Persists across restarts (`~/.poco/config.json` via
  // `GET/PUT /api/preferences/dashboard-group-filter`) — same
  // fetch-once-and-apply-on-top-of-the-default shape as `recentProjectsOpen`
  // just above. Unlike `recentProjectsOpen` (a simple boolean), a stored
  // group name can go stale (its project renamed/regrouped/deleted, or a
  // different workspace's groups) — `bucketTasks` below always intersects
  // this against the *current* workspace's live group set before applying
  // it, so a stale entry silently has no effect rather than zeroing out
  // every bucket with no visible explanation.
  const { data: groupFilterData } = useQuery({
    queryKey: ['dashboardGroupFilterPreference'],
    queryFn: () => api.getDashboardGroupFilterPreference(),
  });
  useEffect(() => {
    if (groupFilterData) setGroupFilters(groupFilterData.groups);
  }, [groupFilterData]);
  const setGroupFilterMutation = useMutation({ mutationFn: (groups: string[]) => api.setDashboardGroupFilterPreference(groups) });
  function toggleGroupFilter(group: string) {
    setGroupFilters((current) => {
      const next = current.includes(group) ? current.filter((existing) => existing !== group) : [...current, group];
      setGroupFilterMutation.mutate(next);
      return next;
    });
  }
  function clearGroupFilters() {
    setGroupFilters([]);
    setGroupFilterMutation.mutate([]);
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Cmd/Ctrl+K opens the search popup from anywhere on the page — including
  // while some other input has focus, same as VS Code/Slack/Notion/Linear's
  // own Cmd/Ctrl+K, which is exactly why this is a plain window listener
  // rather than scoped to a particular element. `preventDefault` stops a
  // browser tab's own Ctrl+K (Firefox: focus the address bar's search).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchResultsQuery = useQuery({
    queryKey: ['search', debouncedSearchQuery],
    queryFn: () => api.search({ q: debouncedSearchQuery }),
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

  // Task-bucket tag filter — same OR-matched, widening-not-narrowing
  // toggle-pill pattern as ProjectsListPage/NotesListPage's tag filters,
  // applied to the buckets below rather than the search popup above (a
  // separate, unrelated filter over the same already-loaded task list).
  // `allBucketTags`/`allBucketGroups` stay derived from every open task (not
  // `bucketTasks`) so picking a filter never removes other tags/groups from
  // their own pill row. The group filter (PLAN.md "organize projects into
  // groups") is a second, independent filter dimension — AND'd with the tag
  // filter, OR'd within its own selected groups, same as the tag filter is
  // within itself.
  const allBucketTags = [...new Set(open.flatMap((t) => t.tags))].sort();
  const allBucketGroups = [...new Set(open.map((t) => t.projectGroup))].sort();
  // Intersected against `allBucketGroups` so a persisted-but-now-stale group
  // (renamed/regrouped/deleted since, or left over from a different
  // workspace) silently drops out instead of matching zero tasks and
  // blanking every bucket with no visible pill to explain why.
  const activeGroupFilters = groupFilters.filter((g) => allBucketGroups.includes(g));
  const bucketTasks = open
    .filter((t) => tagFilters.length === 0 || t.tags.some((tag) => tagFilters.includes(tag)))
    .filter((t) => activeGroupFilters.length === 0 || activeGroupFilters.includes(t.projectGroup));

  const overdue: IndexedTask[] = [];
  const dueToday: IndexedTask[] = [];
  const week: IndexedTask[] = [];
  for (const t of bucketTasks) {
    if (!t.due) continue;
    const diff = daysBetween(today, t.due);
    if (diff < 0) overdue.push(t);
    else if (diff === 0) dueToday.push(t);
    else if (diff <= 7) week.push(t);
  }
  // Everything currently in progress, regardless of due date — a task with
  // no due date (or one due further out) would otherwise never appear on
  // the Dashboard at all despite actively tracking time. Deliberately not
  // exclusive with the due-date buckets above: the same task can show up
  // both here and in e.g. Overdue, since "what's overdue" and "what am I
  // actively working on" are different questions worth answering separately.
  const doing = bucketTasks.filter((t) => t.status === 'doing');

  // Shared by the Today/Overdue/This-week buckets and the search popup's
  // task results — same task shape (IndexedTask), same mutations either way.
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

  /** Search popup only (milestone 25 follow-up) — a task result reuses
   * `renderTaskRow` exactly; a note/journal/project result gets its own
   * compact row (type badge, title/date, snippet, a "go to" link), since
   * none of those have a status/due/checklist to show. */
  function renderSearchResult(r: SearchResult) {
    if (r.type === 'task') return renderTaskRow(r.task);

    const [title, to, badgeKey] =
      r.type === 'note'
        ? [r.note.title, `/notes/${r.note.slug}`, 'note']
        : r.type === 'project'
          ? [r.project.name, `/projects/${r.project.slug}`, 'project']
          : [formatDateLong(r.date, language), `/journal/${yearOf(r.date)}/${r.date}`, 'journal'];

    return (
      <div className="task-row search-result-row" key={`${r.type}-${to}`}>
        <span className={`search-result-badge srr-${badgeKey}`}>{t(`dashboard.searchResultType.${badgeKey}`)}</span>
        <div className="task-main">
          <div className="task-title-row">
            <span className="task-title">{title}</span>
          </div>
          <div className="search-result-snippet">{renderSnippet(r.snippet)}</div>
        </div>
        <div className="task-actions">
          <Link className="icon-btn" title={t('dashboard.searchResultGoTo', { type: t(`dashboard.searchResultType.${badgeKey}`) })} to={to}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>
    );
  }

  function renderBucket(key: string, title: string, tasks: IndexedTask[], opts: { hideIfEmpty?: boolean; emptyLabel?: string } = {}) {
    if (tasks.length === 0 && opts.hideIfEmpty) return null;
    const expanded = expandedBuckets[key] ?? false;
    const visibleTasks = expanded ? tasks : tasks.slice(0, BUCKET_LIMIT);
    const hiddenCount = tasks.length - visibleTasks.length;
    return (
      <div className="bucket" key={key}>
        <div className="bucket-title">
          {title} <span className="count">{tasks.length}</span>
        </div>
        <div className="task-list">
          {visibleTasks.map(renderTaskRow)}
          {tasks.length === 0 && opts.emptyLabel && <div className="empty-note">{opts.emptyLabel}</div>}
        </div>
        {hiddenCount > 0 && (
          <button type="button" className="list-toggle-btn" onClick={() => setExpandedBuckets((m) => ({ ...m, [key]: true }))}>
            {t('dashboard.showMore', { count: hiddenCount })}
          </button>
        )}
        {expanded && tasks.length > BUCKET_LIMIT && (
          <button type="button" className="list-toggle-btn" onClick={() => setExpandedBuckets((m) => ({ ...m, [key]: false }))}>
            {t('dashboard.showFewer')}
          </button>
        )}
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
          <button
            type="button"
            className="btn-secondary icon-only-btn icon-only-btn-round"
            title={`${t('dashboard.searchEverything')} (${SEARCH_SHORTCUT_LABEL})`}
            aria-label={t('dashboard.searchEverything')}
            onClick={() => setSearching(true)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
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
          title={t('dashboard.searchEverything')}
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
            {(searchResultsQuery.data?.results ?? []).map(renderSearchResult)}
            {debouncedSearchQuery.trim() && !searchResultsQuery.isFetching && searchResultsQuery.data?.results.length === 0 && (
              <div className="empty-note">{t('dashboard.noSearchResults')}</div>
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
          <button type="button" className="bucket-title bucket-title-toggle" onClick={toggleRecentProjectsOpen}>
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

      {allBucketGroups.length > 1 && (
        <div className="tag-filter-row dashboard-tag-filter-row group-filter-row">
          <span className="filter-facet-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {t('dashboard.filterByGroup')}
          </span>
          {allBucketGroups.map((group) => (
            <button
              key={group}
              type="button"
              className={`tag-pill tag-pill-filter group-pill-filter ${groupFilters.includes(group) ? 'active' : ''}`}
              onClick={() => toggleGroupFilter(group)}
            >
              {group}
            </button>
          ))}
          {activeGroupFilters.length > 0 && (
            <button type="button" className="tag-filter-clear" onClick={clearGroupFilters}>
              {t('dashboard.clear')}
            </button>
          )}
        </div>
      )}

      {allBucketTags.length > 0 && (
        <div className="tag-filter-row dashboard-tag-filter-row">
          <span className="filter-facet-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            {t('dashboard.filterByTag')}
          </span>
          {allBucketTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-pill tag-pill-filter ${tagFilters.includes(tag) ? 'active' : ''}`}
              onClick={() => toggleTagFilter(tag)}
            >
              {tag}
            </button>
          ))}
          {tagFilters.length > 0 && (
            <button type="button" className="tag-filter-clear" onClick={() => setTagFilters([])}>
              {t('dashboard.clear')}
            </button>
          )}
        </div>
      )}

      {isLoading && <p className="page-sub">{t('dashboard.loadingOpenTasks')}</p>}
      {isError && <p className="field-error">{error instanceof api.ApiError ? error.message : t('dashboard.failedToLoad')}</p>}

      {!isLoading && !isError && (
        <>
          {renderBucket('doing', t('dashboard.buckets.doing'), doing, { hideIfEmpty: true })}
          {renderBucket('today', t('dashboard.buckets.today'), dueToday, { emptyLabel: t('dashboard.nothingDueToday') })}
          {renderBucket('overdue', t('dashboard.buckets.overdue'), overdue, { hideIfEmpty: true })}
          {renderBucket('thisWeek', t('dashboard.buckets.thisWeek'), week)}
        </>
      )}
    </div>
  );
}
