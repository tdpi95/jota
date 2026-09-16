// Express app bootstrap. Exports `createApp`/`startServer` rather than just
// running at import time, so the Electron main process can embed this same
// server in-process (see electron/src/main.ts) instead of talking to it as
// an opaque subprocess.

import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';

import { HttpError } from './lib/httpError.js';
import { reconcileWorkspace } from './lib/index/reindex.js';
import attachmentsRouter from './routes/attachments.js';
import calendarRouter from './routes/calendar.js';
import indexRouter from './routes/index.js';
import journalRouter from './routes/journal.js';
import notesRouter from './routes/notes.js';
import preferencesRouter from './routes/preferences.js';
import projectsRouter from './routes/projects.js';
import reportsRouter from './routes/reports.js';
import searchRouter from './routes/search.js';
import syncRouter from './routes/sync.js';
import systemRouter from './routes/system.js';
import taskQueriesRouter from './routes/taskQueries.js';
import tasksRouter from './routes/tasks.js';
import vaultRouter from './routes/vault.js';
import workspacesRouter from './routes/workspaces.js';
import * as workspaceService from './services/workspaces.js';

const handleServiceError: ErrorRequestHandler = (err, _req, res, _next) => {
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'internal error';
  if (statusCode === 500) console.error(err);
  res.status(statusCode).json({ error: message });
};

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/attachments', attachmentsRouter);
  app.use('/api/workspaces', workspacesRouter);
  app.use('/api/index', indexRouter);
  app.use('/api/vault/git', syncRouter);
  app.use('/api/vault', vaultRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:slug/tasks', tasksRouter);
  app.use('/api/tasks', taskQueriesRouter);
  app.use('/api/journal', journalRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/preferences', preferencesRouter);
  app.use('/api/system', systemRouter);

  // Packaged app only: the Electron main process points this at the built
  // client (`client/dist`, copied into `resourcesPath/client/dist` by
  // electron-builder — see electron/electron-builder.yml and main.ts's
  // `spawnServer`). In dev, Vite's own dev server serves the client instead
  // and this is unset, so none of this runs.
  const clientDistDir = process.env.CLIENT_DIST_DIR;
  if (clientDistDir) {
    app.use(express.static(clientDistDir));
    // SPA fallback: a hard refresh (or the packaged window's initial load)
    // on a client-side route like /projects/foo has no matching static
    // file — hand it index.html so react-router can take over, exactly
    // like Vite's dev server already does for the same paths.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  app.use(handleServiceError);
  return app;
}

/** Binds to 127.0.0.1 only — no external network exposure (PLAN.md). */
export function startServer(port = 0, host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = app.listen(port, host, () => {
      // Reconcile whatever workspace is already active at process boot
      // (PLAN.md "Sync strategy — reconciliation ... runs whenever a
      // workspace is opened, not just process boot" — the "not just" half
      // was never actually wired in until this was found via a real bug:
      // a workspace already open before a schema/cache upgrade — e.g.
      // milestone 25's `body`/FTS columns — never got backfilled, since the
      // only thing that ever called `reconcileWorkspace` was a mutating
      // write, and a process restart with an already-active workspace
      // triggers neither `addWorkspace` nor `openWorkspace`, just this).
      // Best-effort, same footing as every other reconcile call: log and
      // continue, never fail startup over it.
      const active = workspaceService.getActiveWorkspace();
      if (active) {
        try {
          reconcileWorkspace(active.path);
        } catch (err) {
          console.error(`[index] startup index reconcile failed for ${active.path}:`, (err as Error).message);
        }
      }
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({ server, port: actualPort });
    });
    server.once('error', reject);
  });
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const devPort = Number(process.env.PORT) || 4174;
  startServer(devPort)
    .then(({ port }) => console.log(`poco server listening on http://127.0.0.1:${port}`))
    .catch((err) => {
      console.error('failed to start server:', err);
      process.exit(1);
    });
}
