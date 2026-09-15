import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import { formatDateLong } from '../lib/date';
import type { TaskStatus } from '../types';

interface LinkedTaskInfo {
  text: string;
  status: TaskStatus;
  projectSlug: string;
  projectColor: string;
}

// A body past either threshold gets clamped to a few lines with an expand
// button — a rough "is this long enough to bother" check, not a pixel-exact
// measurement (the CSS line-clamp below does the actual visual clipping).
const CLAMP_CHARS = 320;
const CLAMP_LINES = 6;

/**
 * "Show all journal entries" section for CalendarPage — rendered inline on
 * the page itself (not a popup), directly below the month/year grid. One
 * query for the whole year's entries (body included, unlike the cheap
 * `listJournalYear` summary the calendar grids themselves use), optionally
 * narrowed to one month. Each entry's body is clamped with a per-entry
 * expand/collapse toggle when it's long; the date itself still links to
 * that day's journal page like `JournalYearPage`'s list does.
 */
export default function JournalEntriesList({
  title,
  year,
  monthFilter,
}: {
  title: string;
  year: string;
  /** Zero-padded "01"-"12" — when given, only that month's entries show. */
  monthFilter?: string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['journalYearFull', year],
    queryFn: () => api.listJournalYearFull(year),
  });
  // Same "all projects with tasks embedded" lookup JournalDayPage uses to
  // resolve linked-task ids to title/status/project — there's no standalone
  // "get task by id" endpoint.
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const entries = (data?.entries ?? [])
    .filter((e) => !monthFilter || e.date.slice(5, 7) === monthFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const tasksById = useMemo(() => {
    const map = new Map<string, LinkedTaskInfo>();
    for (const project of projectsQuery.data?.projects ?? []) {
      for (const task of project.tasks) {
        map.set(task.id, { text: task.text, status: task.status, projectSlug: project.slug, projectColor: project.frontmatter.color });
      }
    }
    return map;
  }, [projectsQuery.data]);

  return (
    <div className="journal-list-section">
      <h2 className="journal-list-section-title">{title}</h2>

      {isLoading && <p className="page-sub">{t('journalEntriesList.loading')}</p>}
      {isError && <p className="field-error">{t('calendarPage.failedToLoad')}</p>}
      {!isLoading && !isError && entries.length === 0 && <div className="empty-note">{t('journalEntriesList.empty')}</div>}

      <div className="journal-list-body">
        {entries.map((entry) => {
          const lineCount = entry.body.split('\n').length;
          const isLong = entry.body.length > CLAMP_CHARS || lineCount > CLAMP_LINES;
          const isExpanded = expanded[entry.date] ?? false;
          return (
            <div className="journal-list-entry" key={entry.date}>
              <div className="journal-list-entry-head">
                <Link className="journal-list-entry-date" to={`/journal/${entry.date.slice(0, 4)}/${entry.date}`}>
                  {formatDateLong(entry.date, language)}
                </Link>
                {entry.tags.length > 0 && (
                  <div className="project-tags">
                    {entry.tags.map((tag) => (
                      <span className="tag-pill" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {entry.body ? (
                <>
                  <p className={`journal-list-entry-body ${!isExpanded && isLong ? 'is-clamped' : ''}`}>{entry.body}</p>
                  {isLong && (
                    <button
                      type="button"
                      className="cp-more-btn"
                      onClick={() => setExpanded((m) => ({ ...m, [entry.date]: !isExpanded }))}
                    >
                      {isExpanded ? t('journalEntriesList.collapse') : t('journalEntriesList.expand')}
                    </button>
                  )}
                </>
              ) : (
                <p className="journal-list-entry-empty">{t('journalEntriesList.noBody')}</p>
              )}
              {entry.linkedTasks.length > 0 && (
                <div className="journal-list-entry-tasks">
                  {entry.linkedTasks.map((taskId) => {
                    const info = tasksById.get(taskId);
                    return (
                      <Link
                        key={taskId}
                        to={`/projects/${info?.projectSlug ?? ''}`}
                        className={`cp-task ${info?.status === 'done' ? 'done' : ''}`}
                        title={info?.text ?? taskId}
                      >
                        <span className="cp-task-dot" style={{ background: info?.projectColor ?? 'var(--hairline)' }} />
                        <span className="cp-task-text">{info?.text ?? taskId}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
