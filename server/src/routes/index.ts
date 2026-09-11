// Index/misc routes (PLAN.md "Routes" — Index/misc). Thin: all logic lives
// in lib/index/reindex.ts; the active workspace is resolved through the
// workspace service, matching the other route files.

import { Router } from 'express';

import { getIndexStatus, rebuildIndex } from '../lib/index/reindex.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.post('/rebuild', (_req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const stats = rebuildIndex(workspace.path);
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

router.get('/status', (_req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const status = getIndexStatus(workspace.path);
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

export default router;
