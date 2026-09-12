# Markdown-backed Daily Tasks + Journal App

> This is the living design doc for this project. For build status/what's done vs. not, see [PROGRESS.md](PROGRESS.md). For working conventions when picking this project up, see [CLAUDE.md](CLAUDE.md). Update this file (not a copy of it) whenever the design changes.

## Context

The user wants a personal daily-tasks/journal system stored entirely as plain markdown files: task files grouped by project, journal/daily notes bucketed by year. Existing tools (Obsidian, Logseq, Dendron, org-mode/org-journal, Foam, SilverBullet) all approximate this but none match the exact layout without heavy plugin config or accepting a different file-per-unit convention, so the user chose to build a custom local web app (Node.js + React).

Beyond the original CRUD scope, the user wants tasks and projects to carry real detail (descriptions, creation time, time-spent tracking), projects to be visually taggable (color) for a calendar, journal entries to reference the tasks worked on that day, and is open to SQLite for performance — **on the condition that the markdown files remain the portable, user-owned source of truth**; SQLite may only be a derived, rebuildable cache, never a place where data lives that isn't also in the `.md` files.

The user also wants AI agents (Claude Code, Claude Desktop, or any other MCP client) to be able to manage and summarize tasks/journals directly — decided via **MCP**, not a custom in-app chat feature: the app exposes a local MCP server with full read+write tools, so any MCP host supplies its own agent loop, model, and UI for free. Because that grants agents full read+write, the data itself needs an independent undo mechanism (git-backed, see Backup & recovery) so an unwanted agent edit is always reversible.

Finally, like Obsidian, the user wants **multiple workspaces** — any folder on disk can be opened as a workspace — plus the ability to **push a workspace's git history to a remote**, and a design that doesn't foreclose adding other cloud-sync backends (Google Drive, WebDAV, etc.) later.

**Direction change: this is now an Electron desktop app, not a browser-opened web app.** Two things needed a real OS integration that a browser tab can't provide: a native folder picker for "open workspace" (rather than the browser-tab workaround originally planned — a pasted path), and a daily reminder delivered as a native OS notification, reliably, even when the app window isn't open (which needs a tray icon + optional start-at-login). See **Desktop shell (Electron)** and **Daily reminder** below. This is a thin wrap, not a rewrite — the Express server, service layer, REST API, SQLite index, git backup, and MCP server designs below are unchanged; Electron's main process just launches that same server locally and points a `BrowserWindow` at it.

The working directory (`/home/lap16152/Documents/Code/poco`) currently has only an empty scaffold (`package.json`, `.gitignore`, empty dirs) plus a `design/` folder (a UI prototype canvas, see [design/README.md](design/README.md)) — nothing implemented yet.

## Workspaces

A **workspace** is any folder on disk containing (or about to contain) a vault — exactly Obsidian's model: you point the app at a folder, it becomes self-contained there.

- **App-level registry**: `~/.poco/config.json` (outside any workspace, since the app needs to know the workspace list *before* opening one) — `{ workspaces: [{ id, path, name, lastOpenedAt }], activeWorkspaceId }`.
- **Per-workspace hidden directory**: `<workspace>/.poco/` (mirrors Obsidian's `.obsidian/`), holding:
  - `cache/index.sqlite3` — the SQLite index (WAL mode), scoped to that workspace only.
  - `backups/vault-<date>.zip` — periodic snapshots (see Backup & recovery).
  - This directory is added to the workspace's own `.gitignore` (it's a cache, not content) but otherwise travels with the folder if copied — opening a copied/moved workspace elsewhere just works, or self-heals via reconciliation if `.poco/` didn't come along.
- **Adding a workspace**: `POST /api/workspaces {path, name?}` — validates the path exists (or offers to create it), is readable/writable, scaffolds `.poco/` and `projects/`/`journal/` subfolders if missing, `git init`s it if not already a repo, and registers it. Opening an *existing* folder that already has content just adopts it (like Obsidian's "Open folder as vault").
- **Switching**: `POST /api/workspaces/:id/open` closes the previous workspace's SQLite connection and git context, points everything at the new path, and runs index reconciliation for it. **One workspace is active at a time per running server** (matching how you actually use Obsidian day to day); running two workspaces open simultaneously means running two instances of the server on different ports — not needed for v1.
- **Removing**: `DELETE /api/workspaces/:id` un-registers it only — never deletes the folder or its content, same as Obsidian's "Remove from list."
- Aggregates/reports are always scoped to the single active workspace; there's no cross-workspace query surface (again, matches Obsidian — each vault is independent).
- **MCP is decoupled from "whichever workspace the app has open"**: each MCP server registration takes an explicit workspace path (`POCO_WORKSPACE=<path>` env var, or defaults to the registry's `activeWorkspaceId` if omitted) at launch, so an agent's target vault is deterministic and doesn't change underneath a conversation just because someone switched vaults in the app.
- **Folder picker**: a native OS picker (`dialog.showOpenDialog({properties:['openDirectory']})`, in the Electron main process), not a pasted path — see Desktop shell below. The renderer's "+ Open folder" button calls this via the preload bridge, then hands the returned path to the existing `POST /api/workspaces {path, name?}` — the workspace API itself doesn't change at all, only how the path is obtained.

The existing `vault/` directory already created under the repo becomes just a convenient default/dev workspace, not a hardcoded runtime path — nothing in the app code assumes a fixed vault location once workspace management ships.

## Desktop shell (Electron)

A thin wrap around the already-designed server + client, not a rewrite:

- **Main process** (`electron/src/main.ts`) launches the existing Express server bound to `127.0.0.1` on a free local port (no external network exposure), waits for it to be ready, then opens a `BrowserWindow` pointed at it — in dev, at the Vite dev server URL with the API proxied to the embedded server; in production, at the server's own URL, which also serves the built client static files. **No IPC rewrite of the REST API** — the renderer keeps talking to `/api/...` exactly as designed; Electron only adds native-OS affordances the browser couldn't provide.
- **Preload script** (`electron/src/preload.ts`, `contextBridge` + `contextIsolation: true`, no `nodeIntegration` in the renderer) exposes a minimal `window.poco` surface: `pickFolder()` → wraps `dialog.showOpenDialog`, returns the chosen path or `null`; `getLaunchAtLogin()` / `setLaunchAtLogin(bool)`; `getReminderSettings()` / `setReminderSettings({time, enabled})` for the active workspace. Everything else the client needs still goes over HTTP to the embedded server.
- **Window lifecycle**: closing the window hides it (`event.preventDefault()` + `win.hide()`) rather than quitting — the app keeps running via the tray (see Daily reminder) so the scheduler stays alive; the tray menu's "Quit" is the only real quit path, which cleanly stops the embedded server first.
- **Packaging**: `electron-builder`, configured in a new `electron/` npm workspace (own `package.json`, `electron` + `electron-builder` deps) — per-OS installers (dmg/nsis/AppImage) are future polish, not required for local development (`npm run dev` can launch Electron directly against the dev server without packaging).
- Using `node:sqlite` (not a native module) means there's no Electron-ABI rebuild step for the index — this was already anticipated and is why that library was chosen.

## Daily reminder

A native OS notification nudging the user to write today's journal entry if they haven't yet — scoped to whichever workspace is currently active in the running app.

- **Tray + background running, with an opt-out**: a tray icon keeps the app alive after the window is closed, so the reminder fires reliably even on a day the user never opens the window. **Start-at-login is on by default but user-toggleable** (`electron/src/loginItem.ts`, wraps `app.setLoginItemSettings`) — a "Launch at login" switch in Settings, persisted as `launchAtLogin: boolean` in `~/.poco/config.json`. Turning off start-at-login does not disable the tray — the app still stays alive for the rest of the current session once opened, it just won't auto-start next time the OS boots.
- **Per-workspace reminder time**: each workspace registry entry (`~/.poco/config.json`) gains `reminderTime: "HH:MM" | null` (24h local time; `null` = disabled for that workspace), editable in Settings, default `"20:00"` on a newly-added workspace.
- **Scheduler** (`electron/src/reminder.ts`): a main-process interval, checked once a minute, comparing local wall-clock time against the active workspace's `reminderTime`. Fires only if (a) it matches, (b) a `lastReminderFiredDate` field on that workspace entry isn't already today's date (prevents refiring within the same minute or after waking from sleep past the time), and (c) today's journal entry for that workspace has no body yet (skip silently if the user already journaled today — a smart no-op, not a nag). On fire: `new Notification({title: 'Time to journal', body: "You haven't written today's entry yet"})`, `lastReminderFiredDate` updated to today; clicking the notification shows/focuses the window and navigates to `/journal`.
- Native `Notification` API (Electron's own cross-platform wrapper over each OS's notification center) — no extra notification library needed.

## Storage format (paths below are relative to whichever workspace is active)

### Project file — one per project, `<workspace>/projects/<slug>.md`

Frontmatter (native YAML via `gray-matter`) carries project metadata; slug comes from the filename, never stored in frontmatter.

```markdown
---
name: "Website Redesign"
created: 2026-09-10
archived: false
description: >
  Full redesign of the marketing site, launching alongside the
  Q4 product announcement.
tags: [marketing, q4]
color: "#4f86f7"
---

- [/] Draft new homepage copy @due(2026-09-20) @created(2026-09-08T09:15:00Z) @doingSince(2026-09-10T13:00:00Z) @spent(2h15m) #content <!-- id:t_9f0e21 -->
  - [x] Get sign-off on tone from marketing
  - [ ] Write final copy
  Marketing wants a warmer tone than the old site. Pull inspiration from
  the Q3 brand deck before writing final copy.

  Check with Linh about the hero image licensing before this goes live.
- [x] Buy domain name @due(2026-08-01) @created(2026-07-20T10:00:00Z) @done(2026-08-01) <!-- id:t_1122aa -->
```

**Color**: server auto-assigns from a fixed 12-color palette at project creation (cycled by creation order) and always writes it to frontmatter — never left to client-side hashing, so every consumer (calendar marks, badges) reads one authoritative field. Editable via a color-picker in the project form.

**Task line grammar** — checkbox marker is status (`[ ]` todo, `[/]` doing, `[x]` done). Inline tokens, always re-emitted in this fixed order on write (parser accepts any order/whitespace on read):

```
@due(YYYY-MM-DD) → @created(<ISO8601 UTC>) → @doingSince(<ISO8601 UTC>) → @spent(<Xd><Yh><Zm>) → @done(YYYY-MM-DD) → #tag(s) → <!-- id:t_xxxxxxxx -->
```

- `@created(...)` — set once at creation, never rewritten.
- `@doingSince(...)` — present only while `status == doing`; added the instant a task enters doing, removed (folded into `@spent`) the instant it leaves.
- `@spent(...)` — cumulative time-in-doing, compact human format (`2h15m`, `45m`, `3h`, `1d2h15m`, `3d`), omitted entirely when zero. A day is a flat 24h (no calendar/timezone awareness) purely to keep a long-running task's total readable instead of growing into triple-digit hour counts.
- **Time tracking is automatic, tied to status**: moving a task to `[/]` doing starts the implicit timer (`@doingSince` = now); moving it away (to done or back to todo) computes elapsed time and adds it to `@spent`, then clears `@doingSince`. No separate start/stop control. `@doingSince` is a durable file field, so elapsed time is computed correctly even across a server restart while a task was left in doing.
- `#tag`(s) — zero or more, also used for priority (e.g. `#high`).
- `<!-- id:t_xxxxxxxx -->` — stable id in an HTML comment, assigned once via `crypto.randomUUID()`.
- **Description**: multi-line/multi-paragraph free text as indented continuation lines (2-space indent) directly beneath the checkbox line; blank indented lines preserve paragraph breaks; the block ends at the first non-indented line (naturally the next checkbox line or other body content). Non-checkbox, non-description body lines are preserved verbatim — the parser is non-destructive to content it doesn't understand.
- **Checklist (sub-tasks)**: zero or more plain nested GFM checkboxes (`  - [ ] ...` / `  - [x] ...`, one 2-space indent level, immediately beneath the checkbox line and before the description) — deliberately lightweight compared to a top-level task: just text + done, no `@due`/`@tags`/`<!-- id -->`/time-tracking of its own, so it stays a quick hand-editable checkbox rather than a second copy of the task-line grammar. Addressed by array position (no stable id), since the only mutation path is a full-array replace (`checklist` on `PATCH .../tasks/:taskId` and the `update_task`/`create_task` MCP tools) — same convention as `tags`. No blank line separates the checklist block from the description that may follow it (matches the existing checkbox-line-to-description precedent above); the parser tells them apart structurally (checklist lines are checkbox-shaped, description lines aren't), not by a blank-line boundary.

### Journal file — one per day, `<workspace>/journal/<YYYY>/<YYYY-MM-DD>.md`

```markdown
---
date: 2026-09-10
tags: []
linkedTasks: [t_a1b2c3, t_9f0e21]
---

Freeform markdown body, unparsed.
```

`linkedTasks` is a plain array of task ids, insertion-ordered, deduped on add. Year folder created on demand.

## Backend (Express + TypeScript)

`gray-matter` for all frontmatter; a hand-rolled regex/line-based parser for the task-line grammar (not remark/unified — the custom tokens aren't a native markdown construct, and a small regex module is simpler and easier to unit-test). `date-fns` for date math. `crypto.randomUUID()` for ids.

All business logic (task/project/journal read-modify-write, doing-timer transition, index upsert, git commit) lives in plain **service functions** (`server/src/services/*.ts`), not inside Express handlers — both the REST routes and the MCP server call the same functions, so there is exactly one implementation of "what a status change does." Every service function operates against the currently-active workspace context (or, for MCP, the workspace it was launched against).

### SQLite index layer (derived cache, not source of truth)

**Library**: `node:sqlite` (`DatabaseSync`, built into Node ≥22.5 — no npm dependency, no native module to rebuild for Electron later). Ruled out `sql.js` specifically because it has no real file-backed persistence (in-memory + manual whole-buffer serialize/reload), which can't support two separate processes (Express + MCP) concurrently reading/writing the same file the way WAL mode does; ruled out `better-sqlite3` only because it's a native module requiring an Electron-ABI rebuild step later, which `node:sqlite` avoids entirely for equivalent functionality at this app's scale. `node:sqlite` is still Node-experimental — isolate all access behind `lib/index/db.ts` so a future API shift (or a switch back to better-sqlite3, e.g. for FTS5 full-text search) is a contained, single-file change.

**Location**: `<workspace>/.poco/cache/index.sqlite3` — one index per workspace, gitignored within that workspace. Deleting it and reindexing must always reproduce identical query results from a clean scan — this is the hard portability constraint. Schema (sketch): `projects`, `tasks` (FK → project slug, includes `description`, `due`, `created_at`, `done_at`, `doing_since`, `spent_minutes`, `tags` JSON), `journal_entries` (`has_body` flag, `tags` JSON), `journal_task_links` (date, task_id), `index_meta`. Each file-backed table carries `source_mtime`/`source_hash` for staleness bookkeeping. Opened in **WAL mode** so the Express server and a concurrently-running MCP server process (pointed at the same workspace) can both read/write it without lock contention.

**Sync strategy — reconciliation, not blind reparsing** (a full reparse-everything rebuild on every boot scales badly and is wasted work when nothing changed):
- **Startup/open-time reconciliation** (runs whenever a workspace is opened, not just process boot): walk the workspace directory tree doing only `readdir`/`stat` (no file content read), compare each file's `mtime`/size against what's stored in the index from last time. Only **read and parse** files that are new or changed (this is also what picks up hand-edits made while the server was off, or changes an external sync tool — see Remote & cloud sync — made to the folder). Delete index rows for files that no longer exist. On a normal reopen with nothing changed, this is just stat calls — no parsing, effectively instant. Still exposed as `POST /api/index/rebuild` for an explicit forced full reparse.
- **Non-blocking**: the HTTP server starts listening immediately; reconciliation runs asynchronously right after boot or workspace-switch. File-backed routes (single project/journal read, task CRUD) work immediately since they never depend on the index. Aggregate endpoints return `503` with an "indexing…" body for the brief window before reconciliation finishes.
- **Incremental upsert-on-write**: every mutating service function re-uses the structured object it just wrote to disk to also upsert the index row(s) in the same call, immediately after the file write succeeds. Best-effort — if it throws, log and continue; the file write already succeeded and is authoritative, the index self-heals on the next reconciliation.
- **Write path, always in this order**: read file → parse → mutate (incl. doing-timer logic) → serialize → **write file (durable, authoritative step)** → upsert index row(s) (best-effort) → git commit (best-effort, see Backup & recovery) → return the in-memory structured form (never re-read the DB to respond).
- **Which reads go where**: single-project, single-journal-entry, and all task CRUD always read the source file directly (never stale, regardless of index state). Aggregate/cross-file views (`/api/tasks/open`, `/api/calendar/:year/:month`, `/api/tasks/:taskId/journal-links`, `/api/tasks/search`, `/api/reports/time-spent`, `/api/journal/:year` listing) read from the index — documented trade-off: only these can show stale data if the workspace is hand-edited (or externally synced) while the server is running; they self-correct on next reconciliation or a manual reindex.

### Routes

- Workspaces: `GET /api/workspaces`, `POST /api/workspaces`, `POST /api/workspaces/:id/open`, `DELETE /api/workspaces/:id`, `GET /api/workspaces/active`.
- Projects: `GET/POST /api/projects` (create accepts `description`, `tags`, `color`, else auto-assigned), `GET/PATCH/DELETE /api/projects/:slug`.
- Tasks: `POST /api/projects/:slug/tasks` (accepts `description`, `checklist`; server sets `createdAt`, `spentMinutes=0`), `PATCH /api/projects/:slug/tasks/:taskId` (status changes trigger the doing-timer transition logic; also updates `text`/`description`/`due`/`tags`/`checklist` — `checklist`, like `tags`, is a full-array replace, not an index-addressed add/toggle/remove; an optional `afterTaskId` reorders the task — `null` moves it to the front of the project file, a task id moves it to immediately after that task's block — backing the Kanban drag-and-drop described under milestone 18), `DELETE .../tasks/:taskId`.
- Journal: `GET /api/journal/:year`, `GET/PUT /api/journal/:year/:date` (PUT accepts `linkedTasks` full-replace), `POST /api/journal/:year/:date/links/:taskId` (idempotent add, auto-creates the day's file), `DELETE .../links/:taskId`.
- Aggregates: `GET /api/tasks/open`, `GET /api/tasks/:taskId/journal-links`, `GET /api/tasks/search?q=` (matches task text, description, *and* tags — one query for "search by text or tags", milestone 18), `GET /api/calendar/:year/:month`, `GET /api/reports/time-spent?groupBy=&from=&to=&includeInProgress=`.
- Index/misc: `POST /api/index/rebuild`, `GET /api/index/status`, `GET /api/vault/status`.
- Backup/history: `GET /api/vault/history?path=&limit=`, `GET /api/vault/diff/:commit`, `POST /api/vault/revert/:commit`.
- Remote sync: `GET/PUT /api/vault/git/remote`, `POST /api/vault/git/push`, `POST /api/vault/git/pull`, `GET /api/vault/git/status` (see Remote & cloud sync).

**Doing-timer transition** (inside the task status PATCH handler / service function):
```
if newStatus == task.status: return task   # no-op guard, avoids double counting
if task.status == 'doing':
  task.spentMinutes += minutesBetween(task.doingSince, now)
  task.doingSince = null
if newStatus == 'doing': task.doingSince = now
if newStatus == 'done': task.doneAt = today
else if task.status == 'done': task.doneAt = null
task.status = newStatus
```
The live "N (tracking...)" value shown in the UI is computed client-side (`spentMinutes + elapsed-since-doingSince`, ticking locally); the file's `@spent` token only updates on an actual status transition, never on a timer tick, to avoid write amplification.

## Backup & recovery (git-backed workspace)

Since MCP grants agents full read+write, the write path needs an undo mechanism that doesn't depend on the connecting agent's host catching a bad edit before it happens.

**Mechanism: each workspace is its own git repository, managed entirely by the app.**

- On workspace add/open, if `<workspace>/.git` doesn't exist, `git init` it and make an initial commit of whatever's already there.
- Every mutating service-function call commits the changed file(s) right after the file write succeeds, with a self-documenting message: `[origin] action target`, e.g. `[mcp:update_task] t_9f0e21 status doing→done (website-redesign)`, `[api] create_journal_entry 2026-09-10` — history always shows whether a human (web UI) or an agent (and which MCP tool) made a change.
- Best-effort, same footing as the SQLite upsert: if git isn't installed or a commit fails, log and continue — the file write already succeeded and is authoritative; versioning is a safety net, not a dependency for the app to function.
- Because it's a plain git repo, the user can always recover with nothing but a terminal (`cd <workspace> && git log`/`git diff`/`git revert`) — no dependency on the app's own UI.

**Recovery surface**: `GET /api/vault/history?path=&limit=`, `GET /api/vault/diff/:commit`, `POST /api/vault/revert/:commit` (`git revert --no-edit <commit>` — a new undo commit, not a rewrite of history, so it's safe even with later commits on top — followed by reconciling the index for the affected file(s)). Plus a small **History panel** on project detail and journal day pages: recent commits touching that file, each with a one-click "Undo this change."

**Belt-and-suspenders**: a periodic full snapshot to `<workspace>/.poco/backups/vault-<date>.zip` (daily, keep the last ~14) — cheap insurance against the git repo itself being deleted/corrupted; git history is still the primary recovery path.

## Remote & cloud sync

Two genuinely different sync models, both enabled by the workspace-is-a-folder + workspace-is-a-git-repo design above:

**1. Git remote push/pull (active, explicit) — built in v1.**
- `GET/PUT /api/vault/git/remote` — read/set the `origin` remote URL (`git remote add|set-url origin <url>`).
- `POST /api/vault/git/push`, `POST /api/vault/git/pull`, `GET /api/vault/git/status` (ahead/behind counts, dirty state, last sync time).
- No credential management is built — pushing/pulling shells out to plain `git`, so it relies on whatever credential helper/SSH key the user's own git setup already has (same as running `git push` from a terminal). This keeps the app out of the business of storing secrets.
- **Conflicts are surfaced, never auto-resolved**: on a pull that would conflict, return the list of conflicted files as a structured error rather than attempting a merge — these are personal notes and task files, and a bad auto-merge could corrupt the task-line grammar; the user resolves conflicts with normal git tooling (or the History/diff UI) and pulls again.
- Designed as a `SyncProvider` interface (`server/src/lib/sync/types.ts`: `push`, `pull`, `status`) with `gitRemote.ts` as the only v1 implementation, and the workspace registry entry storing `sync: { provider: 'git-remote', remoteUrl } | { provider: 'none' }` — a later provider (see below) slots into the same interface without touching the workspace/vault model.

**2. Passive filesystem sync (Google Drive, WebDAV, Dropbox, Syncthing, …) — works today, zero code needed.**
Because a workspace is just "any folder," the user can already point one at a folder that an external tool keeps synced (a mounted WebDAV share, a Google Drive/Dropbox desktop-sync folder, etc.) — the app doesn't need to know or care that this is happening. Two things make this safe rather than build features for it:
- The app already tolerates files changing underneath it (that's exactly what reconciliation is for).
- The vault scanner should **ignore/skip files that don't match the expected naming pattern** rather than erroring — this specifically covers sync-conflict artifacts these tools create (e.g. `task-list (conflicted copy 2026-09-10).md`).
A future first-class Google Drive/WebDAV `SyncProvider` (API-driven push/pull, like the git-remote one, rather than "just point a folder at a sync client") can be added later behind the same interface if that's ever wanted — not needed for v1.

## Agent access via MCP (Claude Code, Claude Desktop, etc.)

Instead of a custom in-app chat feature backed by an OpenAI-compatible API, the app ships a local **MCP server** so any MCP-capable agent becomes the chat/management interface for free — no server-side agent loop, model config, or chat UI to build.

- **Transport**: stdio, a standalone process (`server/src/mcp/index.ts`, built with `@modelcontextprotocol/sdk`), registered with an MCP host via `claude mcp add` or `.mcp.json` — no network port, no auth to manage. Takes an explicit target workspace (`POCO_WORKSPACE=<path>` env var, defaulting to the app registry's active workspace if omitted) so an agent's vault doesn't silently change if someone switches workspaces in the browser mid-conversation.
- **Tools — full read+write**, each a thin wrapper over the same service functions the REST routes use: `create_task`, `update_task`, `delete_task`, `search_tasks`, `list_open_tasks`, `create_project`, `update_project`, `list_projects`, `get_project`, `upsert_journal_entry`, `get_journal_entry`, `link_task_to_journal`, `unlink_task_from_journal`, and `get_task_summary({projectSlug?, dateRange?, status?})` returning structured aggregates — the calling agent narrates the summary itself, no summarization logic needed server-side.
- **Concurrency**: the MCP process and the Express process may open the same workspace's `index.sqlite3` directly — this is exactly why WAL mode is required. Each process does its own read-modify-write directly against the workspace's files, same as any two writers of a text file.
- **Errors are structured and returned to the model** (e.g. "no project with slug X, did you mean: ..."), so the agent can self-correct rather than fail silently.
- **Self-serve setup**: `/settings`' "Agent access" section (milestone 18) generates copy-pasteable config for the standalone entrypoint above — a Claude Desktop `claude_desktop_config.json` snippet, a Codex CLI `~/.codex/config.toml` snippet, and a `claude mcp add` one-liner — built from `GET /api/system/mcp-info`'s absolute entrypoint path and the active workspace's own path, so a user never has to hand-derive either.

## Frontend (Vite + React + TypeScript + TanStack Query, React Router)

- **`AppShell`** — nav + **`WorkspaceSwitcher`** (list of known workspaces, "+ Open folder" wired to the native picker via `window.poco.pickFolder()`, active-workspace indicator) + persistent **`CalendarSidebar`**: month grid backed by `GET /api/calendar/:year/:month`; marks days with a journal entry, and colored dots (by project color) for linked/due tasks; click navigates to `/journal/:year/:date`.
- `/` — **Dashboard**: open tasks across all projects, bucketed by due date, project color badges, "+ log to today" and "go to project" (milestone 18) quick actions per row; a collapsible "Recent projects" section (top 3 by most-recent task activity, `variant="grid"` on `ProjectCard` — a 3-column card grid deliberately distinct from `/projects`'s row layout); an "+ Add task" popup (`Modal`) with a project selector, defaulting to the most-recently-active project; a "Search tasks" popup (icon button by the task buckets) — one text input plus clickable tag pills, both driving the same text-or-tag query.
- `/projects` — list with per-status task counts, tags, color accents, archived filter, a tag filter (multi-select — click any number of tag pills, OR-matched against a project's tags, "Clear" to reset), new-project button (opens the create form in a **`Modal`**, milestone 18).
- `/projects/:slug` — a "← All projects" link back to `/projects`; the task quick-add form sits above the board; Kanban columns (Todo/Doing/Done, stretched to equal height so a short column's drop zone still spans a much longer sibling's) with description (expandable textarea), a `TimeSpentBadge` (live-ticking while doing), due date, tags; drag-and-drop (native HTML5 DnD, no added dependency) reorders within a column and, dragged across columns in either direction, changes status via the existing doing-timer transition — task order has no dedicated field, it's just the position of the task's block in the project file, so a reorder is a real (small) file edit like any other write (see the Tasks route's `afterTaskId`); project edit form (name/description/tags/color, plus a native `<input type="color">` swatch after the 12 presets for a custom color) opens in the same **`Modal`** as create, not inline — avoids the page-shift an inline form caused; **History panel**.
- `/journal` → redirect to `/journal/<year>/<today>` (auto-creates if missing).
- `/journal/:year` — entries list (date + preview), year nav.
- `/journal/:year/:date` — tag input, autosaving body textarea, **linked-tasks section** (picker backed by `GET /api/tasks/search`), **History panel**.
- `/settings` — a **Language** picker (EN/VI, see Localization below), a git-not-found notice (milestone 18, linking to git-scm.com when `GET /api/system/git-available` is false — undo history and sync both depend on it), workspace list/management (each row also has an "open folder" button, milestone 18, via `window.poco.openWorkspaceFolder` — reveals it in the OS file manager), a **Sync panel** per workspace (remote URL field, Push/Pull buttons, last-synced status, conflict list if any), an **Agent access (MCP)** section (milestone 18, see "Agent access via MCP" above), a **Daily reminder** field per workspace (time picker or "Off", via `window.poco.setReminderSettings`), and a **Launch at login** toggle (via `window.poco.setLaunchAtLogin`).

Shared components: `AppShell`, `WorkspaceSwitcher`, `TaskRow`, `TaskForm`, `TimeSpentBadge`, `ProjectCard`, `ProjectForm`, `DueDateBadge`, `TagInput`, `CalendarSidebar`, `MarkdownTextarea`, `HistoryPanel`, `VaultChangePoller`.

**Auto-refresh after an out-of-band change** (milestone 18): an already-open UI must pick up a change made outside its own mutations — most notably an MCP agent writing to the same workspace from its own, separate process (this app's MCP server is deliberately decoupled from whichever workspace the running app has open, so the Express server has no in-process signal for it), but equally a hand-edit + `git commit` or a `git pull`. Since every write from either front door is already a commit, the workspace's current git HEAD hash is a cheap, reliable "did anything change?" signal — no filesystem watcher, no new dependency. `VaultChangePoller` (mounted once in `AppShell`) polls `GET /api/vault/head` every 4s and, on a hash change, calls `queryClient.invalidateQueries()` with no key — the same whole-cache invalidation `WorkspaceSwitcher` already does for a workspace switch.

## Localization (i18n)

The UI language is a personal display preference, not vault content — it never touches the markdown files, and isn't scoped per-workspace (a user has one language for the whole app, the same way they have one launch-at-login setting). English and Vietnamese ship first; the mechanism doesn't hardcode either, so a third language is just another resource file.

- **Storage**: one `language: 'en' | 'vi'` field on `~/.poco/config.json`'s app-wide registry, alongside `launchAtLogin` — `undefined` (never set) normalizes to `'en'`. Exposed as `GET/PUT /api/preferences/language` (`server/src/routes/preferences.ts`, `services/workspaces.ts`'s `getLanguagePreference`/`setLanguagePreference`), the same pattern already established for `launch-at-login`.
- **No Electron bridge for the client's own use** — unlike launch-at-login/reminder settings, a language switch touches no OS-level API, so the React client reads/writes the preference directly over HTTP (`api/client.ts`'s `getLanguagePreference`/`setLanguagePreference`) and works identically in a plain browser tab, not just inside Electron.
- **Client**: `react-i18next` + `i18next`, resources bundled statically as `client/src/i18n/{en,vi}.json` (`client/src/i18n/index.ts` does the `i18next.init`). `main.tsx` fetches the stored preference once and calls `i18n.changeLanguage` before the first render, so the app never flashes in the wrong language. `/settings` gains a **Language** picker (EN/VI) that persists via the API and calls `i18n.changeLanguage` directly for an instant switch, no reload needed.
- **Electron native strings**: the tray menu (Open/Settings/Quit + tooltip) and the daily-reminder OS notification's title/body are also translated — these are rendered by the main process, outside the React bundle, so they use a small hand-rolled dictionary (`electron/src/i18n.ts`) rather than pulling `react-i18next` into a non-React process. `main.ts` reads the preference once at startup (for the tray's initial language) and the daily-reminder scheduler (`reminder.ts`, already polling once a minute) re-reads it on every tick, calling back into `main.ts` to rebuild the tray menu whenever it changes — so a language switch made in Settings takes effect on the tray within a minute without an app restart.
- **Convention for new UI text going forward**: every user-facing string in `client/src/{pages,components}` goes through `useTranslation()`'s `t()`, keyed by a per-page/component namespace in `en.json`/`vi.json` (e.g. `settings.language.sectionTitle`) — a new hardcoded string in a component is a regression here, the same way an unhandled inline-token variant would be in `taskLine.ts`.

## Project scaffold

```
poco/
  package.json (npm workspaces: server, client, electron)
  design/                                   # UI prototype canvas (source .dc.html + README), see design/README.md
  vault/{projects,journal}/                 # default/dev workspace only, not a hardcoded runtime path
  server/src/
    index.ts  config.ts  types.ts
    lib/fsVault.ts  lib/slug.ts  lib/ids.ts  lib/vaultGit.ts  lib/workspaces.ts
    lib/markdown/{frontmatter,taskLine,project,journal}.ts
    lib/index/{db,reindex}.ts
    lib/sync/{types,gitRemote}.ts
    services/{workspaces,projects,tasks,journal,calendar,reports}.ts
    routes/{workspaces,projects,tasks,journal,calendar,reports,index,vault}.ts
    mcp/{index,tools}.ts
  client/src/
    main.tsx  App.tsx  api/client.ts  types.ts
    i18n/{index,en.json,vi.json}.ts           # react-i18next setup + locale resources (Localization)
    pages/{DashboardPage,ProjectsListPage,ProjectDetailPage,JournalYearPage,JournalDayPage,SettingsPage}.tsx
    components/{AppShell,WorkspaceSwitcher,CalendarSidebar,TaskRow,TaskForm,TimeSpentBadge,ProjectCard,ProjectForm,DueDateBadge,TagInput,MarkdownTextarea,HistoryPanel}.tsx
  electron/
    package.json                            # electron + electron-builder deps
    src/
      main.ts        # app lifecycle, launches embedded server, BrowserWindow, window-hide-not-close
      preload.ts      # contextBridge: pickFolder, launch-at-login getters/setters, reminder settings
      tray.ts         # tray icon + menu (Open, Settings, Quit), rebuildable in the current language
      reminder.ts      # per-minute scheduler, native Notification, polls the language preference too
      loginItem.ts     # app.setLoginItemSettings wrapper
      i18n.ts          # tray/notification string dictionary (Localization) — not react-i18next, plain process
```

`~/.poco/config.json` (app-level workspace registry, plus `launchAtLogin`, `language`, and each workspace's `reminderTime`/`lastReminderFiredDate`) lives outside the repo entirely, in the user's home directory.

## Critical files to build first
- [server/src/lib/markdown/taskLine.ts](server/src/lib/markdown/taskLine.ts) — the task-line grammar parser/serializer; everything else depends on getting this right.
- [server/src/lib/workspaces.ts](server/src/lib/workspaces.ts) — registry read/write, add/open/remove, `.poco/` scaffolding; almost everything downstream operates against "the active workspace" this resolves.
- [electron/src/main.ts](electron/src/main.ts) — launches the embedded server and owns the window lifecycle; everything Electron-specific hangs off this.
- [electron/src/reminder.ts](electron/src/reminder.ts) — the daily-reminder scheduler.
- [server/src/lib/index/db.ts](server/src/lib/index/db.ts), [server/src/lib/index/reindex.ts](server/src/lib/index/reindex.ts) — SQLite schema (WAL mode) + reconciliation-based (re)indexing.
- [server/src/lib/vaultGit.ts](server/src/lib/vaultGit.ts) — git init/commit/revert/remote wrapper; the undo mechanism for agent-made changes and the basis for remote sync.
- [server/src/services/tasks.ts](server/src/services/tasks.ts) — doing-timer transition logic; consumed by both routes and MCP tools.
- [server/src/mcp/tools.ts](server/src/mcp/tools.ts) — MCP tool schemas + dispatch to the service layer.

## Milestones (each independently verifiable)
1. **Vault + markdown core v2** — task grammar (description/created/doing-timer tokens) + project/journal frontmatter v2, workspace-path-agnostic (pure functions over any directory). Verify: round-trip parse→serialize on a hand-written sample file containing every field, byte-for-byte equal output.
2. **Workspace management** — `~/.poco/config.json` registry, add/list/open/remove, `.poco/` scaffold-on-open. Verify: register two scratch folders as workspaces, switch between them, confirm each gets its own `.poco/` dir and the active one's routes serve its content; confirm removing a workspace doesn't touch its folder.
3. **Electron shell** — `electron/` package, `main.ts` (launches the embedded server on a free `127.0.0.1` port, opens a `BrowserWindow`, hide-not-close), `preload.ts` (`pickFolder`, login-item and reminder-setting bridges). Verify: `npm run dev` launches an Electron window showing the (still-unstyled) app talking to the embedded server over HTTP; click "+ Open folder" (once wired in milestone 16) opens a real native directory picker; closing the window hides it rather than quitting, and it's still responsive when reopened from the tray.
4. **Indexing layer** — per-workspace SQLite (WAL mode), reconciliation-based (re)indexing, `POST /api/index/rebuild`, `GET /api/index/status`. Verify: seed a scratch workspace, index, inspect rows match files; delete the sqlite file, re-run, confirm identical reproduction; touch one file's mtime without changing content and confirm it's the only one reparsed.
5. **Backup/versioning layer** — `lib/vaultGit.ts` (init-if-missing, commit-on-write, revert), `routes/vault.ts` history/diff/revert. Verify: make a few changes through the helper directly, confirm `git log` shows one commit per change with the expected message format; revert one commit, confirm file content and `git log` both reflect the undo.
6. **Remote sync layer** — `lib/sync/{types,gitRemote}.ts`, remote get/set + push/pull/status routes, conflict surfacing. Verify: point a scratch workspace at a local bare git repo as `origin`, push, pull, confirm state matches; simulate a conflicting change on both sides and confirm pull returns a structured conflict list rather than corrupting files.
7. **Service layer + Backend Projects+Tasks API v2** — `services/projects.ts`/`services/tasks.ts` (CRUD with description/tags/color/createdAt, doing-timer transition, incremental upsert-on-write **and** git commit-on-write). Verify with curl: create project, add task, PATCH todo→doing→(wait)→todo, confirm `@spent` in the file, the index row, and a new git commit all agree.
8. **Backend Journal API v2** — `services/journal.ts`, `linkedTasks` in GET/PUT, link add/remove endpoints. Verify with curl: file, index, and git history agree after add/remove.
9. **Backend aggregate/query routes** — `/api/tasks/open`, `/api/calendar/:year/:month`, `/api/tasks/:taskId/journal-links`, `/api/tasks/search`, `/api/reports/time-spent`. Verify with curl, cross-checked by hand against the `.md` files.
10. **MCP server** — `server/src/mcp/{index,tools}.ts`, explicit `POCO_WORKSPACE` targeting, registered via `claude mcp add`. Verify by driving it from a real MCP client: create/update tasks via tool calls, confirm files/index/git history all match what the REST API would have produced; deliberately make an "unwanted" change and confirm `POST /api/vault/revert/:commit` cleanly undoes it.
11. **Frontend Projects/Tasks UI v2** — description fields, color picker, tag inputs, live `TimeSpentBadge`.
12. **Frontend Journal UI v2** — linked-tasks section + picker, "+ log to today" quick action.
13. **Frontend Calendar sidebar** — month grid in `AppShell`, marks, click-to-navigate.
14. **Frontend Dashboard v2** — project color badges, "+ log to today" wired in.
15. **Frontend History & revert UI** — History panel on project detail and journal day pages.
16. **Frontend Workspace switcher + Settings/Sync panel** — open/switch/remove workspaces via the milestone-3 native picker; per-workspace remote URL + push/pull/status; Settings gains the Daily reminder time field and Launch-at-login toggle.
17. **Daily reminder** — tray icon + menu, `loginItem.ts`, `reminder.ts` scheduler. Verify: set a workspace's `reminderTime` to a minute in the near future with no body yet in today's journal entry, confirm a native notification fires at that time and not again after; add a body to today's entry first and confirm no notification fires; confirm clicking the notification focuses the window on `/journal`.
18. **Polish** — task drag-and-drop on the Kanban columns (reorder within a column, change status by dropping into another), project create/edit moved into a `Modal` popup instead of an inline form, a custom-color swatch (native `<input type="color">`) alongside the 12-preset palette, a tag filter on `/projects`, and a round of Dashboard additions (quick-add-task popup, a collapsible "Recent projects" card grid, a text-or-tag task-search popup, "go to project" on task rows) (all done — see PROGRESS.md's "Milestone 18 notes"); still outstanding: empty-vault/first-run state, loading/error states, due-date coloring, index-rebuild button, periodic zip snapshot job, README documenting the `.poco/` layout, the portability guarantee, how to register the MCP server, how to inspect/revert history from a plain terminal, and basic `electron-builder` packaging config (installers themselves are a later distribution step, not required here).
19. **Localization (i18n)** — see "Localization" above: `language` preference (`~/.poco/config.json` + `GET/PUT /api/preferences/language`), `react-i18next` client setup with `en`/`vi` resources, every existing page/component converted to `t()`, a Language picker on `/settings`, and the Electron tray menu + daily-reminder notification translated via `electron/src/i18n.ts`. Verify: switch languages in Settings and confirm every page's visible text (nav, buttons, empty/error states, forms) changes immediately with no reload, in both directions; confirm the choice persists across an app restart; confirm the Electron tray's menu/tooltip and a fired daily-reminder notification are in the currently-selected language (tray updates within a minute of a live switch, per the reminder scheduler's poll); confirm a plain browser tab (no Electron) can still switch languages via the same Settings control.

## Verification
- Milestones 4, 7–9: `curl` against the running server; cross-check the on-disk `.md` files, SQLite rows, and `git log`/`git diff` inside the workspace after each write; explicitly test index deletion + reindex reproducing identical state, and that a no-op reopen triggers no reparsing.
- Milestone 2: confirm workspace isolation — content/index/git history of one workspace never leaks into another.
- Milestone 3: confirm the app is usable identically to a plain local web app (nothing here should require the IPC bridge except the folder picker and reminder settings) — the point of the thin-wrap approach is that almost nothing else changes.
- Milestone 6: confirm conflicting concurrent changes surface as a conflict, never a silent corruption.
- Milestone 10: exercise the MCP server through a real MCP client rather than curl; specifically test the revert-an-agent-change path end to end, and that switching the active workspace in the app does not change what a running MCP server targets.
- Milestones 11–16: `npm run dev` at the root, exercise each page manually inside the Electron window — add/edit/complete tasks and watch time-tracking accumulate, write/link a journal entry, confirm the calendar sidebar and dashboard update, use the History panel to undo a change, add/switch workspaces via the native picker, and push/pull against a scratch remote.
- Milestone 17: confirm the reminder still fires after closing (not quitting) the window, and does not fire twice; confirm toggling launch-at-login actually changes the OS-level login item (check the OS's own login-items setting) without affecting the current session's tray/background behavior.
- Confirm portability end-to-end: manually edit a project `.md` file while the server is running, reload the UI, confirm changes appear; delete `<workspace>/.poco/cache/index.sqlite3` entirely, reopen the workspace, and confirm full functionality with no data loss (simulates copying just the workspace folder — `.git` included — to a new machine).
- Confirm multi-process concurrency: run the embedded server and an MCP server pointed at the same workspace simultaneously, write through each, confirm no SQLite lock errors, no git commit conflicts, and both writes land with separate history entries.
