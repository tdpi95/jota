// Express app bootstrap. Exports `createApp`/`startServer` rather than just
// running at import time, so the Electron main process can embed this same
// server in-process (see electron/src/main.ts) instead of talking to it as
// an opaque subprocess.

import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';

import workspacesRouter from './routes/workspaces.js';
import { WorkspaceServiceError } from './services/workspaces.js';

const handleServiceError: ErrorRequestHandler = (err, _req, res, _next) => {
  const statusCode = err instanceof WorkspaceServiceError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'internal error';
  if (statusCode === 500) console.error(err);
  res.status(statusCode).json({ error: message });
};

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/workspaces', workspacesRouter);

  app.use(handleServiceError);
  return app;
}

/** Binds to 127.0.0.1 only — no external network exposure (PLAN.md). */
export function startServer(port = 0, host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = app.listen(port, host, () => {
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
    .then(({ port }) => console.log(`pivot server listening on http://127.0.0.1:${port}`))
    .catch((err) => {
      console.error('failed to start server:', err);
      process.exit(1);
    });
}
