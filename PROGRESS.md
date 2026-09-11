# Progress Tracker

Tracks implementation of [PLAN.md](PLAN.md). Update this file as milestones start/finish — check a box only when its own Verify step (from PLAN.md) has actually been run, not just when code is written.

## Status: not started (design complete, approved; only project scaffold + a UI prototype canvas exist)

## Scaffold done so far
- [x] Root `package.json` (npm workspaces: server, client — **needs an `electron` workspace added**) + `.gitignore`
- [x] `server/package.json` (Express, gray-matter, date-fns, cors, tsx, typescript; no SQLite npm dep — using `node:sqlite`)
- [x] Empty directory tree: `server/src/{lib,routes}`, `client/src/{components,pages,api}`, `vault/{projects,journal}`
- [x] `design/` — UI prototype canvas (source files + live link), see [design/README.md](design/README.md)
- [ ] Everything else below

## Milestones

- [ ] **1. Vault + markdown core v2** — task grammar (description/created/doing-timer tokens) + project/journal frontmatter v2, workspace-path-agnostic.
- [ ] **2. Workspace management** — `~/.pivot/config.json` registry, add/list/open/remove, `.pivot/` scaffold-on-open.
- [ ] **3. Electron shell** — `electron/` workspace, `main.ts` (embedded server + `BrowserWindow`, hide-not-close), `preload.ts` (`pickFolder`, login-item/reminder bridges).
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

## Key decisions log
(Full rationale is in PLAN.md; this is a quick index so a future session doesn't re-litigate them.)

- **Storage**: markdown files are the sole source of truth; SQLite is a derived, always-rebuildable cache — never required to interpret vault content.
- **SQLite library**: `node:sqlite` (built into Node ≥22.5), not `better-sqlite3` (native module, Electron-rebuild friction) or `sql.js` (no real file-backed multi-process concurrency — ruled out because the server + MCP both need concurrent access via WAL mode).
- **Indexing**: reconciliation (stat-diff, parse only changed files) on workspace open, not a blind full reparse — keeps repeat startup fast regardless of vault size.
- **Agent access**: MCP server with full read+write, not a custom in-app chat/OpenAI-compatible feature — any MCP host supplies the agent loop for free.
- **Undo safety net for agent edits**: every workspace is its own git repo, auto-committed on every write (tagged by origin: `[api]` vs `[mcp:<tool>]`), with revert/history routes — independent of whatever approval flow the connecting MCP host does or doesn't have.
- **Multi-workspace**: Obsidian-style — any folder can be a workspace, app-level registry at `~/.pivot/config.json`, one active workspace per running app instance, MCP targets an explicit workspace independent of what's open in the app.
- **Remote sync**: git push/pull to a user-supplied remote, no credential management (shells out to the user's own git setup); conflicts are surfaced, never auto-merged. Built behind a `SyncProvider` interface so Google Drive/WebDAV could be added later without a redesign — though passive folder-sync via those tools already works today with zero extra code.
- **Desktop shell**: Electron, not a plain browser-opened web app (direction change) — a thin wrap: the main process launches the existing Express server locally and points a `BrowserWindow` at it, no IPC rewrite of the REST API. Chosen specifically to get a native folder picker and a reliable daily reminder (native OS notification), neither of which a browser tab can do.
- **Daily reminder**: tray-resident app (window close hides, doesn't quit) with start-at-login **on by default but user-toggleable**; per-workspace reminder time in `~/.pivot/config.json`; a main-process scheduler fires a native notification only if today's journal entry is still empty, once per day.
