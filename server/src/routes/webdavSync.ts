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

router.get('/conflict', async (req, res, next) => {
  try {
    res.json(await webdavSyncService.getConflict(req.query.path));
  } catch (err) {
    next(err);
  }
});

router.post('/conflict/resolve', async (req, res, next) => {
  try {
    const { path, choice, content, expected } = req.body ?? {};
    const validChoice = choice === 'local' || choice === 'remote' || (choice === 'merged' && typeof content === 'string');
    const isVersion = (v: unknown) => v === null || typeof v === 'number' || typeof v === 'string';
    if (!validChoice || typeof expected !== 'object' || expected === null || !isVersion(expected.localMtimeMs) || !isVersion(expected.remoteEtag)) {
      res.status(400).json({ error: "choice ('local' | 'remote' | 'merged' with content) and expected {localMtimeMs, remoteEtag} are required" });
      return;
    }
    const resolution = choice === 'merged' ? { choice, content: content as string } : { choice: choice as 'local' | 'remote' };
    res.json(await webdavSyncService.resolveConflict({ path, resolution, expected: { localMtimeMs: expected.localMtimeMs, remoteEtag: expected.remoteEtag } }));
  } catch (err) {
    next(err);
  }
});

export default router;
