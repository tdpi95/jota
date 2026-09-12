import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import { formatTimestamp } from '../lib/date';

/**
 * Recent commits touching one file, each with a one-click "Undo this
 * change" and an expandable diff (PLAN.md "Recovery surface" — a small
 * History panel on project detail and journal day pages). `path` is
 * relative to the workspace root — `projects/<slug>.md` or
 * `journal/<year>/<date>.md` — matching `services/{projects,journal}.ts`'s
 * own relative-path convention for the files this panel is attached to.
 *
 * A revert is `git revert --no-edit` (a new undo commit on top, not a
 * history rewrite — safe even with later commits already on top of the one
 * being undone) — the caller passes `onReverted` to invalidate whatever
 * page-specific queries (the project, the journal entry, the calendar…)
 * need refetching after the file changes out from under them, since this
 * component has no way to know which those are.
 *
 * Commit messages are generated server-side against the stable task id
 * (`t_xxxxxx`, PLAN.md's task-line grammar) rather than its title — the id
 * never changes and is what `revertVaultCommit` etc. key off, while a title
 * is free text that can itself be edited later. For display only, an
 * optional `taskTitles` lookup (id -> current title, supplied by whichever
 * page already has the task list loaded) lets `formatMessage` swap each
 * `t_xxxxxx` token for its title; unknown/deleted-task ids are left as-is.
 * `renderMessage` does this for on-screen display, bolding the swapped-in
 * title so it stands out from the surrounding `update_task ... (slug)`
 * scaffolding; `formatMessage` is the same substitution as plain text, for
 * the one spot (the native `window.confirm` undo prompt) that can't render
 * markup.
 */
const TASK_ID_RE = /\bt_[0-9a-f]{6}\b/g;

/** History already comes back newest-first and server-capped at 50 (PLAN.md
 * "Backup/history" — `getHistory`'s default `limit`), but a frequently-
 * edited file can still pile up a long scrollable list. Same "+N older"
 * collapse pattern as the Kanban board's Done column (ProjectDetailPage,
 * milestone 18): show only the most recent N by default. */
const RECENT_HISTORY_COUNT = 10;

export default function HistoryPanel({
  path,
  onReverted,
  taskTitles,
}: {
  path: string;
  onReverted?: () => void;
  taskTitles?: Map<string, string>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  function formatMessage(message: string): string {
    if (!taskTitles) return message;
    return message.replace(TASK_ID_RE, (id) => taskTitles.get(id) ?? id);
  }

  function renderMessage(message: string): React.ReactNode {
    if (!taskTitles) return message;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    for (const match of message.matchAll(TASK_ID_RE)) {
      const id = match[0];
      const title = taskTitles.get(id);
      if (title === undefined) continue;
      const index = match.index ?? 0;
      parts.push(message.slice(lastIndex, index));
      parts.push(<strong key={index}>{title}</strong>);
      lastIndex = index + id.length;
    }
    parts.push(message.slice(lastIndex));
    return parts;
  }

  const historyQuery = useQuery({
    queryKey: ['vaultHistory', path],
    queryFn: () => api.getVaultHistory({ path }),
  });

  const diffQuery = useQuery({
    queryKey: ['vaultDiff', expandedHash],
    queryFn: () => api.getVaultDiff(expandedHash as string),
    enabled: expandedHash !== null,
  });

  const revertMutation = useMutation({
    mutationFn: (commit: string) => api.revertVaultCommit(commit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultHistory', path] });
      setExpandedHash(null);
      onReverted?.();
    },
  });

  const history = historyQuery.data?.history ?? [];
  const olderCount = Math.max(0, history.length - RECENT_HISTORY_COUNT);
  const visibleHistory = showAllHistory ? history : history.slice(0, RECENT_HISTORY_COUNT);

  return (
    <div className="history-panel">
      <div className="section-title">{t('historyPanel.title')}</div>
      {historyQuery.isLoading && <p className="page-sub">{t('historyPanel.loading')}</p>}
      {!historyQuery.isLoading && history.length === 0 && <p className="empty-note">{t('historyPanel.empty')}</p>}
      <div className="history-list">
        {visibleHistory.map((commit) => {
          const isExpanded = expandedHash === commit.hash;
          return (
            <div className="history-row" key={commit.hash}>
              <div className="history-row-head">
                <div className="history-row-main">
                  <div className="history-message">{renderMessage(commit.message)}</div>
                  <div className="history-date">{formatTimestamp(commit.date)}</div>
                </div>
                <div className="history-actions">
                  <button
                    className="icon-btn"
                    title={isExpanded ? t('historyPanel.hideDiff') : t('historyPanel.viewDiff')}
                    onClick={() => setExpandedHash(isExpanded ? null : commit.hash)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    title={t('historyPanel.undoTooltip')}
                    disabled={revertMutation.isPending}
                    onClick={() => window.confirm(t('historyPanel.confirmUndo', { message: formatMessage(commit.message) })) && revertMutation.mutate(commit.hash)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                  </button>
                </div>
              </div>
              {isExpanded && <pre className="history-diff">{diffQuery.isLoading ? t('historyPanel.loadingDiff') : (diffQuery.data?.diff ?? '')}</pre>}
            </div>
          );
        })}
      </div>
      {!showAllHistory && olderCount > 0 && (
        <button type="button" className="list-toggle-btn" onClick={() => setShowAllHistory(true)}>
          {t('historyPanel.showOlder', { count: olderCount })}
        </button>
      )}
      {showAllHistory && olderCount > 0 && (
        <button type="button" className="list-toggle-btn" onClick={() => setShowAllHistory(false)}>
          {t('historyPanel.hideOlder')}
        </button>
      )}
      {revertMutation.isError && (
        <p className="field-error">{revertMutation.error instanceof api.ApiError ? revertMutation.error.message : t('historyPanel.undoFailed')}</p>
      )}
    </div>
  );
}
