// Backup/versioning routes (PLAN.md "Routes" — Backup/history). Thin: all
// logic lives in lib/vaultGit.ts; a revert also re-syncs the index for the
// affected file(s) by re-running reconciliation (PLAN.md "Recovery surface").

import { Router } from 'express';

import { reconcileWorkspace } from '../lib/index/reindex.js';
import { getDiff, getHistory, revertCommit } from '../lib/vaultGit.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

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

export default router;
