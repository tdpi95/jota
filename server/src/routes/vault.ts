// Backup/versioning routes (PLAN.md "Routes" — Backup/history). Thin: all
// logic lives in lib/vaultGit.ts; a revert also re-syncs the index for the
// affected file(s) by re-running reconciliation (PLAN.md "Recovery surface").

import { Router } from 'express';

import { reconcileWorkspace } from '../lib/index/reindex.js';
import { getDiff, getHeadCommit, getHistory, revertCommit } from '../lib/vaultGit.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

// Polled by the client (a few-second interval, PLAN.md "Frontend") to detect
// changes made outside its own mutations — most notably an MCP agent
// writing to the same workspace from a separate process. Deliberately just
// the commit hash, not a body worth invalidating a cache over on its own:
// the client compares hashes and, on a change, invalidates its whole query
// cache (same "something changed, re-fetch everything" pattern the
// WorkspaceSwitcher already uses for a workspace switch).
router.get('/head', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ hash: getHeadCommit(workspace.path) });
  } catch (err) {
    next(err);
  }
});

router.get('/history', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { path: filterPath, limit } = req.query;
    const history = getHistory(workspace.path, {
      path: typeof filterPath === 'string' ? filterPath : undefined,
      limit: typeof limit === 'string' && limit.trim() !== '' ? Number(limit) : undefined,
    });
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

router.get('/diff/:commit', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const diff = getDiff(workspace.path, req.params.commit);
    res.json({ diff });
  } catch (err) {
    next(err);
  }
});

router.post('/revert/:commit', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const commit = revertCommit(workspace.path, req.params.commit);
    reconcileWorkspace(workspace.path);
    res.json({ commit });
  } catch (err) {
    next(err);
  }
});

// Provider-agnostic "disconnect" — resets the active workspace's sync
// provider to `{provider: 'none'}` regardless of whether git-remote or
// webdav was active (milestone 29's Settings provider selector, PLAN.md
// "one provider active per workspace"). Lives here, not under
// /api/vault/git or /api/vault/webdav, since it isn't specific to either.
router.delete('/sync', (_req, res, next) => {
  try {
    res.json({ sync: workspaceService.clearSyncProvider() });
  } catch (err) {
    next(err);
  }
});

export default router;
