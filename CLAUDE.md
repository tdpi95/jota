# pivot

A personal, local-first daily-tasks + journal app backed entirely by plain markdown files: tasks grouped by project, journal/daily notes bucketed by year. Node/Express + TypeScript backend, Vite/React + TypeScript frontend, shipped as an **Electron desktop app** (not a browser-opened web app) — the Electron main process launches the same Express server locally and points a `BrowserWindow` at it, adding a native folder picker and a tray-resident daily reminder (native OS notification) that a browser tab couldn't provide. No hosted backend, no accounts — this runs on the user's own machine.

**Before doing anything else in this project, read [PLAN.md](PLAN.md) (the full design) and [PROGRESS.md](PROGRESS.md) (what's actually built vs. not).** Do not re-derive or re-litigate decisions already made there — treat them as settled unless the user says otherwise. If a change touches the design, update PLAN.md itself (it's the living doc, not a snapshot); update PROGRESS.md whenever a milestone starts or a Verify step actually passes.

## What this is, in short

- **Storage**: everything lives in a "workspace" — any folder on disk the user points the app at (Obsidian's model). Markdown files under it are the *only* source of truth; a `node:sqlite` index at `<workspace>/.pivot/cache/index.sqlite3` is a derived, always-rebuildable cache — code must never require the index to interpret vault content correctly.
- **Task files**: one per project at `<workspace>/projects/<slug>.md`. Tasks are GFM checkboxes with a custom inline-token grammar (`@due(...)`, `@created(...)`, `@doingSince(...)`, `@spent(...)`, `#tag`, `<!-- id:t_xxxxxxxx -->`) plus an indented free-text description block. See PLAN.md's "Storage format" section for the exact grammar — don't improvise a variant.
- **Journal files**: one per day at `<workspace>/journal/<YYYY>/<YYYY-MM-DD>.md`, frontmatter + freeform body, with a `linkedTasks` array referencing task ids.
- **Time tracking** is automatic and tied to status: moving a task to "doing" starts an implicit timer, moving it away folds elapsed time into a cumulative `@spent` total. There is no separate start/stop control — don't add one.
- **Agent access is via MCP**, not a custom chat feature — a local stdio MCP server (`server/src/mcp/`) exposes full read+write tools over the same service layer the REST API uses, targeting an explicit workspace via `PIVOT_WORKSPACE`.
- **Every workspace is its own git repo**, auto-committed on every write, tagged by origin (`[api]` vs `[mcp:<tool>]`) — this is the undo mechanism for unwanted agent edits, independent of the REST API's SQLite index.
- **Business logic lives in `server/src/services/*.ts`**, not in Express route handlers — both the REST routes and the MCP tools must call these same functions. Don't duplicate logic between the two front doors.
- **Electron is a thin wrap, not an IPC rewrite**: the main process launches the Express server locally and points a `BrowserWindow` at it — the renderer still talks to `/api/...` over HTTP exactly as if it were a web app. The only things that go through the `electron/src/preload.ts` bridge are what a browser genuinely can't do: the native folder picker, launch-at-login, and reminder settings.
- **Daily reminder** fires a native OS notification once a day if today's journal entry is still empty — tied to whichever workspace is currently active, not all workspaces. The app stays alive in the system tray after the window is closed (only "Quit" in the tray menu actually quits) so the reminder is reliable; start-at-login is on by default but toggleable in Settings.

## Architecture map

See PLAN.md for full detail; quick pointers:
- `server/src/lib/markdown/taskLine.ts` — the task-line grammar parser/serializer. Everything else depends on this being exactly right; changes here need the round-trip test re-run.
- `server/src/lib/workspaces.ts` — workspace registry (`~/.pivot/config.json`), open/switch/remove.
- `server/src/lib/index/{db,reindex}.ts` — `node:sqlite` schema + reconciliation (stat-diff, not blind full reparse).
- `server/src/lib/vaultGit.ts` — git init/commit/revert/remote wrapper.
- `server/src/services/*.ts` — the one implementation of business logic, called by both `routes/` and `mcp/`.
- `server/src/mcp/` — the MCP server (separate process, stdio transport).
- `client/src/` — Vite/React/TanStack Query/React Router frontend.
- `electron/src/main.ts` — app lifecycle, embeds the server, owns the `BrowserWindow`.
- `electron/src/reminder.ts` — the daily-reminder scheduler.
- `design/` — the UI prototype canvas (source `.dc.html` files + a live editable link); see `design/README.md` before touching it.

## Working conventions for this project

- Don't add a feature or convention not already in PLAN.md without checking with the user first — several designs here (task grammar, sync model, workspace model) were arrived at after explicitly ruling out alternatives; re-introducing one of those alternatives without being asked is a regression, not an improvement.
- Markdown files must stay hand-editable and portable outside the app — never make a feature depend on the SQLite index, on `.pivot/`, or on the app having ever run, to be meaningful.
- Any change to the on-disk grammar (task line tokens, frontmatter shape) needs the parser *and* serializer updated together, and the round-trip test re-verified.
- When adding a route or MCP tool, put the actual logic in a service function, not inline in the handler.
- Run the Verify step listed for a milestone in PLAN.md before checking it off in PROGRESS.md — "code written" and "milestone done" aren't the same thing here.

## Commands

Nothing is implemented yet beyond scaffold (see PROGRESS.md). Once the backend/frontend exist:
```bash
npm run dev     # runs server + client concurrently (from repo root)
npm test        # server unit tests (node's built-in test runner via tsx)
```
