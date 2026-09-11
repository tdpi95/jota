import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import * as api from '../api/client';
import { formatTimestamp } from '../lib/date';
import { getPivotBridge, type ReminderSettings } from '../lib/pivotBridge';
import type { PullResult } from '../types';

const DEFAULT_REMINDER: ReminderSettings = { enabled: true, time: '20:00' };

/**
 * Workspace list/management, the active workspace's remote-sync panel, and
 * the desktop-only reminder-time/launch-at-login fields (PLAN.md `/settings`,
 * milestone 16). The last two only do anything inside the Electron shell —
 * `getPivotBridge()` is `null` on a plain browser page, in which case those
 * controls are hidden rather than shown non-functional.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const bridge = getPivotBridge();

  const activeQuery = useQuery({ queryKey: ['workspace', 'active'], queryFn: api.getActiveWorkspace });
  const workspacesQuery = useQuery({ queryKey: ['workspaces'], queryFn: api.listWorkspaces });
  const active = activeQuery.data?.workspace ?? null;
  const workspaces = workspacesQuery.data?.workspaces ?? [];

  // --- Workspaces ---

  const [manualPath, setManualPath] = useState('');

  const addMutation = useMutation({
    mutationFn: (input: { path: string }) => api.addWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setManualPath('');
    },
  });
  const openMutation = useMutation({
    mutationFn: (id: string) => api.openWorkspace(id),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.removeWorkspace(id),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  async function handleOpenFolder() {
    if (!bridge) return;
    const path = await bridge.pickFolder();
    if (path) addMutation.mutate({ path });
  }

  // --- Remote sync (active workspace only) ---

  const remoteQuery = useQuery({ queryKey: ['sync', 'remote'], queryFn: api.getSyncRemote, enabled: active !== null });
  const statusQuery = useQuery({ queryKey: ['sync', 'status'], queryFn: api.getSyncStatus, enabled: active !== null });
  const [remoteUrlDraft, setRemoteUrlDraft] = useState('');
  const [pullResult, setPullResult] = useState<PullResult | null>(null);

  useEffect(() => {
    const sync = remoteQuery.data?.sync;
    setRemoteUrlDraft(sync?.provider === 'git-remote' ? sync.remoteUrl : '');
  }, [remoteQuery.data]);

  function invalidateSync() {
    queryClient.invalidateQueries({ queryKey: ['sync'] });
  }

  const setRemoteMutation = useMutation({
    mutationFn: (url: string) => api.setSyncRemote(url),
    onSuccess: invalidateSync,
  });
  const pushMutation = useMutation({
    mutationFn: api.pushVault,
    onSuccess: invalidateSync,
  });
  const pullMutation = useMutation({
    mutationFn: api.pullVault,
    onSuccess: (result) => {
      setPullResult(result);
      invalidateSync();
      // A clean (non-conflict) pull can change every file in the workspace —
      // unlike every other mutation here, refetch everything, not just the
      // sync queries.
      if (!result.conflict) queryClient.invalidateQueries();
    },
  });

  function commitRemoteUrl() {
    const url = remoteUrlDraft.trim();
    const current = remoteQuery.data?.sync;
    const currentUrl = current?.provider === 'git-remote' ? current.remoteUrl : '';
    if (url && url !== currentUrl) setRemoteMutation.mutate(url);
  }

  // --- Reminder + launch-at-login (Electron only) ---

  const [reminder, setReminder] = useState<ReminderSettings | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [launchAtLogin, setLaunchAtLoginValue] = useState<boolean | null>(null);

  useEffect(() => {
    if (!bridge) return;
    // Falls back to PLAN.md's own stated default for a newly-added
    // workspace ("20:00") if the call rejects — the reminder scheduler and
    // its backing per-workspace data model land with the next milestone, so
    // `getReminderSettings` has no handler registered yet and always
    // rejects for now; this keeps the control usable/testable ahead of that
    // rather than showing nothing.
    bridge.getReminderSettings().then(setReminder).catch(() => setReminder(DEFAULT_REMINDER));
    bridge.getLaunchAtLogin().then(setLaunchAtLoginValue).catch(() => setLaunchAtLoginValue(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitReminder(next: ReminderSettings) {
    if (!bridge) return;
    setReminder(next);
    setReminderError(null);
    bridge.setReminderSettings(next).catch(() => setReminderError("Couldn't save reminder settings."));
  }

  function commitLaunchAtLogin(enabled: boolean) {
    if (!bridge) return;
    setLaunchAtLoginValue(enabled);
    bridge.setLaunchAtLogin(enabled).catch(() => setLaunchAtLoginValue((prev) => !prev));
  }

  const syncStatus = statusQuery.data;
  const syncConfigured = syncStatus?.remoteUrl != null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-section">
        <div className="section-title">Workspaces</div>
        <div className="ws-rows-list">
          {workspaces.map((ws) => {
            const isActive = ws.id === active?.id;
            return (
              <div className="ws-row" key={ws.id}>
                <div>
                  <div className="name">{ws.name}</div>
                  <div className="path">{ws.path}</div>
                </div>
                <button
                  className={`ws-row-btn ${isActive ? 'is-active' : ''}`}
                  disabled={isActive || openMutation.isPending}
                  onClick={() => openMutation.mutate(ws.id)}
                >
                  {isActive ? 'Active' : 'Open'}
                </button>
                <button
                  className="icon-btn"
                  title="Remove from list (keeps the folder)"
                  onClick={() => window.confirm(`Remove "${ws.name}" from the workspace list? The folder itself is untouched.`) && removeMutation.mutate(ws.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
                  </svg>
                </button>
              </div>
            );
          })}
          {workspaces.length === 0 && !workspacesQuery.isLoading && <p className="empty-note">No workspaces yet.</p>}
        </div>

        {bridge ? (
          <button className="btn-secondary" style={{ marginTop: 10 }} onClick={handleOpenFolder} disabled={addMutation.isPending}>
            + Open folder…
          </button>
        ) : (
          <div className="ws-open-new" style={{ marginTop: 10, maxWidth: 420 }}>
            <input
              className="ws-path-input"
              placeholder="/path/to/folder"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && manualPath.trim() && addMutation.mutate({ path: manualPath.trim() })}
            />
            <button className="ws-add-btn" disabled={addMutation.isPending || manualPath.trim() === ''} onClick={() => addMutation.mutate({ path: manualPath.trim() })}>
              + Open
            </button>
          </div>
        )}
        {addMutation.isError && <div className="field-error">{addMutation.error instanceof api.ApiError ? addMutation.error.message : 'Failed to open workspace.'}</div>}
      </div>

      {active && (
        <div className="settings-section">
          <div className="section-title">Remote sync — {active.name}</div>
          <div className="sync-panel">
            <div className="sync-field">
              <label>Remote URL</label>
              <input
                value={remoteUrlDraft}
                onChange={(e) => setRemoteUrlDraft(e.target.value)}
                onBlur={commitRemoteUrl}
                onKeyDown={(e) => e.key === 'Enter' && commitRemoteUrl()}
                placeholder="git@example.com:you/notes.git"
              />
            </div>
            <div className="sync-counts">
              <span>
                <b>{syncStatus?.ahead ?? '—'}</b> ahead
              </span>
              <span>
                <b>{syncStatus?.behind ?? '—'}</b> behind
              </span>
            </div>
            <div className="sync-actions">
              <button className="btn-primary" disabled={!syncConfigured || pushMutation.isPending} onClick={() => pushMutation.mutate()}>
                Push
              </button>
              <button
                className="btn-secondary"
                disabled={!syncConfigured || pullMutation.isPending}
                onClick={() => {
                  setPullResult(null);
                  pullMutation.mutate();
                }}
              >
                Pull
              </button>
            </div>
            <div className="sync-status">
              {!syncConfigured && 'No remote configured yet.'}
              {syncConfigured && syncStatus?.lastSyncedAt && `Last synced ${formatTimestamp(syncStatus.lastSyncedAt)}`}
              {syncConfigured && !syncStatus?.lastSyncedAt && 'Never synced.'}
            </div>
            {pullResult?.conflict && (
              <div className="field-error" style={{ marginTop: 10 }}>
                Pull found conflicts and was aborted — nothing was changed. Conflicting files:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {pullResult.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {(() => {
              const err = setRemoteMutation.error ?? pushMutation.error ?? pullMutation.error;
              if (!err) return null;
              return <div className="field-error" style={{ marginTop: 10 }}>{err instanceof api.ApiError ? err.message : 'Sync action failed.'}</div>;
            })()}
          </div>
        </div>
      )}

      {bridge && (
        <div className="settings-section">
          <div className="section-title">Daily reminder</div>
          <div className="sync-panel" style={{ maxWidth: 340 }}>
            <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                id="reminder-enabled"
                checked={reminder?.enabled ?? false}
                onChange={(e) => commitReminder({ enabled: e.target.checked, time: e.target.checked ? (reminder?.time ?? DEFAULT_REMINDER.time) : null })}
                style={{ width: 'auto' }}
              />
              <label htmlFor="reminder-enabled" style={{ textTransform: 'none', fontSize: 12.5, letterSpacing: 0 }}>
                Remind me if I haven't journaled today
              </label>
            </div>
            <div className="sync-field">
              <label>Time</label>
              <input
                type="time"
                value={reminder?.time ?? DEFAULT_REMINDER.time ?? ''}
                disabled={!reminder?.enabled}
                onChange={(e) => commitReminder({ enabled: true, time: e.target.value })}
              />
            </div>
            {reminderError && <div className="field-error">{reminderError}</div>}
          </div>
        </div>
      )}

      {bridge && (
        <div className="settings-section">
          <div className="section-title">Desktop app</div>
          <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="launch-at-login"
              checked={launchAtLogin ?? false}
              onChange={(e) => commitLaunchAtLogin(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="launch-at-login" style={{ textTransform: 'none', fontSize: 12.5, letterSpacing: 0 }}>
              Launch at login
            </label>
          </div>
        </div>
      )}

      {!bridge && <p className="placeholder-page">The daily reminder and launch-at-login toggle are only available in the desktop app.</p>}
    </div>
  );
}
