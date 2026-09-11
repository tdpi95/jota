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
 */
export default function HistoryPanel({ path, onReverted }: { path: string; onReverted?: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

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

  return (
    <div className="history-panel">
      <div className="section-title">{t('historyPanel.title')}</div>
      {historyQuery.isLoading && <p className="page-sub">{t('historyPanel.loading')}</p>}
      {!historyQuery.isLoading && history.length === 0 && <p className="empty-note">{t('historyPanel.empty')}</p>}
      <div className="history-list">
        {history.map((commit) => {
          const isExpanded = expandedHash === commit.hash;
          return (
            <div className="history-row" key={commit.hash}>
              <div className="history-row-head">
                <div className="history-row-main">
                  <div className="history-message">{commit.message}</div>
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
                    onClick={() => window.confirm(t('historyPanel.confirmUndo', { message: commit.message })) && revertMutation.mutate(commit.hash)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7v6h6" />
                      <path d="M21 17a9 9 0 1 0-3-6.7L3 13" />
                    </svg>
                  </button>
                </div>
              </div>
              {isExpanded && <pre className="history-diff">{diffQuery.isLoading ? t('historyPanel.loadingDiff') : (diffQuery.data?.diff ?? '')}</pre>}
            </div>
          );
        })}
      </div>
      {revertMutation.isError && (
        <p className="field-error">{revertMutation.error instanceof api.ApiError ? revertMutation.error.message : t('historyPanel.undoFailed')}</p>
      )}
    </div>
  );
}
