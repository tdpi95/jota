// Git-remote SyncProvider (PLAN.md "Remote & cloud sync" #1, milestone 6) —
// push/pull/status shell out to the user's own `git`, relying on whatever
// credential helper/SSH key their setup already has. No credential
// management is built here on purpose (PLAN.md).
//
// Conflicts are surfaced, never auto-resolved: a pull that can't fast-forward
// is attempted as a staged (`--no-commit`) merge so it can be inspected for
// conflicts before anything is finalized; if any file is conflicted, the
// merge is aborted (leaving the working tree exactly as it was) and the
// conflicted file list is returned as data, not an exception — the caller
// resolves with normal git tooling and pulls again.

import { execFileSync } from 'node:child_process';

import type { PullResult, SyncStatus } from './types.js';

function run(workspacePath: string, args: string[], opts: { allowFailure?: boolean } = {}): string {
  try {
    return execFileSync('git', args, { cwd: workspacePath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (opts.allowFailure) return '';
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new Error(stderr || (err as Error).message);
  }
}

export function getRemote(workspacePath: string): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** `git remote add|set-url origin <url>` (PLAN.md). */
export function setRemote(workspacePath: string, url: string): void {
  const args = getRemote(workspacePath) !== null ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url];
  run(workspacePath, args);
}

function getCurrentBranch(workspacePath: string): string {
  return run(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

function remoteBranchExists(workspacePath: string, branch: string): boolean {
  try {
    run(workspacePath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export function push(workspacePath: string): void {
  if (!getRemote(workspacePath)) throw new Error('no remote configured — set one first');
  const branch = getCurrentBranch(workspacePath);
  run(workspacePath, ['push', '-u', 'origin', branch]);
}

const CONFLICT_STATUS_RE = /^(UU|AA|DD|AU|UA|UD|DU) (.+)$/;

export function pull(workspacePath: string): PullResult {
  if (!getRemote(workspacePath)) throw new Error('no remote configured — set one first');
  const branch = getCurrentBranch(workspacePath);
  run(workspacePath, ['fetch', 'origin']);

  if (!remoteBranchExists(workspacePath, branch)) {
    return { conflict: false }; // remote has no history for this branch yet — nothing to pull
  }

  // Fast path: a strict fast-forward never touches file content beyond the
  // incoming diff and can't conflict.
  try {
    run(workspacePath, ['merge', '--ff-only', `origin/${branch}`]);
    return { conflict: false };
  } catch {
    // Local has diverged (or has commits the remote doesn't) — fall through
    // to a real (but staged-only) merge attempt.
  }

  try {
    run(workspacePath, ['merge', '--no-commit', '--no-ff', `origin/${branch}`]);
  } catch {
    // Merge failed to stage cleanly — most likely conflicts; confirmed below
    // via `git status`, so nothing to do here but continue.
  }

  const statusOutput = run(workspacePath, ['status', '--porcelain'], { allowFailure: true });
  const conflicted = statusOutput
    .split('\n')
    .map((line) => CONFLICT_STATUS_RE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[2]);

  if (conflicted.length > 0) {
    run(workspacePath, ['merge', '--abort'], { allowFailure: true });
    return { conflict: true, files: conflicted };
  }

  // Staged cleanly with nothing conflicted — finish the merge.
  run(workspacePath, ['commit', '--no-edit']);
  return { conflict: false };
}

export function status(workspacePath: string, lastSyncedAt: string | null): SyncStatus {
  const remoteUrl = getRemote(workspacePath);
  const dirty = run(workspacePath, ['status', '--porcelain'], { allowFailure: true }).trim() !== '';

  let ahead: number | null = null;
  let behind: number | null = null;
  if (remoteUrl) {
    try {
      const branch = getCurrentBranch(workspacePath);
      run(workspacePath, ['fetch', 'origin'], { allowFailure: true });
      if (remoteBranchExists(workspacePath, branch)) {
        const counts = run(workspacePath, ['rev-list', '--left-right', '--count', `origin/${branch}...${branch}`]).trim();
        const [behindStr, aheadStr] = counts.split(/\s+/);
        behind = Number(behindStr);
        ahead = Number(aheadStr);
      }
    } catch {
      // no usable branch yet (e.g. a repo with no commits) — leave null.
    }
  }

  return { remoteUrl, ahead, behind, dirty, lastSyncedAt };
}
