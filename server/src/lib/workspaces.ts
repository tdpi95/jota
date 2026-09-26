// App-level workspace registry (~/.jota/config.json) and per-workspace
// directory scaffolding. See PLAN.md "Workspaces" — this is the registry
// that exists *outside* any workspace, since the app needs to know the
// workspace list before opening one.
//
// `homeDir` is threaded through every function (defaulting to os.homedir())
// purely so tests can point the registry at a scratch directory instead of
// the real one — production callers never pass it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A workspace's remote-sync configuration (PLAN.md "Remote & cloud sync").
 * Absent/undefined on an entry is equivalent to `{ provider: 'none' }` — old
 * registry entries written before milestone 6 never gain the field until
 * they're explicitly given a remote. Exactly one provider is active at a
 * time (PLAN.md milestone 29's "one provider active per workspace" — chosen
 * over letting git-remote and webdav run concurrently, which could race on
 * the same files with no coordination between them); switching providers
 * overwrites this field outright rather than merging. `webdav`'s
 * url/username/password are stored in plain text, same trust model already
 * accepted for `git-remote`'s `remoteUrl` (confirmed via `AskUserQuestion`
 * at milestone 29 kickoff — no OS keychain integration). */
export type WorkspaceSyncConfig =
  | { provider: 'none' }
  | { provider: 'git-remote'; remoteUrl: string; lastSyncedAt: string | null }
  | { provider: 'webdav'; url: string; username: string; password: string; lastSyncedAt: string | null };

export interface WorkspaceEntry {
  id: string;
  path: string;
  name: string;
  /** ISO8601 UTC, updated every time this workspace is opened/switched to. */
  lastOpenedAt: string;
  sync?: WorkspaceSyncConfig;
  /** 24h "HH:MM" local time to fire the daily reminder for this workspace,
   * or `null` when disabled (PLAN.md "Daily reminder"). `undefined` on an
   * entry written before this field existed is treated by
   * `services/workspaces.ts`'s readers the same as PLAN.md's stated default
   * for a newly-added workspace ("20:00") — never normalized here, same
   * pattern as `sync` above. */
  reminderTime?: string | null;
  /** YYYY-MM-DD, local, the last day the daily reminder actually fired for
   * this workspace (set only when it fires, never on a skip) — `undefined`
   * means "never fired yet". Supplied by `electron/src/reminder.ts`, which
   * owns all the wall-clock/local-date logic; the server never computes
   * "today" itself for this field, only stores what it's told. */
  lastReminderFiredDate?: string | null;
}

export interface WorkspaceRegistry {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
  /** Whether the app should launch at OS login — app-wide, not
   * per-workspace (PLAN.md "Daily reminder": "on by default but user-
   * toggleable"). `undefined` means the one-time "on by default for a new
   * install" logic hasn't run yet; `electron/src/main.ts` applies it once at
   * startup and then always writes an explicit value afterward (including
   * when the user later opts out), so this stays `undefined` only until the
   * very first app start ever sees this registry. */
  launchAtLogin?: boolean;
  /** UI language — app-wide, not per-workspace (PLAN.md "Localization":
   * a personal display preference, not vault content, so it lives beside
   * `launchAtLogin` rather than on a workspace entry). `undefined` (a
   * registry written before this field existed, or a fresh install) is
   * read by `services/workspaces.ts`'s `getLanguagePreference` as `'en'` —
   * unlike `launchAtLogin`, there's no "hasn't been decided yet" one-time
   * default to apply, so this always normalizes to a concrete value rather
   * than staying `null`. */
  language?: 'en' | 'vi';
  /** UI color theme — app-wide, not per-workspace, same reasoning as
   * `language` above (PLAN.md "Theming": a personal display preference, not
   * vault content). `undefined` normalizes to `'light'` in
   * `services/workspaces.ts`'s `getThemePreference`. */
  theme?: 'light' | 'dark';
  /** UI accent color family — app-wide, not per-workspace, same reasoning as
   * `theme` above. `'default'` is the original single accent color this app
   * shipped with (kept as the default so existing installs don't change
   * appearance on upgrade); `undefined` normalizes to `'default'` in
   * `services/workspaces.ts`'s `getAccentPalettePreference`. */
  accentPalette?: 'default' | 'green' | 'blue' | 'violet';
  /** CalendarPage's due/journal toggle — app-wide, not per-workspace, same
   * reasoning as `theme` above (a personal display preference, not vault
   * content). `undefined` normalizes to `'due'` in
   * `services/workspaces.ts`'s `getCalendarModePreference` — `'due'` is what
   * the toggle already defaulted to before this preference existed. */
  calendarMode?: 'due' | 'journal';
  /** CalendarPage's month/year granularity — app-wide, not per-workspace,
   * same reasoning as `calendarMode` above. `undefined` normalizes to
   * `'month'` in `services/workspaces.ts`'s `getCalendarGranularityPreference`
   * — `'month'` is what the page already defaulted to before this
   * preference existed. */
  calendarGranularity?: 'month' | 'year';
  /** Journal body autosave debounce, in seconds — app-wide, not
   * per-workspace, same reasoning as `theme` above (a personal editing
   * preference, not vault content). Every autosave is also a git commit
   * (this app's undo mechanism), so this is really "how long a pause in
   * typing before it's worth a commit" — see PLAN.md's "Journal editor".
   * `undefined` normalizes to `30` in `services/workspaces.ts`'s
   * `getAutosaveIntervalPreference`, the default this preference shipped
   * with (previously a hardcoded 4-second constant with no user control). */
  autosaveIntervalSeconds?: number;
  /** Dashboard's "Pinned" section collapse state — app-wide, not
   * per-workspace, same reasoning as `theme` above (a personal display
   * preference, not vault content). `undefined` normalizes to `true` in
   * `services/workspaces.ts`'s `getDashboardPinnedOpenPreference` —
   * expanded is what the section (formerly "Recent projects") already
   * defaulted to before this preference existed. */
  dashboardPinnedOpen?: boolean;
  /** Dashboard's group-filter selection (PLAN.md "organize projects into
   * groups") — app-wide, not per-workspace, same reasoning as `theme` above
   * (a personal display preference, not vault content — group *names* are
   * workspace content, but which ones happen to be toggled on is not). A
   * group no longer in use by any open task in the active workspace is
   * silently dropped by the client rather than filtering everything out, so
   * a stale entry left over from a different workspace is harmless.
   * `undefined` normalizes to `[]` in `services/workspaces.ts`'s
   * `getDashboardGroupFilterPreference` — no filter is what the row already
   * defaulted to before this preference existed. */
  dashboardGroupFilter?: string[];
  /** Dashboard's pinned-projects selection (replaces the old "Recent
   * projects" section) — a plain array of project slugs, app-wide, not
   * per-workspace, same reasoning as `dashboardGroupFilter` above (pinning
   * is a personal organizing choice, not vault content, even though the
   * slugs it stores are workspace-scoped identifiers). A slug no longer
   * present in the active workspace (project deleted, or a leftover from a
   * different workspace) is silently dropped by the client the same way a
   * stale group name already is, rather than showing a broken pin.
   * `undefined` normalizes to `[]` in `services/workspaces.ts`'s
   * `getPinnedProjectsPreference`. */
  pinnedProjectSlugs?: string[];
  /** Dashboard's pinned-notes selection — same shape and reasoning as
   * `pinnedProjectSlugs` above, for note slugs. */
  pinnedNoteSlugs?: string[];
  /** The note editor's Edit/Preview toggle (`NoteBodyEditor`) — app-wide,
   * not per-note, same reasoning as `theme` above (a personal display
   * preference, not vault content). `undefined` normalizes to `'edit'` in
   * `services/workspaces.ts`'s `getNoteViewModePreference` — `'edit'` is
   * what every note already opened in before this preference existed. */
  noteViewMode?: 'edit' | 'preview';
  /** The Dashboard header's weather widget location, picked in Settings via
   * Nominatim search — app-wide, not per-workspace (it's where the user is,
   * not vault content). `undefined`/`null` normalizes to "no location" in
   * `services/workspaces.ts`'s `getWeatherLocationPreference`, in which
   * case the Dashboard keeps showing the plane mascot instead. */
  weatherLocation?: WeatherLocation | null;
  /** Unit the weather widget displays temperatures in — app-wide, same
   * reasoning as `weatherLocation` above. `undefined` normalizes to
   * `'celsius'` in `getTemperatureUnitPreference`. */
  temperatureUnit?: 'celsius' | 'fahrenheit';
}

export interface WeatherLocation {
  /** Display name as shown in Settings and the weather tooltip. */
  name: string;
  latitude: number;
  longitude: number;
}

const EMPTY_REGISTRY: WorkspaceRegistry = { workspaces: [], activeWorkspaceId: null };

export function getRegistryPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.jota', 'config.json');
}

export function readRegistry(homeDir: string = os.homedir()): WorkspaceRegistry {
  const file = getRegistryPath(homeDir);
  if (!fs.existsSync(file)) return { ...EMPTY_REGISTRY, workspaces: [] };
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as WorkspaceRegistry;
}

export function writeRegistry(registry: WorkspaceRegistry, homeDir: string = os.homedir()): void {
  const file = getRegistryPath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

/**
 * Creates `.jota/{cache,backups}`, `projects/`, `journal/`, `notes/` under a
 * workspace root if they don't already exist, and makes sure `.jota/` is
 * gitignored within that workspace (it's a cache, not content — PLAN.md
 * "Workspaces"). Idempotent: safe to call on every add *and* every open, so
 * a workspace that was copied/moved without its `.jota/` dir self-heals.
 */
export function scaffoldWorkspaceDirs(workspacePath: string): void {
  fs.mkdirSync(path.join(workspacePath, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, '.jota', 'cache'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, '.jota', 'backups'), { recursive: true });
  ensureGitignoreEntry(workspacePath, '.jota/');
}

function ensureGitignoreEntry(workspacePath: string, entry: string): void {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  if (existing.split('\n').some((line) => line.trim() === entry)) return;
  const withTrailingNewline = existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing;
  fs.writeFileSync(gitignorePath, withTrailingNewline + entry + '\n', 'utf8');
}

/**
 * `git init`s a workspace if it isn't already a repo, and makes sure it has a
 * commit identity (falling back to a local placeholder if the user has no
 * global `user.name`/`user.email` configured — otherwise commits made by
 * `vaultGit.ts`, milestone 5, would fail in a fresh environment). Best-effort
 * — if git isn't installed, logs and continues; `vaultGit.ts` reuses this
 * same check before its own commit-on-write/revert logic.
 */
export function ensureGitRepo(workspacePath: string): void {
  try {
    if (!fs.existsSync(path.join(workspacePath, '.git'))) {
      execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'ignore' });
    }
    ensureGitIdentity(workspacePath);
    // Forced on every call (not just at init), overriding whatever a
    // contributor's or a checkout-out clone's own git config says (Windows'
    // git installer, and GitHub-hosted Windows runners, both default
    // core.autocrlf=true): without this, checking out/reverting/pulling
    // would silently rewrite this vault's markdown LF line endings to CRLF
    // on Windows, corrupting the byte-for-byte round-trip this app's own
    // parser/serializer promise (and mismatching every other platform's
    // copy of the same file over sync).
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: workspacePath, stdio: 'ignore' });
  } catch (err) {
    console.error(`[workspaces] git init failed for ${workspacePath}:`, (err as Error).message);
  }
}

/** Sets a local placeholder identity only if neither a local nor global one
 * already resolves — never overrides a real one the user has configured. */
function ensureGitIdentity(workspacePath: string): void {
  try {
    execFileSync('git', ['config', 'user.email'], { cwd: workspacePath, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['config', 'user.name', 'jota'], { cwd: workspacePath, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'jota@localhost'], { cwd: workspacePath, stdio: 'ignore' });
  }
}
