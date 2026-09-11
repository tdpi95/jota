// Reports aggregate route (PLAN.md "Routes" — Aggregates). Thin: all logic
// lives in services/reports.ts.

import { Router } from 'express';

import * as reportService from '../services/reports.js';
import * as workspaceService from '../services/workspaces.js';
import type { TimeSpentGroupBy } from '../services/reports.js';

const router = Router();

router.get('/time-spent', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { groupBy, from, to, includeInProgress } = req.query;
    const groups = reportService.getTimeSpentReport(workspace.path, {
      groupBy: typeof groupBy === 'string' ? (groupBy as TimeSpentGroupBy) : undefined,
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
      includeInProgress: includeInProgress === 'true',
    });
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

export default router;
