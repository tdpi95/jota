// App-wide preferences (PLAN.md "Daily reminder" — milestone 17), not
// scoped to any workspace. Currently just the launch-at-login *preference
// record*: `electron/src/main.ts` uses this to know whether it's already
// applied the one-time "on by default for a new install" logic, and to
// persist the user's explicit choice afterward — the live OS truth is
// always read straight from `app.getLoginItemSettings()` in the Electron
// main process, never from here (see services/workspaces.ts).

import { Router } from 'express';

import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/launch-at-login', (_req, res) => {
  res.json({ enabled: workspaceService.getLaunchAtLoginPreference() });
});

router.put('/launch-at-login', (req, res, next) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) is required' });
      return;
    }
    res.json({ enabled: workspaceService.setLaunchAtLoginPreference(enabled) });
  } catch (err) {
    next(err);
  }
});

export default router;
