# Milestone 2 notes

[← back to PROGRESS.md](../../PROGRESS.md)

- `server/src/lib/workspaces.ts` — pure registry I/O (`~/.pivot/config.json` read/write) + `scaffoldWorkspaceDirs` (`.pivot/{cache,backups}`, `projects/`, `journal/`, gitignoring `.pivot/`) + `ensureGitRepo` (best-effort `git init`, reused by `vaultGit.ts` in milestone 5).
- `server/src/services/workspaces.ts` — `addWorkspace` (register + scaffold + activate; adopts an already-registered path instead of duplicating), `openWorkspace` (switch active + re-scaffold, so a moved/copied workspace self-heals), `removeWorkspace` (unregister only, never touches the folder), `listWorkspaces`, `getActiveWorkspace`. All take an optional `homeDir` param (defaults to `os.homedir()`) purely so tests can point at a scratch registry.
- `server/src/routes/workspaces.ts` — `GET /api/workspaces`, `GET /api/workspaces/active`, `POST /api/workspaces`, `POST /api/workspaces/:id/open`, `DELETE /api/workspaces/:id`, all thin wrappers over the service layer.
- `server/src/index.ts` — first real server entrypoint (`createApp`/`startServer`, binds `127.0.0.1` only); direct-run uses a fixed dev port (`4174`, overridable via `PORT`), `startServer(0)` picks a free ephemeral port for embedding (used by Electron in milestone 3).
- Verified live: registered two scratch folders via curl, confirmed each got its own `.pivot/`/`.git`/`.gitignore`, switched active between them, deleted one's `.pivot/` and confirmed re-opening self-heals it, removed one and confirmed its folder/content on disk was untouched.
- Registry shape kept to exactly `{ id, path, name, lastOpenedAt }` + `activeWorkspaceId` for now — `reminderTime`/`lastReminderFiredDate` (milestone 17) and `sync` (milestone 6) fields land with their own milestones, not preemptively.
