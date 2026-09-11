// App-level workspace registry (~/.pivot/config.json) and per-workspace
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
 * they're explicitly given a remote. */
export type WorkspaceSyncConfig =
  | { provider: 'none' }
  | { provider: 'git-remote'; remoteUrl: string; lastSyncedAt: string | null };

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
}

const EMPTY_REGISTRY: WorkspaceRegistry = { workspaces: [], activeWorkspaceId: null };

export function getRegistryPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.pivot', 'config.json');
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
 * Creates `.pivot/{cache,backups}`, `projects/`, `journal/` under a workspace
 * root if they don't already exist, and makes sure `.pivot/` is gitignored
 * within that workspace (it's a cache, not content — PLAN.md "Workspaces").
 * Idempotent: safe to call on every add *and* every open, so a workspace
 * that was copied/moved without its `.pivot/` dir self-heals.
 */
export function scaffoldWorkspaceDirs(workspacePath: string): void {
  fs.mkdirSync(path.join(workspacePath, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, '.pivot', 'cache'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, '.pivot', 'backups'), { recursive: true });
  ensureGitignoreEntry(workspacePath, '.pivot/');
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
    execFileSync('git', ['config', 'user.name', 'pivot'], { cwd: workspacePath, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'pivot@localhost'], { cwd: workspacePath, stdio: 'ignore' });
  }
}
