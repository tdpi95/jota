// Remote sync routes (PLAN.md "Routes" — Remote sync). Thin: all logic lives
// in services/sync.ts. Mounted at /api/vault/git.

import { Router } from 'express';

import * as syncService from '../services/sync.js';

const router = Router();

router.get('/remote', (_req, res, next) => {
  try {
    res.json({ sync: syncService.getRemote() });
  } catch (err) {
    next(err);
  }
});

router.put('/remote', (req, res, next) => {
  try {
    const { url } = req.body ?? {};
    if (typeof url !== 'string') {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    res.json({ sync: syncService.setRemote(url) });
  } catch (err) {
    next(err);
  }
});

router.post('/push', (_req, res, next) => {
  try {
    syncService.push();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/pull', (_req, res, next) => {
  try {
    const result = syncService.pull();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/status', (_req, res, next) => {
  try {
    res.json(syncService.getStatus());
  } catch (err) {
    next(err);
  }
});

export default router;
