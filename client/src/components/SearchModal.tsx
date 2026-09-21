import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import { formatDateLong, todayStr, yearOf } from '../lib/date';
import { toTask } from '../lib/tasks';
import type { IndexedTask, SearchResult, TaskStatus } from '../types';
import Modal from './Modal';
import TaskRow from './TaskRow';

const SEARCH_DEBOUNCE_MS = 300;

/** Renders a `snippet()` excerpt's `**match**` markers as `<mark>` — the
 * only markup FTS5's snippet ever produces (PLAN.md "Search (cross-type
 * full-text)"), so a plain split-on-`**` is enough; no need for a real
 * markdown renderer for what is otherwise plain, already-escaped text. */
function renderSnippet(snippet: string): React.ReactNode {
  return snippet.split('**').map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

/**
 * "Search everything" popup (PLAN.md "Search (cross-type full-text)") —
 * originally Dashboard-only, pulled out here (milestone 18 follow-up: "ctrl+K
 * doesn't work on other pages") so the global Cmd/Ctrl+K shortcut
 * (`KeyboardShortcuts.tsx`) can open the exact same popup from any page,
 * without duplicating the search/mutation logic. Fully self-contained —
 * fetches its own open-tasks list (for the clickable tag pills; a cheap
 * cache-hit when Dashboard has already loaded it, a real but small fetch
 * from anywhere else) and owns its own task mutations, same as
 * `QuickAddTaskModal`.
 */
export default function SearchModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const queryClient = useQueryClient();
  const today = todayStr();
  const year = yearOf(today);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const openTasksQuery = useQuery({ queryKey: ['tasks', 'open'], queryFn: api.getOpenTasks });
  const searchResultsQuery = useQuery({
    queryKey: ['search', debouncedSearchQuery],
    queryFn: () => api.search({ q: debouncedSearchQuery }),
    enabled: debouncedSearchQuery.trim().length > 0,
  });

  // Clickable tags in the popup — derived from open tasks, not a separate
  // fetch. Clicking one just runs it through the same text search (which
  // also matches tags), rather than a parallel filter path.
  const searchableTags = [...new Set((openTasksQuery.data?.tasks ?? []).flatMap((task) => task.tags))].sort();

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

  function renderTaskRow(indexedTask: IndexedTask) {
    return (
      <TaskRow
        key={indexedTask.id}
        task={toTask(indexedTask)}
        project={{ name: indexedTask.projectName, color: indexedTask.projectColor, slug: indexedTask.projectSlug }}
        onStatusChange={(status: TaskStatus) =>
          updateTaskMutation.mutate({ slug: indexedTask.projectSlug, taskId: indexedTask.id, values: { status } })
        }
        onSave={(values) => updateTaskMutation.mutate({ slug: indexedTask.projectSlug, taskId: indexedTask.id, values })}
        onDelete={() => deleteTaskMutation.mutate({ slug: indexedTask.projectSlug, taskId: indexedTask.id })}
        onLogToday={() => logTodayMutation.mutate(indexedTask.id)}
      />
    );
  }

  /** A task result reuses `renderTaskRow` exactly; a note/journal/project
   * result gets its own compact row (type badge, title/date, snippet, a
   * "go to" link), since none of those have a status/due/checklist to show. */
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

  return (
    <Modal title={t('dashboard.searchEverything')} onClose={onClose}>
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
  );
}
