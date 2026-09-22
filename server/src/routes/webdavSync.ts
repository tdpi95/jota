// WebDAV sync routes (PLAN.md "Routes" — Remote sync, milestone 29). Thin:
// all logic lives in services/webdavSync.ts. Mounted at /api/vault/webdav,
// alongside (not replacing) the existing /api/vault/git/* routes — a
// workspace's active provider is whichever this or routes/sync.ts's `PUT
// .../config|remote` was called last (PLAN.md's "one provider active per
// workspace" model).

import { Router } from 'express';

import * as webdavSyncService from '../services/webdavSync.js';

const router = Router();

router.get('/config', (_req, res, next) => {
  try {
    res.json({ sync: webdavSyncService.getConfig() });
  } catch (err) {
    next(err);
  }
});

router.put('/config', (req, res, next) => {
  try {
    const { url, username, password } = req.body ?? {};
    if (typeof url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'url, username, and password are required' });
      return;
    }
    res.json({ sync: webdavSyncService.setConfig({ url, username, password }) });
  } catch (err) {
    next(err);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    const { url, username, password } = req.body ?? {};
    if (typeof url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'url, username, and password are required' });
      return;
    }
    res.json(await webdavSyncService.testConnection({ url, username, password }));
  } catch (err) {
    next(err);
  }
});

router.post('/push', async (_req, res, next) => {
  try {
    res.json(await webdavSyncService.push());
  } catch (err) {
    next(err);
  }
});

router.post('/pull', async (_req, res, next) => {
  try {
    res.json(await webdavSyncService.pull());
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (_req, res, next) => {
  try {
    res.json(await webdavSyncService.getStatus());
  } catch (err) {
    next(err);
  }
});

export default router;
