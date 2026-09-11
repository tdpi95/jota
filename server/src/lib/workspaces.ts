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

export interface WorkspaceEntry {
  id: string;
  path: string;
  name: string;
  /** ISO8601 UTC, updated every time this workspace is opened/switched to. */
  lastOpenedAt: string;
}

export interface WorkspaceRegistry {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
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
