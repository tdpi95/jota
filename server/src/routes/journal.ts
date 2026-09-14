// Journal REST routes (PLAN.md "Routes" — Journal). Thin: all logic lives in
// services/journal.ts.

import { Router } from 'express';

import * as journalService from '../services/journal.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/:year', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ entries: journalService.listJournalYear(workspace.path, req.params.year) });
  } catch (err) {
    next(err);
  }
});

// Registered before the generic `/:year/:date` two-segment route below —
// otherwise `/2026/full` would match there first with `date` = "full" and
// 400 on date validation.
router.get('/:year/full', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ entries: journalService.listJournalYearFull(workspace.path, req.params.year) });
  } catch (err) {
    next(err);
  }
});

router.get('/:year/:date', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const entry = journalService.getJournalEntry(workspace.path, req.params.year, req.params.date);
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.put('/:year/:date', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { tags, linkedTasks, body } = req.body ?? {};
    const entry = journalService.putJournalEntry(workspace.path, req.params.year, req.params.date, { tags, linkedTasks, body }, 'api');
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.post('/:year/:date/links/:taskId', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const entry = journalService.linkTask(workspace.path, req.params.year, req.params.date, req.params.taskId, 'api');
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.delete('/:year/:date/links/:taskId', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const entry = journalService.unlinkTask(workspace.path, req.params.year, req.params.date, req.params.taskId, 'api');
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

export default router;
