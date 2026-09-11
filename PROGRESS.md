# Progress Tracker

Tracks implementation of [PLAN.md](PLAN.md). Update this file as milestones start/finish — check a box only when its own Verify step (from PLAN.md) has actually been run, not just when code is written.

## Status: Milestones 1-3 done; everything else not started

## Scaffold done so far
- [x] Root `package.json` (npm workspaces: server, client, electron) + `.gitignore`
- [x] `server/package.json` (Express, gray-matter, date-fns, cors, tsx, typescript; no SQLite npm dep — using `node:sqlite`)
- [x] `server/tsconfig.json` (NodeNext module/resolution, strict)
- [x] `client/` — Vite + React + TS scaffold (placeholder `App.tsx`; real UI is milestones 11-16)
- [x] `electron/` — Electron + electron-builder scaffold (see "Milestone 3 notes")
- [x] `design/` — UI prototype canvas (source files + live link), see [design/README.md](design/README.md)
- [ ] Everything else below

## Milestones

- [x] **1. Vault + markdown core v2** — task grammar (description/created/doing-timer tokens) + project/journal frontmatter v2, workspace-path-agnostic. Verify: `npm test -w server` — round-trip parse→serialize on hand-written fixtures (`server/src/lib/markdown/__fixtures__/{project-sample,journal-sample}.md`) is byte-for-byte equal; also `npx tsc --noEmit` clean. See "Milestone 1 notes" below.
- [x] **2. Workspace management** — `~/.pivot/config.json` registry, add/list/open/remove, `.pivot/` scaffold-on-open. Verify: `npm test -w server` (`server/src/services/workspaces.test.ts`) plus a manual curl run against the live server (see "Milestone 2 notes") registering two scratch folders, switching, and confirming removal doesn't touch the folder.
- [x] **3. Electron shell** — `electron/` workspace, `main.ts` (embedded server + `BrowserWindow`, hide-not-close), `preload.ts` (`pickFolder`, login-item/reminder bridges). Verify: `npm run dev` at root, driven via a Playwright `_electron` script (see "Milestone 3 notes") — window opens showing the placeholder client talking to the embedded server over HTTP, closing it hides rather than destroys the window, and it's still responsive after a simulated tray reopen.
- [ ] **4. Indexing layer** — per-workspace `node:sqlite` (WAL mode), reconciliation-based (re)indexing, rebuild/status routes.
- [ ] **5. Backup/versioning layer** — `lib/vaultGit.ts` (init/commit-on-write/revert), history/diff/revert routes.
- [ ] **6. Remote sync layer** — `lib/sync/{types,gitRemote}.ts`, remote get/set + push/pull/status, conflict surfacing.
- [ ] **7. Service layer + Backend Projects+Tasks API v2** — CRUD w/ description/tags/color/createdAt, doing-timer transition, index + git commit on write.
- [ ] **8. Backend Journal API v2** — `linkedTasks`, link add/remove endpoints.
- [ ] **9. Backend aggregate/query routes** — open tasks, calendar marks, journal-links, search, time-spent report.
- [ ] **10. MCP server** — stdio server, `PIVOT_WORKSPACE` targeting, full read+write tools + `get_task_summary`.
- [ ] **11. Frontend Projects/Tasks UI v2** — description, color picker, tags, live `TimeSpentBadge`.
- [ ] **12. Frontend Journal UI v2** — linked-tasks section + picker, "+ log to today".
- [ ] **13. Frontend Calendar sidebar** — month grid in `AppShell`, marks, click-to-navigate.
- [ ] **14. Frontend Dashboard v2** — color badges, "+ log to today" wired in.
- [ ] **15. Frontend History & revert UI** — History panel on project/journal pages.
- [ ] **16. Frontend Workspace switcher + Settings/Sync panel** — native folder picker; reminder time + launch-at-login fields.
- [ ] **17. Daily reminder** — tray icon, `loginItem.ts`, `reminder.ts` scheduler, native notification.
- [ ] **18. Polish** — first-run state, loading/error states, backup job, README, MCP registration docs, basic `electron-builder` config.

## Milestone 3 notes
- `electron/src/main.ts` **spawns** the server as its own process (via the hoisted `tsx` binary in dev, fixed port `4174`) rather than importing it in-process — keeps the server always running under a real `node:sqlite`-capable Node regardless of which Node version a given Electron release bundles, and keeps electron's own `tsconfig.json` from having to reach across into `server/src` (separate CommonJS project, no cross-package `rootDir`). Waits for `/api/health` before opening the `BrowserWindow`.
- `electron/src/preload.ts` exposes the full `window.pivot` bridge contract (`pickFolder`, `getLaunchAtLogin`/`setLaunchAtLogin`, `getReminderSettings`/`setReminderSettings`) per PLAN.md's Desktop shell section. `pickFolder` and the launch-at-login pair have real `ipcMain.handle` wiring in `main.ts` (login-item via `electron/src/loginItem.ts`, a thin `app.setLoginItemSettings` wrapper — trivial enough to build now even though the fuller registry-backed version is milestone 17). The reminder-settings pair is declared but **not yet wired** — no handler is registered until milestone 17 builds the per-workspace `reminderTime` data model and `reminder.ts` scheduler; calling it before then rejects with Electron's own "no handler registered" error.
- `electron/src/tray.ts` — minimal tray (Open/Quit) needed for the hide-not-close pattern to be testable at all; the reminder-specific tray items land in milestone 17. Uses a real generated PNG (`electron/src/assets/tray-icon.png`), not `nativeImage.createEmpty()`, which renders invisible on some platforms.
- Window `close` is intercepted (hide, not destroy); `window-all-closed` is a no-op; only the tray's Quit (or `before-quit`) actually quits. On real quit, `stopServer()` uses `tree-kill` to kill the server's **whole** process tree by PID, not just the immediate child — `tsx` spawns its own grandchild loader process, and killing only the wrapper leaked an orphaned server on quit until this was caught during verification.
- The server subprocess is spawned **without** `detached: true` (a first attempt detached it so `stopServer()` could group-kill tsx's grandchild via a negative-PID signal). That broke `npm run dev` + Ctrl+C: a real terminal sends SIGINT to the *whole foreground process group*, and detaching removed the server from that group, so its cleanup then depended on Electron's own JS-level `app.quit()` racing against its own Chromium helper processes (gpu-process, network utility) receiving that same raw signal independently — unreliable, and empirically it left orphaned Electron helpers *and* the server itself running, with `concurrently` hanging forever waiting for them. Fix: leave the server in the group (so a raw Ctrl+C reaches it directly and it dies on its own — no orchestration needed) and use `tree-kill` (walks by PID, not group membership) only for the *explicit* graceful-quit path. Verified by scripting the actual `npm run dev` → Ctrl+C sequence twice (simulating a real terminal by sending `SIGINT` to the whole process group) and confirming zero leftover processes within ~1s each time.
- Root `package.json`: added the `electron` workspace (package renamed to `pivot-electron` internally — naming the workspace itself `electron` collides with the `electron` npm dependency it needs and made npm nest a duplicate copy instead of hoisting it) and repointed `npm run dev` at client+electron (electron's own dev script spawns the server itself, so root no longer also launches `server` directly).
- Added a minimal, deliberately unstyled `client/` scaffold (Vite + React + TS: `vite.config.ts` proxies `/api` to the fixed dev port `4174`, `App.tsx` just renders embedded-server health + active workspace) — needed as infrastructure for this milestone's own verify step, not the real frontend (that's milestones 11-16).
- **Verified live** (not just typechecked): built a one-off Playwright `_electron` driver, ran it under this machine's real X display — launched the app, confirmed the window shows "Embedded server: ok" / "Active workspace: none", called the equivalent of the window's close button and confirmed the window persisted (hidden, not destroyed) while the server process kept running, then simulated the tray's reopen and confirmed the window came back responsive. No permanent driver script was committed (one-off verification, not a recurring need yet); a future `run`-skill pass can build a persistent one if headless Electron testing becomes routine.
- Gotcha for future reinstalls: `electron`'s postinstall binary download has silently no-op'd on a plain `npm install` in this sandbox at least once; if `node_modules/electron/dist/electron` (or `electron/node_modules/electron/dist/electron`, depending on how npm hoists it) is missing, `cd` into that package dir and run `node install.js` directly.

## Milestone 2 notes
- `server/src/lib/workspaces.ts` — pure registry I/O (`~/.pivot/config.json` read/write) + `scaffoldWorkspaceDirs` (`.pivot/{cache,backups}`, `projects/`, `journal/`, gitignoring `.pivot/`) + `ensureGitRepo` (best-effort `git init`, reused by `vaultGit.ts` in milestone 5).
- `server/src/services/workspaces.ts` — `addWorkspace` (register + scaffold + activate; adopts an already-registered path instead of duplicating), `openWorkspace` (switch active + re-scaffold, so a moved/copied workspace self-heals), `removeWorkspace` (unregister only, never touches the folder), `listWorkspaces`, `getActiveWorkspace`. All take an optional `homeDir` param (defaults to `os.homedir()`) purely so tests can point at a scratch registry.
- `server/src/routes/workspaces.ts` — `GET /api/workspaces`, `GET /api/workspaces/active`, `POST /api/workspaces`, `POST /api/workspaces/:id/open`, `DELETE /api/workspaces/:id`, all thin wrappers over the service layer.
- `server/src/index.ts` — first real server entrypoint (`createApp`/`startServer`, binds `127.0.0.1` only); direct-run uses a fixed dev port (`4174`, overridable via `PORT`), `startServer(0)` picks a free ephemeral port for embedding (used by Electron in milestone 3).
- Verified live: registered two scratch folders via curl, confirmed each got its own `.pivot/`/`.git`/`.gitignore`, switched active between them, deleted one's `.pivot/` and confirmed re-opening self-heals it, removed one and confirmed its folder/content on disk was untouched.
- Registry shape kept to exactly `{ id, path, name, lastOpenedAt }` + `activeWorkspaceId` for now — `reminderTime`/`lastReminderFiredDate` (milestone 17) and `sync` (milestone 6) fields land with their own milestones, not preemptively.

## Milestone 1 notes
- `server/src/types.ts` — `Task`, `ProjectFrontmatter`, `JournalFrontmatter`.
- `server/src/lib/ids.ts`, `server/src/lib/slug.ts` — task-id (`t_xxxxxx`, 6 hex chars — the PLAN.md examples are all 6 chars despite the `t_xxxxxxxx` placeholder) and project-slug helpers.
- `server/src/lib/markdown/frontmatter.ts` — thin `gray-matter` wrapper (parse/stringify), isolating the YAML library to one file.
- `server/src/lib/markdown/taskLine.ts` — the task-line grammar: fixed-order serialize, any-order parse, compact `@spent` duration format, description-block parsing (2-space indent, blank-line paragraph breaks). Non-checkbox body content is preserved verbatim as `raw` blocks interleaved with `task` blocks — nothing is silently dropped.
- `server/src/lib/markdown/{project,journal}.ts` — combine frontmatter + body parsing for each file type.
- Round-trip fixtures were generated by running the serializer itself (not hand-typed against a guessed YAML style), then committed and locked in by the round-trip test — this is what makes "byte-for-byte" achievable given `gray-matter`'s own YAML formatting choices (e.g. it emits `description: >-` folded-block style and `tags:` as a block list, not the inline style shown in PLAN.md's illustrative example; that's cosmetic, the schema is unchanged).

## Key decisions log
(Full rationale is in PLAN.md; this is a quick index so a future session doesn't re-litigate them.)

- **Storage**: markdown files are the sole source of truth; SQLite is a derived, always-rebuildable cache — never required to interpret vault content.
- **SQLite library**: `node:sqlite` (built into Node ≥22.5), not `better-sqlite3` (native module, Electron-rebuild friction) or `sql.js` (no real file-backed multi-process concurrency — ruled out because the server + MCP both need concurrent access via WAL mode).
- **Indexing**: reconciliation (stat-diff, parse only changed files) on workspace open, not a blind full reparse — keeps repeat startup fast regardless of vault size.
- **Agent access**: MCP server with full read+write, not a custom in-app chat/OpenAI-compatible feature — any MCP host supplies the agent loop for free.
- **Undo safety net for agent edits**: every workspace is its own git repo, auto-committed on every write (tagged by origin: `[api]` vs `[mcp:<tool>]`), with revert/history routes — independent of whatever approval flow the connecting MCP host does or doesn't have.
- **Multi-workspace**: Obsidian-style — any folder can be a workspace, app-level registry at `~/.pivot/config.json`, one active workspace per running app instance, MCP targets an explicit workspace independent of what's open in the app.
- **Remote sync**: git push/pull to a user-supplied remote, no credential management (shells out to the user's own git setup); conflicts are surfaced, never auto-merged. Built behind a `SyncProvider` interface so Google Drive/WebDAV could be added later without a redesign — though passive folder-sync via those tools already works today with zero extra code.
- **Desktop shell**: Electron, not a plain browser-opened web app (direction change) — a thin wrap: the main process launches the existing Express server locally and points a `BrowserWindow` at it, no IPC rewrite of the REST API. Chosen specifically to get a native folder picker and a reliable daily reminder (native OS notification), neither of which a browser tab can do. The main process **spawns** the server as its own process (not an in-process import) — see "Milestone 3 notes" for why.
- **Daily reminder**: tray-resident app (window close hides, doesn't quit) with start-at-login **on by default but user-toggleable**; per-workspace reminder time in `~/.pivot/config.json`; a main-process scheduler fires a native notification only if today's journal entry is still empty, once per day.
