import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import { getJotaBridge } from '../lib/jotaBridge';

/**
 * Sidebar workspace control (PLAN.md "Frontend" — `AppShell`'s
 * `WorkspaceSwitcher`): the active workspace's name, a dropdown listing
 * every registered workspace to switch among, and "+ Open folder" to
 * register a new one. `window.jota.pickFolder()` (the native OS picker,
 * milestone 3) is the primary way to supply a path — the plain text-input
 * fallback below only appears when `window.jota` isn't present at all
 * (e.g. the client opened as a bare page outside the Electron shell), which
 * isn't the app's real supported path but keeps this usable for a quick
 * check.
 *
 * A workspace switch (or add, which also activates) can change literally
 * everything on screen — every project/task/journal/calendar query is
 * scoped to "the active workspace" — so those mutations invalidate the
 * *entire* query cache rather than picking specific keys, unlike every
 * other mutation in this app.
 */
export default function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [manualPath, setManualPath] = useState('');

  const activeQuery = useQuery({ queryKey: ['workspace', 'active'], queryFn: api.getActiveWorkspace });
  const listQuery = useQuery({ queryKey: ['workspaces'], queryFn: api.listWorkspaces, enabled: open });

  const active = activeQuery.data?.workspace ?? null;
  const workspaces = listQuery.data?.workspaces ?? [];

  const addMutation = useMutation({
    mutationFn: (input: { path: string; name?: string }) => api.addWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setManualPath('');
      setOpen(false);
    },
  });

  const openMutation = useMutation({
    mutationFn: (id: string) => api.openWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setOpen(false);
    },
  });

  async function handleOpenFolder() {
    const bridge = getJotaBridge();
    if (!bridge) {
      // No native picker available outside Electron — fall back to the
      // inline path input rendered below instead of silently doing nothing.
      return;
    }
    const path = await bridge.pickFolder();
    if (path) addMutation.mutate({ path });
  }

  function handleManualAdd() {
    const path = manualPath.trim();
    if (path) addMutation.mutate({ path });
  }

  const hasBridge = getJotaBridge() !== null;

  return (
    <div className="ws-switcher">
      <button className="ws-button" onClick={() => setOpen((v) => !v)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
        <span className="name">{active ? active.name : t('workspaceSwitcher.noWorkspaceOpen')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="ws-dropdown">
          {listQuery.isLoading && <div className="picker-empty">{t('workspaceSwitcher.loading')}</div>}
          {!listQuery.isLoading && workspaces.length === 0 && <div className="picker-empty">{t('workspaceSwitcher.empty')}</div>}
          {workspaces.map((ws) => (
            <button className="ws-item" key={ws.id} onClick={() => ws.id !== active?.id && openMutation.mutate(ws.id)}>
              <span>{ws.name}</span>
              <span className="path">{ws.path}</span>
              {ws.id === active?.id && (
                <svg className="ws-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
          {hasBridge ? (
            <div className="ws-open-new">
              <button className="ws-add-btn" style={{ width: '100%' }} onClick={handleOpenFolder} disabled={addMutation.isPending}>
                {t('workspaceSwitcher.openFolder')}
              </button>
            </div>
          ) : (
            <div className="ws-open-new">
              <input
                className="ws-path-input"
                placeholder={t('workspaceSwitcher.manualPathPlaceholder')}
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
              />
              <button className="ws-add-btn" onClick={handleManualAdd} disabled={addMutation.isPending || manualPath.trim() === ''}>
                {t('workspaceSwitcher.manualOpen')}
              </button>
            </div>
          )}
          {addMutation.isError && (
            <div className="field-error" style={{ margin: '6px 4px 0' }}>
              {addMutation.error instanceof api.ApiError ? addMutation.error.message : t('workspaceSwitcher.failedToOpen')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
