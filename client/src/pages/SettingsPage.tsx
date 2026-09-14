import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import type { SupportedLanguage } from '../i18n';
import { formatTimestamp } from '../lib/date';
import { getPocoBridge, type ReminderSettings } from '../lib/pocoBridge';
import { ACCENT_PALETTE_SWATCH, ACCENT_PALETTES, applyAccentPalette, applyTheme, THEMES, type AccentPalette, type ThemeMode } from '../lib/theme';
import type { PullResult } from '../types';

const DEFAULT_REMINDER: ReminderSettings = { enabled: true, time: '20:00' };

/**
 * Workspace list/management, the active workspace's remote-sync panel, and
 * the desktop-only reminder-time/launch-at-login fields (PLAN.md `/settings`,
 * milestone 16). The last two only do anything inside the Electron shell —
 * `getPocoBridge()` is `null` on a plain browser page, in which case those
 * controls are hidden rather than shown non-functional.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const bridge = getPocoBridge();
  const { t, i18n } = useTranslation();

  // --- Language (PLAN.md "Localization") ---
  // A plain app-wide preference (persisted via the REST API, not the
  // Electron bridge — it works identically in a browser tab), unlike the
  // reminder/launch-at-login section below. `i18n.language` is already the
  // correct value on first render (main.tsx resolves it before the app
  // ever mounts), so there's no separate loading state to track here.
  const setLanguageMutation = useMutation({
    mutationFn: (language: SupportedLanguage) => api.setLanguagePreference(language),
    onSuccess: (_data, language) => {
      void i18n.changeLanguage(language);
    },
  });

  // --- Theme + accent palette (PLAN.md "Theming") ---
  // Same pattern as language above; seeded from the `data-theme`/
  // `data-palette` attributes main.tsx already applied to `<html>` before
  // this page could ever mount, so there's no separate loading state here
  // either — mutating just re-applies the attribute (instant switch) and
  // updates the local copy used to highlight the active button.
  const [theme, setThemeState] = useState<ThemeMode>(() => (document.documentElement.getAttribute('data-theme') as ThemeMode) || 'light');
  const setThemeMutation = useMutation({
    mutationFn: (next: ThemeMode) => api.setThemePreference(next),
    onSuccess: (_data, next) => {
      applyTheme(next);
      setThemeState(next);
    },
  });
  const [accentPalette, setAccentPaletteState] = useState<AccentPalette>(
    () => (document.documentElement.getAttribute('data-palette') as AccentPalette) || 'default',
  );
  const setAccentPaletteMutation = useMutation({
    mutationFn: (next: AccentPalette) => api.setAccentPalettePreference(next),
    onSuccess: (_data, next) => {
      applyAccentPalette(next);
      setAccentPaletteState(next);
    },
  });

  // --- Autosave interval (PLAN.md "Journal editor") ---
  // Same plain-app-wide-preference pattern as language/theme above (no
  // Electron bridge — a debounce duration touches no OS-level API), but
  // unlike those, this one needs real client-side bounds validation before
  // ever hitting the API (a bare number input has no built-in "must be an
  // integer in range" enforcement the way a radiogroup of fixed options
  // does). `draft` is a string, not a number, so a field the user is
  // actively clearing/retyping doesn't flash a "0" or NaN error mid-edit;
  // it only ever gets validated/submitted on blur.
  const AUTOSAVE_INTERVAL_MIN = 1;
  const AUTOSAVE_INTERVAL_MAX = 300;
  const autosaveIntervalQuery = useQuery({ queryKey: ['autosaveIntervalPreference'], queryFn: api.getAutosaveIntervalPreference });
  const [autosaveDraft, setAutosaveDraft] = useState('');
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  useEffect(() => {
    if (autosaveIntervalQuery.data) setAutosaveDraft(String(autosaveIntervalQuery.data.autosaveIntervalSeconds));
  }, [autosaveIntervalQuery.data]);
  const setAutosaveIntervalMutation = useMutation({
    mutationFn: (seconds: number) => api.setAutosaveIntervalPreference(seconds),
    onSuccess: (data) => {
      queryClient.setQueryData(['autosaveIntervalPreference'], data);
      setAutosaveError(null);
    },
    onError: () => setAutosaveError(t('settings.autosave.saveFailed')),
  });
  function commitAutosaveInterval() {
    const parsed = Number(autosaveDraft);
    const current = autosaveIntervalQuery.data?.autosaveIntervalSeconds;
    if (!Number.isInteger(parsed) || parsed < AUTOSAVE_INTERVAL_MIN || parsed > AUTOSAVE_INTERVAL_MAX) {
      setAutosaveError(t('settings.autosave.invalidValue', { min: AUTOSAVE_INTERVAL_MIN, max: AUTOSAVE_INTERVAL_MAX }));
      if (current !== undefined) setAutosaveDraft(String(current));
      return;
    }
    if (parsed !== current) setAutosaveIntervalMutation.mutate(parsed);
  }

  const activeQuery = useQuery({ queryKey: ['workspace', 'active'], queryFn: api.getActiveWorkspace });
  const workspacesQuery = useQuery({ queryKey: ['workspaces'], queryFn: api.listWorkspaces });
  const active = activeQuery.data?.workspace ?? null;
  const workspaces = workspacesQuery.data?.workspaces ?? [];

  // --- Git availability (undo history + sync both depend on it) ---
  const gitQuery = useQuery({ queryKey: ['system', 'git-available'], queryFn: api.checkGitAvailable });

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

  // Reveals a registered workspace's folder in the OS file manager — a
  // convenience for finding/hand-editing the markdown files directly, per
  // this app's own "portable outside the app" principle. Electron-only,
  // same as `handleOpenFolder` above; hidden entirely (not shown disabled)
  // when there's no bridge to back it.
  const [folderOpenError, setFolderOpenError] = useState<string | null>(null);
  async function handleRevealWorkspaceFolder(path: string) {
    if (!bridge) return;
    setFolderOpenError(null);
    const ok = await bridge.openWorkspaceFolder(path);
    if (!ok) setFolderOpenError(t('settings.workspaces.openInFileManagerFailed'));
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

  // --- "Add to applications menu" (Electron, Linux AppImage only) ---
  // `canAddDesktopEntry` starts `false` (not `null`) specifically so the
  // whole section stays hidden — rather than flashing in, then out — for
  // the common case (macOS, Windows, dev, or a non-AppImage Linux build)
  // where the bridge resolves `false`.
  const [canAddDesktopEntry, setCanAddDesktopEntry] = useState(false);
  const [desktopEntryInstalled, setDesktopEntryInstalledValue] = useState<boolean | null>(null);
  const [desktopEntryError, setDesktopEntryError] = useState<string | null>(null);

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
    bridge.canCreateDesktopEntry().then((canAdd) => {
      setCanAddDesktopEntry(canAdd);
      if (canAdd) bridge.isDesktopEntryInstalled().then(setDesktopEntryInstalledValue).catch(() => setDesktopEntryInstalledValue(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitReminder(next: ReminderSettings) {
    if (!bridge) return;
    setReminder(next);
    setReminderError(null);
    bridge.setReminderSettings(next).catch(() => setReminderError(t('settings.reminder.saveFailed')));
  }

  function commitLaunchAtLogin(enabled: boolean) {
    if (!bridge) return;
    setLaunchAtLoginValue(enabled);
    bridge.setLaunchAtLogin(enabled).catch(() => setLaunchAtLoginValue((prev) => !prev));
  }

  function commitDesktopEntryInstalled(enabled: boolean) {
    if (!bridge) return;
    setDesktopEntryInstalledValue(enabled);
    setDesktopEntryError(null);
    bridge.setDesktopEntryInstalled(enabled).catch(() => {
      setDesktopEntryInstalledValue((prev) => !prev);
      setDesktopEntryError(t('settings.desktopEntry.saveFailed'));
    });
  }

  const syncStatus = statusQuery.data;
  const syncConfigured = syncStatus?.remoteUrl != null;

  // --- Agent access (MCP) — config snippets for MCP hosts ---
  // command/args come from the server (lib/mcpInfo.ts) already complete —
  // dev: `npx tsx <entryPath>`; a plain compiled/prod run: `node
  // <entryPath>`; a packaged Linux AppImage: the AppImage's own (stable)
  // path plus a relaunch flag, *not* an entry path, since that path lives
  // under a fresh temp mount on every launch and can't be saved by an MCP
  // host across restarts. The fallback below (shown only until the query
  // resolves) matches the dev shape, the more common case while this
  // section is actually being looked at.
  const mcpInfoQuery = useQuery({ queryKey: ['system', 'mcp-info'], queryFn: api.getMcpInfo });
  const mcpCommand = mcpInfoQuery.data?.command ?? 'npx';
  const mcpArgs = mcpInfoQuery.data?.args ?? ['tsx', '/path/to/poco/server/src/mcp/index.ts'];
  const mcpWorkspacePath = active?.path ?? '/path/to/your/workspace';
  // Extra env the command itself needs to start reliably — only the
  // packaged-AppImage case has any (DISPLAY/DBUS_SESSION_BUS_ADDRESS,
  // milestone 18 part 20: launching the AppImage always boots Electron's
  // native layer first, even for this headless relaunch flag, which
  // segfaults without a real display/session-bus connection, and some MCP
  // hosts spawn child processes with a stripped env that drops both even on
  // a machine that has them). Deliberately does *not* default to including
  // POCO_WORKSPACE (milestone 18 part 21): the MCP server itself already
  // falls back to whichever workspace poco currently has open when it's
  // unset (server/src/mcp/index.ts's resolveWorkspacePath), so hardcoding
  // today's active path into the saved config would silently pin the agent
  // to it even after switching workspaces in the app later — the section
  // below instead explains POCO_WORKSPACE as an opt-in for anyone who wants
  // an agent pinned to one workspace regardless of what's open.
  const mcpEnv = mcpInfoQuery.data?.env ?? {};
  const hasMcpEnv = Object.keys(mcpEnv).length > 0;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copySnippet(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      },
      () => {
        /* clipboard access denied — the snippet is still selectable/copyable by hand */
      },
    );
  }

  const claudeDesktopSnippet = JSON.stringify(
    { mcpServers: { poco: { command: mcpCommand, args: mcpArgs, ...(hasMcpEnv ? { env: mcpEnv } : {}) } } },
    null,
    2,
  );
  const codexSnippet = [
    '[mcp_servers.poco]',
    `command = "${mcpCommand}"`,
    `args = [${mcpArgs.map((arg) => `"${arg}"`).join(', ')}]`,
    ...(hasMcpEnv
      ? [`env = { ${Object.entries(mcpEnv)
          .map(([key, value]) => `${key} = "${value}"`)
          .join(', ')} }`]
      : []),
  ].join('\n');
  const claudeCodeCommand = [
    'claude mcp add poco',
    ...Object.entries(mcpEnv).map(([key, value]) => `-e ${key}=${value}`),
    '--',
    mcpCommand,
    ...mcpArgs,
  ].join(' ');

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('settings.title')}</h1>
      </div>

      {gitQuery.data && !gitQuery.data.available && (
        <div className="notice-banner">
          <span>{t('settings.git.notFoundNotice')}</span>
          <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">
            {t('settings.git.downloadLink')}
          </a>
        </div>
      )}

      <div className="settings-section">
        <div className="section-title">{t('settings.language.sectionTitle')}</div>
        <div className="lang-picker" role="radiogroup" aria-label={t('settings.language.sectionTitle') ?? undefined}>
          {(['en', 'vi'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              role="radio"
              aria-checked={i18n.language === lang}
              className={`ws-row-btn ${i18n.language === lang ? 'is-active' : ''}`}
              disabled={setLanguageMutation.isPending}
              onClick={() => setLanguageMutation.mutate(lang)}
            >
              {t(`settings.language.${lang}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">{t('settings.theme.sectionTitle')}</div>
        <div className="lang-picker" role="radiogroup" aria-label={t('settings.theme.sectionTitle') ?? undefined}>
          {THEMES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={theme === mode}
              className={`ws-row-btn ${theme === mode ? 'is-active' : ''}`}
              disabled={setThemeMutation.isPending}
              onClick={() => setThemeMutation.mutate(mode)}
            >
              {t(`settings.theme.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">{t('settings.palette.sectionTitle')}</div>
        <div className="palette-picker" role="radiogroup" aria-label={t('settings.palette.sectionTitle') ?? undefined}>
          {ACCENT_PALETTES.map((palette) => (
            <button
              key={palette}
              type="button"
              role="radio"
              aria-checked={accentPalette === palette}
              className={`ws-row-btn ${accentPalette === palette ? 'is-active' : ''}`}
              disabled={setAccentPaletteMutation.isPending}
              onClick={() => setAccentPaletteMutation.mutate(palette)}
            >
              <span className="palette-dot" style={{ background: ACCENT_PALETTE_SWATCH[palette] }} />
              {t(`settings.palette.${palette}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">{t('settings.workspaces.sectionTitle')}</div>
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
                  {isActive ? t('common.active') : t('common.open')}
                </button>
                {bridge && (
                  <button className="icon-btn" title={t('settings.workspaces.openInFileManagerTooltip')} onClick={() => handleRevealWorkspaceFolder(ws.path)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                    </svg>
                  </button>
                )}
                <button
                  className="icon-btn"
                  title={t('settings.workspaces.removeTooltip')}
                  onClick={() => window.confirm(t('settings.workspaces.confirmRemove', { name: ws.name })) && removeMutation.mutate(ws.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
                  </svg>
                </button>
              </div>
            );
          })}
          {workspaces.length === 0 && !workspacesQuery.isLoading && <p className="empty-note">{t('settings.workspaces.empty')}</p>}
        </div>
        {folderOpenError && <div className="field-error" style={{ marginTop: 10 }}>{folderOpenError}</div>}

        {bridge ? (
          <button className="btn-secondary" style={{ marginTop: 10 }} onClick={handleOpenFolder} disabled={addMutation.isPending}>
            {t('settings.workspaces.openFolder')}
          </button>
        ) : (
          <div className="ws-open-new" style={{ marginTop: 10, maxWidth: 420 }}>
            <input
              className="ws-path-input"
              placeholder={t('settings.workspaces.manualPathPlaceholder')}
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && manualPath.trim() && addMutation.mutate({ path: manualPath.trim() })}
            />
            <button className="ws-add-btn" disabled={addMutation.isPending || manualPath.trim() === ''} onClick={() => addMutation.mutate({ path: manualPath.trim() })}>
              {t('settings.workspaces.manualOpen')}
            </button>
          </div>
        )}
        {addMutation.isError && (
          <div className="field-error">{addMutation.error instanceof api.ApiError ? addMutation.error.message : t('settings.workspaces.failedToOpen')}</div>
        )}
      </div>

      {active && (
        <div className="settings-section">
          <div className="section-title">{t('settings.sync.sectionTitle', { name: active.name })}</div>
          <div className="sync-panel">
            <div className="sync-field">
              <label>{t('settings.sync.remoteUrlLabel')}</label>
              <input
                value={remoteUrlDraft}
                onChange={(e) => setRemoteUrlDraft(e.target.value)}
                onBlur={commitRemoteUrl}
                onKeyDown={(e) => e.key === 'Enter' && commitRemoteUrl()}
                placeholder={t('settings.sync.remoteUrlPlaceholder')}
              />
            </div>
            <div className="sync-counts">
              <span>
                <b>{syncStatus?.ahead ?? '—'}</b> {t('settings.sync.ahead')}
              </span>
              <span>
                <b>{syncStatus?.behind ?? '—'}</b> {t('settings.sync.behind')}
              </span>
            </div>
            <div className="sync-actions">
              <button className="btn-primary" disabled={!syncConfigured || pushMutation.isPending} onClick={() => pushMutation.mutate()}>
                {t('settings.sync.push')}
              </button>
              <button
                className="btn-secondary"
                disabled={!syncConfigured || pullMutation.isPending}
                onClick={() => {
                  setPullResult(null);
                  pullMutation.mutate();
                }}
              >
                {t('settings.sync.pull')}
              </button>
            </div>
            <div className="sync-status">
              {!syncConfigured && t('settings.sync.noRemoteConfigured')}
              {syncConfigured && syncStatus?.lastSyncedAt && t('settings.sync.lastSynced', { time: formatTimestamp(syncStatus.lastSyncedAt) })}
              {syncConfigured && !syncStatus?.lastSyncedAt && t('settings.sync.neverSynced')}
            </div>
            {pullResult?.conflict && (
              <div className="field-error" style={{ marginTop: 10 }}>
                {t('settings.sync.conflictNotice')}
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
              return (
                <div className="field-error" style={{ marginTop: 10 }}>
                  {err instanceof api.ApiError ? err.message : t('settings.sync.actionFailed')}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="section-title">{t('settings.agentAccess.sectionTitle')}</div>
        <p className="mcp-intro">{t('settings.agentAccess.intro')}</p>
        {active ? (
          <p className="empty-note" style={{ marginBottom: 8 }}>
            {t('settings.agentAccess.activeWorkspaceNote', { path: mcpWorkspacePath })}
          </p>
        ) : (
          <p className="empty-note" style={{ marginBottom: 8 }}>{t('settings.agentAccess.noActiveWorkspaceNote')}</p>
        )}
        <p className="empty-note" style={{ marginBottom: 16 }}>
          {t('settings.agentAccess.pinWorkspaceNote', { path: mcpWorkspacePath })}
        </p>

        <div className="mcp-snippet">
          <div className="mcp-snippet-head">
            <span>{t('settings.agentAccess.claudeDesktopLabel')}</span>
            <button className="ws-row-btn" onClick={() => copySnippet('claude-desktop', claudeDesktopSnippet)}>
              {copiedKey === 'claude-desktop' ? t('settings.agentAccess.copied') : t('settings.agentAccess.copy')}
            </button>
          </div>
          <pre>
            <code>{claudeDesktopSnippet}</code>
          </pre>
        </div>

        <div className="mcp-snippet">
          <div className="mcp-snippet-head">
            <span>{t('settings.agentAccess.codexLabel')}</span>
            <button className="ws-row-btn" onClick={() => copySnippet('codex', codexSnippet)}>
              {copiedKey === 'codex' ? t('settings.agentAccess.copied') : t('settings.agentAccess.copy')}
            </button>
          </div>
          <pre>
            <code>{codexSnippet}</code>
          </pre>
        </div>

        <div className="mcp-snippet">
          <div className="mcp-snippet-head">
            <span>{t('settings.agentAccess.claudeCodeLabel')}</span>
            <button className="ws-row-btn" onClick={() => copySnippet('claude-code', claudeCodeCommand)}>
              {copiedKey === 'claude-code' ? t('settings.agentAccess.copied') : t('settings.agentAccess.copy')}
            </button>
          </div>
          <pre>
            <code>{claudeCodeCommand}</code>
          </pre>
        </div>
      </div>

      {bridge && (
        <div className="settings-section">
          <div className="section-title">{t('settings.reminder.sectionTitle')}</div>
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
                {t('settings.reminder.enabledLabel')}
              </label>
            </div>
            <div className="sync-field">
              <label>{t('settings.reminder.timeLabel')}</label>
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

      <div className="settings-section">
        <div className="section-title">{t('settings.autosave.sectionTitle')}</div>
        <div className="sync-panel" style={{ maxWidth: 340 }}>
          <div className="sync-field">
            <label>{t('settings.autosave.intervalLabel')}</label>
            <input
              type="number"
              min={AUTOSAVE_INTERVAL_MIN}
              max={AUTOSAVE_INTERVAL_MAX}
              step={1}
              value={autosaveDraft}
              onChange={(e) => setAutosaveDraft(e.target.value)}
              onBlur={commitAutosaveInterval}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              disabled={autosaveIntervalQuery.isLoading}
            />
          </div>
          <p className="empty-note" style={{ marginTop: 8 }}>{t('settings.autosave.helperText')}</p>
          {autosaveError && <div className="field-error">{autosaveError}</div>}
        </div>
      </div>

      {bridge && (
        <div className="settings-section">
          <div className="section-title">{t('settings.launchAtLogin.sectionTitle')}</div>
          <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="launch-at-login"
              checked={launchAtLogin ?? false}
              onChange={(e) => commitLaunchAtLogin(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="launch-at-login" style={{ textTransform: 'none', fontSize: 12.5, letterSpacing: 0 }}>
              {t('settings.launchAtLogin.label')}
            </label>
          </div>

          {canAddDesktopEntry && (
            <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                type="checkbox"
                id="desktop-entry-installed"
                checked={desktopEntryInstalled ?? false}
                disabled={desktopEntryInstalled === null}
                onChange={(e) => commitDesktopEntryInstalled(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <label htmlFor="desktop-entry-installed" style={{ textTransform: 'none', fontSize: 12.5, letterSpacing: 0 }}>
                {t('settings.desktopEntry.label')}
              </label>
            </div>
          )}
          {desktopEntryError && <div className="field-error">{desktopEntryError}</div>}
        </div>
      )}

      {!bridge && <p className="placeholder-page">{t('settings.desktopOnlyNotice')}</p>}
    </div>
  );
}
