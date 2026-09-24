// Git init/commit/history/diff/revert wrapper (PLAN.md "Backup & recovery").
// Every workspace is its own git repo; this is the independent undo
// mechanism for unwanted writes (human or agent) — best-effort on the write
// path (a failed commit never blocks a file write that already succeeded),
// but a real error on the explicit revert path since that's a user-invoked
// action that deserves to be reported if it fails.

import { execFileSync } from 'node:child_process';

import { ensureGitRepo } from './workspaces.js';

/** Whether the `git` CLI is invokable at all — every workspace's undo
 * history and remote sync depend on it (PLAN.md "Backup & recovery"), but
 * git isn't bundled with this app, so a machine that never had it installed
 * needs a clear signal rather than every commit silently no-op-ing forever.
 * Backs Settings' "git not found" notice. */
export function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface CommitInfo {
  hash: string;
  /** ISO8601, commit date. */
  date: string;
  message: string;
}

export interface CommitChangeOptions {
  /** Who made the change: 'api' for the web UI, `mcp:<tool>` for an agent
   * tool call (PLAN.md "Backup & recovery") — history always shows whether a
   * human or an agent (and which tool) made a change. */
  origin: string;
  /** Human-readable description of the change, e.g.
   * "t_9f0e21 status doing→done (website-redesign)". Combined with `origin`
   * into `[origin] message`. */
  message: string;
  /** Paths (relative to the workspace root) to stage. Omit/empty to stage
   * everything currently changed (used for the one-time initial commit). */
  paths?: string[];
}

/**
 * Stages and commits the given paths with a self-documenting message. Logs
 * and returns without throwing if git isn't installed, the repo has no
 * identity configured some other way, or there's nothing staged to commit —
 * the caller's file write already succeeded and is authoritative; versioning
 * is a safety net, not a dependency for the app to function (PLAN.md).
 */
export function commitChange(workspacePath: string, opts: CommitChangeOptions): void {
  try {
    const addArgs = opts.paths && opts.paths.length > 0 ? opts.paths : ['-A'];
    execFileSync('git', ['add', ...addArgs], { cwd: workspacePath, stdio: 'ignore' });

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (staged.trim() === '') return; // nothing changed, e.g. a re-commit of identical content

    execFileSync('git', ['commit', '-m', `[${opts.origin}] ${opts.message}`], {
      cwd: workspacePath,
      stdio: 'ignore',
    });
  } catch (err) {
    console.error(`[vaultGit] commit failed for ${workspacePath}:`, (err as Error).message);
  }
}

/**
 * Ensures the workspace is a git repo (reusing lib/workspaces.ts's
 * best-effort init) and, if it has no commits yet, makes an initial commit of
 * whatever's already there (PLAN.md: "git init it and make an initial commit
 * of whatever's already there"). Idempotent — safe to call on every
 * workspace add/open.
 */
export function ensureGitHistory(workspacePath: string): void {
  ensureGitRepo(workspacePath);
  if (getHistory(workspacePath, { limit: 1 }).length > 0) return;
  commitChange(workspacePath, { origin: 'system', message: 'initial commit' });
}

const RECORD_SEPARATOR = '\x1f';

/** Recent commits touching the workspace (or, if `path` is given, just that
 * file), most recent first. Returns `[]` for a repo with no commits yet
 * rather than throwing. */
export function getHistory(workspacePath: string, opts: { path?: string; limit?: number } = {}): CommitInfo[] {
  const args = ['log', `--pretty=format:%H${RECORD_SEPARATOR}%cI${RECORD_SEPARATOR}%s`, '-n', String(opts.limit ?? 50)];
  if (opts.path) args.push('--', opts.path);

  let output: string;
  try {
    // stderr is discarded (not just uncaptured) so an expected "no commits
    // yet" on a fresh repo doesn't spam the process's own stderr.
    output = execFileSync('git', args, { cwd: workspacePath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return []; // not a repo yet, or no commits
  }
  if (output.trim() === '') return [];

  return output
    .trim()
    .split('\n')
    .map((line) => {
      const [hash, date, message] = line.split(RECORD_SEPARATOR);
      return { hash, date, message };
    });
}

/** Whether `data` is byte-for-byte some version of `relPath` this
 * workspace has committed before — i.e. an ancestor of the file's local
 * history. Backs WebDAV sync's "the server only has an older copy of ours"
 * check (lib/sync/webdav.ts), which can't otherwise tell a stale server copy
 * from a genuinely new one once the sync baseline is gone. Compares git blob
 * ids (`hash-object` on the bytes vs. every blob `git log --raw` recorded for
 * that path), so it's one `git log` per file, never a checkout. Best-effort:
 * `false` when git isn't installed, the folder isn't a repo, or the path was
 * never committed. */
export function isInFileHistory(workspacePath: string, relPath: string, data: Buffer): boolean {
  try {
    const blob = execFileSync('git', ['hash-object', '--stdin'], { cwd: workspacePath, input: data, stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const log = execFileSync('git', ['log', '--format=', '--raw', '--no-abbrev', '--', relPath], {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    // Each --raw line is ":<mode> <mode> <old blob> <new blob> <status>\t<path>";
    // only the post-change blob counts as a version the file actually had.
    return log.split('\n').some((line) => line.split(/\s+/)[3] === blob);
  } catch {
    return false;
  }
}

/** The workspace's current commit hash, or `null` for a repo with no commits
 * yet. Backs the frontend's auto-refresh poll (PLAN.md "Frontend"): every
 * write, from either front door (`api` or `mcp:<tool>`), is a commit, so a
 * changed HEAD is a cheap, reliable signal that something outside the
 * client's own mutations touched the vault — no filesystem watcher needed. */
export function getHeadCommit(workspacePath: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim();
  } catch {
    return null; // not a repo yet, or no commits
  }
}

/** The patch introduced by one commit (works for the root commit too, since
 * `git show` diffs it against the empty tree). */
export function getDiff(workspacePath: string, commit: string): string {
  try {
    return execFileSync('git', ['show', commit], {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(stderr || `no such commit: ${commit}`);
  }
}

/**
 * Reverts one commit (`git revert --no-edit`, PLAN.md) — a new undo commit,
 * not a rewrite of history, so it's safe even with later commits on top.
 * Throws with git's own stderr on failure (e.g. a revert conflict) rather
 * than silently swallowing it — unlike `commitChange`, this is a
 * user-invoked action the caller needs to know failed.
 */
export function revertCommit(workspacePath: string, commit: string): CommitInfo {
  try {
    execFileSync('git', ['revert', '--no-edit', commit], { cwd: workspacePath, stdio: 'pipe' });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`git revert failed: ${stderr || (err as Error).message}`);
  }
  const [latest] = getHistory(workspacePath, { limit: 1 });
  if (!latest) throw new Error('git revert produced no commit');
  return latest;
}
