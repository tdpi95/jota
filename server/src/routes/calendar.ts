// Calendar aggregate route (PLAN.md "Routes" — Aggregates). Thin: all logic
// lives in services/calendar.ts.

import { Router } from 'express';

import * as calendarService from '../services/calendar.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/:year/:month', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const days = calendarService.getCalendarMonth(workspace.path, req.params.year, req.params.month);
    res.json({ days });
  } catch (err) {
    next(err);
  }
});

export default router;
